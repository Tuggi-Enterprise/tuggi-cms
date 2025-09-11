/**
 * Script to process Wikipedia image replacement for POIs with unknown image sources
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

interface WikipediaReplacementPOI {
  id: string;
  name: string;
  city: string;
  state: string;
  osm_wikipedia_url: string;
  image_url: string | null;
  image_source: string | null;
  replacement_priority: 'high' | 'medium' | 'low';
  replacement_reason: string;
}

interface ReplacementResult {
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

async function loadReplacementCandidates(): Promise<WikipediaReplacementPOI[]> {
  console.log('📂 Loading Wikipedia replacement candidates...');
  
  try {
    // Load from the JSON file we just created
    const fs = await import('fs/promises');
    const path = await import('path');
    
    const candidatesFile = join(process.cwd(), 'scripts', 'output', 'wikipedia-replacement-candidates.json');
    const fileContent = await fs.readFile(candidatesFile, 'utf-8');
    const allCandidates = JSON.parse(fileContent) as WikipediaReplacementPOI[];
    
    // Filter for medium and high priority candidates
    const candidates = allCandidates.filter(poi => 
      poi.replacement_priority === 'medium' || poi.replacement_priority === 'high'
    );
    
    console.log(`✅ Loaded ${candidates.length} replacement candidates`);
    console.log(`   High priority: ${candidates.filter(p => p.replacement_priority === 'high').length}`);
    console.log(`   Medium priority: ${candidates.filter(p => p.replacement_priority === 'medium').length}`);
    
    return candidates;

  } catch (error) {
    console.error('💥 Error loading replacement candidates:', error);
    throw error;
  }
}

async function processWikipediaReplacement(poi: WikipediaReplacementPOI): Promise<ReplacementResult> {
  const result: ReplacementResult = {
    success: false,
    attractionId: poi.id,
    attractionName: poi.name,
    oldImageUrl: poi.image_url || undefined,
    oldImageSource: poi.image_source || undefined
  };

  try {
    console.log(`🔄 Processing: ${poi.name} (${poi.city}, ${poi.state})`);
    console.log(`   Current image: ${poi.image_url ? 'Yes' : 'No'} (${poi.image_source || 'unknown'})`);

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
      result.newImageUrl = data.images[0]?.url;
      result.newImageSource = 'wikipedia';
      result.imagesFound = data.availableImages;
      console.log(`✅ Success: ${poi.name} - Replaced with Wikipedia image`);
      console.log(`   New image: ${result.newImageUrl}`);
      console.log(`   Images found on Wikipedia: ${result.imagesFound}`);
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

async function processBatch(pois: WikipediaReplacementPOI[], batchSize: number = 5, delayMs: number = 3000): Promise<ReplacementResult[]> {
  const results: ReplacementResult[] = [];
  const totalBatches = Math.ceil(pois.length / batchSize);

  console.log(`🎯 Starting Wikipedia image replacement for ${pois.length} POIs`);
  console.log(`⚙️  Batch size: ${batchSize}, Delay: ${delayMs}ms`);

  for (let i = 0; i < pois.length; i += batchSize) {
    const batch = pois.slice(i, i + batchSize);
    const batchNumber = Math.floor(i / batchSize) + 1;

    console.log(`\n📦 Processing batch ${batchNumber}/${totalBatches} (${batch.length} POIs)`);
    console.log(`🚀 Processing batch of ${batch.length} POIs...`);

    // Process batch in parallel
    const batchPromises = batch.map(poi => processWikipediaReplacement(poi));
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

async function saveResults(results: ReplacementResult[]): Promise<void> {
  const outputDir = join(process.cwd(), 'scripts', 'output');
  
  // Save detailed results
  const resultsFile = join(outputDir, 'wikipedia-replacement-results.json');
  await writeFile(resultsFile, JSON.stringify(results, null, 2));
  console.log(`💾 Detailed results saved to: ${resultsFile}`);

  // Save summary CSV
  const csvFile = join(outputDir, 'wikipedia-replacement-summary.csv');
  const csvHeader = 'Attraction_ID,Attraction_Name,Success,Old_Image_URL,New_Image_URL,Old_Source,New_Source,Images_Found,Error\n';
  const csvRows = results.map(result => 
    `"${result.attractionId}","${result.attractionName}","${result.success}","${result.oldImageUrl || ''}","${result.newImageUrl || ''}","${result.oldImageSource || ''}","${result.newImageSource || ''}","${result.imagesFound || ''}","${result.error || ''}"`
  ).join('\n');
  
  await writeFile(csvFile, csvHeader + csvRows);
  console.log(`📊 Summary CSV saved to: ${csvFile}`);
}

async function main() {
  console.log('🎯 Wikipedia Image Replacement Batch Processing');
  console.log('==============================================\n');

  try {
    // Load candidates
    const candidates = await loadReplacementCandidates();
    
    if (candidates.length === 0) {
      console.log('✅ No replacement candidates found.');
      return;
    }

    // Ask for confirmation before processing
    console.log(`\n⚠️  About to process ${candidates.length} POIs for Wikipedia image replacement.`);
    console.log('This will replace existing images with Wikipedia images.');
    console.log('Press Ctrl+C to cancel, or wait 5 seconds to continue...\n');
    
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Process in batches
    const results = await processBatch(candidates, 3, 3000); // Smaller batches, longer delay for Wikipedia API

    // Save results
    await saveResults(results);

    // Show final summary
    const successCount = results.filter(r => r.success).length;
    const failedCount = results.filter(r => !r.success).length;
    
    console.log('\n🎉 Wikipedia image replacement completed!');
    console.log(`📊 Final Results:`);
    console.log(`   ✅ Successfully replaced: ${successCount}`);
    console.log(`   ❌ Failed: ${failedCount}`);
    console.log(`   📈 Success rate: ${((successCount / results.length) * 100).toFixed(1)}%`);

    if (successCount > 0) {
      console.log('\n🎯 Successfully replaced POIs:');
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
