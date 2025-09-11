/**
 * Script to investigate Wikidata as an image source
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// Load environment variables
config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface WikidataPOI {
  id: string;
  name: string;
  city: string;
  state: string;
  osm_wikidata_id: string;
  image_url: string | null;
  image_source: string | null;
}

async function investigateWikidataImages(): Promise<void> {
  console.log('🔍 Investigating Wikidata as image source...\n');

  try {
    // Get POIs with Wikidata IDs
    const { data: wikidataPOIs, error } = await supabase
      .schema('core')
      .from('attractions')
      .select('id, name, city, state, osm_wikidata_id, image_url, image_source')
      .not('osm_wikidata_id', 'is', null)
      .limit(10); // Start with 10 for testing

    if (error) {
      throw new Error(`Error querying Wikidata POIs: ${error.message}`);
    }

    console.log(`✅ Found ${wikidataPOIs?.length || 0} POIs with Wikidata IDs`);

    // Test Wikidata API for images
    for (const poi of wikidataPOIs || []) {
      console.log(`\n🔄 Testing: ${poi.name} (${poi.city}, ${poi.state})`);
      console.log(`   Wikidata ID: ${poi.osm_wikidata_id}`);
      console.log(`   Current image: ${poi.image_url ? 'Yes' : 'No'} (${poi.image_source || 'unknown'})`);

      try {
        // Query Wikidata API for images
        const wikidataUrl = `https://www.wikidata.org/w/api.php?` + new URLSearchParams({
          action: 'wbgetentities',
          format: 'json',
          ids: poi.osm_wikidata_id,
          props: 'claims'
        });

        const response = await fetch(wikidataUrl);
        if (!response.ok) {
          throw new Error(`Wikidata API error: ${response.status}`);
        }

        const data = await response.json();
        const entity = data.entities[poi.osm_wikidata_id];

        if (!entity) {
          console.log(`   ❌ Entity not found in Wikidata`);
          continue;
        }

        // Look for image claims (P18)
        const imageClaims = entity.claims?.P18;
        if (imageClaims && imageClaims.length > 0) {
          console.log(`   ✅ Found ${imageClaims.length} image(s) in Wikidata:`);
          imageClaims.forEach((claim: any, index: number) => {
            const imageName = claim.mainsnak?.datavalue?.value;
            if (imageName) {
              const imageUrl = `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(imageName)}`;
              console.log(`      ${index + 1}. ${imageName}`);
              console.log(`         URL: ${imageUrl}`);
            }
          });
        } else {
          console.log(`   ❌ No images found in Wikidata`);
        }

        // Look for other relevant claims
        const relevantClaims = ['P18', 'P154', 'P41', 'P1442']; // Image, logo, flag, banner
        const foundClaims: string[] = [];
        relevantClaims.forEach(claimId => {
          if (entity.claims?.[claimId]) {
            foundClaims.push(claimId);
          }
        });

        if (foundClaims.length > 0) {
          console.log(`   📋 Other relevant claims found: ${foundClaims.join(', ')}`);
        }

      } catch (error) {
        console.log(`   💥 Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }

      // Wait between requests
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

  } catch (error) {
    console.error('💥 Investigation failed:', error);
  }
}

async function investigateWebsiteImages(): Promise<void> {
  console.log('\n🌐 Investigating website images...\n');

  try {
    // Get POIs with websites
    const { data: websitePOIs, error } = await supabase
      .schema('core')
      .from('attractions')
      .select('id, name, city, state, website, image_url, image_source')
      .not('website', 'is', null)
      .limit(5); // Start with 5 for testing

    if (error) {
      throw new Error(`Error querying website POIs: ${error.message}`);
    }

    console.log(`✅ Found ${websitePOIs?.length || 0} POIs with websites`);

    // Test website image extraction
    for (const poi of websitePOIs || []) {
      console.log(`\n🔄 Testing: ${poi.name} (${poi.city}, ${poi.state})`);
      console.log(`   Website: ${poi.website}`);
      console.log(`   Current image: ${poi.image_url ? 'Yes' : 'No'} (${poi.image_source || 'unknown'})`);

      try {
        // Test if website is accessible
        const response = await fetch(poi.website, { 
          method: 'HEAD',
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; ImageBot/1.0)'
          }
        });

        if (response.ok) {
          console.log(`   ✅ Website accessible (${response.status})`);
          console.log(`   📋 Content-Type: ${response.headers.get('content-type')}`);
        } else {
          console.log(`   ❌ Website not accessible (${response.status})`);
        }

      } catch (error) {
        console.log(`   💥 Error accessing website: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }

      // Wait between requests
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

  } catch (error) {
    console.error('💥 Website investigation failed:', error);
  }
}

async function investigateReferenceLinks(): Promise<void> {
  console.log('\n🔗 Investigating reference links...\n');

  try {
    // Get POIs with reference links
    const { data: referencePOIs, error } = await supabase
      .schema('core')
      .from('attractions')
      .select('id, name, city, state, reference_links, image_url, image_source')
      .not('reference_links', 'is', null)
      .limit(5); // Start with 5 for testing

    if (error) {
      throw new Error(`Error querying reference POIs: ${error.message}`);
    }

    console.log(`✅ Found ${referencePOIs?.length || 0} POIs with reference links`);

    // Test reference links
    for (const poi of referencePOIs || []) {
      console.log(`\n🔄 Testing: ${poi.name} (${poi.city}, ${poi.state})`);
      console.log(`   Reference Links: ${poi.reference_links}`);
      console.log(`   Current image: ${poi.image_url ? 'Yes' : 'No'} (${poi.image_source || 'unknown'})`);

      try {
        // Parse reference links (assuming JSON format)
        const links = JSON.parse(poi.reference_links || '[]');
        console.log(`   📋 Found ${links.length} reference links:`);
        
        links.forEach((link: string, index: number) => {
          console.log(`      ${index + 1}. ${link}`);
        });

      } catch (error) {
        console.log(`   💥 Error parsing reference links: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

  } catch (error) {
    console.error('💥 Reference links investigation failed:', error);
  }
}

async function main() {
  console.log('🎯 Additional Image Sources Investigation');
  console.log('========================================\n');

  try {
    await investigateWikidataImages();
    await investigateWebsiteImages();
    await investigateReferenceLinks();
    
    console.log('\n✅ Investigation completed!');
    
  } catch (error) {
    console.error('💥 Investigation failed:', error);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main().catch(console.error);
}
