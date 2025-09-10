/**
 * Test script for Wikimedia Commons image extraction
 * 
 * This script tests the modified store-poi-images edge function with
 * the sample POI "Monumento à Mãe Preta"
 */

import { createClient } from '@supabase/supabase-js';

// Configuration
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Sample POI data from the user
const samplePOI = {
  "idx": 122,
  "id": "e179587f-97b7-44db-ad39-a5b43658444c",
  "name": "Monumento à Mãe Preta",
  "description": "Monumento à Mãe Preta",
  "city": "São Paulo",
  "country": "BR",
  "image_url": "https://commons.wikimedia.org/wiki/Category:Mãe Preta by Júlio Guerra (bronze, 1955)",
  "rating": "0",
  "audio_guides_count": 0,
  "created_at": "2025-09-09 16:44:10.216176+00",
  "updated_at": "2025-09-10 17:06:52.314545+00",
  "google_place_id": null,
  "category": "monument",
  "approved": false,
  "approved_by": null,
  "approved_at": null,
  "is_premium": false,
  "user_id": null,
  "price_level": null,
  "formatted_phone_number": null,
  "international_phone_number": null,
  "business_status": "OPERATIONAL",
  "vicinity": null,
  "photos_references": null,
  "import_source": "osm_geojson",
  "import_batch_id": null,
  "imported_from_polygon_id": null,
  "formatted_address": null,
  "website": null,
  "opening_hours": null,
  "google_types": null,
  "user_ratings_total": null,
  "state": "SP",
  "show_in_map": null,
  "reference_links": null,
  "city_location": null,
  "last_verification_score": null,
  "last_verification_status": null,
  "last_verified_at": null,
  "osm_category": null,
  "osm_tags": "{\"name\": \"Monumento à Mãe Preta\", \"historic\": \"memorial\", \"wikidata\": \"Q45052140\", \"wikimedia_commons\": \"Category:Mãe Preta by Júlio Guerra (bronze, 1955)\"}",
  "osm_data_quality_score": null,
  "osm_geometry": null,
  "osm_last_updated": null,
  "elevation_m": null,
  "estimated_height_m": null,
  "osm_area_m2": null,
  "heritage_status": null,
  "architectural_style": null,
  "historical_period": null,
  "landmark_type": null,
  "architect": null,
  "construction_status": null,
  "completion_estimated_year": null,
  "unesco_status": null,
  "unesco_inscription_date": null,
  "unesco_reference": null,
  "landmark_level": null,
  "importance_level": null,
  "wheelchair_accessible": null,
  "wheelchair_toilets": null,
  "parking_capacity": null,
  "public_transport": null,
  "access_points": null,
  "urban_density": null,
  "noise_level": null,
  "air_quality": null,
  "shade_availability": null,
  "pov_quality_score": null,
  "visibility_score": null,
  "accessibility_score": null,
  "photogenic_score": null,
  "cultural_significance": null,
  "local_traditions": null,
  "seasonal_attractions": null,
  "museum_type": null,
  "collection_focus": null,
  "target_audience": null,
  "educational_programs": null,
  "park_type": null,
  "vegetation_type": null,
  "water_features": null,
  "sports_facilities": null,
  "playground": null,
  "monument_type": null,
  "commemorated_event": null,
  "commemorated_person": null,
  "building_colour": null,
  "roof_colour": null,
  "building_material": null,
  "verification_status": null,
  "data_sources": null,
  "osm_import_date": "2025-09-09 16:44:10.216176+00",
  "osm_wikidata_id": null,
  "osm_wikipedia_url": null,
  "contact_phone": null,
  "contact_email": null,
  "operator_name": null,
  "last_processed_at": null,
  "processing_lock_by": null,
  "processing_lock_at": null,
  "osm_description": null,
  "rag_sources_found": null,
  "rag_sources_last_search": null,
  "rag_sources_quality_score": null,
  "rag_content_extracted": null,
  "rag_content_summary": null,
  "rag_content_last_updated": null,
  "rag_verified_facts": null,
  "rag_temporal_tokens": null,
  "rag_entity_tokens": null,
  "rag_event_tokens": null,
  "rag_discovered_links": null,
  "rag_wikipedia_links": null,
  "rag_official_sources": null,
  "rag_completeness_score": "0.00",
  "rag_reliability_score": "0.00",
  "rag_freshness_days": 0,
  "rag_source_count": 0,
  "rag_search_cache": null,
  "rag_search_terms_used": null,
  "rag_last_successful_search": null,
  "rag_search_failure_count": 0,
  "rag_scraped_content": null,
  "rag_content_quality_score": "0.00",
  "rag_keywords_extracted": null,
  "rag_facts_extracted": null,
  "rag_scraping_last_attempt": null,
  "rag_scraping_success_count": 0,
  "rag_scraping_failure_count": 0,
  "rag_urls_scraped": null,
  "rag_urls_failed": null,
  "poi_confidence_score": null,
  "poi_score_justification": null,
  "poi_score_calculated_at": null,
  "poi_score_calculation_method": null,
  "processing_audit_log": null,
  "last_score_update_at": null,
  "poi_height": null,
  "height_confidence": null,
  "boundary_source": null,
  "boundary_confidence": null,
  "boundary_area_m2": null,
  "generation_strategy": null,
  "generation_range": null,
  "last_tp_generation_at": null,
  "tp_generation_metadata": null,
  "street_name": null,
  "house_number": null,
  "postal_code": null,
  "neighborhood": null,
  "name_variations": null,
  "name_metadata": "{\"languages_found\": [], \"has_multilingual\": false, \"alternative_names_count\": 0}",
  "entrance_fee": null,
  "accessibility_notes": null,
  "osm_id": "12358fa6-802d-1e69-9483-d561b4e78113",
  "official_rating": null,
  "visitor_capacity": null,
  "pet_friendly": null,
  "unique_id": null
};

async function testWikimediaImageExtraction() {
  console.log('🧪 Testing Wikimedia Commons image extraction...\n');

  try {
    // Parse OSM tags
    const osmTags = JSON.parse(samplePOI.osm_tags);
    console.log('📋 Sample POI Data:');
    console.log(`   Name: ${samplePOI.name}`);
    console.log(`   City: ${samplePOI.city}, ${samplePOI.state}`);
    console.log(`   Image URL: ${samplePOI.image_url}`);
    console.log(`   Wikimedia Commons: ${osmTags.wikimedia_commons}`);
    console.log('');

    // Prepare request body for the edge function
    const requestBody = {
      attractionId: samplePOI.id,
      attractionName: samplePOI.name,
      imageSource: 'wikimedia_commons' as const,
      wikimediaUrl: samplePOI.image_url,
      osmTags: osmTags
    };

    console.log('📤 Request Body:');
    console.log(JSON.stringify(requestBody, null, 2));
    console.log('');

    // Call the edge function
    console.log('🚀 Calling store-poi-images edge function...');
    
    const { data, error } = await supabase.functions.invoke('store-poi-images', {
      body: requestBody
    });

    if (error) {
      console.error('❌ Error calling edge function:', error);
      return;
    }

    console.log('✅ Edge function response:');
    console.log(JSON.stringify(data, null, 2));
    console.log('');

    // Check if image was stored successfully
    if (data.success && data.images && data.images.length > 0) {
      console.log('🎉 SUCCESS! Image extracted and stored:');
      console.log(`   Image ID: ${data.images[0].id}`);
      console.log(`   Public URL: ${data.images[0].url}`);
      console.log(`   Storage Path: ${data.images[0].storage_path}`);
      console.log('');

      // Verify the image was saved in the database
      console.log('🔍 Verifying database record...');
      const { data: imageRecord, error: dbError } = await supabase
        .schema('core')
        .from('attraction_image')
        .select('*')
        .eq('id', data.images[0].id)
        .single();

      if (dbError) {
        console.error('❌ Error fetching image record:', dbError);
      } else {
        console.log('✅ Database record found:');
        console.log(`   Alt Text: ${imageRecord.alt_text}`);
        console.log(`   Photo Reference: ${imageRecord.photo_reference}`);
        console.log(`   Created At: ${imageRecord.created_at}`);
      }

      // Check if attraction was updated with image URL
      console.log('🔍 Verifying attraction update...');
      const { data: attractionRecord, error: attractionError } = await supabase
        .schema('core')
        .from('attractions')
        .select('image_url')
        .eq('id', samplePOI.id)
        .single();

      if (attractionError) {
        console.error('❌ Error fetching attraction record:', attractionError);
      } else {
        console.log('✅ Attraction updated:');
        console.log(`   New Image URL: ${attractionRecord.image_url}`);
      }

    } else {
      console.log('❌ FAILED! No image was processed:');
      if (data.errors) {
        console.log('   Errors:', data.errors);
      }
    }

  } catch (error) {
    console.error('💥 Unexpected error:', error);
  }
}

// Test direct Wikimedia Commons API calls
async function testWikimediaAPI() {
  console.log('\n🔬 Testing Wikimedia Commons API directly...\n');

  try {
    const categoryUrl = samplePOI.image_url;
    const categoryName = categoryUrl.match(/\/wiki\/Category:(.+)$/)?.[1];
    
    if (!categoryName) {
      console.error('❌ Could not extract category name from URL');
      return;
    }

    console.log(`📂 Category: ${decodeURIComponent(categoryName)}`);

    // Get category members
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      list: 'categorymembers',
      cmtitle: `Category:${categoryName}`,
      cmtype: 'file',
      cmlimit: '5',
      cmnamespace: '6'
    });

    const response = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`);
    const data = await response.json();
    
    console.log('📋 Category members:');
    const files = data.query?.categorymembers || [];
    files.forEach((file: any, index: number) => {
      console.log(`   ${index + 1}. ${file.title}`);
    });

    if (files.length > 0) {
      // Get detailed info for first file
      const firstFile = files[0];
      console.log(`\n🔍 Getting details for: ${firstFile.title}`);
      
      const detailParams = new URLSearchParams({
        action: 'query',
        format: 'json',
        titles: firstFile.title,
        prop: 'imageinfo',
        iiprop: 'url|size|mime|extmetadata',
        iiurlwidth: '1600'
      });

      const detailResponse = await fetch(`https://commons.wikimedia.org/w/api.php?${detailParams}`);
      const detailData = await detailResponse.json();
      
      const pages = detailData.query?.pages;
      const pageId = Object.keys(pages)[0];
      const page = pages[pageId];
      
      if (page && page.imageinfo && page.imageinfo.length > 0) {
        const imageInfo = page.imageinfo[0];
        const metadata = imageInfo.extmetadata || {};
        
        console.log('✅ Image details:');
        console.log(`   URL: ${imageInfo.url}`);
        console.log(`   Size: ${imageInfo.size} bytes`);
        console.log(`   Dimensions: ${imageInfo.width}x${imageInfo.height}`);
        console.log(`   MIME: ${imageInfo.mime}`);
        console.log(`   Author: ${metadata.Artist?.value || metadata.Creator?.value || 'Unknown'}`);
        console.log(`   License: ${metadata.LicenseShortName?.value || metadata.License?.value || 'Unknown'}`);
        console.log(`   Description: ${metadata.ImageDescription?.value || 'No description'}`);
      }
    }

  } catch (error) {
    console.error('💥 Error testing Wikimedia API:', error);
  }
}

// Main execution
async function main() {
  console.log('🎯 Wikimedia Commons Image Extraction Test');
  console.log('==========================================\n');

  // Test 1: Direct API calls
  await testWikimediaAPI();

  // Test 2: Edge function
  await testWikimediaImageExtraction();

  console.log('\n🏁 Test completed!');
}

// Run the test
if (require.main === module) {
  main().catch(console.error);
}

export { testWikimediaImageExtraction, testWikimediaAPI };
