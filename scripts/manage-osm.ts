import { OSMCacheService } from '../lib/services/osm-cache-service';
import { OSMLocalDataService, splitOnLineFeed } from '../lib/services/osm-local-data-service';
import { scanMunicipalSeats, seatLevelWarning } from '../lib/services/admin-boundaries';
import { LOCAL_OSM_DIR_ENV, geonamesDbPath, listOsmRegions, localOsmDir, parsePoly, regionDbPath, type RegionPolygon } from '../lib/services/local-osm-regions';
import { spawn, spawnSync } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as readline from 'node:readline';

function argValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

/** `<dir>/portugal-latest.osm.pbf` → `<dir>/portugal.poly`, the name Geofabrik publishes it under. */
function polyBesidePbf(pbfPath: string): string {
  return path.join(path.dirname(pbfPath), path.basename(pbfPath).replace(/(-latest)?\.osm\.pbf$/, '') + '.poly');
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  const cache = OSMCacheService.getInstance();

  if (command === '--cleanup') {
    const days = parseInt(args[1] || '5');
    console.log(`🧹 Cleaning OSM cache older than ${days} days...`);
    const removed = cache.cleanup(days);
    console.log(`✅ Removed ${removed} entries from cache.`);
  } 
  else if (command === '--import-pbf') {
    const pbfPath = args[1];
    const region = argValue(args, '--region');
    if (!pbfPath || !region) {
      console.error('❌ Usage: --import-pbf <file> --region <name> [--poly <file>]');
      process.exitCode = 1;
      return;
    }

    if (!fs.existsSync(pbfPath)) {
      console.error(`❌ File not found: ${pbfPath}`);
      process.exitCode = 1;
      return;
    }
    // The region's boundary picks it by coordinate (local-osm-regions); no .poly, no region.
    const polySource = argValue(args, '--poly') ?? polyBesidePbf(pbfPath);
    if (!fs.existsSync(polySource)) {
      console.error(`❌ Boundary not found: ${polySource}. Download it beside the PBF (Geofabrik: <region>.poly) or pass --poly <file>.`);
      process.exitCode = 1;
      return;
    }
    const regionPoly = parsePoly(fs.readFileSync(polySource, 'utf8')); // fail before hours of import, not after

    // Optional flag to skip the post-import hotfixes (~30-90 min total).
    // Useful for quick partial imports or debugging. Default: hotfixes run.
    const skipHotfixes = args.includes('--skip-hotfixes');

    const dir = localOsmDir();
    const finalDb = regionDbPath(region, dir);
    // A new region is built under another name and only becomes `<region>.db` when complete, so
    // a running engine never picks a half-imported region. An existing one is updated in place.
    const updating = fs.existsSync(finalDb);
    const dbPath = updating ? finalDb : `${finalDb}.importing`;
    console.log(`📦 Importing PBF: ${pbfPath} → ${dbPath}${updating ? ' (update in place)' : ''}`);

    const localData = new OSMLocalDataService(dbPath);
    try {
      // Check if osmium is available
      const hasOsmium = spawnSync('osmium', ['--version']).status === 0;

      if (hasOsmium) {
        console.log('💎 Using Osmium for high-performance import...');
        await importWithOsmium(pbfPath, localData, dir);
        await importMunicipalBorders(pbfPath, localData, region, regionPoly, dir);
      } else {
        console.log('⚙️ Osmium not found. Using pbf2json fallback...');
        await importWithPbf2Json(pbfPath, localData);
        console.warn('⚠️ Municipal borders (BR-POI-010) need osmium: run --import-admin once it is installed.');
      }
    } finally {
      localData.close();
    }

    if (skipHotfixes) {
      console.log('\n⏭️  Skipping post-import hotfixes (--skip-hotfixes).');
      console.log('   Run these manually before using the migration pipeline:');
      console.log(`     npx tsx scripts/hotfix-osm-id-index.ts --db ${dbPath}`);
      console.log(`     npx tsx scripts/hotfix-osm-rtree-index.ts --db ${dbPath} --force`);
    } else {
      await runPostImportHotfixes(dbPath);
    }
    fs.copyFileSync(polySource, path.join(dir, `${region}.poly`));
    if (!updating) fs.renameSync(dbPath, finalDb);
    if (!fs.existsSync(geonamesDbPath(dir))) {
      console.log(`\nℹ️  ${geonamesDbPath(dir)} is missing (city/state/country offline): npx tsx scripts/hotfix-geonames-import.ts`);
    }
    console.log(`\n✅ Region "${region}" ready: ${finalDb}`);
  }
  else if (command === '--import-admin') {
    // Only the municipal borders (BR-POI-010), into an existing region database: minutes, not the
    // hours of a full --import-pbf. `--db` writes elsewhere (a trial run).
    const pbfPath = args[1];
    const region = argValue(args, '--region');
    if (!pbfPath || !region || !fs.existsSync(pbfPath)) {
      console.error('❌ Usage: --import-admin <file> --region <name> [--poly <file>] [--db <file>]');
      process.exitCode = 1;
      return;
    }
    const polySource = argValue(args, '--poly') ?? polyBesidePbf(pbfPath);
    if (!fs.existsSync(polySource)) {
      console.error(`❌ Boundary not found: ${polySource}. Pass --poly <file>.`);
      process.exitCode = 1;
      return;
    }
    const dbPath = argValue(args, '--db') ?? regionDbPath(region);
    const localData = new OSMLocalDataService(dbPath);
    try {
      await importMunicipalBorders(pbfPath, localData, region, parsePoly(fs.readFileSync(polySource, 'utf8')), path.dirname(path.resolve(dbPath)));
    } finally {
      localData.close();
    }
  }
  else if (command === '--clear-cache') {
    console.log('🧹 Clearing all OSM cache...');
    cache.clearAll();
    console.log('✅ Cache cleared.');
  }
  else if (command === '--status') {
    const dir = localOsmDir();
    console.log(`📊 OSM Local Status (${dir}):`);
    for (const r of listOsmRegions(dir)) {
      console.log(`   ${r.name.padEnd(12)} ${(fs.statSync(r.dbPath).size / 1024 ** 3).toFixed(2)} GB`);
    }
    console.log(`   GeoNames: ${fs.existsSync(geonamesDbPath(dir)) ? '✅' : '❌ missing'}`);
  }
  else {
    console.log(`
OSM Management Tool
===================
Local OSM data: one database per region in ${LOCAL_OSM_DIR_ENV} (default data/osm): <region>.db + <region>.poly
Usage:
  npx tsx scripts/manage-osm.ts --cleanup [days]               Clean old cache (default 5)
  npx tsx scripts/manage-osm.ts --import-pbf <file> --region <name> [--poly <file>]
                                                               Import PBF into <region>.db (runs hotfixes after).
                                                               --poly defaults to the Geofabrik <region>.poly beside the PBF
  npx tsx scripts/manage-osm.ts --import-pbf <file> --region <name> --skip-hotfixes
  npx tsx scripts/manage-osm.ts --import-admin <file> --region <name> [--poly <file>] [--db <file>]
                                                               Only the municipal borders (BR-POI-010) into <region>.db
  npx tsx scripts/manage-osm.ts --clear-cache                  Clear all query cache
  npx tsx scripts/manage-osm.ts --status                       List local regions
    `);
  }
}

/**
 * Run the two hotfixes of a region database that the migration pipeline depends on, after a
 * PBF import. The R-tree is always rebuilt (`--force`): `INSERT OR REPLACE` moves rows to new
 * rowids with the same count, and a kept R-tree would point at the wrong rows (L9, #833).
 * GeoNames is worldwide and lives in its own file (`scripts/hotfix-geonames-import.ts`).
 *
 * Failures in any single hotfix are logged but do not abort the rest.
 */
async function runPostImportHotfixes(dbPath: string): Promise<void> {
  const hotfixes = [
    { name: '@id expression index', args: ['scripts/hotfix-osm-id-index.ts', '--db', dbPath], est: '~5-30 min' },
    { name: 'R-tree spatial index', args: ['scripts/hotfix-osm-rtree-index.ts', '--db', dbPath, '--force'], est: '~25-50 min' },
  ];

  console.log('\n' + '━'.repeat(70));
  console.log('🛠️  Post-import hotfixes — bringing the local DB up to spec');
  console.log('━'.repeat(70));

  for (let i = 0; i < hotfixes.length; i++) {
    const h = hotfixes[i];
    console.log(`\n▸ [${i + 1}/${hotfixes.length}] ${h.name} (${h.est})`);
    console.log(`  npx tsx ${h.args.join(' ')}`);

    // shell on Windows only, so cmd finds `npx.cmd`; elsewhere the paths go through untouched.
    // With a shell, args are concatenated unescaped: quote them, or "C:\Users\Leandro Ramos\..." is cut at the space.
    const win = process.platform === 'win32';
    const args = win ? h.args.map(a => (/\s/.test(a) ? `"${a}"` : a)) : h.args;
    const r = spawnSync('npx', ['tsx', ...args], { stdio: 'inherit', cwd: process.cwd(), shell: win });

    if (r.status !== 0) {
      console.warn(`  ⚠️  ${h.name} exited with status ${r.status} — continuing with the next hotfix.`);
      console.warn(`     You can re-run it later: npx tsx ${h.args.join(' ')}`);
    }
  }

  console.log('\n' + '━'.repeat(70));
  console.log('✅ Post-import hotfixes complete.');
  console.log('━'.repeat(70));
}

async function importWithOsmium(pbfPath: string, localData: OSMLocalDataService, dir: string) {
  const filteredPbf = path.join(dir, '.filtered_import.osm.pbf');

  console.log('🚀 Filtering PBF (tags-filter)...');
  const filter = spawnSync('osmium', [
    'tags-filter', pbfPath,
    'nwr/highway', 'nwr/building', 'nwr/natural', 'nwr/landuse',
    'nwr/amenity', 'nwr/leisure', 'nwr/tourism', 'nwr/historic', 'nwr/water', 'nwr/waterway', 'nwr/shop',
    'nwr/aeroway', 'nwr/railway', 'nwr/man_made', 'nwr/place',
    'nwr/route=ferry', 'nwr/ferry',
    'nwr/aerialway',
    '-o', filteredPbf,
    '--overwrite'
  ], { stdio: 'inherit' });
  if (filter.status !== 0) throw new Error(`osmium tags-filter failed (status ${filter.status})`);

  try {
    // Streamed straight into SQLite: the GeoJSON of a country is several GB that never hits disk.
    console.log('🚀 Exporting to GeoJSON Sequence and importing into SQLite...');
    const exporter = spawn('osmium', [
      'export', filteredPbf,
      '-f', 'geojsonseq',
      '-o', '-',
      '--attributes', 'type,id'
    ], { stdio: ['ignore', 'pipe', 'inherit'] });
    const exited = new Promise<number | null>(resolve => exporter.on('close', resolve));
    try {
      await localData.importGeoJSONSeq(exporter.stdout);
    } catch (e) {
      exporter.kill();
      throw e;
    }
    const status = await exited;
    if (status !== 0) throw new Error(`osmium export failed (status ${status})`);
  } finally {
    // On Windows osmium may still hold the file right after a failure; a cleanup error must not
    // replace the import error that got us here.
    try {
      if (fs.existsSync(filteredPbf)) fs.unlinkSync(filteredPbf);
    } catch (e) {
      console.warn(`⚠️ Could not delete ${filteredPbf} (${(e as NodeJS.ErrnoException).code}); delete it by hand.`);
    }
  }
  console.log('🏁 Success!');
}

/**
 * Municipal borders, whole (BR-POI-010): the `boundary=administrative` relations assembled by
 * osmium into polygons, kept at the municipal level of the region's country (detected in the
 * extract, `admin-boundaries#importAdminBoundaries`) and inside its `.poly`. Prints, for the human,
 * the count per level and the independent seat check (`admin-boundaries#seatLevelWarning`).
 */
async function importMunicipalBorders(pbfPath: string, localData: OSMLocalDataService, region: string, poly: RegionPolygon, dir: string) {
  const filteredPbf = path.join(dir, '.admin_boundaries.osm.pbf');
  console.log('🏛️  Municipal borders: filtering boundary=administrative relations...');
  const filter = spawnSync('osmium', ['tags-filter', pbfPath, 'r/boundary=administrative', '-o', filteredPbf, '--overwrite'], { stdio: 'inherit' });
  if (filter.status !== 0) throw new Error(`osmium tags-filter (admin) failed (status ${filter.status})`);
  try {
    const seatScan = await streamOsmium(['cat', filteredPbf, '-f', 'opl,add_metadata=false', '-o', '-'], scanMunicipalSeats, 'cat (seats)');
    const result = await streamOsmium(
      ['export', filteredPbf, '-f', 'geojsonseq', '--geometry-types=polygon', '--attributes', 'type,id', '-o', '-'],
      lines => localData.importAdminBoundaries(lines, { region: poly, seatScan }),
      'export (admin)',
    );
    const perLevel = (m: Record<string, number>) => Object.entries(m).sort(([a], [b]) => Number(a) - Number(b)).map(([l, n]) => `${l}→${n}`).join(', ') || 'none';
    console.log(`   Relations centred inside ${region}.poly, by admin_level: ${perLevel(result.byLevel)}`);
    console.log(`   Of those, with a city/town/village seat:            ${perLevel(result.seatsByLevel)}`);
    if (!result.country || result.level === null) {
      console.warn(`⚠️ No country found in the extract (no admin_level=2 relation with ISO3166-1 holding the region, no ISO3166-2 subdivision inside it): municipal border mode stays OFF for "${region}".`);
      return;
    }
    console.log(`   Country: ${result.country} (from ${result.countrySource}) → municipal admin_level ${result.level} (admin-boundaries#MUNICIPALITY_ADMIN_LEVEL_BY_COUNTRY)`);
    console.log(`   ✅ ${result.kept} municipalities kept at admin_level ${result.level} (${result.outsideRegion} centred outside ${region}.poly, dropped). Check the count against the country's.`);
    const standalone = Object.entries(result.standaloneByLevel).map(([l, n]) => `${l}→${n}`).join(', ');
    if (standalone) console.log(`   Of those, cities outside the municipal level with no municipality inside (admin-boundaries#STANDALONE_MUNICIPALITY_LEVELS_BY_COUNTRY): ${standalone}`);
    console.log(`   Seats for the POI matching (BR-POI-010): ${result.keptWithSeat} of ${result.kept} municipalities (${result.keptSeatedByLabel} by label, no admin_centre).`);
    if (result.keptWithSeat < result.kept) console.warn(`⚠️ ${result.kept - result.keptWithSeat} municipalities have neither admin_centre nor label: no POI can enter their municipal mode.`);
    const warning = seatLevelWarning(result);
    if (warning) console.warn(`\n⚠️⚠️ CHECK THE MUNICIPAL LEVEL: ${warning}\n`);
  } finally {
    try {
      if (fs.existsSync(filteredPbf)) fs.unlinkSync(filteredPbf);
    } catch (e) {
      console.warn(`⚠️ Could not delete ${filteredPbf} (${(e as NodeJS.ErrnoException).code}); delete it by hand.`);
    }
  }
}

/** Runs osmium with its stdout as lines into `consume`; fails on a non-zero exit, kills osmium if `consume` throws. */
async function streamOsmium<T>(args: string[], consume: (lines: AsyncIterable<string>) => Promise<T>, label: string): Promise<T> {
  const child = spawn('osmium', args, { stdio: ['ignore', 'pipe', 'inherit'] });
  const exited = new Promise<number | null>(resolve => child.on('close', resolve));
  let result: T;
  try {
    result = await consume(splitOnLineFeed(child.stdout));
  } catch (e) {
    child.kill();
    throw e;
  }
  const status = await exited;
  if (status !== 0) throw new Error(`osmium ${label} failed (status ${status})`);
  return result;
}

async function importWithPbf2Json(pbfPath: string, localData: OSMLocalDataService) {
  const pbf2jsonExe = path.join(process.cwd(), 'data', 'pbf2json.exe');
  
  if (!fs.existsSync(pbf2jsonExe)) {
    console.error('❌ pbf2json.exe not found in data/ directory. Please download it first.');
    return;
  }

  const leveldbPath = path.join(process.cwd(), 'data', 'leveldb');
  if (!fs.existsSync(leveldbPath)) fs.mkdirSync(leveldbPath, { recursive: true });

  const tags = 'highway,building,amenity,leisure,tourism,historic,natural,water,waterway,shop,aeroway,railway,man_made,landuse,place,route,ferry,aerialway';
  
  console.log(`🚀 Streaming PBF through pbf2json (this may take a while for large files)...`);
  
  const child = spawn(pbf2jsonExe, [
    `-leveldb=${leveldbPath}`,
    `-tags=${tags}`,
    '-waynodes',
    pbfPath
  ]);

  const rl = readline.createInterface({
    input: child.stdout,
    terminal: false
  });

  const tempFile = path.join(process.cwd(), 'data', 'temp_pbf2json.jsonseq');
  const writeStream = fs.createWriteStream(tempFile);

  let count = 0;
  for await (const line of rl) {
    try {
      const doc = JSON.parse(line);
      
      // Convert pbf2json format to a format compatible with our importer
      // We convert it to a simplified GeoJSON-like structure that OSMLocalDataService can handle
      const feature = {
        id: `${doc.type}/${doc.id}`,
        properties: doc.tags,
        geometry: {
          type: doc.type === 'node' ? 'Point' : 'LineString',
          coordinates: doc.type === 'node' 
            ? [parseFloat(doc.lon), parseFloat(doc.lat)]
            : doc.nodes.map((n: any) => [parseFloat(n.lon), parseFloat(n.lat)])
        }
      };

      writeStream.write(JSON.stringify(feature) + '\n');
      count++;
      if (count % 25000 === 0) {
        process.stdout.write(`   Processed ${count.toLocaleString()} features...\r`);
      }
    } catch (e) {
      // Skip invalid lines
    }
  }

  writeStream.end();
  console.log(`\n✅ Conversion complete (${count} features). Importing into SQLite...`);
  
  await localData.importGeoJSONSeq(tempFile);
  
  // Cleanup
  if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
  console.log('🏁 Success!');
}

main().catch(console.error);

