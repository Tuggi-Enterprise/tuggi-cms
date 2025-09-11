/**
 * Script to monitor website image processing progress
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// Load environment variables
config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function monitorProgress(): Promise<void> {
  console.log('📊 Monitoring Website Image Processing Progress');
  console.log('==============================================\n');

  try {
    // Get total POIs with websites
    const { data: totalWithWebsites, error: totalError } = await supabase
      .schema('core')
      .from('attractions')
      .select('id', { count: 'exact' })
      .not('website', 'is', null)
      .not('website', 'eq', '');

    if (totalError) {
      throw new Error(`Error getting total count: ${totalError.message}`);
    }

    const totalPOIs = totalWithWebsites?.length || 0;
    console.log(`📈 Total POIs with websites: ${totalPOIs}`);

    // Get POIs with website images
    const { data: withWebsiteImages, error: websiteError } = await supabase
      .schema('core')
      .from('attractions')
      .select('id, name, city, state, image_url, image_source')
      .eq('image_source', 'website');

    if (websiteError) {
      throw new Error(`Error getting website images: ${websiteError.message}`);
    }

    const processedCount = withWebsiteImages?.length || 0;
    console.log(`✅ POIs with website images: ${processedCount}`);

    // Get current image source distribution
    const { data: sourceDistribution, error: sourceError } = await supabase
      .schema('core')
      .from('attractions')
      .select('image_source')
      .not('image_url', 'is', null);

    if (sourceError) {
      throw new Error(`Error getting source distribution: ${sourceError.message}`);
    }

    const distribution: { [key: string]: number } = {};
    sourceDistribution?.forEach(poi => {
      const source = poi.image_source || 'unknown';
      distribution[source] = (distribution[source] || 0) + 1;
    });

    console.log('\n📊 Current Image Source Distribution:');
    Object.entries(distribution)
      .sort(([,a], [,b]) => b - a)
      .forEach(([source, count]) => {
        console.log(`   ${source}: ${count} POIs`);
      });

    // Show recent website images
    if (withWebsiteImages && withWebsiteImages.length > 0) {
      console.log('\n🎯 Recent Website Images:');
      withWebsiteImages.slice(0, 10).forEach((poi, index) => {
        console.log(`   ${index + 1}. ${poi.name} (${poi.city}, ${poi.state})`);
        console.log(`      Image: ${poi.image_url ? 'Yes' : 'No'}`);
        console.log('');
      });
    }

    // Calculate progress
    const progress = totalPOIs > 0 ? ((processedCount / totalPOIs) * 100).toFixed(1) : '0.0';
    console.log(`\n📈 Progress: ${processedCount}/${totalPOIs} (${progress}%)`);

  } catch (error) {
    console.error('💥 Error monitoring progress:', error);
  }
}

// Run the monitoring
if (require.main === module) {
  monitorProgress().catch(console.error);
}
