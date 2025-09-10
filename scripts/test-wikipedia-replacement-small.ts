/**
 * Test script for Wikipedia image replacement with a small sample
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

async function loadSmallSample(): Promise<WikipediaReplacementPOI[]> {
  console.log('📂 Loading small sample for testing...');
  
  try {
    // Load from the JSON file we just created
    const fs = await import('fs/promises');
    const path = await import('path');
    
    const candidatesFile = join(process.cwd(), 'scripts', 'output', 'wikipedia-replacement-candidates.json');
    const fileContent = await fs.readFile(candidatesFile, 'utf-8');
    const allCandidates = JSON.parse(fileContent) as WikipediaReplacementPOI[];
    
    // Take a small sample of medium priority candidates
    const candidates = allCandidates
      .filter(poi => poi.replacement_priority === 'medium')
      .slice(0, 5); // Only 5 POIs for testing
    
    console.log(`✅ Loaded ${candidates.length} POIs for testing`);
    
    return candidates;

  } catch (error) {
    console.error('💥 Error loading sample:', error);
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

async function main() {
  console.log('🧪 Wikipedia Image Replacement Test (Small Sample)');
  console.log('==================================================\n');

  try {
    // Load small sample
    const candidates = await loadSmallSample();
    
    if (candidates.length === 0) {
      console.log('✅ No test candidates found.');
      return;
    }

    console.log(`\n🎯 Testing with ${candidates.length} POIs:`);
    candidates.forEach((poi, index) => {
      console.log(`   ${index + 1}. ${poi.name} (${poi.city}, ${poi.state})`);
      console.log(`      Current: ${poi.image_source || 'unknown'} - ${poi.replacement_reason}`);
      console.log(`      Wikipedia: ${poi.osm_wikipedia_url}`);
      console.log('');
    });

    // Process each POI
    const results: ReplacementResult[] = [];
    
    for (const poi of candidates) {
      const result = await processWikipediaReplacement(poi);
      results.push(result);
      
      // Wait between requests
      if (candidates.indexOf(poi) < candidates.length - 1) {
        console.log('⏳ Waiting 2 seconds before next POI...\n');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    // Save results
    const outputDir = join(process.cwd(), 'scripts', 'output');
    const resultsFile = join(outputDir, 'wikipedia-replacement-test-results.json');
    await writeFile(resultsFile, JSON.stringify(results, null, 2));
    console.log(`💾 Test results saved to: ${resultsFile}`);

    // Show final summary
    const successCount = results.filter(r => r.success).length;
    const failedCount = results.filter(r => !r.success).length;
    
    console.log('\n🎉 Test completed!');
    console.log(`📊 Results:`);
    console.log(`   ✅ Successfully replaced: ${successCount}`);
    console.log(`   ❌ Failed: ${failedCount}`);
    console.log(`   📈 Success rate: ${((successCount / results.length) * 100).toFixed(1)}%`);

    if (successCount > 0) {
      console.log('\n🎯 Successfully replaced POIs:');
      results.filter(r => r.success).forEach((result, index) => {
        console.log(`   ${index + 1}. ${result.attractionName}`);
        console.log(`      Old: ${result.oldImageSource || 'unknown'} → New: ${result.newImageSource}`);
        console.log(`      Images found: ${result.imagesFound}`);
        console.log('');
      });
    }

    if (failedCount > 0) {
      console.log('\n❌ Failed POIs:');
      results.filter(r => !r.success).forEach((result, index) => {
        console.log(`   ${index + 1}. ${result.attractionName} - ${result.error}`);
      });
    }

  } catch (error) {
    console.error('💥 Test failed:', error);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main().catch(console.error);
}
