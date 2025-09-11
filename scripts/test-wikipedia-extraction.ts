/**
 * Test script for Wikipedia image extraction
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// Load environment variables
config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Test with the POIs that don't have images
const testPOIs = [
  {
    id: 'test-1',
    name: 'Letreiro de Padre Miguel',
    wikipediaUrl: 'https://pt.wikipedia.org/wiki/Padre_Miguel'
  },
  {
    id: 'test-2', 
    name: 'Cachoeira da gruta Camorim',
    wikipediaUrl: 'https://pt.wikipedia.org/wiki/Camorim'
  }
];

async function testWikipediaExtraction() {
  console.log('🧪 Testing Wikipedia image extraction...\n');

  for (const poi of testPOIs) {
    console.log(`🔄 Testing: ${poi.name}`);
    console.log(`📄 Wikipedia URL: ${poi.wikipediaUrl}`);
    
    try {
      // Test the Wikipedia API directly
      const url = new URL(poi.wikipediaUrl);
      const pathParts = url.pathname.split('/');
      const pageTitle = pathParts[pathParts.length - 1];
      
      console.log(`📋 Page Title: ${decodeURIComponent(pageTitle)}`);
      
      // Get page images
      const apiUrl = `https://${url.hostname}/w/api.php?` + new URLSearchParams({
        action: 'query',
        format: 'json',
        prop: 'images',
        titles: decodeURIComponent(pageTitle),
        imlimit: '5'
      });

      console.log(`🔗 API URL: ${apiUrl}`);
      
      const response = await fetch(apiUrl);
      if (!response.ok) {
        throw new Error(`Wikipedia API error: ${response.status}`);
      }

      const data = await response.json();
      const pages = data.query?.pages;
      const pageId = Object.keys(pages)[0];
      const page = pages[pageId];

      if (!page || !page.images) {
        console.log(`❌ No images found on Wikipedia page`);
        continue;
      }

      console.log(`✅ Found ${page.images.length} images on Wikipedia page:`);
      page.images.forEach((image: any, index: number) => {
        console.log(`   ${index + 1}. ${image.title}`);
      });

      // Test getting detailed info for first image
      if (page.images.length > 0) {
        const firstImage = page.images[0];
        console.log(`\n🔍 Getting details for: ${firstImage.title}`);
        
        const detailParams = new URLSearchParams({
          action: 'query',
          format: 'json',
          titles: firstImage.title,
          prop: 'imageinfo',
          iiprop: 'url|size|mime|extmetadata',
          iiurlwidth: '1600'
        });

        const detailResponse = await fetch(`https://${url.hostname}/w/api.php?${detailParams}`);
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

    } catch (error) {
      console.error(`💥 Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
    
    console.log('\n' + '='.repeat(50) + '\n');
  }
}

// Run the test
if (require.main === module) {
  testWikipediaExtraction().catch(console.error);
}
