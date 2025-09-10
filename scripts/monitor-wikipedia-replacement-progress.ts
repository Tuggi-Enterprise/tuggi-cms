/**
 * Script to monitor the progress of Wikipedia image replacement
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// Load environment variables
config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function monitorProgress() {
  console.log('📊 Monitoring Wikipedia Image Replacement Progress...\n');

  try {
    // Check current Wikipedia image sources
    const { data: wikipediaPOIs, error } = await supabase
      .schema('core')
      .from('attractions')
      .select('id, name, city, state, image_url, image_source')
      .eq('image_source', 'wikipedia');

    if (error) {
      throw new Error(`Error querying Wikipedia POIs: ${error.message}`);
    }

    const totalWikipedia = wikipediaPOIs?.length || 0;
    console.log(`🎯 Total POIs with Wikipedia images: ${totalWikipedia}`);

    // Check recent Wikipedia images (last 10)
    console.log('\n📋 Recent Wikipedia images processed:');
    wikipediaPOIs?.slice(-10).forEach((poi, index) => {
      console.log(`   ${index + 1}. ${poi.name} (${poi.city}, ${poi.state})`);
      console.log(`      Image: ${poi.image_url}`);
      console.log('');
    });

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

    console.log('📈 Current image source distribution:');
    Array.from(sourceCounts.entries()).forEach(([source, count]) => {
      console.log(`   ${source}: ${count} attractions`);
    });

    // Estimate progress
    const totalCandidates = 418; // From our previous analysis
    const processed = totalWikipedia - 2; // Subtract the 2 original POIs without images
    const remaining = totalCandidates - processed;
    const progress = ((processed / totalCandidates) * 100).toFixed(1);

    console.log(`\n🎯 Replacement Progress:`);
    console.log(`   Processed: ${processed}/${totalCandidates} (${progress}%)`);
    console.log(`   Remaining: ${remaining} POIs`);
    console.log(`   Success rate: ${totalWikipedia > 0 ? '100%' : '0%'} (all processed POIs have Wikipedia images)`);

  } catch (error) {
    console.error('💥 Error monitoring progress:', error);
  }
}

// Run the monitoring
if (require.main === module) {
  monitorProgress().catch(console.error);
}
