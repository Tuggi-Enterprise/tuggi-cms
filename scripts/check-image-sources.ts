/**
 * Script to check image sources in the database
 */

import { config } from 'dotenv';
import { getSupabase } from '../lib/core/supabase-client';

// Load environment variables
config();

const supabase = getSupabase('service');

async function checkImageSources() {
  console.log('🔍 Checking image sources in the database...\n');

  try {
    // Check attractions with image_source
    console.log('📊 Attractions by image source:');
    const { data: attractionsBySource, error: attractionsError } = await supabase
      .schema('core')
      .from('attractions')
      .select('image_source')
      .not('image_source', 'is', null);

    if (attractionsError) {
      throw new Error(`Error querying attractions: ${attractionsError.message}`);
    }

    const sourceCounts = new Map<string, number>();
    attractionsBySource?.forEach(attraction => {
      const source = attraction.image_source || 'unknown';
      sourceCounts.set(source, (sourceCounts.get(source) || 0) + 1);
    });

    Array.from(sourceCounts.entries()).forEach(([source, count]) => {
      console.log(`   ${source}: ${count} attractions`);
    });

    // Check recent Wikimedia Commons images
    console.log('\n🖼️  Recent Wikimedia Commons images:');
    const { data: recentImages, error: imagesError } = await supabase
      .schema('core')
      .from('attraction_image')
      .select(`
        id,
        attraction_id,
        image_url,
        storage_path,
        photo_reference,
        created_at,
        attractions!inner(
          name,
          city,
          state,
          image_source
        )
      `)
      .like('image_url', '%commons.wikimedia.org%')
      .order('created_at', { ascending: false })
      .limit(10);

    if (imagesError) {
      throw new Error(`Error querying images: ${imagesError.message}`);
    }

    recentImages?.forEach((image: any, index) => {
      console.log(`   ${index + 1}. ${image.attractions.name} (${image.attractions.city}, ${image.attractions.state})`);                                                                                                           
      console.log(`      Image Source: ${image.attractions.image_source}`);
      console.log(`      Image ID: ${image.id}`);
      console.log(`      Storage Path: ${image.storage_path}`);
      console.log(`      Photo Reference: ${image.photo_reference}`);
      console.log(`      Created: ${image.created_at}`);
      console.log('');
    });

    // Check if image_source is being set correctly
    console.log('🔍 Checking if image_source is being set correctly...');
    const { data: wikimediaAttractions, error: wikimediaError } = await supabase
      .schema('core')
      .from('attractions')
      .select('id, name, city, state, image_url, image_source')
      .like('image_url', '%commons.wikimedia.org%')
      .limit(5);

    if (wikimediaError) {
      throw new Error(`Error querying Wikimedia attractions: ${wikimediaError.message}`);
    }

    console.log('📋 Wikimedia Commons attractions with image_source:');
    wikimediaAttractions?.forEach((attraction, index) => {
      console.log(`   ${index + 1}. ${attraction.name} (${attraction.city}, ${attraction.state})`);
      console.log(`      Image Source: ${attraction.image_source || 'NOT SET'}`);
      console.log(`      Image URL: ${attraction.image_url}`);
      console.log('');
    });

  } catch (error) {
    console.error('💥 Error checking image sources:', error);
  }
}

// Run the check
if (require.main === module) {
  checkImageSources().catch(console.error);
}

export { checkImageSources };
