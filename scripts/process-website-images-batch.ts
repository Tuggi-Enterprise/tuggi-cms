/**
 * Script to process website images for POIs with official websites
 */

import { config } from 'dotenv';
import { getSupabase } from '../lib/core/supabase-client';
import { writeFile } from 'fs/promises';
import { join } from 'path';

// Load environment variables
config();

const supabase = getSupabase('service');

interface WebsitePOI {
  id: string;
  name: string;
  city: string;
  state: string;
  website: string;
  image_url: string | null;
  image_source: string | null;
}

interface WebsiteResult {
  success: boolean;
  attractionId: string;
  attractionName: string;
  websiteUrl: string;
  oldImageUrl?: string;
  newImageUrl?: string;
  oldImageSource?: string;
  newImageSource?: string;
  error?: string;
  imagesFound?: number;
}

async function loadWebsitePOIs(): Promise<WebsitePOI[]> {
  console.log('📂 Loading POIs with official websites...');
  
  try {
    const { data, error } = await supabase
      .schema('core')
      .from('attractions')
      .select('id, name, city, state, website, image_url, image_source')
      .not('website', 'is', null)
      .not('website', 'eq', '');

    if (error) {
      throw new Error(`Error loading website POIs: ${error.message}`);
    }

    const pois = data || [];
    console.log(`✅ Loaded ${pois.length} POIs with websites`);
    
    // Filter out POIs that already have good image sources
    const priorityPOIs = pois.filter(poi => 
      !poi.image_source || 
      poi.image_source === 'unknown' || 
      poi.image_source === 'google_places'
    );
    
    console.log(`🎯 Priority POIs (need better images): ${priorityPOIs.length}`);
    
    return priorityPOIs;

  } catch (error) {
    console.error('💥 Error loading website POIs:', error);
    throw error;
  }
}

async function processWebsiteImage(poi: WebsitePOI): Promise<WebsiteResult> {
  const result: WebsiteResult = {
    success: false,
    attractionId: poi.id,
    attractionName: poi.name,
    websiteUrl: poi.website,
    oldImageUrl: poi.image_url || undefined,
    oldImageSource: poi.image_source || undefined
  };

  try {
    console.log(`🔄 Processing: ${poi.name} (${poi.city}, ${poi.state})`);
    console.log(`   Website: ${poi.website}`);
    console.log(`   Current image: ${poi.image_url ? 'Yes' : 'No'} (${poi.image_source || 'unknown'})`);

    // Call the extract-website-images edge function
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
      throw new Error(`Edge function error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    
    if (data.success) {
      result.success = true;
      result.newImageUrl = data.imageUrl;
      result.newImageSource = 'website';
      result.imagesFound = data.availableImages;
      console.log(`✅ Success: ${poi.name} - Processed website image`);
      console.log(`   New image: ${result.newImageUrl}`);
      console.log(`   Images found on website: ${result.imagesFound}`);
    } else {
      result.error = data.message || 'No images found on website';
      console.log(`❌ Failed: ${poi.name} - ${result.error}`);
    }

  } catch (error) {
    result.error = error instanceof Error ? error.message : 'Unknown error';
    console.log(`❌ Failed: ${poi.name} - ${result.error}`);
  }

  return result;
}

async function processBatch(pois: WebsitePOI[], batchSize: number = 2, delayMs: number = 3000): Promise<WebsiteResult[]> {
  const results: WebsiteResult[] = [];
  const totalBatches = Math.ceil(pois.length / batchSize);

  console.log(`🎯 Starting website image processing for ${pois.length} POIs`);
  console.log(`⚙️  Batch size: ${batchSize}, Delay: ${delayMs}ms`);

  for (let i = 0; i < pois.length; i += batchSize) {
    const batch = pois.slice(i, i + batchSize);
    const batchNumber = Math.floor(i / batchSize) + 1;

    console.log(`\n📦 Processing batch ${batchNumber}/${totalBatches} (${batch.length} POIs)`);
    console.log(`🚀 Processing batch of ${batch.length} POIs...`);

    // Process batch in parallel
    const batchPromises = batch.map(poi => processWebsiteImage(poi));
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

async function saveResults(results: WebsiteResult[]): Promise<void> {
  const outputDir = join(process.cwd(), 'scripts', 'output');
  
  // Save detailed results
  const resultsFile = join(outputDir, 'website-processing-results.json');
  await writeFile(resultsFile, JSON.stringify(results, null, 2));
  console.log(`💾 Detailed results saved to: ${resultsFile}`);

  // Save summary CSV
  const csvFile = join(outputDir, 'website-processing-summary.csv');
  const csvHeader = 'Attraction_ID,Attraction_Name,Website_URL,Success,Old_Image_URL,New_Image_URL,Old_Source,New_Source,Images_Found,Error\n';
  const csvRows = results.map(result => 
    `"${result.attractionId}","${result.attractionName}","${result.websiteUrl}","${result.success}","${result.oldImageUrl || ''}","${result.newImageUrl || ''}","${result.oldImageSource || ''}","${result.newImageSource || ''}","${result.imagesFound || ''}","${result.error || ''}"`
  ).join('\n');
  
  await writeFile(csvFile, csvHeader + csvRows);
  console.log(`📊 Summary CSV saved to: ${csvFile}`);
}

async function main() {
  console.log('🌐 Website Image Processing');
  console.log('===========================\n');

  try {
    // Load POIs
    const pois = await loadWebsitePOIs();
    
    if (pois.length === 0) {
      console.log('✅ No POIs with websites found that need better images.');
      return;
    }

    // Show sample POIs
    console.log(`\n🎯 Sample POIs with websites:`);
    pois.slice(0, 5).forEach((poi, index) => {
      console.log(`   ${index + 1}. ${poi.name} (${poi.city}, ${poi.state})`);
      console.log(`      Website: ${poi.website}`);
      console.log(`      Current image: ${poi.image_url ? 'Yes' : 'No'} (${poi.image_source || 'unknown'})`);
      console.log('');
    });

    // Process in batches (smaller batches for website scraping)
    const results = await processBatch(pois, 2, 3000); // Small batches, longer delay

    // Save results
    await saveResults(results);

    // Show final summary
    const successCount = results.filter(r => r.success).length;
    const failedCount = results.filter(r => !r.success).length;
    
    console.log('\n🎉 Website image processing completed!');
    console.log(`📊 Final Results:`);
    console.log(`   ✅ Successfully processed: ${successCount}`);
    console.log(`   ❌ Failed: ${failedCount}`);
    console.log(`   📈 Success rate: ${((successCount / results.length) * 100).toFixed(1)}%`);

    if (successCount > 0) {
      console.log('\n🎯 Successfully processed POIs:');
      results.filter(r => r.success).slice(0, 10).forEach((result, index) => {
        console.log(`   ${index + 1}. ${result.attractionName}`);
        console.log(`      Website: ${result.websiteUrl}`);
        console.log(`      Old: ${result.oldImageSource || 'unknown'} → New: ${result.newImageSource}`);
        console.log(`      Images found: ${result.imagesFound}`);
        console.log('');
      });
      
      if (successCount > 10) {
        console.log(`   ... and ${successCount - 10} more POIs`);
      }
    }

    if (failedCount > 0) {
      console.log('\n❌ Failed POIs:');
      results.filter(r => !r.success).slice(0, 5).forEach((result, index) => {
        console.log(`   ${index + 1}. ${result.attractionName} - ${result.error}`);
      });
      
      if (failedCount > 5) {
        console.log(`   ... and ${failedCount - 5} more failed POIs`);
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
