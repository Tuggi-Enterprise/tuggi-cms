/**
 * Script to test website image extraction
 */

import { config } from 'dotenv';

// Load environment variables
config();

interface TestPOI {
  id: string;
  name: string;
  city: string;
  state: string;
  website: string;
}

const testPOIs: TestPOI[] = [
  {
    id: "test-1",
    name: "Centro Cultural de España",
    city: "Ciudad De México",
    state: "null",
    website: "http://www.ccemx.org/"
  },
  {
    id: "test-2", 
    name: "Mercado Sonora",
    city: "Ciudad De México",
    state: "null",
    website: "https://mercadosonora.com.mx/"
  },
  {
    id: "test-3",
    name: "Iglesia de San Medir",
    city: "Barcelona",
    state: "null", 
    website: "http://parroquiasantmedir.cat/"
  }
];

async function testWebsiteExtraction(poi: TestPOI): Promise<void> {
  console.log(`\n🧪 Testing website extraction for: ${poi.name}`);
  console.log(`   Website: ${poi.website}`);

  try {
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
      console.log(`   ✅ Success!`);
      console.log(`   Image URL: ${data.imageUrl}`);
      console.log(`   Images found: ${data.availableImages}`);
      console.log(`   Image title: ${data.images[0]?.title}`);
    } else {
      console.log(`   ❌ Failed: ${data.message}`);
    }

  } catch (error) {
    console.log(`   💥 Error: ${error.message}`);
  }
}

async function main() {
  console.log('🌐 Testing Website Image Extraction');
  console.log('===================================\n');

  for (const poi of testPOIs) {
    await testWebsiteExtraction(poi);
    
    // Wait between tests
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  console.log('\n🎉 Website extraction testing completed!');
}

// Run the test
if (require.main === module) {
  main().catch(console.error);
}
