/**
 * Test script for POIs that we know work
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// Load environment variables
config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// POIs that we know work from previous tests
const workingPOIs = [
  {
    id: 'e179587f-97b7-44db-ad39-a5b43658444c',
    name: 'Monumento à Mãe Preta',
    wikimediaUrl: 'https://commons.wikimedia.org/wiki/Category:Mãe Preta by Júlio Guerra (bronze, 1955)'
  }
];

async function testWorkingPOIs() {
  console.log('🧪 Testing POIs that we know work...\n');

  for (const poi of workingPOIs) {
    console.log(`🔄 Testing: ${poi.name}`);
    
    try {
      const requestBody = {
        attractionId: poi.id,
        attractionName: poi.name,
        imageSource: 'wikimedia_commons' as const,
        wikimediaUrl: poi.wikimediaUrl
      };

      console.log(`📤 Calling edge function...`);
      const { data, error } = await supabase.functions.invoke('store-poi-images', {
        body: requestBody
      });

      if (error) {
        console.error(`❌ Error: ${error.message}`);
        continue;
      }

      if (!data.success) {
        console.error(`❌ Failed: ${data.errors?.join(', ') || 'Unknown error'}`);
        continue;
      }

      console.log(`✅ Success!`);
      if (data.images && data.images.length > 0) {
        console.log(`   Image ID: ${data.images[0].id}`);
        console.log(`   URL: ${data.images[0].url}`);
      }

    } catch (error) {
      console.error(`💥 Exception: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
    
    console.log('');
  }
}

// Run the test
if (require.main === module) {
  testWorkingPOIs().catch(console.error);
}
