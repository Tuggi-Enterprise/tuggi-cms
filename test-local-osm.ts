import { OSMDataFetcher } from './lib/services/trigger-points-google/services/osm-data-fetcher';
import { POIData } from './lib/services/trigger-points-google/types/interfaces';

async function test() {
  const fetcher = new OSMDataFetcher();
  
  // A point in Boston (Faneuil Hall)
  const poi: POIData = {
    id: 'test-boston',
    name: 'Faneuil Hall',
    location: { lat: 42.3601, lng: -71.0562 },
    type: 'tourist_attraction',
    country: 'USA',
    city: 'Boston'
  };

  console.log('🚀 Testing OSM Fetch for Boston (should use LOCAL DATA)...');
  const startTime = Date.now();
  const data = await fetcher.fetchAllRequiredData(poi, 400);
  const endTime = Date.now();

  console.log('-----------------------------------');
  console.log(`⏱️  Time taken: ${endTime - startTime}ms`);
  console.log(`🛣️  Streets found: ${data.streets.length}`);
  console.log(`🏢 Buildings found: ${data.buildings.length}`);
  console.log('-----------------------------------');
}

test().catch(console.error);
