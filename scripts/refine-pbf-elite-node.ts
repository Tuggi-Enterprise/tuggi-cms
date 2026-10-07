import { spawnSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { splitOnLineFeed } from '../lib/services/osm-local-data-service';
import { shouldFilterPOI, pickCategory, CATEGORIES } from '../lib/shared/poi-filter';
import { articlesByWikidata } from '../lib/services/wikidata-sitelinks';
import { scenicRoadFeatures } from '../lib/services/osm-scenic-roads';
import { polygonContains, type RegionPolygon } from '../lib/services/local-osm-regions';

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

/** Same point the homolog importer stores as lat/lon: the first coordinate of the geometry. */
function firstPoint(geometry: any): [number, number] | null {
  let c = geometry?.coordinates;
  while (Array.isArray(c) && Array.isArray(c[0])) c = c[0];
  return Array.isArray(c) && typeof c[0] === 'number' ? [c[0], c[1]] : null;
}

/** Metres from a point to the nearest border segment (equirectangular; fine at this scale). */
function metresToBorder(border: RegionPolygon, lng: number, lat: number): number {
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
const BORDER_TOLERANCE_M = 150;

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

async function main() {
  const args = process.argv.slice(2);
  const inputPath = args[0];
  const country = args[1] || 'Spain';
  const isoAt = args.indexOf('--iso');
  const iso = isoAt >= 0 ? args[isoAt + 1] : undefined;

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
  if (border) console.log(`🧭 Clipping to the ISO3166-1=${iso} border (${border.outer.length} outer rings, ±${BORDER_TOLERANCE_M} m)`);
  else console.warn('⚠️  No --iso <code>: the extract buffer past the border is kept and stamped with this country.');
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
  
  // A listed building with no other tag stays only with a Wikipedia article (touristNoiseReason).
  // OSM often carries just the `wikidata` of such a building, so its article is looked up first.
  const bareIds: string[] = [];
  for await (const line of splitOnLineFeed(fs.createReadStream(geojsonSeqPath))) {
    const clean = line.trim().replace(/^\x1e/, '').trim();
    if (!clean) continue;
    let p: any;
    try { p = JSON.parse(clean).properties; } catch { continue; }
    if (p && p.wikidata && !p.wikipedia && !pickCategory(p)) bareIds.push(String(p.wikidata).split(';')[0].trim());
  }
  const articles = await articlesByWikidata(bareIds);
  console.log(`   Listed buildings with only wikidata: ${bareIds.length.toLocaleString()} | with a Wikipedia article: ${articles.size.toLocaleString()}`);

  // Split on \n only: node:readline also breaks on U+2028/U+2029, which osmium leaves raw inside
  // tag values, and both halves of such a feature failed JSON.parse and were dropped.
  const rl = splitOnLineFeed(fs.createReadStream(geojsonSeqPath));

  const outFile = fs.createWriteStream(finalOutputPath);
  outFile.write('{"type":"FeatureCollection","features":[\n');

  let processed = 0;
  let kept = 0;
  let outsideBorder = 0;
  let samePlaceDropped = 0;
  const byPlace = new Map<string, { objectKey: string; areal: boolean; features: any[] }>();
  let first = true;
  const write = (feature: any) => {
    if (!first) outFile.write(',\n');
    outFile.write(JSON.stringify(feature));
    kept++;
    first = false;
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
      const article = !fp.wikipedia && fp.wikidata ? articles.get(String(fp.wikidata).split(';')[0].trim()) : undefined;
      if (article) fp.wikipedia = article;
      const filterResult = shouldFilterPOI(feature);
      let abroad = false;
      if (!filterResult.remove && border) {
        const pt = firstPoint(feature.geometry);
        abroad = !pt || (!polygonContains(border, pt[1], pt[0]) && metresToBorder(border, pt[0], pt[1]) > BORDER_TOLERANCE_M);
        if (abroad) outsideBorder++;
      }

      // One place mapped as many objects (each segment of a funicular, of a rail trail, of a city
      // wall; a node beside the building) carries the same name and wikidata on every piece: 607
      // extra rows in Austria, Schloßbergbahn x8. One object per place is written at the end, an
      // areal one when there is one (it is what carries boundary_geometry), with all its variants.
      const p = feature.properties || {};
      if (!filterResult.remove && !abroad && p.wikidata && p.name) {
        const placeKey = `${p.name}|${p.wikidata}`;
        const objectKey = `${p['@type']}/${p['@id']}`;
        const isAreal = /Polygon$/.test(feature.geometry?.type ?? '');
        const held = byPlace.get(placeKey);
        if (!held) byPlace.set(placeKey, { objectKey, areal: isAreal, features: [feature] });
        else if (held.objectKey === objectKey) { held.features.push(feature); held.areal ||= isAreal; }
        else if (isAreal && !held.areal) { samePlaceDropped++; byPlace.set(placeKey, { objectKey, areal: true, features: [feature] }); }
        else samePlaceDropped++;
      } else if (!filterResult.remove && !abroad) {
        write(feature);
      }
      
      if (processed % 1000 === 0) {
        process.stdout.write(`\r   Processed: ${processed.toLocaleString()} | Kept: ${kept.toLocaleString()}`);
      }
    } catch (e: any) {
      console.error(`\n❌ Error parsing line ${processed}:`, e.message);
    }
  }

  for (const held of byPlace.values()) held.features.forEach(write);
  outFile.write('\n]}');
  outFile.end();

  // Wait for outFile to finish writing
  await new Promise((resolve) => outFile.on('finish', resolve));

  console.log(`\n\n✅ Stage 3 complete!`);
  console.log(`📊 Results:`);
  console.log(`   Total Processed: ${processed.toLocaleString()}`);
  console.log(`   Total Kept: ${kept.toLocaleString()}`);
  if (border) console.log(`   Outside the ${iso} border (dropped after the filter): ${outsideBorder.toLocaleString()}`);
  console.log(`   Same name + wikidata as an earlier object (dropped): ${samePlaceDropped.toLocaleString()}`);
  console.log(`   Filter Rate: ${((1 - kept/processed) * 100).toFixed(1)}%`);

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
