/**
 * Test script for small batch processing
 * 
 * This script processes only the first 5 POIs to test the batch processing
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { readFile } from 'fs/promises';
import { join } from 'path';

// Load environment variables
config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface POIWithWikimedia {
  id: string;
  name: string;
  city: string;
  state: string;
  image_url: string | null;
  osm_tags: string | null;
  wikimedia_commons_url?: string;
  has_image_url: boolean;
  has_osm_tags: boolean;
}

async function testSmallBatch() {
  console.log('🧪 Testing small batch processing (5 POIs)...\n');

  try {
    // Load POIs
    const outputPath = join(process.cwd(), 'scripts', 'output', 'wikimedia-pois.json');
    const data = await readFile(outputPath, 'utf-8');
    const allPOIs = JSON.parse(data) as POIWithWikimedia[];
    
    // Take only first 5 POIs for testing
    const testPOIs = allPOIs.slice(0, 5);
    
    console.log(`📋 Testing with ${testPOIs.length} POIs:`);
    testPOIs.forEach((poi, index) => {
      console.log(`   ${index + 1}. ${poi.name} (${poi.city}, ${poi.state})`);
    });
    console.log('');

    let successCount = 0;
    let failCount = 0;

    // Process each POI
    for (let i = 0; i < testPOIs.length; i++) {
      const poi = testPOIs[i];
      console.log(`\n🔄 Processing ${i + 1}/${testPOIs.length}: ${poi.name}`);
      
      try {
        // Check if already processed
        const { data: existingImages } = await supabase
          .schema('core')
          .from('attraction_image')
          .select('id, image_url')
          .eq('attraction_id', poi.id)
          .limit(1);

        if (existingImages && existingImages.length > 0) {
          console.log(`⏭️  Already processed - Image ID: ${existingImages[0].id}`);
          successCount++;
          continue;
        }

        // Process the POI
        const requestBody = {
          attractionId: poi.id,
          attractionName: poi.name,
          imageSource: 'wikimedia_commons' as const,
          wikimediaUrl: poi.wikimedia_commons_url
        };

        console.log(`📤 Calling edge function...`);
        const { data, error } = await supabase.functions.invoke('store-poi-images', {
          body: requestBody
        });

        if (error) {
          throw new Error(`Edge function error: ${error.message}`);
        }

        if (!data.success || !data.images || data.images.length === 0) {
          throw new Error(`No image processed: ${data.errors?.join(', ') || 'Unknown error'}`);
        }

        const image = data.images[0];
        console.log(`✅ Success! Image ID: ${image.id}`);
        console.log(`   URL: ${image.url}`);
        successCount++;

        // Wait 2 seconds between requests
        if (i < testPOIs.length - 1) {
          console.log(`⏳ Waiting 2 seconds...`);
          await new Promise(resolve => setTimeout(resolve, 2000));
        }

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`❌ Failed: ${errorMessage}`);
        failCount++;
      }
    }

    console.log(`\n🎉 Test completed!`);
    console.log(`✅ Successful: ${successCount}`);
    console.log(`❌ Failed: ${failCount}`);
    console.log(`📊 Success Rate: ${((successCount / testPOIs.length) * 100).toFixed(1)}%`);

  } catch (error) {
    console.error('💥 Test failed:', error);
  }
}

// Run the test
if (require.main === module) {
  testSmallBatch().catch(console.error);
}
