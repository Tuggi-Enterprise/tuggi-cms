/**
 * Script to monitor progress of all image sources
 */

import { config } from 'dotenv';
import { getSupabase } from '../lib/core/supabase-client';

// Load environment variables
config();

const supabase = getSupabase('service');

async function monitorAllSources(): Promise<void> {
  console.log('📊 Monitoring All Image Sources Progress');
  console.log('=======================================\n');

  try {
    // Get total attractions
    const { data: totalAttractions, error: totalError } = await supabase
      .schema('core')
      .from('attractions')
      .select('id', { count: 'exact' });

    if (totalError) {
      throw new Error(`Error getting total count: ${totalError.message}`);
    }

    const totalPOIs = totalAttractions?.length || 0;
    console.log(`📈 Total POIs in database: ${totalPOIs}`);

    // Get POIs with images
    const { data: withImages, error: withImagesError } = await supabase
      .schema('core')
      .from('attractions')
      .select('id, image_source', { count: 'exact' })
      .not('image_url', 'is', null);

    if (withImagesError) {
      throw new Error(`Error getting POIs with images: ${withImagesError.message}`);
    }

    const withImagesCount = withImages?.length || 0;
    const withoutImagesCount = totalPOIs - withImagesCount;
    
    console.log(`✅ POIs with images: ${withImagesCount}`);
    console.log(`❌ POIs without images: ${withoutImagesCount}`);
    console.log(`📊 Coverage: ${((withImagesCount / totalPOIs) * 100).toFixed(1)}%`);

    // Get image source distribution
    const sourceDistribution: { [key: string]: number } = {};
    withImages?.forEach(poi => {
      const source = poi.image_source || 'unknown';
      sourceDistribution[source] = (sourceDistribution[source] || 0) + 1;
    });

    console.log('\n📊 Image Source Distribution:');
    Object.entries(sourceDistribution)
      .sort(([,a], [,b]) => b - a)
      .forEach(([source, count]) => {
        const percentage = ((count / withImagesCount) * 100).toFixed(1);
        console.log(`   ${source}: ${count} POIs (${percentage}%)`);
      });

    // Get POIs without images by available sources
    const { data: withoutImages, error: withoutImagesError } = await supabase
      .schema('core')
      .from('attractions')
      .select('id, name, city, state, website, osm_tags')
      .is('image_url', null);

    if (withoutImagesError) {
      throw new Error(`Error getting POIs without images: ${withoutImagesError.message}`);
    }

    const withoutImagesPOIs = withoutImages || [];
    
    const withWebsites = withoutImagesPOIs.filter(poi => poi.website);
    const withWikidata = withoutImagesPOIs.filter(poi => poi.osm_tags?.wikidata);
    const withWikipedia = withoutImagesPOIs.filter(poi => poi.osm_tags?.wikipedia);
    const withWikimediaCommons = withoutImagesPOIs.filter(poi => poi.osm_tags?.wikimedia_commons);
    const withOSMImages = withoutImagesPOIs.filter(poi => poi.osm_tags?.image);

    console.log('\n🔍 POIs Without Images - Available Sources:');
    console.log(`   Websites: ${withWebsites.length}`);
    console.log(`   Wikidata: ${withWikidata.length}`);
    console.log(`   Wikipedia: ${withWikipedia.length}`);
    console.log(`   Wikimedia Commons: ${withWikimediaCommons.length}`);
    console.log(`   OSM Images: ${withOSMImages.length}`);

    // Show recent additions by source
    console.log('\n🎯 Recent Image Additions by Source:');
    
    const sources = ['website', 'wikidata', 'wikipedia', 'wikimedia_commons', 'osm'];
    
    for (const source of sources) {
      const { data: recentImages, error: recentError } = await supabase
        .schema('core')
        .from('attractions')
        .select('id, name, city, state, image_url, image_source')
        .eq('image_source', source)
        .order('updated_at', { ascending: false })
        .limit(3);

      if (!recentError && recentImages && recentImages.length > 0) {
        console.log(`\n   ${source.toUpperCase()}:`);
        recentImages.forEach((poi, index) => {
          console.log(`     ${index + 1}. ${poi.name} (${poi.city}, ${poi.state})`);
        });
      }
    }

    // Show potential for improvement
    const totalPotential = withWebsites.length + withWikidata.length + withWikipedia.length + withWikimediaCommons.length + withOSMImages.length;
    console.log(`\n🚀 Potential for Improvement:`);
    console.log(`   Total POIs with available sources: ${totalPotential}`);
    console.log(`   Could improve coverage to: ${(((withImagesCount + totalPotential) / totalPOIs) * 100).toFixed(1)}%`);

  } catch (error) {
    console.error('💥 Error monitoring progress:', error);
  }
}

// Run the monitoring
if (require.main === module) {
  monitorAllSources().catch(console.error);
}
