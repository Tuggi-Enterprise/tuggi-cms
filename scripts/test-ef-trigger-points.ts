
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN; // Necessary for EF auth

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local');
  process.exit(1);
}

if (!ACCESS_TOKEN) {
    console.warn('⚠️  WARNING: ACCESS_TOKEN not provided.');
    console.warn('The Edge Function requires an Authorization header.');
    console.warn('Please run with: ACCESS_TOKEN=<your_jwt> npx ts-node scripts/test-ef-trigger-points.ts');
    // We continue, but the call might fail with 401
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { 
        headers: ACCESS_TOKEN ? { Authorization: `Bearer ${ACCESS_TOKEN}` } : {} 
    }
});

const POI_ID = '9e705409-b74b-48e4-9c5a-cb831a70ffe7';

async function main() {
  console.log(`\n🔍 Fetching POI Data for ID: ${POI_ID}...`);

  // 1. Fetch POI Data (mimicking the frontend logic)
  const { data: poi, error } = await supabase
    .schema('core')
    .from('attractions')
    .select(`
      id, 
      name, 
      category, 
      country, 
      city, 
      state,
      osm_id,
      osm_type,
      osm_tags,
      coordinates:attraction_coordinate!inner(latitude, longitude)
    `)
    .eq('id', POI_ID)
    .single();

  if (error) {
    console.error('❌ Error fetching POI from database:', error.message);
    return;
  }

  if (!poi) {
    console.error('❌ POI not found.');
    return;
  }

  // 2. Validate/Normalize OSM Data (logic from page.tsx)
  let osmId = poi.osm_id;
  let osmType = poi.osm_type;
  const osmTags = poi.osm_tags || {};

  if (!osmId || !osmType) {
    osmId = osmId || osmTags['@id'] || osmTags.id || osmTags.osm_id;
    if (!osmType) {
      const rawType = osmTags['@type'] || osmTags.type || osmTags.osm_type;
      if (typeof rawType === 'string' && rawType.includes('/')) {
        osmType = rawType.split('/')[0];
      } else if (rawType && ['node', 'way', 'relation'].includes(rawType.toLowerCase())) {
        osmType = rawType.toLowerCase();
      }
    }
  }

  // 3. Construct POIData object
  const poiData = {
    id: poi.id,
    name: poi.name,
    location: { 
      lat: (poi.coordinates as any).latitude, 
      lng: (poi.coordinates as any).longitude 
    },
    type: poi.category || 'unknown',
    country: poi.country,
    city: poi.city,
    state: poi.state,
    ...(osmId && { osm_id: osmId }),
    ...(osmType && { osm_type: osmType }),
    ...(osmTags && Object.keys(osmTags).length > 0 && { osm_tags: osmTags })
  };

  console.log(`✅ POI Data Prepared: ${poiData.name} (${poiData.city})`);
  console.log(`   Location: ${poiData.location.lat}, ${poiData.location.lng}`);

  // 4. Invoke Edge Function
  console.log('\n🚀 Invoking generate-trigger-points Edge Function...');
  const startTime = Date.now();

  const { data: result, error: fnError } = await supabase.functions.invoke('generate-trigger-points', {
    body: { poiData, options: { forceRegenerate: true } }
  });

  const duration = Date.now() - startTime;

  if (fnError) {
    console.error('❌ Edge Function Failed:', fnError);
    if (fnError instanceof Error) {
        console.error('   Message:', fnError.message);
    }
    // Try to parse if it's a JSON response with details
    try {
        console.error('   Details:', await fnError.context.json());
    } catch (e) { /* ignore */ }
  } else {
    console.log(`\n✅ Edge Function Success (${duration}ms)!`);
    console.log('---------------------------------------------------');
    if (result.success) {
        console.log(`🎯 Generated ${result.data.count} trigger points`);
        console.log(`🏷️  POI Classification: ${result.metadata?.poiGroup?.group || 'N/A'}`);
        console.log(`📐 Boundary Source: ${result.boundary?.source}`);
        if (result.data.triggerPoints?.length > 0) {
            console.log('\nExample Trigger Points:');
            result.data.triggerPoints.slice(0, 3).forEach((tp: any, i: number) => {
                console.log(`   ${i+1}. [${tp.id}] ${tp.street?.name || 'Unknown St'} (Dist: ${Math.round(tp.distance)}m, Q: ${tp.quality.toFixed(2)})`);
            });
        }
    } else {
        console.error('⚠️  Function returned success=false');
        console.error('   Error:', result.error);
        console.error('   Details:', result.details);
    }
    console.log('---------------------------------------------------');
  }
}

main().catch(console.error);
