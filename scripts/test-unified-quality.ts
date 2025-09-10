/**
 * Test script for the unified image processing with quality filters
 * Tests with a small sample to verify functionality
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// Load environment variables
config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function testUnifiedProcessing() {
  console.log('🧪 Testing Unified Image Processing with Quality Filters');
  console.log('======================================================\n');

  try {
    // Get a sample of POIs with different source types
    const { data: samplePOIs, error } = await supabase
      .schema('core')
      .from('attractions')
      .select('id, name, city, state, image_url, image_source, website, osm_tags')
      .or('website.ilike.%gov%,website.ilike.%museum%,osm_tags->>wikidata.not.is.null,osm_tags->>wikipedia.not.is.null')
      .limit(5);

    if (error) {
      throw new Error(`Error loading sample POIs: ${error.message}`);
    }

    if (!samplePOIs || samplePOIs.length === 0) {
      console.log('❌ No sample POIs found');
      return;
    }

    console.log(`📋 Found ${samplePOIs.length} sample POIs for testing:\n`);

    samplePOIs.forEach((poi, index) => {
      console.log(`${index + 1}. ${poi.name} (${poi.city}, ${poi.state})`);
      console.log(`   Current image: ${poi.image_url ? 'Yes' : 'No'} (${poi.image_source || 'unknown'})`);
      if (poi.website) console.log(`   Website: ${poi.website}`);
      if (poi.osm_tags?.wikidata) console.log(`   Wikidata: ${poi.osm_tags.wikidata}`);
      if (poi.osm_tags?.wikipedia) console.log(`   Wikipedia: ${poi.osm_tags.wikipedia}`);
      if (poi.osm_tags?.wikimedia_commons) console.log(`   Wikimedia: ${poi.osm_tags.wikimedia_commons}`);
      console.log('');
    });

    // Test quality scoring functions
    console.log('🔍 Testing Quality Scoring Functions:\n');

    const testUrls = [
      'https://rio.rj.gov.br/images/cristo.jpg', // Government site
      'https://pt.wikipedia.org/wiki/File:Example.jpg', // Wikipedia
      'https://www.instagram.com/p/example.jpg', // Social media (should be rejected)
      'https://commons.wikimedia.org/wiki/File:Test.jpg', // Wikimedia Commons
      'https://www.museu.org.br/gallery/main.jpg' // Museum site
    ];

    // Import the functions we need to test
    const { scoreImageQuality, getSourceType, isSocialMediaImage } = await import('./unified-image-processing');

    testUrls.forEach((url, index) => {
      console.log(`${index + 1}. Testing URL: ${url}`);
      console.log(`   Source Type: ${getSourceType(url)}`);
      console.log(`   Is Social Media: ${isSocialMediaImage(url)}`);
      console.log(`   Quality Score: ${scoreImageQuality(url, 'test.jpg', 'Test image', 1200, 800, 500000, 'jpg')}/100`);
      console.log('');
    });

    console.log('✅ Quality filter tests completed!');
    console.log('\n🚀 Ready to run full unified processing script.');

  } catch (error) {
    console.error('💥 Test failed:', error);
    process.exit(1);
  }
}

// Run the test
if (require.main === module) {
  testUnifiedProcessing().catch(console.error);
}
