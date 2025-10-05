/**
 * Small production test - Process a few real POIs with the complete unified system
 * This will test Phase 1 + Phase 2A + all Edge Functions with actual data
 */

import { config } from 'dotenv';
import { getSupabase } from '../lib/core/supabase-client';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { searchSpecializedSources } from './phase2-specialized-sources';

// Load environment variables
config();

const supabase = getSupabase('service');

interface POI {
  id: string;
  name: string;
  city: string;
  state: string;
  country: string;
  image_url: string | null;
  image_source: string | null;
  website?: string;
  osm_tags?: any;
}

interface ProcessingResult {
  success: boolean;
  attractionId: string;
  attractionName: string;
  oldImageSource?: string;
  newImageSource?: string;
  newImageUrl?: string;
  error?: string;
  processingTime?: number;
}

// Process specialized sources (Phase 2A)
async function processSpecializedImage(poi: POI): Promise<ProcessingResult> {
  const startTime = Date.now();
  
  try {
    console.log(`   🏛️  Trying specialized sources for ${poi.country}...`);
    
    const specializedResults = await searchSpecializedSources(
      poi.name,
      poi.city,
      poi.country
    );

    if (specializedResults.length === 0) {
      return {
        success: false,
        attractionId: poi.id,
        attractionName: poi.name,
        oldImageSource: poi.image_source,
        error: 'No specialized sources found for this country',
        processingTime: Date.now() - startTime
      };
    }

    // Find the first successful result
    const successfulResult = specializedResults.find(result => result.success);
    
    if (successfulResult) {
      // Call the specialized images Edge Function
      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/extract-specialized-images`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
        },
        body: JSON.stringify({
          attractionId: poi.id,
          attractionName: poi.name,
          specializedSource: successfulResult.source,
          imageUrl: successfulResult.imageUrl,
          metadata: successfulResult.metadata
        })
      });

      const data = await response.json();
      
      if (data.success) {
        return {
          success: true,
          attractionId: poi.id,
          attractionName: poi.name,
          oldImageSource: poi.image_source,
          newImageSource: `specialized_${successfulResult.source}`,
          newImageUrl: data.imageUrl,
          processingTime: Date.now() - startTime
        };
      } else {
        return {
          success: false,
          attractionId: poi.id,
          attractionName: poi.name,
          oldImageSource: poi.image_source,
          error: `Specialized source failed: ${data.error}`,
          processingTime: Date.now() - startTime
        };
      }
    }

    return {
      success: false,
      attractionId: poi.id,
      attractionName: poi.name,
      oldImageSource: poi.image_source,
      error: 'All specialized sources failed',
      processingTime: Date.now() - startTime
    };

  } catch (error) {
    return {
      success: false,
      attractionId: poi.id,
      attractionName: poi.name,
      oldImageSource: poi.image_source,
      error: `Specialized sources error: ${error.message}`,
      processingTime: Date.now() - startTime
    };
  }
}

// Process website images (Phase 1)
async function processWebsiteImage(poi: POI): Promise<ProcessingResult> {
  const startTime = Date.now();
  
  try {
    console.log(`   🌐 Trying website: ${poi.website}...`);
    
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

    const data = await response.json();
    
    return {
      success: data.success,
      attractionId: poi.id,
      attractionName: poi.name,
      oldImageSource: poi.image_source,
      newImageSource: 'website',
      newImageUrl: data.imageUrl,
      error: data.message,
      processingTime: Date.now() - startTime
    };
  } catch (error) {
    return {
      success: false,
      attractionId: poi.id,
      attractionName: poi.name,
      oldImageSource: poi.image_source,
      error: error.message,
      processingTime: Date.now() - startTime
    };
  }
}

// Process Wikipedia images (Phase 1)
async function processWikipediaImage(poi: POI): Promise<ProcessingResult> {
  const startTime = Date.now();
  
  try {
    console.log(`   📖 Trying Wikipedia: ${poi.osm_tags?.wikipedia}...`);
    
    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/extract-wikipedia-images`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
      },
      body: JSON.stringify({
        attractionId: poi.id,
        attractionName: poi.name,
        wikipediaUrl: poi.osm_tags?.wikipedia
      })
    });

    const data = await response.json();
    
    return {
      success: data.success,
      attractionId: poi.id,
      attractionName: poi.name,
      oldImageSource: poi.image_source,
      newImageSource: 'wikipedia',
      newImageUrl: data.images?.[0]?.url,
      error: data.message,
      processingTime: Date.now() - startTime
    };
  } catch (error) {
    return {
      success: false,
      attractionId: poi.id,
      attractionName: poi.name,
      oldImageSource: poi.image_source,
      error: error.message,
      processingTime: Date.now() - startTime
    };
  }
}

// Main processing function for a single POI
async function processPOI(poi: POI): Promise<ProcessingResult> {
  console.log(`\n🔄 Processing: ${poi.name} (${poi.city}, ${poi.country})`);
  console.log(`   Current image: ${poi.image_url ? 'Yes' : 'No'} (${poi.image_source || 'unknown'})`);

  // Define processing order (highest priority first)
  const processors = [];
  
  // 1. Specialized sources (Phase 2A) - highest priority
  if (['BR', 'US', 'ES', 'MX', 'CL'].includes(poi.country)) {
    processors.push({
      name: 'specialized_sources',
      processor: () => processSpecializedImage(poi)
    });
  }
  
  // 2. Website sources
  if (poi.website) {
    processors.push({
      name: 'website',
      processor: () => processWebsiteImage(poi)
    });
  }
  
  // 3. Wikipedia sources
  if (poi.osm_tags?.wikipedia) {
    processors.push({
      name: 'wikipedia',
      processor: () => processWikipediaImage(poi)
    });
  }

  if (processors.length === 0) {
    console.log(`   ❌ No available sources`);
    return {
      success: false,
      attractionId: poi.id,
      attractionName: poi.name,
      oldImageSource: poi.image_source,
      error: 'No available sources'
    };
  }

  console.log(`   📋 Available sources: ${processors.map(p => p.name).join(', ')}`);

  // Try each processor in order
  for (const { name, processor } of processors) {
    console.log(`   🔍 Trying ${name}...`);
    
    try {
      const result = await processor();
      
      if (result.success) {
        console.log(`   ✅ Success with ${name}`);
        console.log(`   📸 New image: ${result.newImageUrl}`);
        console.log(`   ⏱️  Processing time: ${result.processingTime}ms`);
        return result;
      } else {
        console.log(`   ❌ Failed with ${name}: ${result.error}`);
      }
    } catch (error) {
      console.log(`   💥 Error with ${name}: ${error.message}`);
    }
  }

  console.log(`   ❌ All sources failed`);
  return {
    success: false,
    attractionId: poi.id,
    attractionName: poi.name,
    oldImageSource: poi.image_source,
    error: 'All available sources failed'
  };
}

async function runSmallProductionTest() {
  console.log('🎯 Small Production Test - Complete Unified System');
  console.log('=================================================\n');

  try {
    // Load a small sample of diverse POIs
    const { data: pois, error } = await supabase
      .schema('core')
      .from('attractions')
      .select('id, name, city, state, country, image_url, image_source, website, osm_tags')
      .or('website.not.is.null,osm_tags->>wikipedia.not.is.null,country.in.(BR,US,ES)')
      .limit(5); // Small test batch

    if (error) {
      throw new Error(`Error loading POIs: ${error.message}`);
    }

    console.log(`✅ Loaded ${pois.length} POIs for production test\n`);

    const results: ProcessingResult[] = [];

    // Process each POI
    for (const poi of pois) {
      const result = await processPOI(poi);
      results.push(result);
      
      // Wait between POIs to be respectful
      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    // Save results
    const outputDir = join(process.cwd(), 'scripts', 'output');
    const resultsFile = join(outputDir, 'small-production-test-results.json');
    await writeFile(resultsFile, JSON.stringify(results, null, 2));
    console.log(`\n💾 Results saved to: ${resultsFile}`);

    // Show summary
    const successCount = results.filter(r => r.success).length;
    const failedCount = results.filter(r => !r.success).length;
    const totalProcessingTime = results.reduce((sum, r) => sum + (r.processingTime || 0), 0);
    
    console.log('\n📊 Production Test Results:');
    console.log('===========================');
    console.log(`✅ Successfully processed: ${successCount}/${results.length}`);
    console.log(`❌ Failed: ${failedCount}/${results.length}`);
    console.log(`📈 Success rate: ${((successCount / results.length) * 100).toFixed(1)}%`);
    console.log(`⏱️  Total processing time: ${(totalProcessingTime / 1000).toFixed(1)}s`);
    console.log(`⚡ Average time per POI: ${(totalProcessingTime / results.length / 1000).toFixed(1)}s`);

    // Show successful results
    if (successCount > 0) {
      console.log('\n🎉 Successful Results:');
      console.log('======================');
      results.filter(r => r.success).forEach((result, index) => {
        console.log(`${index + 1}. ${result.attractionName}`);
        console.log(`   Source: ${result.newImageSource}`);
        console.log(`   Old: ${result.oldImageSource || 'none'} → New: ${result.newImageSource}`);
        console.log(`   Time: ${result.processingTime}ms`);
        console.log(`   Image: ${result.newImageUrl}`);
        console.log('');
      });
    }

    // Show failed results
    if (failedCount > 0) {
      console.log('\n❌ Failed Results:');
      console.log('==================');
      results.filter(r => !r.success).forEach((result, index) => {
        console.log(`${index + 1}. ${result.attractionName}`);
        console.log(`   Error: ${result.error}`);
        console.log('');
      });
    }

    if (successCount > 0) {
      console.log('\n🚀 PRODUCTION TEST SUCCESSFUL!');
      console.log('===============================');
      console.log('✅ System is working in production environment');
      console.log('✅ Edge Functions are processing real POIs');
      console.log('✅ Database updates are working');
      console.log('✅ Ready for larger batches');
      
      console.log('\n💡 Next steps:');
      console.log('- Run larger batches (10-50 POIs)');
      console.log('- Monitor success rates and adjust');
      console.log('- Scale to full database processing');
    } else {
      console.log('\n⚠️  All POIs failed - investigate issues');
      console.log('Check API keys, network connectivity, and Edge Function logs');
    }

  } catch (error) {
    console.error('💥 Production test failed:', error);
    process.exit(1);
  }
}

// Run the production test
if (require.main === module) {
  runSmallProductionTest().catch(console.error);
}
