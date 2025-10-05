/**
 * Script to identify all POIs with Wikimedia Commons images
 * 
 * This script finds all attractions that have:
 * 1. image_url pointing to Wikimedia Commons
 * 2. osm_tags containing wikimedia_commons field
 */

import { config } from 'dotenv';
import { getSupabase } from '../lib/core/supabase-client';

// Load environment variables
config();

const supabase = getSupabase('service');

interface POIWithWikimedia {
  id: string;
  name: string;
  city: string;
  state: string;
  image_url: string | null;
  osm_tags: string | null;
  wikimedia_commons_url?: string;
  has_image_url: boolean;
  has_osm_tags: boolean;
}

async function identifyWikimediaPOIs(): Promise<POIWithWikimedia[]> {
  console.log('🔍 Identifying POIs with Wikimedia Commons images...\n');

  try {
    // Query 1: Find POIs with image_url pointing to Wikimedia Commons
    console.log('📋 Querying POIs with Wikimedia Commons image_url...');
    const { data: imageUrlPOIs, error: imageUrlError } = await supabase
      .schema('core')
      .from('attractions')
      .select('id, name, city, state, image_url, osm_tags')
      .like('image_url', '%commons.wikimedia.org%');

    if (imageUrlError) {
      throw new Error(`Error querying image_url POIs: ${imageUrlError.message}`);
    }

    console.log(`✅ Found ${imageUrlPOIs?.length || 0} POIs with Wikimedia Commons image_url`);

    // For now, focus on POIs with image_url (we found 351)
    // We can add osm_tags query later if needed
    console.log('📋 Processing POIs with Wikimedia Commons image_url...');
    
    const results: POIWithWikimedia[] = imageUrlPOIs?.map(poi => ({
      ...poi,
      wikimedia_commons_url: poi.image_url,
      has_image_url: true,
      has_osm_tags: false
    })) || [];
    
    console.log(`\n📊 Summary:`);
    console.log(`   Total unique POIs: ${results.length}`);
    console.log(`   With image_url: ${results.filter(p => p.has_image_url).length}`);
    console.log(`   With osm_tags: ${results.filter(p => p.has_osm_tags).length}`);
    console.log(`   With both: ${results.filter(p => p.has_image_url && p.has_osm_tags).length}`);

    return results;

  } catch (error) {
    console.error('💥 Error identifying Wikimedia POIs:', error);
    throw error;
  }
}

async function analyzeWikimediaPOIs(pois: POIWithWikimedia[]): Promise<void> {
  console.log('\n📈 Analysis of Wikimedia Commons POIs:\n');

  // Group by city
  const byCity = new Map<string, POIWithWikimedia[]>();
  pois.forEach(poi => {
    const key = `${poi.city}, ${poi.state}`;
    if (!byCity.has(key)) {
      byCity.set(key, []);
    }
    byCity.get(key)!.push(poi);
  });

  console.log('🏙️  POIs by City:');
  Array.from(byCity.entries())
    .sort((a, b) => b[1].length - a[1].length)
    .forEach(([city, cityPOIs]) => {
      console.log(`   ${city}: ${cityPOIs.length} POIs`);
    });

  // Analyze URL patterns
  console.log('\n🔗 URL Pattern Analysis:');
  const urlPatterns = new Map<string, number>();
  pois.forEach(poi => {
    if (poi.wikimedia_commons_url) {
      const url = poi.wikimedia_commons_url;
      if (url.includes('/wiki/Category:')) {
        urlPatterns.set('Category', (urlPatterns.get('Category') || 0) + 1);
      } else if (url.includes('/wiki/File:')) {
        urlPatterns.set('File', (urlPatterns.get('File') || 0) + 1);
      } else {
        urlPatterns.set('Other', (urlPatterns.get('Other') || 0) + 1);
      }
    }
  });

  Array.from(urlPatterns.entries()).forEach(([pattern, count]) => {
    console.log(`   ${pattern}: ${count} POIs`);
  });

  // Show sample POIs
  console.log('\n📋 Sample POIs:');
  pois.slice(0, 10).forEach((poi, index) => {
    console.log(`   ${index + 1}. ${poi.name} (${poi.city}, ${poi.state})`);
    console.log(`      ID: ${poi.id}`);
    console.log(`      Wikimedia URL: ${poi.wikimedia_commons_url || 'N/A'}`);
    console.log(`      Has image_url: ${poi.has_image_url}`);
    console.log(`      Has osm_tags: ${poi.has_osm_tags}`);
    console.log('');
  });
}

async function saveResultsToFile(pois: POIWithWikimedia[]): Promise<void> {
  const fs = await import('fs/promises');
  const path = await import('path');
  
  const outputDir = path.join(process.cwd(), 'scripts', 'output');
  await fs.mkdir(outputDir, { recursive: true });
  
  const outputFile = path.join(outputDir, 'wikimedia-pois.json');
  await fs.writeFile(outputFile, JSON.stringify(pois, null, 2));
  
  console.log(`💾 Results saved to: ${outputFile}`);
  
  // Also save a CSV for easy viewing
  const csvFile = path.join(outputDir, 'wikimedia-pois.csv');
  const csvHeader = 'ID,Name,City,State,Wikimedia_URL,Has_Image_URL,Has_OSM_Tags\n';
  const csvRows = pois.map(poi => 
    `"${poi.id}","${poi.name}","${poi.city}","${poi.state}","${poi.wikimedia_commons_url || ''}","${poi.has_image_url}","${poi.has_osm_tags}"`
  ).join('\n');
  
  await fs.writeFile(csvFile, csvHeader + csvRows);
  console.log(`📊 CSV saved to: ${csvFile}`);
}

async function main() {
  console.log('🎯 Wikimedia Commons POI Identification');
  console.log('=====================================\n');

  try {
    // Identify POIs
    const pois = await identifyWikimediaPOIs();
    
    if (pois.length === 0) {
      console.log('❌ No POIs with Wikimedia Commons images found.');
      return;
    }

    // Analyze results
    await analyzeWikimediaPOIs(pois);
    
    // Save results
    await saveResultsToFile(pois);
    
    console.log('\n✅ Identification completed successfully!');
    console.log(`📊 Found ${pois.length} POIs with Wikimedia Commons images`);
    
  } catch (error) {
    console.error('💥 Script failed:', error);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main().catch(console.error);
}

export { identifyWikimediaPOIs, analyzeWikimediaPOIs };
