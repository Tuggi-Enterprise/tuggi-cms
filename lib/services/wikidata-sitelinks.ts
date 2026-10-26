/**
 * Wikidata item -> what it says about an OSM object: its Wikipedia article (sitelinks), its heritage
 * designations (P1435) and whether it has a Wikivoyage page.
 *
 * A national register can mint one Wikidata item per object (the Austrian BDA did for every listed
 * monument, the Czech water register for every pond), so an OSM `wikidata` tag alone does not say
 * anyone wrote about the place. An article does — BR-POI-011 item 0. Used by
 * scripts/refine-pbf-elite-node to fill `wikipedia` and to pass P1435/Wikivoyage to the elite
 * filter (lib/shared/poi-filter#shouldFilterPOI) before it runs.
 */
import fs from 'node:fs'

// Projects that are not an encyclopedia article written by people: cebwiki is bot-generated.
const NOT_AN_ARTICLE = new Set(['commonswiki', 'cebwiki', 'specieswiki', 'wikidatawiki', 'metawiki', 'sourceswiki', 'wikimaniawiki'])
const PREFERRED = ['en', 'de', 'fr', 'it', 'es', 'pt', 'nl']
const BATCH = 50 // wbgetentities limit for anonymous clients
const UA = { 'User-Agent': 'TuggiCMS/1.0 (https://tuggi.app)' }

/** Picks the `lang:Title` OSM writes in `wikipedia`, or null when the item has no article. */
export function pickArticle(sitelinks: Record<string, { title: string }>): string | null {
  const wikis = Object.keys(sitelinks).filter(site => /^[a-z_-]+wiki$/.test(site) && !NOT_AN_ARTICLE.has(site))
  if (!wikis.length) return null
  const site = PREFERRED.map(l => `${l}wiki`).find(w => wikis.includes(w)) ?? wikis.sort()[0]
  return `${site.slice(0, -4).replace(/_/g, '-')}:${sitelinks[site].title}`
}

export interface WikidataFacts {
  /** `lang:Title` of the article (pickArticle), or null: no article in any language. */
  article: string | null
  /** P1435 (heritage designation) values. */
  heritage: string[]
  /** The item has a Wikivoyage page in some language. */
  wikivoyage: boolean
  /** Wikipedia titles for the languages asked (`languages`), by language code. */
  titles: Record<string, string>
}

/** One Wikidata entity (wbgetentities, props=claims|sitelinks) -> WikidataFacts. */
export function factsOf(entity: any, languages: readonly string[]): WikidataFacts {
  const sitelinks: Record<string, { title: string }> = entity?.sitelinks ?? {}
  const titles: Record<string, string> = {}
  for (const lang of languages) if (sitelinks[`${lang}wiki`]) titles[lang] = sitelinks[`${lang}wiki`].title
  return {
    article: pickArticle(sitelinks),
    heritage: (entity?.claims?.P1435 ?? []).map((c: any) => c.mainsnak?.datavalue?.value?.id).filter(Boolean),
    wikivoyage: Object.keys(sitelinks).some(site => site.endsWith('wikivoyage')),
    titles,
  }
}

async function getJson(url: string, init: RequestInit = {}): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { ...init, headers: { ...UA, ...(init.headers as Record<string, string> ?? {}) } })
    if (res.ok) return res.json()
    if (attempt >= 6 || (res.status !== 429 && res.status < 500)) throw new Error(`HTTP ${res.status} ${url.slice(0, 120)}`)
    await new Promise(r => setTimeout(r, 1000 * 2 ** attempt))
  }
}

/**
 * Resolves each Q-id. Throws when Wikidata does not answer: a silent miss would drop every object
 * whose only reference is its article. `cachePath` keeps the answers between runs (JSON by Q-id);
 * a cached item without one of `languages` in its titles is fetched again.
 */
export async function wikidataFacts(
  ids: string[],
  opts: { languages?: readonly string[]; cachePath?: string; onProgress?: (done: number, total: number) => void } = {},
): Promise<Map<string, WikidataFacts>> {
  const languages = [...new Set(['en', 'de', ...(opts.languages ?? [])])]
  const cache: Record<string, WikidataFacts & { langs?: string[] }> =
    opts.cachePath && fs.existsSync(opts.cachePath) ? JSON.parse(fs.readFileSync(opts.cachePath, 'utf8')) : {}
  const unique = [...new Set(ids.filter(id => /^Q\d+$/.test(id)))]
  const missing = unique.filter(id => !cache[id] || !languages.every(l => cache[id].langs?.includes(l)))
  for (let i = 0; i < missing.length; i += BATCH) {
    const chunk = missing.slice(i, i + BATCH)
    const body = await getJson(`https://www.wikidata.org/w/api.php?action=wbgetentities&props=claims|sitelinks&format=json&ids=${chunk.join('|')}`)
    for (const id of chunk) cache[id] = { ...factsOf(body.entities?.[id], languages), langs: languages }
    opts.onProgress?.(Math.min(i + BATCH, missing.length), missing.length)
    if (opts.cachePath && (i / BATCH) % 40 === 39) fs.writeFileSync(opts.cachePath, JSON.stringify(cache))
  }
  if (opts.cachePath && missing.length) fs.writeFileSync(opts.cachePath, JSON.stringify(cache))
  const out = new Map<string, WikidataFacts>()
  for (const id of unique) {
    const { langs: _langs, ...facts } = cache[id]
    out.set(id, facts)
  }
  return out
}

/** The first Q-id of an OSM `wikidata` value ("Q1;Q2" happens), or null. */
export function firstQid(value: unknown): string | null {
  const q = String(value ?? '').split(';')[0].trim()
  return /^Q\d+$/.test(q) ? q : null
}

/**
 * The Wikidata properties by which an item declares the OSM object it is. An object mapped without
 * its `wikidata` tag still has its article, P1435 and Wikivoyage on the item that points at it
 * (Mexico recall 2026-10-22: 125 objects). The link is the declared id, never the name: matching by
 * name made 28 wrong pairs of 224.
 */
export const OSM_ID_PROPERTY = { relation: 'P402', way: 'P10689', node: 'P11693' } as const
export type OsmType = keyof typeof OSM_ID_PROPERTY
const SPARQL_BATCH = 300

/**
 * SPARQL bindings (?osm, ?item) of one property into `out`, keyed "type/id". An object two items
 * claim is ambiguous and links to neither (kept as '' so a later binding cannot revive it).
 */
export function linksFromBindings(type: OsmType, bindings: any[], out: Map<string, string>): void {
  for (const b of bindings) {
    const id = String(b?.osm?.value ?? '').trim()
    const q = /\/(Q\d+)$/.exec(String(b?.item?.value ?? ''))?.[1]
    if (!/^\d+$/.test(id) || !q) continue
    const key = `${type}/${id}`
    const seen = out.get(key)
    out.set(key, seen === undefined || seen === q ? q : '')
  }
}

/** Sets `wikidata` from `links` when the object has none; true when it did. */
export function withLinkedWikidata(props: any, links: Map<string, string>): boolean {
  if (firstQid(props?.wikidata)) return false
  const q = links.get(`${props?.['@type']}/${props?.['@id']}`)
  if (!q) return false
  props.wikidata = q
  return true
}

/**
 * The item that declares each OSM object ("node/1", "way/2", "relation/3"), through the Wikidata
 * Query Service. `cachePath` keeps every asked key between runs ('' = no item, or ambiguous).
 * Throws when the service does not answer, as wikidataFacts does.
 */
export async function osmLinkedItems(
  keys: string[], opts: { cachePath?: string; onProgress?: (done: number, total: number) => void } = {},
): Promise<Map<string, string>> {
  const cache: Record<string, string> = opts.cachePath && fs.existsSync(opts.cachePath) ? JSON.parse(fs.readFileSync(opts.cachePath, 'utf8')) : {}
  const unique = [...new Set(keys)].filter(k => /^(node|way|relation)\/\d+$/.test(k))
  const missing = unique.filter(k => cache[k] === undefined)
  let done = 0
  for (const type of Object.keys(OSM_ID_PROPERTY) as OsmType[]) {
    const ids = missing.filter(k => k.startsWith(`${type}/`)).map(k => k.slice(type.length + 1))
    for (let i = 0; i < ids.length; i += SPARQL_BATCH) {
      const chunk = ids.slice(i, i + SPARQL_BATCH)
      const query = `SELECT ?osm ?item WHERE { VALUES ?osm { ${chunk.map(id => `"${id}"`).join(' ')} } ?item wdt:${OSM_ID_PROPERTY[type]} ?osm }`
      const body = await getJson('https://query.wikidata.org/sparql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/sparql-results+json' },
        body: `query=${encodeURIComponent(query)}`,
      })
      const found = new Map<string, string>()
      linksFromBindings(type, body?.results?.bindings ?? [], found)
      for (const id of chunk) cache[`${type}/${id}`] = found.get(`${type}/${id}`) ?? ''
      done += chunk.length
      opts.onProgress?.(done, missing.length)
    }
  }
  if (opts.cachePath && missing.length) fs.writeFileSync(opts.cachePath, JSON.stringify(cache))
  const out = new Map<string, string>()
  for (const k of unique) if (cache[k]) out.set(k, cache[k])
  return out
}

/**
 * The items of `ids` that are an instance (P31) of `classId` or of a subclass of it (P279, any depth), through the
 * Wikidata Query Service. `cachePath` keeps every asked item between runs, per class. Throws when the service does not
 * answer, as wikidataFacts does.
 */
export async function instancesOfClass(
  ids: string[], classId: string, opts: { cachePath?: string } = {},
): Promise<Set<string>> {
  const cache: Record<string, Record<string, boolean>> = opts.cachePath && fs.existsSync(opts.cachePath) ? JSON.parse(fs.readFileSync(opts.cachePath, 'utf8')) : {}
  const known = cache[classId] ??= {}
  const unique = [...new Set(ids.filter(id => /^Q\d+$/.test(id)))]
  const missing = unique.filter(id => known[id] === undefined)
  for (let i = 0; i < missing.length; i += SPARQL_BATCH) {
    const chunk = missing.slice(i, i + SPARQL_BATCH)
    const query = `SELECT DISTINCT ?item WHERE { VALUES ?item { ${chunk.map(id => `wd:${id}`).join(' ')} } ?item wdt:P31/wdt:P279* wd:${classId} }`
    const body = await getJson('https://query.wikidata.org/sparql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/sparql-results+json' },
      body: `query=${encodeURIComponent(query)}`,
    })
    const found = new Set((body?.results?.bindings ?? []).map((b: any) => /\/(Q\d+)$/.exec(String(b?.item?.value ?? ''))?.[1]))
    for (const id of chunk) known[id] = found.has(id)
  }
  if (opts.cachePath && missing.length) fs.writeFileSync(opts.cachePath, JSON.stringify(cache))
  return new Set(unique.filter(id => known[id]))
}

/**
 * Keeps the links whose item is a reference (BR-POI-011 item 0: article, P1435 or Wikivoyage). A bare
 * item would still count as fame outside the item-0 gates (poi-filter#shouldFilterPOI hasWikidata):
 * Nova Scotia (2026-10-25) linked 40 churches through register items with no article.
 */
export function referencedLinks(links: Map<string, string>, facts: Map<string, WikidataFacts>): Map<string, string> {
  return new Map([...links].filter(([, q]) => {
    const f = facts.get(q)
    return !!f && (!!f.article || f.heritage.length > 0 || f.wikivoyage)
  }))
}
