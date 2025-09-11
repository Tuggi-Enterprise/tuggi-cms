/**
 * Test Phase 2A: Real API Integrations
 * Tests the implemented specialized source APIs
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { searchSpecializedSources } from './phase2-specialized-sources';

// Load environment variables
config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface TestCase {
  name: string;
  city: string;
  country: string;
  expectedSources: string[];
  description: string;
}

async function testPhase2AIntegrations() {
  console.log('🧪 Testing Phase 2A: Real API Integrations');
  console.log('==========================================\n');

  const testCases: TestCase[] = [
    {
      name: 'Smithsonian Castle',
      city: 'Washington DC',
      country: 'United States',
      expectedSources: ['Smithsonian', 'Library of Congress'],
      description: 'Should find images in Smithsonian Open Access API'
    },
    {
      name: 'Lincoln Memorial',
      city: 'Washington DC', 
      country: 'United States',
      expectedSources: ['Library of Congress', 'National Park Service'],
      description: 'Should find historical images in Library of Congress'
    },
    {
      name: 'Sagrada Família',
      city: 'Barcelona',
      country: 'España',
      expectedSources: ['Europeana', 'Spanish Heritage'],
      description: 'Should find images in Europeana for European heritage'
    },
    {
      name: 'Casa Batlló',
      city: 'Barcelona',
      country: 'España', 
      expectedSources: ['Europeana', 'Spanish Museums'],
      description: 'Test European cultural heritage API'
    },
    {
      name: 'Cristo Redentor',
      city: 'Rio de Janeiro',
      country: 'Brazil',
      expectedSources: ['IPHAN', 'Brazilian Government'],
      description: 'Test Brazilian heritage sources (may not have APIs)'
    }
  ];

  let totalTests = 0;
  let successfulTests = 0;
  let apiSuccesses = 0;

  for (const testCase of testCases) {
    console.log(`\n🔍 Testing: ${testCase.name} (${testCase.city}, ${testCase.country})`);
    console.log(`   Expected: ${testCase.expectedSources.join(', ')}`);
    console.log(`   Description: ${testCase.description}`);
    
    totalTests++;
    
    try {
      const results = await searchSpecializedSources(
        testCase.name,
        testCase.city,
        testCase.country
      );

      if (results.length > 0) {
        successfulTests++;
        console.log(`   ✅ Found ${results.length} specialized sources`);
        
        results.forEach((result, index) => {
          console.log(`   ${index + 1}. ${result.source}: ${result.success ? '✅ Success' : `❌ ${result.error}`}`);
          
          if (result.success) {
            apiSuccesses++;
            console.log(`      🖼️  Image: ${result.imageUrl}`);
            console.log(`      📝 Title: ${result.metadata?.title}`);
            console.log(`      📄 License: ${result.metadata?.license}`);
            console.log(`      👤 Author: ${result.metadata?.author}`);
          }
        });
      } else {
        console.log(`   ❌ No specialized sources found`);
      }
      
    } catch (error) {
      console.log(`   💥 Error: ${error.message}`);
    }
  }

  // Summary
  console.log('\n📊 Phase 2A Integration Test Results');
  console.log('====================================');
  console.log(`Total test cases: ${totalTests}`);
  console.log(`Sources found: ${successfulTests}/${totalTests} (${(successfulTests/totalTests*100).toFixed(1)}%)`);
  console.log(`API successes: ${apiSuccesses}`);
  
  if (apiSuccesses > 0) {
    console.log('\n🎉 Phase 2A APIs are working!');
    console.log('✅ Ready for integration with unified processing script');
  } else {
    console.log('\n⚠️  No API integrations successful yet');
    console.log('🔧 This is expected - APIs need proper keys and configuration');
  }

  // Test individual API endpoints
  await testIndividualAPIs();
}

async function testIndividualAPIs() {
  console.log('\n🔬 Testing Individual API Endpoints');
  console.log('===================================');

  // Test Smithsonian API
  await testSmithsonianAPI();
  
  // Test Europeana API
  await testEuropeanaAPI();
  
  // Test Library of Congress API
  await testLibraryOfCongressAPI();
}

async function testSmithsonianAPI() {
  console.log('\n🏛️  Testing Smithsonian Open Access API');
  
  try {
    const apiUrl = 'https://api.si.edu/openaccess/api/v1.0/search';
    const params = new URLSearchParams({
      'api_key': process.env.SMITHSONIAN_API_KEY || 'DEMO_KEY',
      'q': 'Washington Monument',
      'media.type': 'Images',
      'rows': '1'
    });

    const response = await fetch(`${apiUrl}?${params}`);
    console.log(`   Status: ${response.status}`);
    
    if (response.ok) {
      const data = await response.json();
      console.log(`   ✅ API responding - ${data.response?.rowCount || 0} results`);
      
      if (data.response?.rows?.[0]) {
        const item = data.response.rows[0];
        console.log(`   📝 Sample item: ${item.title}`);
      }
    } else {
      console.log(`   ❌ API error: ${response.statusText}`);
    }
    
  } catch (error) {
    console.log(`   💥 Network error: ${error.message}`);
  }
}

async function testEuropeanaAPI() {
  console.log('\n🏛️  Testing Europeana API');
  
  try {
    const apiUrl = 'https://api.europeana.eu/record/v2/search.json';
    const params = new URLSearchParams({
      wskey: process.env.EUROPEANA_API_KEY || 'DEMO_KEY',
      query: 'Sagrada Familia Barcelona',
      media: 'true',
      rows: '1'
    });

    const response = await fetch(`${apiUrl}?${params}`);
    console.log(`   Status: ${response.status}`);
    
    if (response.ok) {
      const data = await response.json();
      console.log(`   ✅ API responding - ${data.itemsCount || 0} results`);
      
      if (data.items?.[0]) {
        const item = data.items[0];
        console.log(`   📝 Sample item: ${item.title?.[0] || 'Untitled'}`);
      }
    } else {
      console.log(`   ❌ API error: ${response.statusText}`);
    }
    
  } catch (error) {
    console.log(`   💥 Network error: ${error.message}`);
  }
}

async function testLibraryOfCongressAPI() {
  console.log('\n📚 Testing Library of Congress API');
  
  try {
    const apiUrl = 'https://www.loc.gov/search/';
    const params = new URLSearchParams({
      q: 'Lincoln Memorial',
      fo: 'json',
      c: 'photos',
      sp: '1'
    });

    const response = await fetch(`${apiUrl}?${params}`);
    console.log(`   Status: ${response.status}`);
    
    if (response.ok) {
      const data = await response.json();
      console.log(`   ✅ API responding - ${data.results?.length || 0} results`);
      
      if (data.results?.[0]) {
        const item = data.results[0];
        console.log(`   📝 Sample item: ${item.title}`);
      }
    } else {
      console.log(`   ❌ API error: ${response.statusText}`);
    }
    
  } catch (error) {
    console.log(`   💥 Network error: ${error.message}`);
  }
}

// Run the test
if (require.main === module) {
  testPhase2AIntegrations().catch(console.error);
}
