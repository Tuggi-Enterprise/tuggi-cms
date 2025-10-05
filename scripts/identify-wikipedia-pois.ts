/**
 * Script to identify POIs that have Wikipedia pages with images
 * 
 * This script finds attractions that have:
 * 1. osm_wikipedia_url field populated
 * 2. Potential Wikipedia pages with images
 */

import { config } from 'dotenv';
import { getSupabase } from '../lib/core/supabase-client';

// Load environment variables
config();

const supabase = getSupabase('service');

interface POIWithWikipedia {
  id: string;
  name: string;
  city: string;
  state: string;
  osm_wikipedia_url: string | null;
  image_url: string | null;
  has_wikipedia_url: boolean;
  has_image: boolean;
}

async function identifyWikipediaPOIs(): Promise<POIWithWikipedia[]> {
  console.log('🔍 Identifying POIs with Wikipedia pages...\n');

  try {
    // Query POIs with Wikipedia URLs
    console.log('📋 Querying POIs with Wikipedia URLs...');
    const { data: wikipediaPOIs, error: wikipediaError } = await supabase
      .schema('core')
      .from('attractions')
      .select('id, name, city, state, osm_wikipedia_url, image_url')
      .not('osm_wikipedia_url', 'is', null)
      .like('osm_wikipedia_url', '%wikipedia.org%');

    if (wikipediaError) {
      throw new Error(`Error querying Wikipedia POIs: ${wikipediaError.message}`);
    }

    console.log(`✅ Found ${wikipediaPOIs?.length || 0} POIs with Wikipedia URLs`);

    // Process results
    const results: POIWithWikipedia[] = wikipediaPOIs?.map(poi => ({
      ...poi,
      has_wikipedia_url: true,
      has_image: !!poi.image_url
    })) || [];

    return results;

  } catch (error) {
    console.error('💥 Error identifying Wikipedia POIs:', error);
    throw error;
  }
}

async function analyzeWikipediaPOIs(pois: POIWithWikipedia[]): Promise<void> {
  console.log('\n📈 Analysis of Wikipedia POIs:\n');

  // Group by city
  const byCity = new Map<string, POIWithWikipedia[]>();
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
    .slice(0, 15) // Show top 15 cities
    .forEach(([city, cityPOIs]) => {
      console.log(`   ${city}: ${cityPOIs.length} POIs`);
    });

  // Analyze Wikipedia URL patterns
  console.log('\n🔗 Wikipedia URL Pattern Analysis:');
  const urlPatterns = new Map<string, number>();
  pois.forEach(poi => {
    if (poi.osm_wikipedia_url) {
      const url = poi.osm_wikipedia_url;
      if (url.includes('/pt.wikipedia.org/')) {
        urlPatterns.set('Portuguese Wikipedia', (urlPatterns.get('Portuguese Wikipedia') || 0) + 1);
      } else if (url.includes('/en.wikipedia.org/')) {
        urlPatterns.set('English Wikipedia', (urlPatterns.get('English Wikipedia') || 0) + 1);
      } else {
        urlPatterns.set('Other Wikipedia', (urlPatterns.get('Other Wikipedia') || 0) + 1);
      }
    }
  });

  Array.from(urlPatterns.entries()).forEach(([pattern, count]) => {
    console.log(`   ${pattern}: ${count} POIs`);
  });

  // Show POIs without images
  const poisWithoutImages = pois.filter(poi => !poi.has_image);
  console.log(`\n📷 POIs without images: ${poisWithoutImages.length}/${pois.length} (${((poisWithoutImages.length / pois.length) * 100).toFixed(1)}%)`);

  // Show sample POIs
  console.log('\n📋 Sample POIs with Wikipedia pages:');
  pois.slice(0, 10).forEach((poi, index) => {
    console.log(`   ${index + 1}. ${poi.name} (${poi.city}, ${poi.state})`);
    console.log(`      ID: ${poi.id}`);
    console.log(`      Wikipedia URL: ${poi.osm_wikipedia_url}`);
    console.log(`      Has Image: ${poi.has_image ? 'Yes' : 'No'}`);
    console.log('');
  });

  // Show POIs without images that could benefit from Wikipedia image extraction
  console.log('\n🎯 POIs without images (candidates for Wikipedia image extraction):');
  poisWithoutImages.slice(0, 10).forEach((poi, index) => {
    console.log(`   ${index + 1}. ${poi.name} (${poi.city}, ${poi.state})`);
    console.log(`      Wikipedia: ${poi.osm_wikipedia_url}`);
    console.log('');
  });
}

async function saveResultsToFile(pois: POIWithWikipedia[]): Promise<void> {
  const fs = await import('fs/promises');
  const path = await import('path');
  
  const outputDir = path.join(process.cwd(), 'scripts', 'output');
  await fs.mkdir(outputDir, { recursive: true });
  
  const outputFile = path.join(outputDir, 'wikipedia-pois.json');
  await fs.writeFile(outputFile, JSON.stringify(pois, null, 2));
  
  console.log(`💾 Results saved to: ${outputFile}`);
  
  // Also save a CSV for easy viewing
  const csvFile = path.join(outputDir, 'wikipedia-pois.csv');
  const csvHeader = 'ID,Name,City,State,Wikipedia_URL,Has_Image\n';
  const csvRows = pois.map(poi => 
    `"${poi.id}","${poi.name}","${poi.city}","${poi.state}","${poi.osm_wikipedia_url || ''}","${poi.has_image}"`
  ).join('\n');
  
  await fs.writeFile(csvFile, csvHeader + csvRows);
  console.log(`📊 CSV saved to: ${csvFile}`);
}

async function main() {
  console.log('🎯 Wikipedia POI Identification');
  console.log('==============================\n');

  try {
    // Identify POIs
    const pois = await identifyWikipediaPOIs();
    
    if (pois.length === 0) {
      console.log('❌ No POIs with Wikipedia pages found.');
      return;
    }

    // Analyze results
    await analyzeWikipediaPOIs(pois);
    
    // Save results
    await saveResultsToFile(pois);
    
    console.log('\n✅ Identification completed successfully!');
    console.log(`📊 Found ${pois.length} POIs with Wikipedia pages`);
    
    // Show potential for image extraction
    const poisWithoutImages = pois.filter(poi => !poi.has_image);
    console.log(`🎯 ${poisWithoutImages.length} POIs could benefit from Wikipedia image extraction`);
    
  } catch (error) {
    console.error('💥 Script failed:', error);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main().catch(console.error);
}

export { identifyWikipediaPOIs, analyzeWikipediaPOIs };
