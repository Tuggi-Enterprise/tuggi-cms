import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });
dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function testCreatePOIRPC() {
  console.log('🧪 Testing create_poi_with_uuid RPC function...\n');

  // Test data
  const testPOI = {
    p_name: 'Test POI',
    p_city: 'São Paulo',
    p_state: 'SP',
    p_country: 'Brazil',
    p_category: 'test',
    p_osm_id: 999999999,
    p_osm_type: 'node',
    p_source_file: 'test.geojson',
    p_lat: -23.5505,
    p_lon: -46.6333,
    p_coordinate_data: {
      latitude: -23.5505,
      longitude: -46.6333,
      elevation_m: null,
      boundary_type: 'point',
      boundary_source: 'osm',
      show_in_map: true,
      boundary_geometry: JSON.stringify({
        type: "Point",
        coordinates: [-46.6333, -23.5505]
      })
    }
  };

  console.log('📤 Calling RPC with test data:', {
    name: testPOI.p_name,
    osm_id: testPOI.p_osm_id,
    osm_type: testPOI.p_osm_type
  });

  try {
    const { data, error } = await supabase
      .schema('homolog')
      .rpc('create_poi_with_uuid', testPOI);

    console.log('\n📥 RPC Response:');
    console.log('  - Error:', error);
    console.log('  - Data:', data);
    console.log('  - Data type:', typeof data);
    console.log('  - Data length:', data?.length);
    console.log('  - Is array:', Array.isArray(data));

    if (error) {
      console.error('\n❌ RPC Error Details:');
      console.error('  - Message:', error.message);
      console.error('  - Details:', error.details);
      console.error('  - Hint:', error.hint);
      console.error('  - Code:', error.code);
    }

    if (data && data.length > 0) {
      console.log('\n✅ Success! RPC returned data:');
      console.log('  - UUID:', data[0].poi_uuid_id);
      console.log('  - Success:', data[0].success);
      console.log('  - Message:', data[0].message);
    } else {
      console.log('\n⚠️ Warning: RPC returned no data');
    }

    // Verify if POI was actually created
    if (data && data.length > 0 && data[0].poi_uuid_id) {
      const { data: poiData, error: poiError } = await supabase
        .schema('homolog')
        .from('pois')
        .select('uuid_id, name, city, state')
        .eq('uuid_id', data[0].poi_uuid_id)
        .single();

      console.log('\n🔍 Verifying POI in database:');
      console.log('  - Found:', !!poiData);
      console.log('  - POI Data:', poiData);
      console.log('  - Error:', poiError);
    }

  } catch (err) {
    console.error('\n❌ Exception caught:');
    console.error(err);
  }
}

testCreatePOIRPC()
  .then(() => {
    console.log('\n✅ Test completed');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ Test failed:', err);
    process.exit(1);
  });

