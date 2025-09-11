/**
 * Test script for Wikidata image extraction
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// Load environment variables
config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Test with POIs that have Wikidata IDs
const testPOIs = [
  {
    id: 'test-1',
    name: 'Ecomuseu do Quarteirão Cultural do Matadouro de Santa Cruz',
    wikidataId: 'Q10270027'
  },
  {
    id: 'test-2', 
    name: 'Espaço Cultural da Marinha',
    wikidataId: 'Q10274952'
  },
  {
    id: 'test-3',
    name: 'Bairro do Ipiranga',
    wikidataId: 'Q10275874'
  }
];

async function testWikidataExtraction() {
  console.log('🧪 Testing Wikidata image extraction...\n');

  for (const poi of testPOIs) {
    console.log(`🔄 Testing: ${poi.name}`);
    console.log(`📄 Wikidata ID: ${poi.wikidataId}`);
    
    try {
      // Test the Wikidata API directly
      const apiUrl = `https://www.wikidata.org/w/api.php?` + new URLSearchParams({
        action: 'wbgetentities',
        format: 'json',
        ids: poi.wikidataId,
        props: 'claims'
      });

      console.log(`🔗 API URL: ${apiUrl}`);
      
      const response = await fetch(apiUrl);
      if (!response.ok) {
        throw new Error(`Wikidata API error: ${response.status}`);
      }

      const data = await response.json();
      const entity = data.entities[poi.wikidataId];

      if (!entity) {
        console.log(`❌ Entity not found in Wikidata`);
        continue;
      }

      // Look for image claims (P18)
      const imageClaims = entity.claims?.P18;
      if (!imageClaims || imageClaims.length === 0) {
        console.log(`❌ No images found in Wikidata`);
        continue;
      }

      console.log(`✅ Found ${imageClaims.length} image(s) in Wikidata:`);
      imageClaims.forEach((claim: any, index: number) => {
        const imageName = claim.mainsnak?.datavalue?.value;
        if (imageName) {
          console.log(`   ${index + 1}. ${imageName}`);
        }
      });

      // Test getting detailed info for first image
      if (imageClaims.length > 0) {
        const firstImage = imageClaims[0];
        const imageName = firstImage.mainsnak?.datavalue?.value;
        
        if (imageName) {
          console.log(`\n🔍 Getting details for: ${imageName}`);
          
          const detailParams = new URLSearchParams({
            action: 'query',
            format: 'json',
            titles: `File:${imageName}`,
            prop: 'imageinfo',
            iiprop: 'url|size|mime|extmetadata',
            iiurlwidth: '1600'
          });

          const detailResponse = await fetch(`https://commons.wikimedia.org/w/api.php?${detailParams}`);
          const detailData = await detailResponse.json();
          
          const detailPages = detailData.query?.pages;
          const detailPageId = Object.keys(detailPages)[0];
          const detailPage = detailPages[detailPageId];
          
          if (detailPage && detailPage.imageinfo && detailPage.imageinfo.length > 0) {
            const imageInfo = detailPage.imageinfo[0];
            const metadata = imageInfo.extmetadata || {};
            
            console.log(`✅ Image details:`);
            console.log(`   URL: ${imageInfo.url}`);
            console.log(`   Size: ${imageInfo.size} bytes`);
            console.log(`   Dimensions: ${imageInfo.width}x${imageInfo.height}`);
            console.log(`   MIME: ${imageInfo.mime}`);
            console.log(`   Author: ${metadata.Artist?.value || metadata.Creator?.value || 'Unknown'}`);
            console.log(`   License: ${metadata.LicenseShortName?.value || metadata.License?.value || 'Unknown'}`);
            console.log(`   Description: ${metadata.ImageDescription?.value || 'No description'}`);
          }
        }
      }

    } catch (error) {
      console.error(`💥 Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
    
    console.log('\n' + '='.repeat(50) + '\n');
  }
}

// Run the test
if (require.main === module) {
  testWikidataExtraction().catch(console.error);
}
