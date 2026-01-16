import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { CoreTriggerPointPredictor } from '../lib/services/trigger-points-google/core/trigger-point-predictor';
import { POIData } from '../lib/services/trigger-points-google/types/interfaces';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const POI_ID = '66e082b7-744a-4c93-8fbb-f039d3f34e64'; // Parque Ibirapuera

async function main() {
  console.log(`\n🔍 Fetching POI Data for ID: ${POI_ID}...`);

  // 1. Fetch POI Data
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

  if (error || !poi) {
    console.error('❌ Error fetching POI or POI not found:', error?.message);
    return;
  }

  // 2. Validate/Normalize OSM Data
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
  const poiData: POIData = {
    id: poi.id,
    name: poi.name,
    location: { 
      lat: (poi.coordinates as any).latitude, 
      lng: (poi.coordinates as any).longitude 
    },
    type: poi.category || 'unknown',
    types: [poi.category || 'unknown'], // Populate types for analyzer
    country: poi.country,
    city: poi.city,
    state: poi.state,
    ...(osmId && { osm_id: osmId }),
    ...(osmType && { osm_type: osmType }),
    ...(osmTags && Object.keys(osmTags).length > 0 && { osm_tags: osmTags })
  };

  console.log(`✅ POI Data Prepared: ${poiData.name} (${poiData.city})`);
  console.log(`   Location: ${poiData.location.lat}, ${poiData.location.lng}`);

  // 4. Run Logic Directly
  console.log('\n🚀 Running CoreTriggerPointPredictor locally...');
  const startTime = Date.now();

  try {
    const predictor = new CoreTriggerPointPredictor();
    const result = await predictor.predictTriggerPointsComplete(poiData, { forceRegenerate: true });
    
    const duration = Date.now() - startTime;
    console.log(`\n✅ Prediction Success (${duration}ms)!`);
    console.log('---------------------------------------------------');
    
    console.log(`🎯 Generated ${result.triggerPoints.length} trigger points`);
    console.log(`🏷️  POI Classification: ${result.boundary.classification?.group || 'N/A'}`);
    console.log(`📐 Boundary Source: ${result.boundary.source}`);

    if (result.triggerPoints.length > 0) {
        console.log('\nExample Trigger Points:');
        result.triggerPoints.slice(0, 5).forEach((tp: any, i: number) => {
            console.log(`   ${i+1}. [${tp.type}] Dist: ${Math.round(tp.distance)}m, Q: ${tp.quality.toFixed(2)}, Bearing: ${tp.expectedBearing.toFixed(1)}°`);
        });
    }

    if (result.metadata?.osmDataStats) {
         console.log('\nOSM Statistics:');
         console.log(`   - Streets: ${(result.metadata.osmDataStats as any).streets}`);
         console.log(`   - Buildings: ${(result.metadata.osmDataStats as any).buildings}`);
    }
    
    // Log debug info if fallback happened
    if (result.metadata.method.includes('fallback')) {
        console.warn('⚠️  Fallback method was used!');
    }

  } catch (error) {
    console.error('❌ Prediction Failed:', error);
  }
}

main().catch(console.error);
