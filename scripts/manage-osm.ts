import { OSMCacheService } from '../lib/services/osm-cache-service';
import { OSMLocalDataService } from '../lib/services/osm-local-data-service';
import { spawn, spawnSync } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as readline from 'node:readline';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  const cache = OSMCacheService.getInstance();
  const localData = OSMLocalDataService.getInstance();

  if (command === '--cleanup') {
    const days = parseInt(args[1] || '5');
    console.log(`🧹 Cleaning OSM cache older than ${days} days...`);
    const removed = cache.cleanup(days);
    console.log(`✅ Removed ${removed} entries from cache.`);
  } 
  else if (command === '--import-pbf') {
    const pbfPath = args[1];
    if (!pbfPath) {
      console.error('❌ Please provide a PBF file path.');
      return;
    }

    if (!fs.existsSync(pbfPath)) {
      console.error(`❌ File not found: ${pbfPath}`);
      return;
    }

    // Optional flag to skip the post-import hotfixes (~30-90 min total).
    // Useful for quick partial imports or debugging. Default: hotfixes run.
    const skipHotfixes = args.includes('--skip-hotfixes');

    console.log(`📦 Importing PBF: ${pbfPath}`);

    // Check if osmium is available
    const hasOsmium = spawnSync('osmium', ['--version']).status === 0;

    if (hasOsmium) {
      console.log('💎 Using Osmium for high-performance import...');
      await importWithOsmium(pbfPath, localData);
    } else {
      console.log('⚙️ Osmium not found. Using pbf2json fallback...');
      await importWithPbf2Json(pbfPath, localData);
    }

    if (skipHotfixes) {
      console.log('\n⏭️  Skipping post-import hotfixes (--skip-hotfixes).');
      console.log('   Run these manually before using the migration pipeline:');
      console.log('     npx tsx scripts/hotfix-osm-id-index.ts');
      console.log('     npx tsx scripts/hotfix-osm-rtree-index.ts');
      console.log('     npx tsx scripts/hotfix-geonames-import.ts');
    } else {
      await runPostImportHotfixes();
    }
  }
  else if (command === '--clear-cache') {
    console.log('🧹 Clearing all OSM cache...');
    cache.clearAll();
    console.log('✅ Cache cleared.');
  }
  else if (command === '--status') {
    console.log('📊 OSM Local Status:');
    const hasData = localData.hasData();
    console.log(`   Local Data Index: ${hasData ? '✅ Active' : '❌ Empty'}`);
  }
  else {
    console.log(`
OSM Management Tool
===================
Usage:
  npx tsx scripts/manage-osm.ts --cleanup [days]               Clean old cache (default 5)
  npx tsx scripts/manage-osm.ts --import-pbf <file>            Import PBF into local DB (runs hotfixes after)
  npx tsx scripts/manage-osm.ts --import-pbf <file> --skip-hotfixes  Import PBF only, skip post-import indexes
  npx tsx scripts/manage-osm.ts --clear-cache                  Clear all query cache
  npx tsx scripts/manage-osm.ts --status                       Check cache/local status
    `);
  }
}

/**
 * Run the three local_osm.db hotfixes that the migration pipeline depends on,
 * after a fresh PBF import. Each is idempotent and self-contained — if a
 * given index/data already exists with the right row count, it is skipped.
 *
 * Total wall time on a continental PBF: ~30-90 min (mostly the R-tree build
 * on buildings, which has ~19M rows).
 *
 * Failures in any single hotfix are logged but do not abort the rest — the
 * migration pipeline degrades gracefully when an index is missing.
 */
async function runPostImportHotfixes(): Promise<void> {
  const hotfixes = [
    { name: '@id expression index',  script: 'hotfix-osm-id-index.ts',     est: '~5-30 min' },
    { name: 'R-tree spatial index',  script: 'hotfix-osm-rtree-index.ts',  est: '~25-50 min' },
    { name: 'GeoNames reverse geocoder', script: 'hotfix-geonames-import.ts', est: '~15 sec' }
  ];

  console.log('\n' + '━'.repeat(70));
  console.log('🛠️  Post-import hotfixes — bringing the local DB up to spec');
  console.log('━'.repeat(70));
  console.log('   Each is idempotent. Use --skip-hotfixes next time to opt out.');

  for (let i = 0; i < hotfixes.length; i++) {
    const h = hotfixes[i];
    console.log(`\n▸ [${i + 1}/${hotfixes.length}] ${h.name} (${h.est})`);
    console.log(`  npx tsx scripts/${h.script}`);

    // shell: true so Windows finds `npx.cmd` via cmd's PATH resolution.
    // No security risk — the args are hardcoded script names from `hotfixes`.
    const r = spawnSync('npx', ['tsx', `scripts/${h.script}`], {
      stdio: 'inherit',
      cwd: process.cwd(),
      shell: true
    });

    if (r.status !== 0) {
      console.warn(`  ⚠️  ${h.name} exited with status ${r.status} — continuing with the next hotfix.`);
      console.warn(`     You can re-run it later: npx tsx scripts/${h.script}`);
    }
  }

  console.log('\n' + '━'.repeat(70));
  console.log('✅ Post-import hotfixes complete. Local DB ready for migration pipeline.');
  console.log('━'.repeat(70));
}

async function importWithOsmium(pbfPath: string, localData: OSMLocalDataService) {
  const filteredPbf = path.join(process.cwd(), 'data', 'filtered_import.osm.pbf');
  const tempGeoJSON = path.join(process.cwd(), 'data', 'temp_import.geojsonseq');

  console.log('🚀 Filtering PBF (tags-filter)...');
  spawnSync('osmium', [
    'tags-filter', pbfPath,
    'nwr/highway', 'nwr/building', 'nwr/natural', 'nwr/landuse',
    'nwr/amenity', 'nwr/leisure', 'nwr/tourism', 'nwr/historic', 'nwr/water', 'nwr/waterway', 'nwr/shop',
    'nwr/aeroway', 'nwr/railway', 'nwr/man_made', 'nwr/place',
    'nwr/route=ferry', 'nwr/ferry',
    'nwr/aerialway',
    '-o', filteredPbf,
    '--overwrite'
  ]);

  console.log('🚀 Exporting to GeoJSON Sequence...');
  spawnSync('osmium', [
    'export', filteredPbf,
    '-f', 'geojsonseq',
    '-o', tempGeoJSON,
    '--overwrite',
    '--attributes', 'type,id'
  ]);

  console.log('✅ Importing into SQLite...');
  await localData.importGeoJSONSeq(tempGeoJSON);

  if (fs.existsSync(tempGeoJSON)) fs.unlinkSync(tempGeoJSON);
  if (fs.existsSync(filteredPbf)) fs.unlinkSync(filteredPbf);
  console.log('🏁 Success!');
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

