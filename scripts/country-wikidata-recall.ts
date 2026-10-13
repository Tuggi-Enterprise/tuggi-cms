/**
 * BR-POI-011 item 11 — national recall by Wikidata, a mandatory step for a new country, between the
 * refine (or the homolog) and the batch: UNESCO, the national monument class, castles/châteaux with a
 * protection AND a visitation signal, spas, first-rank nature. What the refined file lacks comes back
 * as a GeoJSON for the same importer (scripts/import-geojson-homolog.ts), by hand.
 *
 * Read-only on the network and the PBF; writes only under output/. Czechia, 2026-10-09: 63 objects
 * came back this way (Kladruby, Teplá, the spa colonnades, the national parks).
 *
 *   npx tsx scripts/country-wikidata-recall.ts <refined.geojson> --pbf <country.osm.pbf> --iso CZ \
 *     --country-qid Q213 [--national Q649434] [--national-signal Q30118401] [--category spa:"Kategorie:Kolonády v Česku"]... \
 *     [--castle-pv-cut 300]
 *
 * --national: the country's national monument designation(s) (P1435); --national-signal: designations that
 *   only count as a castle's visitation signal (CZ: Q30118401, part of a national monument). List them first with
 *   SELECT ?h (COUNT(?i) AS ?n) { ?i wdt:P17 wd:<country>; wdt:P1435 ?h } GROUP BY ?h ORDER BY DESC(?n)
 * --category: a category of the local Wikipedia whose members join a class (spa | nature). Czech
 *   show caves and rock towns are P31 of nothing useful; the cs-wiki categories carry them.
 * --castle-pv-cut: local-wiki pageviews over 60 days; default = p75 of the castles (CZ: p75 252, cut 300).
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { COUNTRY_LANGUAGE, percentile } from '../lib/services/country-relevance'
import { splitOnLineFeed } from '../lib/services/osm-local-data-service'

const UA = { 'User-Agent': 'TuggiCMS/1.0 (https://tuggi.app)' }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const chunks = <T>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n))
const ENTITY = 'http://www.wikidata.org/entity/'

// Classes. `P279*` inside the main pattern times out: the castle subclasses are resolved first.
const CLASS_QUERIES: Record<string, (c: string) => string> = {
  unesco: c => `SELECT DISTINCT ?i WHERE {
    { ?i wdt:P1435 wd:Q9259 } UNION { ?i wdt:P1435 wd:Q43113623 } UNION { ?i wdt:P757 [] }
    UNION { ?w wdt:P1435 wd:Q9259 ; wdt:P17 wd:${c} . ?i wdt:P361 ?w }
    ?i wdt:P17 wd:${c} . }`,
  castles: c => `SELECT DISTINCT ?i WITH { SELECT DISTINCT ?t WHERE { VALUES ?k { wd:Q23413 wd:Q751876 wd:Q17715832 } ?t wdt:P279* ?k } } AS %t
    WHERE { INCLUDE %t . ?i wdt:P31 ?t ; wdt:P17 wd:${c} . }`,
  // spa town, spa, spa colonnade, colonnade, spa house (house only with a signal); springs inside a spa town.
  spa: c => `SELECT DISTINCT ?i ?kind WHERE {
    { VALUES (?k ?kind) { (wd:Q4946461 "core") (wd:Q1341387 "core") (wd:Q131564953 "core") (wd:Q657100 "core") (wd:Q61708634 "house") }
      ?i wdt:P31 ?k ; wdt:P17 wd:${c} . }
    UNION { ?town wdt:P31 wd:Q4946461 ; wdt:P17 wd:${c} . VALUES ?s { wd:Q1365924 wd:Q124714 } ?i wdt:P31 ?s ; wdt:P131 ?town . BIND("spring" AS ?kind) } }`,
  // national parks, show caves, rock formations with a protection or a Wikivoyage page.
  nature: c => `SELECT DISTINCT ?i WHERE {
    { ?i wdt:P31 wd:Q46169 ; wdt:P17 wd:${c} . } UNION { ?i wdt:P31 wd:Q2232001 ; wdt:P17 wd:${c} . }
    UNION { VALUES ?k { wd:Q631305 wd:Q1404150 wd:Q954501 wd:Q9337566 } ?i wdt:P31 ?k ; wdt:P17 wd:${c} .
      { ?i wdt:P1435 [] } UNION { ?a schema:about ?i ; schema:isPartOf ?site . FILTER(CONTAINS(STR(?site), "wikivoyage")) } } }`,
}
const nationalQuery = (c: string, ids: string[]) => `SELECT DISTINCT ?i WHERE { VALUES ?h { ${ids.map(x => `wd:${x}`).join(' ')} } ?i wdt:P1435 ?h ; wdt:P17 wd:${c} . }`
const detailsQuery = (ids: string[], lang: string) => `SELECT ?i ?label ?en ?coord
  (GROUP_CONCAT(DISTINCT STRAFTER(STR(?h),"entity/");separator=",") AS ?p1435)
  (SAMPLE(?lw) AS ?localwiki) (SAMPLE(?enw) AS ?enwiki) (SAMPLE(?dew) AS ?dewiki) (COUNT(DISTINCT ?voy) AS ?voyage)
WHERE { VALUES ?i { ${ids.map(x => `wd:${x}`).join(' ')} }
  OPTIONAL { ?i rdfs:label ?label FILTER(lang(?label)="${lang}") } OPTIONAL { ?i rdfs:label ?en FILTER(lang(?en)="en") }
  OPTIONAL { ?i wdt:P625 ?coord } OPTIONAL { ?i wdt:P1435 ?h }
  OPTIONAL { ?a1 schema:about ?i ; schema:isPartOf <https://${lang}.wikipedia.org/> ; schema:name ?lw }
  OPTIONAL { ?a2 schema:about ?i ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?enw }
  OPTIONAL { ?a3 schema:about ?i ; schema:isPartOf <https://de.wikipedia.org/> ; schema:name ?dew }
  OPTIONAL { ?voy schema:about ?i ; schema:isPartOf ?vs . FILTER(CONTAINS(STR(?vs),"wikivoyage")) }
} GROUP BY ?i ?label ?en ?coord`

async function sparql(q: string): Promise<Array<Record<string, string>>> {
  for (let k = 0; ; k++) {
    const r = await fetch('https://query.wikidata.org/sparql', { method: 'POST', headers: { ...UA, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/sparql-results+json' }, body: 'query=' + encodeURIComponent(q) })
    // The endpoint sometimes cuts a large answer mid-stream (CZ castles, 2026-10-09): retry on a broken body.
    const body = r.ok ? await r.text().then(t => { try { return JSON.parse(t) } catch { return null } }) : null
    if (body) return body.results.bindings.map((b: any) => Object.fromEntries(Object.entries<any>(b).map(([k, v]) => [k, String(v.value).replace(ENTITY, '')])))
    if (k >= 4) throw new Error(`SPARQL ${r.status}${r.ok ? " (truncated body)" : ""}`)
    await sleep(5000 * (k + 1))
  }
}
async function mw(host: string, params: Record<string, string>): Promise<any> {
  const u = `https://${host}/w/api.php?` + new URLSearchParams({ format: 'json', formatversion: '2', ...params })
  for (let k = 0; ; k++) {
    const r = await fetch(u, { headers: UA })
    const body = r.ok ? await r.text().then(t => { try { return JSON.parse(t) } catch { return null } }) : null
    if (body) return body
    if (k >= 4) throw new Error(`${host} ${r.status}`)
    await sleep(3000)
  }
}

interface Item { q: string; label?: string; en?: string; lat?: number; lon?: number; p1435: string[]; localwiki?: string; enwiki?: string; dewiki?: string; voyage: number; classes: Set<string>; spaKind?: string; category?: string; enLen?: number; deLen?: number; pv60?: number }

async function main() {
  const args = process.argv.slice(2)
  const refined = args[0]
  const opt = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined }
  const all = (n: string) => args.flatMap((a, i) => a === n ? [args[i + 1]] : [])
  const iso = opt('--iso')?.toUpperCase(), countryQ = opt('--country-qid'), pbf = opt('--pbf')
  const lang = opt('--lang') ?? (iso ? COUNTRY_LANGUAGE[iso] : undefined)
  if (!refined || !countryQ || !pbf || !lang) { console.error('usage: <refined.geojson> --pbf <pbf> --iso <CC> --country-qid <Q> [--lang xx] [--national Q,Q] [--category class:Title]... [--castle-pv-cut N]'); process.exit(1) }
  const national = (opt('--national') ?? '').split(',').filter(Boolean)
  // A part of a national monument (CZ Q30118401) is a visitation signal for a castle, not a class of its own.
  const nationalSignal = new Set([...national, ...(opt('--national-signal') ?? '').split(',').filter(Boolean), 'Q9259', 'Q43113623'])

  // 1. Selection
  const items = new Map<string, Item>()
  const add = (q: string, cls: string, extra: Partial<Item> = {}) => { const it = items.get(q) ?? { q, p1435: [], voyage: 0, classes: new Set<string>() }; it.classes.add(cls); Object.assign(it, extra); items.set(q, it) }
  for (const [cls, query] of Object.entries(CLASS_QUERIES)) for (const r of await sparql(query(countryQ))) add(r.i, cls, r.kind ? { spaKind: r.kind } : {})
  if (national.length) for (const r of await sparql(nationalQuery(countryQ, national))) add(r.i, 'national')
  for (const spec of all('--category')) {
    const [cls, ...t] = spec.split(':'); const title = t.join(':'); let cont: Record<string, string> | null = {}
    do {
      const j = await mw(`${lang}.wikipedia.org`, { action: 'query', generator: 'categorymembers', gcmtitle: title, gcmnamespace: '0', gcmlimit: '500', prop: 'pageprops', ppprop: 'wikibase_item', ...cont })
      for (const p of j.query?.pages ?? []) if (p.pageprops?.wikibase_item) add(p.pageprops.wikibase_item, cls, { category: title })
      cont = j.continue ?? null
    } while (cont)
  }
  console.log(`selected: ${items.size} items (${Object.keys(CLASS_QUERIES).join(', ')}${national.length ? ', national' : ''}${all('--category').length ? ', categories' : ''})`)

  // 2. Details: labels, coordinates, P1435, articles, Wikivoyage; article size en/de; local pageviews (60 d)
  for (const c of chunks([...items.keys()], 250)) for (const r of await sparql(detailsQuery(c, lang))) {
    const it = items.get(r.i)!; const m = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(r.coord ?? '')
    Object.assign(it, { label: r.label, en: r.en, lat: m ? +m[2] : undefined, lon: m ? +m[1] : undefined, p1435: r.p1435 ? r.p1435.split(',') : [], localwiki: r.localwiki, enwiki: r.enwiki, dewiki: r.dewiki, voyage: +r.voyage })
  }
  for (const [wiki, key, out] of [['en', 'enwiki', 'enLen'], ['de', 'dewiki', 'deLen']] as const) {
    const L = [...items.values()].filter(x => x[key])
    for (const b of chunks(L, 50)) {
      const j = await mw(`${wiki}.wikipedia.org`, { action: 'query', prop: 'info', redirects: '1', titles: b.map(x => x[key]!).join('|') })
      const back = new Map<string, string>(); for (const n of [...(j.query.normalized ?? []), ...(j.query.redirects ?? [])]) back.set(n.to, back.get(n.from) ?? n.from)
      for (const p of j.query.pages) { const t = back.get(p.title) ?? p.title; const it = b.find(x => x[key] === t); if (it) it[out] = p.length }
    }
  }
  const local = [...items.values()].filter(x => x.localwiki)
  for (const b of chunks(local, 50)) {
    let cont: Record<string, string> | null = {}
    do {
      const j = await mw(`${lang}.wikipedia.org`, { action: 'query', prop: 'pageviews', pvipdays: '60', titles: b.map(x => x.localwiki!).join('|'), ...cont })
      for (const p of j.query.pages) { const it = b.find(x => x.localwiki === p.title); if (it && p.pageviews) it.pv60 = Object.values<number | null>(p.pageviews).reduce((s: number, v) => s + (v ?? 0), 0) }
      cont = j.continue ?? null
    } while (cont)
  }

  // 3. Gate per class: castles = any P1435 AND a visitation signal; spa house only with a signal; springs need a local article.
  const castlePvs = [...items.values()].filter(x => x.classes.has('castles') && x.p1435.length).map(x => x.pv60 ?? 0)
  const pvCut = opt('--castle-pv-cut') !== undefined ? Number(opt('--castle-pv-cut')) : percentile(castlePvs, 0.75)
  const LEN_CUT = 5000
  const signal = (x: Item) => x.voyage > 0 || Math.max(x.enLen ?? 0, x.deLen ?? 0) >= LEN_CUT || (x.pv60 ?? 0) >= pvCut || x.p1435.some(h => nationalSignal.has(h))
  const keep = (x: Item, c: string) => c === 'castles' ? x.p1435.length > 0 && signal(x)
    : c === 'spa' ? !!x.category || x.spaKind === 'core' || (x.spaKind === 'spring' && !!x.localwiki) || (x.spaKind === 'house' && signal(x))
    : true
  const important = [...items.values()].filter(x => { for (const c of [...x.classes]) if (!keep(x, c)) x.classes.delete(c); return x.classes.size > 0 })
  console.log(`important: ${important.length} (castle pageview cut ${pvCut}${opt('--castle-pv-cut') ? '' : ' = p75 of the protected castles'})`)

  // 4. Against the refined file: by wikidata, else by name within 500 m (reported, not recalled).
  const byWd = new Set<string>(); const named: Array<{ name: string; lat: number; lon: number }> = []
  const fold = (s: string) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
  // The refined file passes 512 MB (a V8 string cannot hold it): one feature per line, streamed.
  for await (const line of splitOnLineFeed(fs.createReadStream(refined))) {
    const s = line.trim().replace(/,$/, ''); if (!s.startsWith('{"type":"Feature"')) continue
    const f = JSON.parse(s); const p = f.properties ?? {}
    for (const w of String(p.wikidata ?? '').split(';')) if (w.trim()) byWd.add(w.trim())
    let c = f.geometry?.coordinates; while (Array.isArray(c?.[0])) c = c[0]
    if (p.name && typeof c?.[0] === 'number') named.push({ name: fold(p.name), lon: c[0], lat: c[1] })
  }
  const metres = (a: number, b: number, c: number, d: number) => 1000 * Math.hypot((a - c) * 111.2, (b - d) * 111.2 * Math.cos((a * Math.PI) / 180))
  const missing = important.filter(x => !byWd.has(x.q))
  const nameOnly = missing.filter(x => x.lat !== undefined && named.some(n => (n.name === fold(x.label ?? '') || n.name === fold(x.en ?? '')) && metres(n.lat, n.lon, x.lat!, x.lon!) <= 500))
  const absent = missing.filter(x => !nameOnly.includes(x))
  console.log(`in the refined file by wikidata: ${important.length - missing.length} · by name ≤ 500 m (check by hand): ${nameOnly.length} · absent: ${absent.length}`)

  // 5. The absent ones that OSM tags with their wikidata: one object each (areal > point; a way only as a line is skipped).
  const stamp = Date.now(), outDir = 'output', sel = path.join(outDir, `recall-${stamp}.osm.pbf`), seq = path.join(outDir, `recall-${stamp}.geojsonseq`)
  const want = new Map(absent.map(x => [x.q, x]))
  const out: any[] = [], manifest: any[] = [], skipped: string[] = []
  if (want.size) {
    const exprPath = path.join(outDir, `recall-${stamp}.txt`)
    fs.writeFileSync(exprPath, chunks([...want.keys()], 200).map(c => `nwr/wikidata=${c.join(',')}`).join('\n'))
    const f = spawnSync('osmium', ['tags-filter', pbf, '--expressions', exprPath, '-o', sel, '--overwrite']); if (f.status !== 0) throw new Error(String(f.stderr))
    const e = spawnSync('osmium', ['export', sel, '-f', 'geojsonseq', '-a', 'type,id', '--overwrite', '-o', seq]); if (e.status !== 0) throw new Error(String(e.stderr))
    fs.unlinkSync(exprPath)
    const byQ = new Map<string, any[]>()
    for (const l of fs.readFileSync(seq, 'utf8').split('\n')) { const s = l.replace(/^\x1e/, '').trim(); if (!s) continue; const f = JSON.parse(s)
      for (const w of String(f.properties.wikidata ?? '').split(';')) if (want.has(w.trim())) (byQ.get(w.trim()) ?? byQ.set(w.trim(), []).get(w.trim())!).push(f) }
    for (const [q, x] of want) {
      const fs_ = (byQ.get(q) ?? []).filter(f => !(f.geometry.type === 'LineString' && f.properties['@type'] === 'way'))
      const f = fs_.find(f => /Polygon/.test(f.geometry.type)) ?? fs_.find(f => f.geometry.type === 'Point') ?? fs_[0]
      if (!f) { skipped.push(`${q} ${x.label ?? x.en ?? ''}: no OSM object tagged with it`); continue }
      if (!f.properties.name) { if (x.localwiki) f.properties.name = x.label; else { skipped.push(`${q} ${x.label ?? ''}: unnamed in OSM, no ${lang} article`); continue } }
      out.push(f); manifest.push({ q, key: `${f.properties['@type']}/${f.properties['@id']}`, name: f.properties.name, classes: [...x.classes], pv60: x.pv60, p1435: x.p1435 })
    }
    fs.unlinkSync(sel); fs.unlinkSync(seq)
  }
  const base = path.join(outDir, `${path.basename(refined, '.geojson')}-recall`)
  fs.writeFileSync(`${base}.geojson`, '{"type":"FeatureCollection","features":[\n' + out.map(f => JSON.stringify(f)).join(',\n') + '\n]}\n')
  fs.writeFileSync(`${base}-manifest.json`, JSON.stringify({ pvCut, manifest, skipped, nameOnly: nameOnly.map(x => `${x.q} ${x.label ?? x.en}`) }, null, 1))
  console.log(`recall: ${out.length} objects -> ${base}.geojson · skipped ${skipped.length} (UNESCO/national items with no OSM object are usually area concepts or movable goods) · manifest ${base}-manifest.json`)
  for (const m of manifest) console.log(`  ${m.classes.join('/')} | ${m.name} | ${m.key}`)
}

main().catch(e => { console.error(e); process.exit(1) })
