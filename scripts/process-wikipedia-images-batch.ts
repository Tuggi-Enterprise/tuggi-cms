/**
 * Script to process Wikipedia images for POIs that don't have images
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

interface WikipediaPOI {
  id: string;
  name: string;
  city: string;
  state: string;
  osm_wikipedia_url: string;
  has_image: boolean;
}

interface ProcessingResult {
  success: boolean;
  attractionId: string;
  attractionName: string;
  error?: string;
  imageUrl?: string;
  imageSource?: string;
}

async function loadWikipediaPOIs(): Promise<WikipediaPOI[]> {
  console.log('📂 Loading Wikipedia POIs without images...');
  
  try {
    const { data, error } = await supabase
      .schema('core')
      .from('attractions')
      .select('id, name, city, state, osm_wikipedia_url, image_url')
      .not('osm_wikipedia_url', 'is', null)
      .like('osm_wikipedia_url', '%wikipedia.org%')
      .is('image_url', null); // Only POIs without images

    if (error) {
      throw new Error(`Error loading Wikipedia POIs: ${error.message}`);
    }

    const pois = data?.map(poi => ({
      ...poi,
      has_image: !!poi.image_url
    })) || [];

    console.log(`✅ Loaded ${pois.length} Wikipedia POIs without images`);
    return pois;

  } catch (error) {
    console.error('💥 Error loading Wikipedia POIs:', error);
    throw error;
  }
}

async function processWikipediaImage(poi: WikipediaPOI): Promise<ProcessingResult> {
  const result: ProcessingResult = {
    success: false,
    attractionId: poi.id,
    attractionName: poi.name
  };

  try {
    console.log(`🔄 Processing: ${poi.name} (${poi.city}, ${poi.state})`);

    // Call the extract-wikipedia-images edge function
    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/extract-wikipedia-images`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
      },
      body: JSON.stringify({
        attractionId: poi.id,
        attractionName: poi.name,
        wikipediaUrl: poi.osm_wikipedia_url
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Edge function error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    
    if (data.success) {
      result.success = true;
      result.imageUrl = data.images[0]?.url;
      result.imageSource = 'wikipedia';
      console.log(`✅ Success: ${poi.name} - Image extracted from Wikipedia`);
    } else {
      result.error = data.message || 'No images found on Wikipedia page';
      console.log(`❌ Failed: ${poi.name} - ${result.error}`);
    }

  } catch (error) {
    result.error = error instanceof Error ? error.message : 'Unknown error';
    console.log(`❌ Failed: ${poi.name} - ${result.error}`);
  }

  return result;
}

async function processBatch(pois: WikipediaPOI[], batchSize: number = 5, delayMs: number = 2000): Promise<ProcessingResult[]> {
  const results: ProcessingResult[] = [];
  const totalBatches = Math.ceil(pois.length / batchSize);

  console.log(`🎯 Starting batch processing of ${pois.length} Wikipedia POIs`);
  console.log(`⚙️  Batch size: ${batchSize}, Delay: ${delayMs}ms`);

  for (let i = 0; i < pois.length; i += batchSize) {
    const batch = pois.slice(i, i + batchSize);
    const batchNumber = Math.floor(i / batchSize) + 1;

    console.log(`\n📦 Processing batch ${batchNumber}/${totalBatches} (${batch.length} POIs)`);
    console.log(`🚀 Processing batch of ${batch.length} POIs...`);

    // Process batch in parallel
    const batchPromises = batch.map(poi => processWikipediaImage(poi));
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
  const resultsFile = join(outputDir, 'wikipedia-processing-results.json');
  await writeFile(resultsFile, JSON.stringify(results, null, 2));
  console.log(`💾 Detailed results saved to: ${resultsFile}`);

  // Save summary CSV
  const csvFile = join(outputDir, 'wikipedia-processing-summary.csv');
  const csvHeader = 'Attraction_ID,Attraction_Name,Success,Image_URL,Image_Source,Error\n';
  const csvRows = results.map(result => 
    `"${result.attractionId}","${result.attractionName}","${result.success}","${result.imageUrl || ''}","${result.imageSource || ''}","${result.error || ''}"`
  ).join('\n');
  
  await writeFile(csvFile, csvHeader + csvRows);
  console.log(`📊 Summary CSV saved to: ${csvFile}`);
}

async function main() {
  console.log('🎯 Wikipedia Image Batch Processing');
  console.log('===================================\n');

  try {
    // Load POIs
    const pois = await loadWikipediaPOIs();
    
    if (pois.length === 0) {
      console.log('✅ No Wikipedia POIs without images found. All POIs already have images!');
      return;
    }

    // Process in batches
    const results = await processBatch(pois, 3, 2000); // Smaller batches, longer delay for Wikipedia API

    // Save results
    await saveResults(results);

    // Show final summary
    const successCount = results.filter(r => r.success).length;
    const failedCount = results.filter(r => !r.success).length;
    
    console.log('\n🎉 Batch processing completed!');
    console.log(`📊 Final Results:`);
    console.log(`   ✅ Successfully processed: ${successCount}`);
    console.log(`   ❌ Failed: ${failedCount}`);
    console.log(`   📈 Success rate: ${((successCount / results.length) * 100).toFixed(1)}%`);

    if (successCount > 0) {
      console.log('\n🎯 Successfully processed POIs:');
      results.filter(r => r.success).forEach((result, index) => {
        console.log(`   ${index + 1}. ${result.attractionName} - ${result.imageUrl}`);
      });
    }

    if (failedCount > 0) {
      console.log('\n❌ Failed POIs:');
      results.filter(r => !r.success).forEach((result, index) => {
        console.log(`   ${index + 1}. ${result.attractionName} - ${result.error}`);
      });
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
