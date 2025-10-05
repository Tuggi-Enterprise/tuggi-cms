/**
 * Script to process Wikidata images for POIs
 */

import { config } from 'dotenv';
import { getSupabase } from '../lib/core/supabase-client';
import { writeFile } from 'fs/promises';
import { join } from 'path';

// Load environment variables
config();

const supabase = getSupabase('service');

interface WikidataPOI {
  id: string;
  name: string;
  city: string;
  state: string;
  osm_wikidata_id: string;
  image_url: string | null;
  image_source: string | null;
}

interface WikidataResult {
  success: boolean;
  attractionId: string;
  attractionName: string;
  oldImageUrl?: string;
  newImageUrl?: string;
  oldImageSource?: string;
  newImageSource?: string;
  error?: string;
  imagesFound?: number;
}

async function loadWikidataPOIs(): Promise<WikidataPOI[]> {
  console.log('📂 Loading POIs with Wikidata IDs...');
  
  try {
    const { data, error } = await supabase
      .schema('core')
      .from('attractions')
      .select('id, name, city, state, osm_wikidata_id, image_url, image_source')
      .not('osm_wikidata_id', 'is', null);

    if (error) {
      throw new Error(`Error loading Wikidata POIs: ${error.message}`);
    }

    const pois = data || [];
    console.log(`✅ Loaded ${pois.length} POIs with Wikidata IDs`);
    
    return pois;

  } catch (error) {
    console.error('💥 Error loading Wikidata POIs:', error);
    throw error;
  }
}

async function processWikidataImage(poi: WikidataPOI): Promise<WikidataResult> {
  const result: WikidataResult = {
    success: false,
    attractionId: poi.id,
    attractionName: poi.name,
    oldImageUrl: poi.image_url || undefined,
    oldImageSource: poi.image_source || undefined
  };

  try {
    console.log(`🔄 Processing: ${poi.name} (${poi.city}, ${poi.state})`);
    console.log(`   Current image: ${poi.image_url ? 'Yes' : 'No'} (${poi.image_source || 'unknown'})`);

    // Call the extract-wikidata-images edge function
    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/extract-wikidata-images`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
      },
      body: JSON.stringify({
        attractionId: poi.id,
        attractionName: poi.name,
        wikidataId: poi.osm_wikidata_id
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Edge function error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    
    if (data.success) {
      result.success = true;
      result.newImageUrl = data.images[0]?.url;
      result.newImageSource = 'wikidata';
      result.imagesFound = data.availableImages;
      console.log(`✅ Success: ${poi.name} - Processed Wikidata image`);
      console.log(`   New image: ${result.newImageUrl}`);
      console.log(`   Images found in Wikidata: ${result.imagesFound}`);
    } else {
      result.error = data.message || 'No images found in Wikidata';
      console.log(`❌ Failed: ${poi.name} - ${result.error}`);
    }

  } catch (error) {
    result.error = error instanceof Error ? error.message : 'Unknown error';
    console.log(`❌ Failed: ${poi.name} - ${result.error}`);
  }

  return result;
}

async function processBatch(pois: WikidataPOI[], batchSize: number = 3, delayMs: number = 2000): Promise<WikidataResult[]> {
  const results: WikidataResult[] = [];
  const totalBatches = Math.ceil(pois.length / batchSize);

  console.log(`🎯 Starting Wikidata image processing for ${pois.length} POIs`);
  console.log(`⚙️  Batch size: ${batchSize}, Delay: ${delayMs}ms`);

  for (let i = 0; i < pois.length; i += batchSize) {
    const batch = pois.slice(i, i + batchSize);
    const batchNumber = Math.floor(i / batchSize) + 1;

    console.log(`\n📦 Processing batch ${batchNumber}/${totalBatches} (${batch.length} POIs)`);
    console.log(`🚀 Processing batch of ${batch.length} POIs...`);

    // Process batch in parallel
    const batchPromises = batch.map(poi => processWikidataImage(poi));
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

async function saveResults(results: WikidataResult[]): Promise<void> {
  const outputDir = join(process.cwd(), 'scripts', 'output');
  
  // Save detailed results
  const resultsFile = join(outputDir, 'wikidata-processing-results.json');
  await writeFile(resultsFile, JSON.stringify(results, null, 2));
  console.log(`💾 Detailed results saved to: ${resultsFile}`);

  // Save summary CSV
  const csvFile = join(outputDir, 'wikidata-processing-summary.csv');
  const csvHeader = 'Attraction_ID,Attraction_Name,Success,Old_Image_URL,New_Image_URL,Old_Source,New_Source,Images_Found,Error\n';
  const csvRows = results.map(result => 
    `"${result.attractionId}","${result.attractionName}","${result.success}","${result.oldImageUrl || ''}","${result.newImageUrl || ''}","${result.oldImageSource || ''}","${result.newImageSource || ''}","${result.imagesFound || ''}","${result.error || ''}"`
  ).join('\n');
  
  await writeFile(csvFile, csvHeader + csvRows);
  console.log(`📊 Summary CSV saved to: ${csvFile}`);
}

async function main() {
  console.log('🎯 Wikidata Image Processing');
  console.log('============================\n');

  try {
    // Load POIs
    const pois = await loadWikidataPOIs();
    
    if (pois.length === 0) {
      console.log('✅ No POIs with Wikidata IDs found.');
      return;
    }

    // Show sample POIs
    console.log(`\n🎯 Sample POIs with Wikidata IDs:`);
    pois.slice(0, 5).forEach((poi, index) => {
      console.log(`   ${index + 1}. ${poi.name} (${poi.city}, ${poi.state})`);
      console.log(`      Wikidata ID: ${poi.osm_wikidata_id}`);
      console.log(`      Current image: ${poi.image_url ? 'Yes' : 'No'} (${poi.image_source || 'unknown'})`);
      console.log('');
    });

    // Process in batches
    const results = await processBatch(pois, 3, 2000); // Small batches, moderate delay

    // Save results
    await saveResults(results);

    // Show final summary
    const successCount = results.filter(r => r.success).length;
    const failedCount = results.filter(r => !r.success).length;
    
    console.log('\n🎉 Wikidata image processing completed!');
    console.log(`📊 Final Results:`);
    console.log(`   ✅ Successfully processed: ${successCount}`);
    console.log(`   ❌ Failed: ${failedCount}`);
    console.log(`   📈 Success rate: ${((successCount / results.length) * 100).toFixed(1)}%`);

    if (successCount > 0) {
      console.log('\n🎯 Successfully processed POIs:');
      results.filter(r => r.success).slice(0, 10).forEach((result, index) => {
        console.log(`   ${index + 1}. ${result.attractionName}`);
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
