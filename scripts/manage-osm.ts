import { OSMCacheService } from '../lib/services/osm-cache-service';
import { OSMLocalDataService } from '../lib/services/osm-local-data-service';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';

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

    console.log(`📦 Importing PBF: ${pbfPath}`);
    
    // 1. Filter PBF to include only relevant tags
    const filteredPbf = path.join(process.cwd(), 'data', 'filtered_import.osm.pbf');
    console.log('🚀 Filtering PBF (tags-filter)...');
    const filter = spawnSync('osmium', [
      'tags-filter', pbfPath,
      'nwr/highway', 'nwr/building', 'nwr/natural=wood', 'nwr/landuse=forest',
      'nwr/amenity', 'nwr/leisure', 'nwr/tourism', 'nwr/historic', 'nwr/natural=water', 'nwr/water', 'nwr/waterway', 'nwr/shop',
      '-o', filteredPbf,
      '--overwrite'
    ]);

    if (filter.status !== 0) {
      console.error('❌ Osmium tags-filter failed.');
      console.error(filter.stderr.toString());
      return;
    }

    // 2. Convert filtered PBF to GeoJSON Sequence (line-delimited)
    const tempGeoJSON = path.join(process.cwd(), 'data', 'temp_import.geojsonseq');
    console.log('🚀 Converting filtered PBF to GeoJSON Sequence...');
    
    const exportCmd = spawnSync('osmium', [
      'export', filteredPbf,
      '-f', 'geojsonseq',
      '-o', tempGeoJSON,
      '--overwrite',
      '--attributes', 'type,id'
    ]);

    if (exportCmd.status !== 0) {
      console.error('❌ Osmium export failed.');
      console.error(exportCmd.stderr.toString());
      return;
    }

    console.log('✅ GeoJSON Sequence created. Importing into SQLite (streaming)...');
    await localData.importGeoJSONSeq(tempGeoJSON);
    
    // Cleanup temp files
    if (fs.existsSync(tempGeoJSON)) fs.unlinkSync(tempGeoJSON);
    if (fs.existsSync(filteredPbf)) fs.unlinkSync(filteredPbf);
    
    console.log('🏁 Success! Local OSM data is ready.');
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

main().catch(console.error);
