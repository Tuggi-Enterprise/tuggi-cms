/**
 * Script to check Wikipedia image sources
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// Load environment variables
config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkWikipediaSources() {
  console.log('🔍 Checking Wikipedia image sources...\n');

  try {
    // Check the specific POIs we just processed
    const { data: wikipediaPOIs, error } = await supabase
      .schema('core')
      .from('attractions')
      .select('id, name, city, state, image_url, image_source, osm_wikipedia_url')
      .in('name', ['Letreiro de Padre Miguel', 'Cachoeira da gruta Camorim']);

    if (error) {
      throw new Error(`Error querying Wikipedia POIs: ${error.message}`);
    }

    console.log('📋 Wikipedia POIs processed:');
    wikipediaPOIs?.forEach((poi, index) => {
      console.log(`   ${index + 1}. ${poi.name} (${poi.city}, ${poi.state})`);
      console.log(`      ID: ${poi.id}`);
      console.log(`      Image Source: ${poi.image_source || 'Not set'}`);
      console.log(`      Image URL: ${poi.image_url || 'No image'}`);
      console.log(`      Wikipedia URL: ${poi.osm_wikipedia_url}`);
      console.log('');
    });

    // Check all attractions with Wikipedia image source
    const { data: allWikipedia, error: allError } = await supabase
      .schema('core')
      .from('attractions')
      .select('id, name, city, state, image_url, image_source')
      .eq('image_source', 'wikipedia');

    if (allError) {
      throw new Error(`Error querying all Wikipedia sources: ${allError.message}`);
    }

    console.log(`\n📊 Total attractions with Wikipedia image source: ${allWikipedia?.length || 0}`);
    
    if (allWikipedia && allWikipedia.length > 0) {
      console.log('\n🎯 All Wikipedia image sources:');
      allWikipedia.forEach((poi, index) => {
        console.log(`   ${index + 1}. ${poi.name} (${poi.city}, ${poi.state})`);
        console.log(`      Image URL: ${poi.image_url}`);
        console.log('');
      });
    }

    // Check image source distribution
    const { data: sourceStats, error: statsError } = await supabase
      .schema('core')
      .from('attractions')
      .select('image_source')
      .not('image_source', 'is', null);

    if (statsError) {
      throw new Error(`Error querying source stats: ${statsError.message}`);
    }

    const sourceCounts = new Map<string, number>();
    sourceStats?.forEach(poi => {
      const source = poi.image_source || 'unknown';
      sourceCounts.set(source, (sourceCounts.get(source) || 0) + 1);
    });

    console.log('\n📈 Image source distribution:');
    Array.from(sourceCounts.entries()).forEach(([source, count]) => {
      console.log(`   ${source}: ${count} attractions`);
    });

  } catch (error) {
    console.error('💥 Error:', error);
  }
}

// Run the script
if (require.main === module) {
  checkWikipediaSources().catch(console.error);
}
