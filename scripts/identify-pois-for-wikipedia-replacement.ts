/**
 * Script to identify POIs that could benefit from Wikipedia image replacement
 * 
 * This script finds attractions that have:
 * 1. Wikipedia pages (osm_wikipedia_url)
 * 2. Current images from Google Places (image_source = 'google_places' or null)
 * 3. Or no current images but have Wikipedia pages
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// Load environment variables
config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface POIForReplacement {
  id: string;
  name: string;
  city: string;
  state: string;
  osm_wikipedia_url: string | null;
  image_url: string | null;
  image_source: string | null;
  has_wikipedia_url: boolean;
  has_current_image: boolean;
  current_source: string;
  replacement_priority: 'high' | 'medium' | 'low';
  replacement_reason: string;
}

async function identifyPOIsForReplacement(): Promise<POIForReplacement[]> {
  console.log('🔍 Identifying POIs for Wikipedia image replacement...\n');

  try {
    // Query POIs with Wikipedia URLs
    console.log('📋 Querying POIs with Wikipedia URLs...');
    const { data: wikipediaPOIs, error: wikipediaError } = await supabase
      .schema('core')
      .from('attractions')
      .select('id, name, city, state, osm_wikipedia_url, image_url, image_source')
      .not('osm_wikipedia_url', 'is', null)
      .like('osm_wikipedia_url', '%wikipedia.org%');

    if (wikipediaError) {
      throw new Error(`Error querying Wikipedia POIs: ${wikipediaError.message}`);
    }

    console.log(`✅ Found ${wikipediaPOIs?.length || 0} POIs with Wikipedia URLs`);

    // Process results and categorize by replacement priority
    const results: POIForReplacement[] = wikipediaPOIs?.map(poi => {
      const hasCurrentImage = !!poi.image_url;
      const currentSource = poi.image_source || 'unknown';
      
      let replacementPriority: 'high' | 'medium' | 'low' = 'low';
      let replacementReason = '';

      if (!hasCurrentImage) {
        replacementPriority = 'high';
        replacementReason = 'No current image';
      } else if (currentSource === 'google_places') {
        replacementPriority = 'high';
        replacementReason = 'Google Places image (potentially protected)';
      } else if (currentSource === 'unknown' || currentSource === null) {
        replacementPriority = 'medium';
        replacementReason = 'Unknown source image';
      } else if (currentSource === 'wikimedia_commons') {
        replacementPriority = 'low';
        replacementReason = 'Already has Wikimedia Commons image';
      } else if (currentSource === 'wikipedia') {
        replacementPriority = 'low';
        replacementReason = 'Already has Wikipedia image';
      } else {
        replacementPriority = 'medium';
        replacementReason = `Current source: ${currentSource}`;
      }

      return {
        ...poi,
        has_wikipedia_url: true,
        has_current_image: hasCurrentImage,
        current_source: currentSource,
        replacement_priority: replacementPriority,
        replacement_reason: replacementReason
      };
    }) || [];

    return results;

  } catch (error) {
    console.error('💥 Error identifying POIs for replacement:', error);
    throw error;
  }
}

async function analyzeReplacementCandidates(pois: POIForReplacement[]): Promise<void> {
  console.log('\n📈 Analysis of Wikipedia Replacement Candidates:\n');

  // Group by replacement priority
  const byPriority = new Map<string, POIForReplacement[]>();
  pois.forEach(poi => {
    if (!byPriority.has(poi.replacement_priority)) {
      byPriority.set(poi.replacement_priority, []);
    }
    byPriority.get(poi.replacement_priority)!.push(poi);
  });

  console.log('🎯 Replacement Priority Distribution:');
  ['high', 'medium', 'low'].forEach(priority => {
    const count = byPriority.get(priority)?.length || 0;
    const percentage = ((count / pois.length) * 100).toFixed(1);
    console.log(`   ${priority.toUpperCase()}: ${count} POIs (${percentage}%)`);
  });

  // Group by current source
  const bySource = new Map<string, POIForReplacement[]>();
  pois.forEach(poi => {
    const source = poi.current_source || 'null';
    if (!bySource.has(source)) {
      bySource.set(source, []);
    }
    bySource.get(source)!.push(poi);
  });

  console.log('\n📊 Current Image Source Distribution:');
  Array.from(bySource.entries())
    .sort((a, b) => b[1].length - a[1].length)
    .forEach(([source, sourcePOIs]) => {
      console.log(`   ${source}: ${sourcePOIs.length} POIs`);
    });

  // Group by city
  const byCity = new Map<string, POIForReplacement[]>();
  pois.forEach(poi => {
    const key = `${poi.city}, ${poi.state}`;
    if (!byCity.has(key)) {
      byCity.set(key, []);
    }
    byCity.get(key)!.push(poi);
  });

  console.log('\n🏙️  Top Cities with Wikipedia Replacement Candidates:');
  Array.from(byCity.entries())
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 15)
    .forEach(([city, cityPOIs]) => {
      const highPriority = cityPOIs.filter(p => p.replacement_priority === 'high').length;
      console.log(`   ${city}: ${cityPOIs.length} POIs (${highPriority} high priority)`);
    });

  // Show high priority candidates
  const highPriorityPOIs = byPriority.get('high') || [];
  console.log(`\n🎯 High Priority Replacement Candidates (${highPriorityPOIs.length} POIs):`);
  highPriorityPOIs.slice(0, 20).forEach((poi, index) => {
    console.log(`   ${index + 1}. ${poi.name} (${poi.city}, ${poi.state})`);
    console.log(`      Current: ${poi.current_source} - ${poi.replacement_reason}`);
    console.log(`      Wikipedia: ${poi.osm_wikipedia_url}`);
    console.log('');
  });

  // Show medium priority candidates
  const mediumPriorityPOIs = byPriority.get('medium') || [];
  console.log(`\n📋 Medium Priority Replacement Candidates (${mediumPriorityPOIs.length} POIs):`);
  mediumPriorityPOIs.slice(0, 10).forEach((poi, index) => {
    console.log(`   ${index + 1}. ${poi.name} (${poi.city}, ${poi.state})`);
    console.log(`      Current: ${poi.current_source} - ${poi.replacement_reason}`);
    console.log('');
  });
}

async function saveResultsToFile(pois: POIForReplacement[]): Promise<void> {
  const fs = await import('fs/promises');
  const path = await import('path');
  
  const outputDir = path.join(process.cwd(), 'scripts', 'output');
  await fs.mkdir(outputDir, { recursive: true });
  
  // Save all results
  const outputFile = path.join(outputDir, 'wikipedia-replacement-candidates.json');
  await fs.writeFile(outputFile, JSON.stringify(pois, null, 2));
  console.log(`💾 All results saved to: ${outputFile}`);
  
  // Save high priority candidates
  const highPriorityPOIs = pois.filter(p => p.replacement_priority === 'high');
  const highPriorityFile = path.join(outputDir, 'wikipedia-high-priority-candidates.json');
  await fs.writeFile(highPriorityFile, JSON.stringify(highPriorityPOIs, null, 2));
  console.log(`🎯 High priority candidates saved to: ${highPriorityFile}`);
  
  // Save CSV for easy viewing
  const csvFile = path.join(outputDir, 'wikipedia-replacement-candidates.csv');
  const csvHeader = 'ID,Name,City,State,Wikipedia_URL,Current_Image_URL,Current_Source,Priority,Reason\n';
  const csvRows = pois.map(poi => 
    `"${poi.id}","${poi.name}","${poi.city}","${poi.state}","${poi.osm_wikipedia_url || ''}","${poi.image_url || ''}","${poi.current_source}","${poi.replacement_priority}","${poi.replacement_reason}"`
  ).join('\n');
  
  await fs.writeFile(csvFile, csvHeader + csvRows);
  console.log(`📊 CSV saved to: ${csvFile}`);
}

async function main() {
  console.log('🎯 Wikipedia Image Replacement Identification');
  console.log('============================================\n');

  try {
    // Identify POIs
    const pois = await identifyPOIsForReplacement();
    
    if (pois.length === 0) {
      console.log('❌ No POIs with Wikipedia pages found.');
      return;
    }

    // Analyze results
    await analyzeReplacementCandidates(pois);
    
    // Save results
    await saveResultsToFile(pois);
    
    console.log('\n✅ Identification completed successfully!');
    console.log(`📊 Found ${pois.length} POIs with Wikipedia pages`);
    
    // Show summary by priority
    const highPriority = pois.filter(p => p.replacement_priority === 'high').length;
    const mediumPriority = pois.filter(p => p.replacement_priority === 'medium').length;
    const lowPriority = pois.filter(p => p.replacement_priority === 'low').length;
    
    console.log(`🎯 Replacement Candidates:`);
    console.log(`   High Priority: ${highPriority} POIs (Google Places or no images)`);
    console.log(`   Medium Priority: ${mediumPriority} POIs (Unknown sources)`);
    console.log(`   Low Priority: ${lowPriority} POIs (Already have public images)`);
    
  } catch (error) {
    console.error('💥 Script failed:', error);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main().catch(console.error);
}

export { identifyPOIsForReplacement, analyzeReplacementCandidates };
