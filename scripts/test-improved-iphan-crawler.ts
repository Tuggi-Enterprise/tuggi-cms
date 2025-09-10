import dotenv from 'dotenv';
dotenv.config();

interface TestPOI {
  id: string;
  name: string;
  city: string;
  state: string;
  country: string;
}

// Test POIs that should have specific IPHAN heritage information
const testPOIs: TestPOI[] = [
  {
    id: 'test-iphan-1',
    name: 'Teatro Municipal',
    city: 'Rio de Janeiro',
    state: 'RJ',
    country: 'BR'
  },
  {
    id: 'test-iphan-2', 
    name: 'Museu Nacional',
    city: 'Rio de Janeiro',
    state: 'RJ',
    country: 'BR'
  },
  {
    id: 'test-iphan-3',
    name: 'Igreja de São Francisco',
    city: 'Salvador',
    state: 'BA',
    country: 'BR'
  },
  {
    id: 'test-iphan-4',
    name: 'Fortaleza de São José',
    city: 'Macapá',
    state: 'AP',
    country: 'BR'
  },
  {
    id: 'test-iphan-5',
    name: 'Palácio dos Bandeirantes',
    city: 'São Paulo',
    state: 'SP',
    country: 'BR'
  }
];

async function testImprovedIPHANCrawler() {
  console.log('🏛️  Testing Improved IPHAN Crawler...\n');
  
  const results = [];
  
  for (const poi of testPOIs) {
    console.log(`\n📍 Testing: ${poi.name} (${poi.city}, ${poi.state})`);
    
    try {
      const searchQuery = `${poi.name} ${poi.city}`;
      
      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/extract-iphan-images`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
        },
        body: JSON.stringify({
          attractionId: poi.id,
          attractionName: poi.name,
          searchQuery: searchQuery
        })
      });
      
      const data = await response.json();
      
      if (data.success) {
        console.log(`   ✅ Success: Found ${data.found} heritage items, stored ${data.stored} images`);
        console.log(`   🖼️  Image URL: ${data.imageUrl}`);
        results.push({
          poi: poi.name,
          success: true,
          found: data.found,
          stored: data.stored,
          imageUrl: data.imageUrl
        });
      } else {
        console.log(`   ❌ Failed: ${data.message}`);
        results.push({
          poi: poi.name,
          success: false,
          error: data.message
        });
      }
      
      // Show heritage results found
      if (data.results && data.results.length > 0) {
        console.log(`   📋 Heritage items found:`);
        data.results.forEach((result: any, index: number) => {
          console.log(`      ${index + 1}. ${result.title}`);
          console.log(`         Source: ${result.source}`);
          console.log(`         Image: ${result.imageUrl}`);
        });
      }
      
    } catch (error) {
      console.log(`   💥 Error: ${error.message}`);
      results.push({
        poi: poi.name,
        success: false,
        error: error.message
      });
    }
    
    // Wait between requests to be respectful
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  
  // Summary
  console.log('\n📊 Test Summary:');
  console.log('================');
  
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  console.log(`✅ Successful: ${successful.length}/${results.length}`);
  console.log(`❌ Failed: ${failed.length}/${results.length}`);
  
  if (successful.length > 0) {
    console.log('\n🎉 Successful extractions:');
    successful.forEach(result => {
      console.log(`   • ${result.poi}: ${result.stored} images stored`);
    });
  }
  
  if (failed.length > 0) {
    console.log('\n💥 Failed extractions:');
    failed.forEach(result => {
      console.log(`   • ${result.poi}: ${result.error}`);
    });
  }
  
  console.log('\n🏛️  Improved IPHAN Crawler test completed!');
}

// Run the test
testImprovedIPHANCrawler().catch(console.error);
