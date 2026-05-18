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
  npx tsx scripts/manage-osm.ts --cleanup [days]    Clean old cache (default 5)
  npx tsx scripts/manage-osm.ts --import-pbf <file> Import PBF into local DB
  npx tsx scripts/manage-osm.ts --clear-cache      Clear all query cache
  npx tsx scripts/manage-osm.ts --status           Check cache/local status
    `);
  }
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

