import { spawnSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { splitOnLineFeed } from '../lib/services/osm-local-data-service';
import { shouldFilterPOI, pickCategory, CATEGORIES } from '../lib/shared/poi-filter';
import { wikidataFacts, firstQid, type WikidataFacts } from '../lib/services/wikidata-sitelinks';
import { scenicRoadFeatures } from '../lib/services/osm-scenic-roads';
import { polygonContains, type RegionPolygon } from '../lib/services/local-osm-regions';
import { scanMunicipalSeats, municipalityAdminLevels } from '../lib/services/admin-boundaries';
import { representativePoint } from '../lib/utils/geometry';
import {
  COUNTRY_LANGUAGE, VILLAGE_PAGEVIEW_PERCENTILE, placeClass, tagStrength, signalStrength, percentile,
  proseLengths, monthlyPageviews, nameInCountryLanguage, type VillageSignals, type Strength,
} from '../lib/services/country-relevance';

/**
 * A Geofabrik country extract reaches kilometres past the border (its .poly is a buffer), and the
 * importer stamps every row with the one country passed on the command line. The Austrian extract
 * carried Italian lakes and Czech nature reserves that way. The national border is the
 * admin_level=2 relation tagged ISO3166-1=<code>, assembled by osmium from the same PBF.
 */
export function nationalBorder(inputPath: string, iso: string, outputDir: string, timestamp: number): RegionPolygon {
  const relPbf = path.join(outputDir, `border-${timestamp}.osm.pbf`);
  const relJson = path.join(outputDir, `border-${timestamp}.geojson`);
  const f = spawnSync('osmium', ['tags-filter', inputPath, `r/ISO3166-1=${iso}`, '-o', relPbf, '--overwrite']);
  if (f.status !== 0) throw new Error(`osmium tags-filter (border) failed: ${f.stderr}`);
  const e = spawnSync('osmium', ['export', relPbf, '--geometry-types=polygon', '-o', relJson, '--overwrite']);
  if (e.status !== 0) throw new Error(`osmium export (border) failed: ${e.stderr}`);
  const fc = JSON.parse(fs.readFileSync(relJson, 'utf8'));
  fs.unlinkSync(relPbf);
  fs.unlinkSync(relJson);
  const country = fc.features.find((x: any) => x.properties?.admin_level === '2');
  if (!country) throw new Error(`No admin_level=2 relation with ISO3166-1=${iso} in ${inputPath}`);
  const polys = country.geometry.type === 'Polygon' ? [country.geometry.coordinates] : country.geometry.coordinates;
  return { outer: polys.map((p: any) => p[0]), holes: polys.flatMap((p: any) => p.slice(1)) };
}

/** Metres from a point to the nearest border segment (equirectangular; fine at this scale). */
export function metresToBorder(border: RegionPolygon, lng: number, lat: number): number {
  const kx = 111320 * Math.cos((lat * Math.PI) / 180), ky = 110540;
  let best = Infinity;
  for (const ring of [...border.outer, ...border.holes]) {
    for (let i = 1; i < ring.length; i++) {
      const ax = (ring[i - 1][0] - lng) * kx, ay = (ring[i - 1][1] - lat) * ky;
      const bx = (ring[i][0] - lng) * kx, by = (ring[i][1] - lat) * ky;
      const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
      const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
      best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
    }
  }
  return best;
}

// A summit or pass on the border line falls on either side of it by a few metres of mapping.
export const BORDER_TOLERANCE_M = 150;

/**
 * BR-POI-011 item 6: the representative point (the pin the importer stores, lib/utils/geometry)
 * decides. Outside the ISO border it goes, unless it is within BORDER_TOLERANCE_M of the line AND
 * named in the country's language — the summit or marker that defines the border (Sněžka, 5 m).
 * Kościół… and Urzeitpark Sebnitz, a few metres past the line, go.
 */
export function borderVerdict(border: RegionPolygon, feature: any, lang: string | undefined): 'inside' | 'tolerated' | 'abroad' {
  const pt = representativePoint(feature.geometry);
  if (!pt) return 'abroad';
  if (polygonContains(border, pt[1], pt[0])) return 'inside';
  if (metresToBorder(border, pt[0], pt[1]) <= BORDER_TOLERANCE_M && nameInCountryLanguage(feature.properties ?? {}, lang)) return 'tolerated';
  return 'abroad';
}

/**
 * Municipal seats (BR-POI-010 item 4) of the extract, as "node/123": the admin_centre (else label)
 * member of each boundary=administrative relation at the country's municipal level(s).
 */
export async function municipalSeats(inputPath: string, iso: string, outputDir: string, timestamp: number): Promise<Set<string>> {
  const relPbf = path.join(outputDir, `admin-${timestamp}.osm.pbf`);
  const f = spawnSync('osmium', ['tags-filter', inputPath, 'r/boundary=administrative', '-R', '-o', relPbf, '--overwrite']);
  if (f.status !== 0) throw new Error(`osmium tags-filter (admin) failed: ${f.stderr}`);
  const levels = new Set(municipalityAdminLevels(iso).map(String));
  const proc = spawn('osmium', ['cat', relPbf, '-t', 'relation', '-f', 'opl,add_metadata=false', '-o', '-']);
  async function* municipal() {
    for await (const line of splitOnLineFeed(proc.stdout)) {
      const level = /(?:[ ,]T|,)admin_level=([^,\s]*)/.exec(line)?.[1];
      if (level && levels.has(level)) yield line;
    }
  }
  const scan = await scanMunicipalSeats(municipal());
  fs.unlinkSync(relPbf);
  const out = new Set<string>();
  for (const seats of scan.seats.values()) for (const s of seats) out.add(`${s.type}/${s.id}`);
  return out;
}

const objectKeyOf = (p: any) => `${p['@type']}/${p['@id']}`;
const kmBetween = (a: number[], b: number[]) => Math.hypot((a[0] - b[0]) * 111.32 * Math.cos((a[1] * Math.PI) / 180), (a[1] - b[1]) * 110.54);

/**
 * One feature per scenic road (lib/services/osm-scenic-roads), with the member ways past the border
 * cut: the importer pins the POI on the first coordinate, and the Timmelsjoch road starts in Italy.
 */
export async function scenicRoadsInside(inputPath: string, workDir: string, tag: string, border: RegionPolygon | null): Promise<any[]> {
  const inside = (pt: number[]) => !border || polygonContains(border, pt[1], pt[0]) || metresToBorder(border, pt[0], pt[1]) <= BORDER_TOLERANCE_M;
  const roads = await scenicRoadFeatures(inputPath, workDir, tag);
  // A road of the neighbour that touches the border stays out: the Deutsche Alpenstraße has 13 of its
  // 29 member ways on the Austrian side of the line (or the extract's idea of it).
  return roads.filter(road => {
    const all = road.geometry.coordinates;
    const strictly = all.filter((line: number[][]) => !border || polygonContains(border, line[0][1], line[0][0])).length;
    if (strictly * 2 <= all.length) return false;
    const lines = all.filter((line: number[][]) => inside(line[0]));
    road.geometry.coordinates = lines;
    return true;
  });
}

/** Village/neighbourhood held for BR-POI-011 item 8, decided after the whole file is read. */
interface HeldPlace { features: any[]; key: string; pt: [number, number] | null; seat: boolean }

/**
 * BR-POI-011 items 8–9 over the villages and neighbourhoods that passed the elite filter: which
 * strength keeps each one (null = it goes). Seats (BR-POI-010 item 4) never go; an areal place with
 * the same name within 3 km of a seat node is that seat too (the relation place=town beside its node).
 */
async function decidePlaces(
  held: HeldPlace[], facts: Map<string, WikidataFacts>, lang: string | undefined, pvCutArg: number | undefined, cacheDir: string,
): Promise<{ verdict: Map<HeldPlace, Strength | null>; pvCut: number; measured: Record<string, number> }> {
  const norm = (s: string) => String(s || '').toLowerCase().normalize('NFC').trim();
  const seatNodes = new Map<string, Array<[number, number]>>();
  for (const h of held) if (h.seat && h.pt) (seatNodes.get(norm(h.features[0].properties.name)) ?? seatNodes.set(norm(h.features[0].properties.name), []).get(norm(h.features[0].properties.name))!).push(h.pt);
  for (const h of held) {
    if (h.seat || !h.pt || h.features[0].properties['@type'] === 'node') continue;
    if ((seatNodes.get(norm(h.features[0].properties.name)) ?? []).some(s => kmBetween(s, h.pt!) < 3)) h.seat = true;
  }
  // Network signals only for the ones no tag keeps.
  const verdict = new Map<HeldPlace, Strength | null>();
  const need: Array<{ h: HeldPlace; titles: Record<string, string>; f?: WikidataFacts }> = [];
  for (const h of held) {
    const p = h.features[0].properties;
    const cheap = tagStrength(p, h.seat);
    if (cheap) { verdict.set(h, cheap); continue; }
    const q = firstQid(p.wikidata);
    const f = q ? facts.get(q) : undefined;
    const titles: Record<string, string> = { ...(f?.titles ?? {}) };
    const tag = /^([a-z-]+):(.+)$/.exec(String(p.wikipedia ?? ''));
    if (tag && !titles[tag[1]]) titles[tag[1]] = tag[2].trim();
    if (!f && !tag) { verdict.set(h, null); continue; }
    need.push({ h, titles, f });
  }
  const prose = { en: await proseLengths('en', need.map(n => n.titles.en).filter(Boolean)), de: await proseLengths('de', need.map(n => n.titles.de).filter(Boolean)) };
  const views = lang ? await monthlyPageviews(lang, need.map(n => n.titles[lang]).filter(Boolean), { cachePath: path.join(cacheDir, 'pageviews-cache.json') }) : new Map<string, number>();
  const signals = need.map(n => ({ n, s: {
    p1435: !!n.f?.heritage.length, wikivoyage: !!n.f?.wikivoyage,
    enProse: n.titles.en ? prose.en.get(n.titles.en) ?? 0 : 0, deProse: n.titles.de ? prose.de.get(n.titles.de) ?? 0 : 0,
    pageviews: lang && n.titles[lang] ? views.get(n.titles[lang]) ?? 0 : 0,
  } as VillageSignals }));
  // Item 9: the cut is measured over the villages ("as aldeias do próprio extrato") and applied to both
  // classes. Neighbourhoods are urban and read far more: mixed in, they lifted the CZ p96 from ~100 to 199.
  const pvs = signals.filter(x => placeClass(x.n.h.features[0].properties) === "village").map(x => x.s.pageviews);
  const measured = { n: pvs.length, p50: percentile(pvs, 0.5), p90: percentile(pvs, 0.9), p95: percentile(pvs, 0.95), p96: percentile(pvs, VILLAGE_PAGEVIEW_PERCENTILE) };
  const pvCut = pvCutArg ?? Math.max(1, measured.p96);
  for (const { n, s } of signals) verdict.set(n.h, signalStrength(s, pvCut));
  return { verdict, pvCut, measured };
}

async function main() {
  const args = process.argv.slice(2);
  const inputPath = args[0];
  const country = args[1] || 'Spain';
  const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const iso = opt('--iso')?.toUpperCase();
  const pvCutArg = opt('--village-pv-cut') !== undefined ? Number(opt('--village-pv-cut')) : undefined;
  const lang = opt('--lang') ?? (iso ? COUNTRY_LANGUAGE[iso] : undefined);

  if (!inputPath) {
    console.error('❌ Please provide the PBF file path');
    process.exit(1);
  }

  const outputDir = 'output';
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = Date.now();
  const fileName = path.basename(inputPath, '.osm.pbf');
  const finalOutputPath = path.join(outputDir, `${fileName}-elite-${timestamp}.geojson`);

  console.log('🌏 REFINED PBF UNIFIED FILTER (ELITE) - NODE VERSION');
  console.log('='.repeat(60));
  console.log(`📁 Input: ${inputPath}`);
  console.log(`📁 Output: ${finalOutputPath}`);
  console.log(`🌍 Country: ${country}`);
  const border = iso ? nationalBorder(inputPath, iso, outputDir, timestamp) : null;
  if (border) console.log(`🧭 Clipping to the ISO3166-1=${iso} border (${border.outer.length} outer rings; ±${BORDER_TOLERANCE_M} m only for a ${lang ?? '?'} name — BR-POI-011 item 6)`);
  else console.warn('⚠️  No --iso <code>: the extract buffer past the border is kept and stamped with this country.');
  if (iso && !lang) console.warn(`⚠️  No language for ${iso} (country-relevance#COUNTRY_LANGUAGE): pass --lang <wiki code>. Without it the village pageviews (BR-POI-011 item 9) and the border name exception (item 6) are off.`);
  const seats = iso ? await municipalSeats(inputPath, iso, outputDir, timestamp) : new Set<string>();
  if (iso) console.log(`🏛️  Municipal seats (BR-POI-010 item 4, levels ${municipalityAdminLevels(iso).join('/')}): ${seats.size.toLocaleString()}`);
  console.log('');

  // 1. Stage 1: Categorical Filter
  console.log('🚀 Stage 1: Fast Categorical Filter (osmium)...');
  const filteredPbf = path.join(outputDir, `filtered-${timestamp}.osm.pbf`);
  const expressionsPath = path.join(outputDir, `expressions-${timestamp}.txt`);

  const expressions = CATEGORIES.map(tag => `nwr/${tag}`).join('\n');
  fs.writeFileSync(expressionsPath, expressions);

  const stage1 = spawnSync('osmium', ['tags-filter', inputPath, '--expressions', expressionsPath, '-o', filteredPbf, '--overwrite']);

  if (stage1.status !== 0) {
    console.error('❌ Stage 1 failed:', stage1.stderr.toString());
    process.exit(1);
  }

  const stage1Stats = fs.statSync(filteredPbf);
  console.log(`✅ Stage 1 complete: ${filteredPbf} (${stage1Stats.size} bytes)`);

  if (stage1Stats.size < 500) {
    console.warn('⚠️  Filtered PBF is suspiciously small. It might be empty.');
  }

  fs.unlinkSync(expressionsPath);

  // 2. Stage 2: Convert to GeoJSON Seq
  console.log('\n🚀 Stage 2: Converting to GeoJSON Sequence...');
  const geojsonSeqPath = path.join(outputDir, `temp-${timestamp}.geojsonseq`);

  const stage2 = spawnSync('osmium', [
    'export', filteredPbf,
    '-f', 'geojsonseq',
    '-o', geojsonSeqPath,
    '--overwrite',
    '--attributes', 'type,id,version,timestamp'
  ]);

  if (stage2.status !== 0) {
    console.error('❌ Stage 2 failed:', stage2.stderr.toString());
    process.exit(1);
  }

  const stage2Stats = fs.statSync(geojsonSeqPath);
  console.log(`✅ Stage 2 complete: ${geojsonSeqPath} (${stage2Stats.size} bytes)`);

  // Scenic roads are route relations, which osmium export does not emit: built apart, appended so
  // Stage 3 judges them like everything else.
  const scenicRoads = await scenicRoadsInside(inputPath, outputDir, String(timestamp), border);
  for (const road of scenicRoads) fs.appendFileSync(geojsonSeqPath, JSON.stringify(road) + '\n');
  console.log(`   Scenic roads (route=road + scenic=yes) appended: ${scenicRoads.length}`);

  // 3. Stage 3: Unified Elite Filtering
  console.log('\n🚀 Stage 3: Unified Elite Filtering (line-by-line)...');

  // BR-POI-011 item 0: a bare wikidata is not a reference; its article, P1435 and Wikivoyage are.
  // Every item is resolved first (cached across runs in output/wikidata-facts-cache.json).
  const qids: string[] = [];
  for await (const line of splitOnLineFeed(fs.createReadStream(geojsonSeqPath))) {
    const clean = line.trim().replace(/^\x1e/, '').trim();
    if (!clean) continue;
    let p: any;
    try { p = JSON.parse(clean).properties; } catch { continue; }
    const q = firstQid(p?.wikidata);
    // Only the items that can change the verdict: an object the filter drops even with every
    // reference (a road, a stream, a shop) is not resolved — CZ: 98k items in Stage 2.
    if (q && !shouldFilterPOI({ properties: { ...p, wikipedia: p.wikipedia ?? 'xx:any' } }, { heritage: true, wikivoyage: true }).remove) qids.push(q);
  }
  const facts = await wikidataFacts(qids, {
    languages: lang ? [lang] : [], cachePath: path.join(outputDir, 'wikidata-facts-cache.json'),
    onProgress: (d, t) => process.stdout.write(`\r   Wikidata items fetched: ${d.toLocaleString()} / ${t.toLocaleString()}`),
  });
  const withArticle = [...facts.values()].filter(f => f.article).length;
  console.log(`\n   Wikidata items: ${facts.size.toLocaleString()} | with a Wikipedia article: ${withArticle.toLocaleString()} | P1435: ${[...facts.values()].filter(f => f.heritage.length).length.toLocaleString()}`);

  // Split on \n only: node:readline also breaks on U+2028/U+2029, which osmium leaves raw inside
  // tag values, and both halves of such a feature failed JSON.parse and were dropped.
  const rl = splitOnLineFeed(fs.createReadStream(geojsonSeqPath));

  const outFile = fs.createWriteStream(finalOutputPath);
  outFile.write('{"type":"FeatureCollection","features":[\n');

  let processed = 0;
  let kept = 0;
  let outsideBorder = 0;
  let toleratedAtBorder = 0;
  let samePlaceDropped = 0;
  const reasons = new Map<string, number>();
  // name|wikidata|kind -> the distinct objects carrying it, in file order
  const byPlace = new Map<string, Map<string, { features: any[]; areal: boolean; seat: boolean }>>();
  const heldPlaces = new Map<string, HeldPlace>();
  let first = true;
  const write = (feature: any) => {
    if (!first) outFile.write(',\n');
    outFile.write(JSON.stringify(feature));
    kept++;
    first = false;
  };
  // One place mapped as many objects (each segment of a funicular, of a rail trail, of a city wall;
  // a node beside the building) carries the same name and wikidata on every piece: 607 extra rows in
  // Austria, Schloßbergbahn x8. One object per place is written at the end, all its variants with it:
  // the municipal seat when there is one (BR-POI-010 item 4 — the relation place=town would otherwise
  // eat its seat node: 571 pairs in Czechia), else an areal one (it carries boundary_geometry). The
  // kind (place × category) is part of the key, so a village and a castle sharing a wrong wikidata stay apart.
  const admit = (feature: any) => {
    const p = feature.properties;
    if (!p.wikidata || !p.name) return write(feature);
    const placeKey = `${p.name}|${p.wikidata}|${p.place ? 'place' : pickCategory(p) ?? ''}`;
    const objects = byPlace.get(placeKey) ?? byPlace.set(placeKey, new Map()).get(placeKey)!;
    const key = objectKeyOf(p);
    const o = objects.get(key) ?? objects.set(key, { features: [], areal: false, seat: seats.has(key) }).get(key)!;
    o.features.push(feature);
    o.areal ||= /Polygon$/.test(feature.geometry?.type ?? '');
  };

  for await (const line of rl) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    processed++;
    try {
      let cleanLine = trimmedLine;
      // Handle RS (Record Separator) character if present in geojsonseq
      if (cleanLine.startsWith('\x1e')) cleanLine = cleanLine.substring(1);
      cleanLine = cleanLine.trim();
      if (!cleanLine) continue;

      const feature = JSON.parse(cleanLine);
      const fp = feature.properties || {};
      const q = firstQid(fp.wikidata);
      const f = q ? facts.get(q) : undefined;
      if (f?.article && !fp.wikipedia) fp.wikipedia = f.article;
      const filterResult = shouldFilterPOI(feature, f && { heritage: f.heritage.length > 0, wikivoyage: f.wikivoyage });
      if (filterResult.remove) {
        const r = (filterResult.reason ?? '?').replace(/ without a public reference.*$/, '').replace(/\(.*$/, '').replace(/'.*$/, '').trim();
        reasons.set(r, (reasons.get(r) ?? 0) + 1);
        continue;
      }
      if (border) {
        const v = borderVerdict(border, feature, lang);
        if (v === 'abroad') { outsideBorder++; continue; }
        if (v === 'tolerated') toleratedAtBorder++;
      }
      // BR-POI-011 item 8: villages and neighbourhoods wait for the whole country (the pageview cut is
      // measured over all of them, item 9).
      if (iso && placeClass(fp)) {
        const key = objectKeyOf(fp);
        const h = heldPlaces.get(key) ?? heldPlaces.set(key, { features: [], key, pt: null, seat: seats.has(key) }).get(key)!;
        h.features.push(feature);
        h.pt ??= representativePoint(feature.geometry);
        continue;
      }
      admit(feature);

      if (processed % 1000 === 0) {
        process.stdout.write(`\r   Processed: ${processed.toLocaleString()} | Kept: ${kept.toLocaleString()}`);
      }
    } catch (e: any) {
      console.error(`\n❌ Error parsing line ${processed}:`, e.message);
    }
  }

  const places = [...heldPlaces.values()];
  if (places.length) {
    const { verdict, pvCut, measured } = await decidePlaces(places, facts, lang, pvCutArg, outputDir);
    const by: Record<string, number> = {};
    for (const h of places) {
      const v = verdict.get(h) ?? null;
      const k = `${placeClass(h.features[0].properties)}:${v ?? 'OUT'}`;
      by[k] = (by[k] ?? 0) + 1;
      if (v) h.features.forEach(admit);
    }
    console.log(`\n   Villages/neighbourhoods (BR-POI-011 item 8): ${places.length.toLocaleString()} | ${Object.entries(by).sort().map(([k, n]) => `${k} ${n}`).join(', ')}`);
    console.log(`   Pageviews of the ${lang ?? "-"} wiki over ${measured.n} candidate villages: p50 ${measured.p50} · p90 ${measured.p90} · p95 ${measured.p95} · p96 ${measured.p96} → cut ${pvCut}${pvCutArg !== undefined ? ' (--village-pv-cut)' : ' (p96, item 9)'}`);
  }

  for (const objects of byPlace.values()) {
    const all = [...objects.values()];
    const chosen = all.some(o => o.seat) ? all.filter(o => o.seat) : [all.find(o => o.areal) ?? all[0]];
    samePlaceDropped += all.length - chosen.length;
    for (const o of chosen) o.features.forEach(write);
  }
  outFile.write('\n]}');
  outFile.end();

  // Wait for outFile to finish writing
  await new Promise((resolve) => outFile.on('finish', resolve));

  console.log(`\n\n✅ Stage 3 complete!`);
  console.log(`📊 Results:`);
  console.log(`   Total Processed: ${processed.toLocaleString()}`);
  console.log(`   Total Kept: ${kept.toLocaleString()}`);
  if (border) console.log(`   Outside the ${iso} border (dropped after the filter): ${outsideBorder.toLocaleString()} | kept within ${BORDER_TOLERANCE_M} m by a ${lang} name: ${toleratedAtBorder}`);
  console.log(`   Same name + wikidata + kind as another object (dropped): ${samePlaceDropped.toLocaleString()}`);
  console.log(`   Filter Rate: ${((1 - kept/processed) * 100).toFixed(1)}%`);
  console.log(`   Removed by reason (top 40):`);
  for (const [r, n] of [...reasons].sort((a, b) => b[1] - a[1]).slice(0, 40)) console.log(`     ${String(n).padStart(8)}  ${r}`);

  // Cleanup
  fs.unlinkSync(filteredPbf);
  fs.unlinkSync(geojsonSeqPath);

  console.log(`\n🏁 SUCCESS! Final file: ${finalOutputPath}`);

  // Return the path for the next step
  return finalOutputPath;
}

if (require.main === module || process.argv[1].includes('refine-pbf-elite-node')) {
  main().catch(console.error);
}
