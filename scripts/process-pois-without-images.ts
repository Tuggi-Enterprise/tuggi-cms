/**
 * Script to process POIs without images using all available sources
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { writeFile } from 'fs/promises';
import { join } from 'path';

// Load environment variables
config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface POIWithoutImage {
  id: string;
  name: string;
  city: string;
  state: string;
  website?: string;
  osm_tags?: any;
  reference_links?: any;
  rag_sources_found?: any;
}

interface ProcessingResult {
  success: boolean;
  attractionId: string;
  attractionName: string;
  source: string;
  newImageUrl?: string;
  error?: string;
  imagesFound?: number;
}

async function loadPOIsWithoutImages(): Promise<POIWithoutImage[]> {
  console.log('📂 Loading POIs without images...');
  
  try {
    const { data, error } = await supabase
      .schema('core')
      .from('attractions')
      .select('id, name, city, state, website, osm_tags, reference_links, rag_sources_found')
      .is('image_url', null);

    if (error) {
      throw new Error(`Error loading POIs without images: ${error.message}`);
    }

    const pois = data || [];
    console.log(`✅ Loaded ${pois.length} POIs without images`);
    
    // Categorize POIs by available sources
    const withWebsites = pois.filter(poi => poi.website);
    const withWikidata = pois.filter(poi => poi.osm_tags?.wikidata);
    const withWikipedia = pois.filter(poi => poi.osm_tags?.wikipedia);
    const withWikimediaCommons = pois.filter(poi => poi.osm_tags?.wikimedia_commons);
    const withOSMImages = pois.filter(poi => poi.osm_tags?.image);
    
    console.log(`\n📊 Available sources for POIs without images:`);
    console.log(`   Websites: ${withWebsites.length}`);
    console.log(`   Wikidata: ${withWikidata.length}`);
    console.log(`   Wikipedia: ${withWikipedia.length}`);
    console.log(`   Wikimedia Commons: ${withWikimediaCommons.length}`);
    console.log(`   OSM Images: ${withOSMImages.length}`);
    
    return pois;

  } catch (error) {
    console.error('💥 Error loading POIs without images:', error);
    throw error;
  }
}

async function processPOIWithAllSources(poi: POIWithoutImage): Promise<ProcessingResult> {
  const result: ProcessingResult = {
    success: false,
    attractionId: poi.id,
    attractionName: poi.name,
    source: 'none'
  };

  console.log(`🔄 Processing: ${poi.name} (${poi.city}, ${poi.state})`);

  // Try sources in order of preference
  const sources = [
    {
      name: 'website',
      condition: poi.website,
      processor: () => processWebsiteImage(poi)
    },
    {
      name: 'wikidata',
      condition: poi.osm_tags?.wikidata,
      processor: () => processWikidataImage(poi)
    },
    {
      name: 'wikipedia',
      condition: poi.osm_tags?.wikipedia,
      processor: () => processWikipediaImage(poi)
    },
    {
      name: 'wikimedia_commons',
      condition: poi.osm_tags?.wikimedia_commons,
      processor: () => processWikimediaImage(poi)
    },
    {
      name: 'osm',
      condition: poi.osm_tags?.image,
      processor: () => processOSMImage(poi)
    }
  ];

  for (const source of sources) {
    if (source.condition) {
      console.log(`   Trying ${source.name}...`);
      try {
        const sourceResult = await source.processor();
        if (sourceResult.success) {
          result.success = true;
          result.source = source.name;
          result.newImageUrl = sourceResult.newImageUrl;
          result.imagesFound = sourceResult.imagesFound;
          console.log(`   ✅ Success with ${source.name}`);
          return result;
        } else {
          console.log(`   ❌ Failed with ${source.name}: ${sourceResult.error}`);
        }
      } catch (error) {
        console.log(`   💥 Error with ${source.name}: ${error.message}`);
      }
    }
  }

  result.error = 'No suitable images found in any source';
  console.log(`   ❌ No images found in any available source`);
  return result;
}

async function processWebsiteImage(poi: POIWithoutImage): Promise<ProcessingResult> {
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
    source: 'website',
    newImageUrl: data.imageUrl,
    error: data.message,
    imagesFound: data.availableImages
  };
}

async function processWikidataImage(poi: POIWithoutImage): Promise<ProcessingResult> {
  const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/extract-wikidata-images`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
    },
    body: JSON.stringify({
      attractionId: poi.id,
      attractionName: poi.name,
      wikidataId: poi.osm_tags?.wikidata
    })
  });

  const data = await response.json();
  return {
    success: data.success,
    attractionId: poi.id,
    attractionName: poi.name,
    source: 'wikidata',
    newImageUrl: data.images?.[0]?.url,
    error: data.message,
    imagesFound: data.availableImages
  };
}

async function processWikipediaImage(poi: POIWithoutImage): Promise<ProcessingResult> {
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
    source: 'wikipedia',
    newImageUrl: data.images?.[0]?.url,
    error: data.message,
    imagesFound: data.availableImages
  };
}

async function processWikimediaImage(poi: POIWithoutImage): Promise<ProcessingResult> {
  const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/store-poi-images`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
    },
    body: JSON.stringify({
      attractionId: poi.id,
      attractionName: poi.name,
      imageSource: 'wikimedia_commons',
      wikimediaUrl: poi.osm_tags?.wikimedia_commons
    })
  });

  const data = await response.json();
  return {
    success: data.success,
    attractionId: poi.id,
    attractionName: poi.name,
    source: 'wikimedia_commons',
    newImageUrl: data.imageUrl,
    error: data.message
  };
}

async function processOSMImage(poi: POIWithoutImage): Promise<ProcessingResult> {
  const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/extract-osm-images`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
    },
    body: JSON.stringify({
      attractionId: poi.id,
      attractionName: poi.name,
      imageUrl: poi.osm_tags?.image
    })
  });

  const data = await response.json();
  return {
    success: data.success,
    attractionId: poi.id,
    attractionName: poi.name,
    source: 'osm',
    newImageUrl: data.imageUrl,
    error: data.message
  };
}

async function processBatch(pois: POIWithoutImage[], batchSize: number = 3, delayMs: number = 2000): Promise<ProcessingResult[]> {
  const results: ProcessingResult[] = [];
  const totalBatches = Math.ceil(pois.length / batchSize);

  console.log(`🎯 Starting processing for ${pois.length} POIs without images`);
  console.log(`⚙️  Batch size: ${batchSize}, Delay: ${delayMs}ms`);

  for (let i = 0; i < pois.length; i += batchSize) {
    const batch = pois.slice(i, i + batchSize);
    const batchNumber = Math.floor(i / batchSize) + 1;

    console.log(`\n📦 Processing batch ${batchNumber}/${totalBatches} (${batch.length} POIs)`);

    // Process batch in parallel
    const batchPromises = batch.map(poi => processPOIWithAllSources(poi));
    const batchResults = await Promise.all(batchPromises);
    
    results.push(...batchResults);

    // Show progress
    const successCount = results.filter(r => r.success).length;
    const failedCount = results.filter(r => !r.success).length;
    const progress = ((i + batch.length) / pois.length * 100).toFixed(1);
    
    console.log(`📊 Progress: ${i + batch.length}/${pois.length} (${progress}%) - Success: ${successCount}, Failed: ${failedCount}`);

    // Wait before next batch (except for the last batch)
    if (i + batchSize < pois.length) {
      console.log(`⏳ Waiting ${delayMs/1000} seconds before next batch...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  return results;
}

async function saveResults(results: ProcessingResult[]): Promise<void> {
  const outputDir = join(process.cwd(), 'scripts', 'output');
  
  // Save detailed results
  const resultsFile = join(outputDir, 'pois-without-images-results.json');
  await writeFile(resultsFile, JSON.stringify(results, null, 2));
  console.log(`💾 Detailed results saved to: ${resultsFile}`);

  // Save summary CSV
  const csvFile = join(outputDir, 'pois-without-images-summary.csv');
  const csvHeader = 'Attraction_ID,Attraction_Name,Success,Source,New_Image_URL,Images_Found,Error\n';
  const csvRows = results.map(result => 
    `"${result.attractionId}","${result.attractionName}","${result.success}","${result.source}","${result.newImageUrl || ''}","${result.imagesFound || ''}","${result.error || ''}"`
  ).join('\n');
  
  await writeFile(csvFile, csvHeader + csvRows);
  console.log(`📊 Summary CSV saved to: ${csvFile}`);
}

async function main() {
  console.log('🖼️  Processing POIs Without Images');
  console.log('==================================\n');

  try {
    // Load POIs without images
    const pois = await loadPOIsWithoutImages();
    
    if (pois.length === 0) {
      console.log('✅ No POIs without images found.');
      return;
    }

    // Show sample POIs
    console.log(`\n🎯 Sample POIs without images:`);
    pois.slice(0, 5).forEach((poi, index) => {
      console.log(`   ${index + 1}. ${poi.name} (${poi.city}, ${poi.state})`);
      if (poi.website) console.log(`      Website: ${poi.website}`);
      if (poi.osm_tags?.wikidata) console.log(`      Wikidata: ${poi.osm_tags.wikidata}`);
      if (poi.osm_tags?.wikipedia) console.log(`      Wikipedia: ${poi.osm_tags.wikipedia}`);
      if (poi.osm_tags?.wikimedia_commons) console.log(`      Wikimedia: ${poi.osm_tags.wikimedia_commons}`);
      if (poi.osm_tags?.image) console.log(`      OSM Image: ${poi.osm_tags.image}`);
      console.log('');
    });

    // Process in batches
    const results = await processBatch(pois, 3, 2000);

    // Save results
    await saveResults(results);

    // Show final summary
    const successCount = results.filter(r => r.success).length;
    const failedCount = results.filter(r => !r.success).length;
    
    console.log('\n🎉 Processing completed!');
    console.log(`📊 Final Results:`);
    console.log(`   ✅ Successfully processed: ${successCount}`);
    console.log(`   ❌ Failed: ${failedCount}`);
    console.log(`   📈 Success rate: ${((successCount / results.length) * 100).toFixed(1)}%`);

    // Show source distribution
    const sourceDistribution: { [key: string]: number } = {};
    results.filter(r => r.success).forEach(result => {
      sourceDistribution[result.source] = (sourceDistribution[result.source] || 0) + 1;
    });

    console.log('\n📊 Success by Source:');
    Object.entries(sourceDistribution)
      .sort(([,a], [,b]) => b - a)
      .forEach(([source, count]) => {
        console.log(`   ${source}: ${count} POIs`);
      });

    if (successCount > 0) {
      console.log('\n🎯 Successfully processed POIs:');
      results.filter(r => r.success).slice(0, 10).forEach((result, index) => {
        console.log(`   ${index + 1}. ${result.attractionName}`);
        console.log(`      Source: ${result.source}`);
        console.log(`      Images found: ${result.imagesFound || 'N/A'}`);
        console.log('');
      });
      
      if (successCount > 10) {
        console.log(`   ... and ${successCount - 10} more POIs`);
      }
    }

  } catch (error) {
    console.error('💥 Script failed:', error);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main().catch(console.error);
}
