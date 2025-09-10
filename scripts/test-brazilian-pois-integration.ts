import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { searchSpecializedSources } from './phase2-specialized-sources';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface BrazilianPOI {
  id: string;
  name: string;
  city: string;
  state: string;
  country: string;
  image_url: string | null;
  image_source: string | null;
}

async function loadBrazilianPOIs(): Promise<BrazilianPOI[]> {
  console.log('🇧🇷 Loading Brazilian POIs from database...');
  
  const { data: pois, error } = await supabase
    .schema('core')
    .from('attractions')
    .select('id, name, city, state, country, image_url, image_source')
    .eq('country', 'BR')
    .limit(10);

  if (error) {
    console.error('Error loading Brazilian POIs:', error);
    return [];
  }

  console.log(`✅ Loaded ${pois?.length || 0} Brazilian POIs`);
  return pois || [];
}

async function testIPHANIntegration(poi: BrazilianPOI): Promise<boolean> {
  console.log(`\n🏛️  Testing IPHAN integration for: ${poi.name} (${poi.city}, ${poi.state})`);
  
  try {
    const results = await searchSpecializedSources(
      poi.name,
      poi.city,
      poi.country
    );

    console.log(`   📊 Found ${results.length} specialized sources`);
    
    const successfulResults = results.filter(r => r.success);
    if (successfulResults.length > 0) {
      console.log(`   ✅ Success with ${successfulResults.length} sources:`);
      successfulResults.forEach((result, index) => {
        console.log(`      ${index + 1}. ${result.source}`);
        console.log(`         Image: ${result.imageUrl}`);
        console.log(`         License: ${result.metadata?.license}`);
      });
      return true;
    } else {
      console.log(`   ❌ No successful results`);
      results.forEach((result, index) => {
        console.log(`      ${index + 1}. ${result.source}: ${result.error}`);
      });
      return false;
    }
    
  } catch (error) {
    console.log(`   💥 Error: ${error.message}`);
    return false;
  }
}

async function testUnifiedSystem(poi: BrazilianPOI): Promise<boolean> {
  console.log(`\n🔄 Testing unified system for: ${poi.name}`);
  
  try {
    // Call the unified image processing Edge Function
    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/unified-image-processing`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
      },
      body: JSON.stringify({
        attractionId: poi.id,
        attractionName: poi.name,
        city: poi.city,
        state: poi.state,
        country: poi.country
      })
    });

    if (!response.ok) {
      throw new Error(`Unified system error: ${response.status}`);
    }

    const data = await response.json();
    
    if (data.success) {
      console.log(`   ✅ Unified system success:`);
      console.log(`      New image: ${data.imageUrl}`);
      console.log(`      Source: ${data.imageSource}`);
      console.log(`      Processing time: ${data.processingTime}ms`);
      return true;
    } else {
      console.log(`   ❌ Unified system failed: ${data.error}`);
      return false;
    }
    
  } catch (error) {
    console.log(`   💥 Error: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log('🇧🇷 Testing Brazilian POIs Integration');
  console.log('=====================================\n');

  try {
    // Load Brazilian POIs
    const pois = await loadBrazilianPOIs();
    
    if (pois.length === 0) {
      console.log('❌ No Brazilian POIs found in database');
      return;
    }

    console.log(`\n🎯 Testing with ${pois.length} Brazilian POIs:\n`);
    
    let iphanSuccessCount = 0;
    let unifiedSuccessCount = 0;
    
    for (const poi of pois) {
      console.log(`📍 POI: ${poi.name} (${poi.city}, ${poi.state})`);
      console.log(`   Current image: ${poi.image_url ? 'Yes' : 'No'} (${poi.image_source || 'none'})`);
      
      // Test IPHAN integration
      const iphanSuccess = await testIPHANIntegration(poi);
      if (iphanSuccess) iphanSuccessCount++;
      
      // Test unified system
      const unifiedSuccess = await testUnifiedSystem(poi);
      if (unifiedSuccess) unifiedSuccessCount++;
      
      // Wait between requests to be respectful
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    // Summary
    console.log('\n📊 Test Summary:');
    console.log('================');
    console.log(`🇧🇷 Brazilian POIs tested: ${pois.length}`);
    console.log(`🏛️  IPHAN integration success: ${iphanSuccessCount}/${pois.length} (${Math.round(iphanSuccessCount/pois.length*100)}%)`);
    console.log(`🔄 Unified system success: ${unifiedSuccessCount}/${pois.length} (${Math.round(unifiedSuccessCount/pois.length*100)}%)`);
    
    if (iphanSuccessCount > 0) {
      console.log('\n🎉 IPHAN crawler is working for Brazilian heritage sites!');
    }
    
    if (unifiedSuccessCount > 0) {
      console.log('🎉 Unified system is successfully processing Brazilian POIs!');
    }
    
    console.log('\n✅ Brazilian POIs integration test completed!');
    
  } catch (error) {
    console.error('💥 Error:', error);
    process.exit(1);
  }
}

// Run the test
main().catch(console.error);
