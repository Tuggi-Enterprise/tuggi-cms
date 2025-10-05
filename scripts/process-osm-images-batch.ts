/**
 * Script to process OSM images for POIs with image tags
 */

import { config } from 'dotenv';
import { getSupabase } from '../lib/core/supabase-client';
import { writeFile } from 'fs/promises';
import { join } from 'path';

// Load environment variables
config();

const supabase = getSupabase('service');

interface OSMImagePOI {
  id: string;
  name: string;
  city: string;
  state: string;
  osm_tags: any;
  image_url: string | null;
  image_source: string | null;
}

interface OSMResult {
  success: boolean;
  attractionId: string;
  attractionName: string;
  osmImageUrl: string;
  oldImageUrl?: string;
  newImageUrl?: string;
  oldImageSource?: string;
  newImageSource?: string;
  error?: string;
}

async function loadOSMImagePOIs(): Promise<OSMImagePOI[]> {
  console.log('📂 Loading POIs with OSM image tags...');
  
  try {
    const { data, error } = await supabase
      .schema('core')
      .from('attractions')
      .select('id, name, city, state, osm_tags, image_url, image_source')
      .not('osm_tags->>image', 'is', null);

    if (error) {
      throw new Error(`Error loading OSM image POIs: ${error.message}`);
    }

    const pois = data || [];
    console.log(`✅ Loaded ${pois.length} POIs with OSM image tags`);
    
    // Show the POIs found
    pois.forEach((poi, index) => {
      console.log(`   ${index + 1}. ${poi.name} (${poi.city}, ${poi.state})`);
      console.log(`      OSM image: ${poi.osm_tags?.image}`);
      console.log(`      Current image: ${poi.image_url ? 'Yes' : 'No'} (${poi.image_source || 'unknown'})`);
      console.log('');
    });
    
    return pois;

  } catch (error) {
    console.error('💥 Error loading OSM image POIs:', error);
    throw error;
  }
}

async function processOSMImage(poi: OSMImagePOI): Promise<OSMResult> {
  const result: OSMResult = {
    success: false,
    attractionId: poi.id,
    attractionName: poi.name,
    osmImageUrl: poi.osm_tags?.image,
    oldImageUrl: poi.image_url || undefined,
    oldImageSource: poi.image_source || undefined
  };

  try {
    console.log(`🔄 Processing: ${poi.name} (${poi.city}, ${poi.state})`);
    console.log(`   OSM image URL: ${poi.osm_tags?.image}`);
    console.log(`   Current image: ${poi.image_url ? 'Yes' : 'No'} (${poi.image_source || 'unknown'})`);

    // Call the extract-osm-images edge function
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

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Edge function error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    
    if (data.success) {
      result.success = true;
      result.newImageUrl = data.imageUrl;
      result.newImageSource = 'osm';
      console.log(`✅ Success: ${poi.name} - Processed OSM image`);
      console.log(`   New image: ${result.newImageUrl}`);
    } else {
      result.error = data.message || 'Failed to process OSM image';
      console.log(`❌ Failed: ${poi.name} - ${result.error}`);
    }

  } catch (error) {
    result.error = error instanceof Error ? error.message : 'Unknown error';
    console.log(`❌ Failed: ${poi.name} - ${result.error}`);
  }

  return result;
}

async function processBatch(pois: OSMImagePOI[]): Promise<OSMResult[]> {
  const results: OSMResult[] = [];

  console.log(`🎯 Starting OSM image processing for ${pois.length} POIs`);

  for (let i = 0; i < pois.length; i++) {
    const poi = pois[i];
    console.log(`\n📦 Processing ${i + 1}/${pois.length}`);

    const result = await processOSMImage(poi);
    results.push(result);

    // Show progress
    const successCount = results.filter(r => r.success).length;
    const failedCount = results.filter(r => !r.success).length;
    
    console.log(`📊 Progress: ${i + 1}/${pois.length} - Success: ${successCount}, Failed: ${failedCount}`);

    // Wait between requests
    if (i < pois.length - 1) {
      console.log(`⏳ Waiting 2 seconds before next POI...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  return results;
}

async function saveResults(results: OSMResult[]): Promise<void> {
  const outputDir = join(process.cwd(), 'scripts', 'output');
  
  // Save detailed results
  const resultsFile = join(outputDir, 'osm-processing-results.json');
  await writeFile(resultsFile, JSON.stringify(results, null, 2));
  console.log(`💾 Detailed results saved to: ${resultsFile}`);

  // Save summary CSV
  const csvFile = join(outputDir, 'osm-processing-summary.csv');
  const csvHeader = 'Attraction_ID,Attraction_Name,OSM_Image_URL,Success,Old_Image_URL,New_Image_URL,Old_Source,New_Source,Error\n';
  const csvRows = results.map(result => 
    `"${result.attractionId}","${result.attractionName}","${result.osmImageUrl}","${result.success}","${result.oldImageUrl || ''}","${result.newImageUrl || ''}","${result.oldImageSource || ''}","${result.newImageSource || ''}","${result.error || ''}"`
  ).join('\n');
  
  await writeFile(csvFile, csvHeader + csvRows);
  console.log(`📊 Summary CSV saved to: ${csvFile}`);
}

async function main() {
  console.log('🗺️  OSM Image Processing');
  console.log('========================\n');

  try {
    // Load POIs
    const pois = await loadOSMImagePOIs();
    
    if (pois.length === 0) {
      console.log('✅ No POIs with OSM image tags found.');
      return;
    }

    // Process all POIs
    const results = await processBatch(pois);

    // Save results
    await saveResults(results);

    // Show final summary
    const successCount = results.filter(r => r.success).length;
    const failedCount = results.filter(r => !r.success).length;
    
    console.log('\n🎉 OSM image processing completed!');
    console.log(`📊 Final Results:`);
    console.log(`   ✅ Successfully processed: ${successCount}`);
    console.log(`   ❌ Failed: ${failedCount}`);
    console.log(`   📈 Success rate: ${((successCount / results.length) * 100).toFixed(1)}%`);

    if (successCount > 0) {
      console.log('\n🎯 Successfully processed POIs:');
      results.filter(r => r.success).forEach((result, index) => {
        console.log(`   ${index + 1}. ${result.attractionName}`);
        console.log(`      OSM URL: ${result.osmImageUrl}`);
        console.log(`      Old: ${result.oldImageSource || 'unknown'} → New: ${result.newImageSource}`);
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
    console.error('💥 Script failed:', error);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main().catch(console.error);
}
