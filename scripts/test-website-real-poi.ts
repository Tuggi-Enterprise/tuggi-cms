/**
 * Script to test website image extraction with a real POI
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// Load environment variables
config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function testWithRealPOI(): Promise<void> {
  console.log('🧪 Testing website extraction with real POI...\n');

  try {
    // Get a POI with a website
    const { data: poi, error } = await supabase
      .schema('core')
      .from('attractions')
      .select('id, name, city, state, website, image_url, image_source')
      .not('website', 'is', null)
      .not('website', 'eq', '')
      .limit(1)
      .single();

    if (error || !poi) {
      throw new Error(`Error loading POI: ${error?.message}`);
    }

    console.log(`🎯 Testing with: ${poi.name}`);
    console.log(`   ID: ${poi.id}`);
    console.log(`   Website: ${poi.website}`);
    console.log(`   Current image: ${poi.image_url ? 'Yes' : 'No'}`);
    console.log(`   Current source: ${poi.image_source || 'unknown'}`);

    // Call the edge function
    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/extract-website-images`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
      },
      body: JSON.stringify({
        attractionId: poi.id,
        attractionName: poi.name,
        websiteUrl: poi.website
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    
    if (data.success) {
      console.log(`\n✅ Success!`);
      console.log(`   New image URL: ${data.imageUrl}`);
      console.log(`   Images found: ${data.availableImages}`);
      console.log(`   Image title: ${data.images[0]?.title}`);
      
      // Verify the database was updated
      const { data: updatedPOI, error: verifyError } = await supabase
        .schema('core')
        .from('attractions')
        .select('image_url, image_source')
        .eq('id', poi.id)
        .single();

      if (verifyError) {
        console.log(`   ⚠️  Could not verify database update: ${verifyError.message}`);
      } else {
        console.log(`\n🔍 Database verification:`);
        console.log(`   Updated image_url: ${updatedPOI.image_url}`);
        console.log(`   Updated image_source: ${updatedPOI.image_source}`);
        
        if (updatedPOI.image_source === 'website') {
          console.log(`   ✅ image_source correctly set to 'website'`);
        } else {
          console.log(`   ❌ image_source not set correctly`);
        }
      }
      
    } else {
      console.log(`\n❌ Failed: ${data.message}`);
    }

  } catch (error) {
    console.log(`\n💥 Error: ${error.message}`);
  }
}

// Run the test
if (require.main === module) {
  testWithRealPOI().catch(console.error);
}
