/**
 * Script to analyze all potential image sources in the attractions table
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

interface ImageSourceAnalysis {
  source: string;
  count: number;
  examples: Array<{
    id: string;
    name: string;
    city: string;
    state: string;
    image_url: string;
    image_source: string | null;
  }>;
}

async function analyzeImageSources(): Promise<void> {
  console.log('🔍 Analyzing all potential image sources in attractions...\n');

  try {
    // Get all attractions with their image data
    const { data: attractions, error } = await supabase
      .schema('core')
      .from('attractions')
      .select('id, name, city, state, image_url, image_source, osm_tags, website, reference_links, rag_sources_found')
      .not('image_url', 'is', null);

    if (error) {
      throw new Error(`Error loading attractions: ${error.message}`);
    }

    console.log(`📊 Total attractions with images: ${attractions?.length || 0}\n`);

    // Analyze current image sources
    const sourceAnalysis: { [key: string]: ImageSourceAnalysis } = {};
    
    attractions?.forEach(attraction => {
      const source = attraction.image_source || 'unknown';
      
      if (!sourceAnalysis[source]) {
        sourceAnalysis[source] = {
          source,
          count: 0,
          examples: []
        };
      }
      
      sourceAnalysis[source].count++;
      
      if (sourceAnalysis[source].examples.length < 5) {
        sourceAnalysis[source].examples.push({
          id: attraction.id,
          name: attraction.name,
          city: attraction.city,
          state: attraction.state,
          image_url: attraction.image_url,
          image_source: attraction.image_source
        });
      }
    });

    console.log('📈 Current Image Source Distribution:');
    console.log('=====================================');
    Object.values(sourceAnalysis)
      .sort((a, b) => b.count - a.count)
      .forEach(analysis => {
        console.log(`\n${analysis.source}: ${analysis.count} POIs`);
        console.log('Examples:');
        analysis.examples.forEach((example, index) => {
          console.log(`  ${index + 1}. ${example.name} (${example.city}, ${example.state})`);
          console.log(`     URL: ${example.image_url}`);
        });
      });

    // Analyze potential new sources
    console.log('\n\n🔍 Analyzing Potential New Image Sources:');
    console.log('==========================================');

    // 1. Website URLs
    const withWebsites = attractions?.filter(a => a.website) || [];
    console.log(`\n1. POIs with website URLs: ${withWebsites.length}`);
    if (withWebsites.length > 0) {
      console.log('Examples:');
      withWebsites.slice(0, 5).forEach((poi, index) => {
        console.log(`  ${index + 1}. ${poi.name} - ${poi.website}`);
      });
    }

    // 2. Reference links
    const withReferenceLinks = attractions?.filter(a => a.reference_links) || [];
    console.log(`\n2. POIs with reference_links: ${withReferenceLinks.length}`);
    if (withReferenceLinks.length > 0) {
      console.log('Examples:');
      withReferenceLinks.slice(0, 5).forEach((poi, index) => {
        console.log(`  ${index + 1}. ${poi.name}`);
        console.log(`     Links: ${JSON.stringify(poi.reference_links)}`);
      });
    }

    // 3. RAG sources
    const withRagSources = attractions?.filter(a => a.rag_sources_found) || [];
    console.log(`\n3. POIs with RAG sources: ${withRagSources.length}`);
    if (withRagSources.length > 0) {
      console.log('Examples:');
      withRagSources.slice(0, 5).forEach((poi, index) => {
        console.log(`  ${index + 1}. ${poi.name}`);
        console.log(`     RAG sources: ${JSON.stringify(poi.rag_sources_found)}`);
      });
    }

    // 4. OSM tags analysis
    console.log(`\n4. OSM Tags Analysis:`);
    const osmTagSources: { [key: string]: number } = {};
    
    attractions?.forEach(attraction => {
      if (attraction.osm_tags) {
        const tags = attraction.osm_tags;
        
        // Check for various image-related tags
        const imageRelatedTags = [
          'image', 'photo', 'picture', 'img', 'image_url', 'photo_url',
          'wikimedia_commons', 'wikipedia', 'wikidata', 'website',
          'url', 'homepage', 'official_website', 'official_url'
        ];
        
        imageRelatedTags.forEach(tag => {
          if (tags[tag]) {
            osmTagSources[tag] = (osmTagSources[tag] || 0) + 1;
          }
        });
      }
    });

    console.log('OSM tags with potential image sources:');
    Object.entries(osmTagSources)
      .sort(([,a], [,b]) => b - a)
      .forEach(([tag, count]) => {
        console.log(`  ${tag}: ${count} POIs`);
      });

    // 5. Analyze image URL patterns
    console.log(`\n5. Image URL Pattern Analysis:`);
    const urlPatterns: { [key: string]: number } = {};
    
    attractions?.forEach(attraction => {
      if (attraction.image_url) {
        const url = attraction.image_url;
        
        if (url.includes('wikimedia.org')) {
          urlPatterns['wikimedia'] = (urlPatterns['wikimedia'] || 0) + 1;
        } else if (url.includes('wikipedia.org')) {
          urlPatterns['wikipedia'] = (urlPatterns['wikipedia'] || 0) + 1;
        } else if (url.includes('google')) {
          urlPatterns['google'] = (urlPatterns['google'] || 0) + 1;
        } else if (url.includes('supabase.co')) {
          urlPatterns['supabase'] = (urlPatterns['supabase'] || 0) + 1;
        } else if (url.includes('flickr.com')) {
          urlPatterns['flickr'] = (urlPatterns['flickr'] || 0) + 1;
        } else if (url.includes('instagram.com')) {
          urlPatterns['instagram'] = (urlPatterns['instagram'] || 0) + 1;
        } else if (url.includes('facebook.com')) {
          urlPatterns['facebook'] = (urlPatterns['facebook'] || 0) + 1;
        } else if (url.includes('tripadvisor')) {
          urlPatterns['tripadvisor'] = (urlPatterns['tripadvisor'] || 0) + 1;
        } else if (url.includes('booking.com')) {
          urlPatterns['booking'] = (urlPatterns['booking'] || 0) + 1;
        } else {
          urlPatterns['other'] = (urlPatterns['other'] || 0) + 1;
        }
      }
    });

    console.log('Image URL patterns:');
    Object.entries(urlPatterns)
      .sort(([,a], [,b]) => b - a)
      .forEach(([pattern, count]) => {
        console.log(`  ${pattern}: ${count} POIs`);
      });

    // 6. Find POIs without images
    const { data: withoutImages, error: noImageError } = await supabase
      .schema('core')
      .from('attractions')
      .select('id, name, city, state, website, reference_links, rag_sources_found, osm_tags')
      .is('image_url', null)
      .limit(20);

    if (!noImageError && withoutImages) {
      console.log(`\n6. POIs without images (sample of 20):`);
      withoutImages.forEach((poi, index) => {
        console.log(`  ${index + 1}. ${poi.name} (${poi.city}, ${poi.state})`);
        if (poi.website) console.log(`     Website: ${poi.website}`);
        if (poi.reference_links) console.log(`     Reference links: ${JSON.stringify(poi.reference_links)}`);
        if (poi.rag_sources_found) console.log(`     RAG sources: ${JSON.stringify(poi.rag_sources_found)}`);
        if (poi.osm_tags?.website) console.log(`     OSM website: ${poi.osm_tags.website}`);
        console.log('');
      });
    }

    // Save detailed analysis
    const analysisData = {
      timestamp: new Date().toISOString(),
      totalAttractionsWithImages: attractions?.length || 0,
      sourceDistribution: sourceAnalysis,
      potentialSources: {
        withWebsites: withWebsites.length,
        withReferenceLinks: withReferenceLinks.length,
        withRagSources: withRagSources.length,
        osmTagSources,
        urlPatterns
      },
      sampleWithoutImages: withoutImages || []
    };

    const outputDir = join(process.cwd(), 'scripts', 'output');
    const analysisFile = join(outputDir, 'image-sources-analysis.json');
    await writeFile(analysisFile, JSON.stringify(analysisData, null, 2));
    console.log(`\n💾 Detailed analysis saved to: ${analysisFile}`);

  } catch (error) {
    console.error('💥 Error analyzing image sources:', error);
  }
}

// Run the analysis
if (require.main === module) {
  analyzeImageSources().catch(console.error);
}
