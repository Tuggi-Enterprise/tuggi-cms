#!/usr/bin/env tsx

/**
 * Extract Photo References from Google URLs
 * 
 * This script extracts photo_reference values from existing Google Maps API URLs
 * in the attractions table and saves them to the attraction_image table.
 * 
 * Usage: npx tsx scripts/extract-photo-references-from-urls.ts
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config()

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface AttractionWithGoogleUrl {
  id: string
  name: string
  google_place_id: string | null
  image_url: string
}

function extractPhotoReferenceFromUrl(url: string): string | null {
  try {
    const urlObj = new URL(url)
    const photoRef = urlObj.searchParams.get('photo_reference')
    return photoRef
  } catch (error) {
    console.error('Error parsing URL:', url, error)
    return null
  }
}

async function findAttractionsWithGoogleUrls(): Promise<AttractionWithGoogleUrl[]> {
  console.log('🔍 Finding attractions with Google Maps URLs...')
  
  const { data, error } = await supabase
    .schema('core')
    .from('attractions')
    .select('id, name, google_place_id, image_url')
    .not('image_url', 'is', null)
    .like('image_url', '%maps.googleapis.com%')

  if (error) {
    console.error('❌ Error fetching attractions:', error)
    throw error
  }

  console.log(`📊 Found ${data?.length || 0} attractions with Google Maps URLs`)
  return data || []
}

async function extractAndSavePhotoReferences(attractions: AttractionWithGoogleUrl[]): Promise<void> {
  console.log(`🚀 Extracting photo references from ${attractions.length} attractions...`)
  
  let successCount = 0
  let errorCount = 0
  let skippedCount = 0
  
  for (const [index, attraction] of attractions.entries()) {
    console.log(`\n[${index + 1}/${attractions.length}] Processing: ${attraction.name}`)
    
    try {
      // Extract photo reference from URL
      const photoReference = extractPhotoReferenceFromUrl(attraction.image_url)
      
      if (!photoReference) {
        console.log(`⚠️  Could not extract photo reference from URL`)
        skippedCount++
        continue
      }

      // Check if this attraction already has an entry in attraction_image
      const { data: existingImage, error: checkError } = await supabase
        .schema('core')
        .from('attraction_image')
        .select('id')
        .eq('attraction_id', attraction.id)
        .limit(1)

      if (checkError) {
        console.error(`❌ Error checking existing image:`, checkError)
        errorCount++
        continue
      }

      if (existingImage && existingImage.length > 0) {
        console.log(`⚠️  Attraction already has image record, skipping...`)
        skippedCount++
        continue
      }

      // Insert photo reference into attraction_image table
      const { data: insertedImage, error: insertError } = await supabase
        .schema('core')
        .from('attraction_image')
        .insert({
          attraction_id: attraction.id,
          image_url: attraction.image_url, // Keep the Google URL for now
          photo_reference: photoReference,
          alt_text: `Image from Google Places for ${attraction.name}`
        })
        .select('id')
        .single()

      if (insertError) {
        console.error(`❌ Error inserting photo reference:`, insertError)
        errorCount++
        continue
      }

      console.log(`✅ Successfully saved photo reference: ${photoReference}`)
      successCount++

    } catch (error) {
      console.error(`❌ Error processing ${attraction.name}:`, error)
      errorCount++
    }
  }

  console.log(`\n📈 Extraction Summary:`)
  console.log(`   ✅ Successful: ${successCount}`)
  console.log(`   ⚠️  Skipped: ${skippedCount}`)
  console.log(`   ❌ Errors: ${errorCount}`)
  console.log(`   📊 Total processed: ${successCount + skippedCount + errorCount}`)
}

async function verifyExtraction(): Promise<void> {
  console.log('\n🔍 Verifying extraction results...')
  
  // Check how many attraction_image records now have photo_reference
  const { data: withPhotoRefs, error: photoRefError } = await supabase
    .schema('core')
    .from('attraction_image')
    .select('id, attraction_id, photo_reference')
    .not('photo_reference', 'is', null)

  if (photoRefError) {
    console.error('❌ Error checking photo references:', photoRefError)
    return
  }

  // Check how many attractions still have Google URLs
  const { data: stillGoogle, error: googleError } = await supabase
    .schema('core')
    .from('attractions')
    .select('id, name, image_url')
    .not('image_url', 'is', null)
    .like('image_url', '%maps.googleapis.com%')

  if (googleError) {
    console.error('❌ Error checking remaining Google URLs:', googleError)
    return
  }

  console.log(`📊 Verification Results:`)
  console.log(`   📸 attraction_image records with photo_reference: ${withPhotoRefs?.length || 0}`)
  console.log(`   🔗 attractions still with Google URLs: ${stillGoogle?.length || 0}`)

  if (withPhotoRefs && withPhotoRefs.length > 0) {
    console.log(`\n✅ Photo references successfully extracted!`)
    console.log(`   Now you can run the migration script to download and store images in Supabase Storage.`)
  }
}

async function main(): Promise<void> {
  console.log('📸 Photo Reference Extraction from Google URLs')
  console.log('===============================================')
  
  try {
    // Find attractions with Google URLs
    const attractions = await findAttractionsWithGoogleUrls()
    
    if (attractions.length === 0) {
      console.log('✅ No attractions found with Google Maps URLs.')
      return
    }

    // Show what will be processed
    console.log('\n📋 Attractions to process:')
    attractions.slice(0, 5).forEach((attraction, index) => {
      console.log(`   ${index + 1}. ${attraction.name}`)
      console.log(`      URL: ${attraction.image_url}`)
    })
    
    if (attractions.length > 5) {
      console.log(`   ... and ${attractions.length - 5} more`)
    }

    // Extract and save photo references
    await extractAndSavePhotoReferences(attractions)
    
    // Verify results
    await verifyExtraction()
    
    console.log('\n✅ Photo reference extraction completed!')
    console.log('\n🚀 Next steps:')
    console.log('   1. Run: npx tsx scripts/check-google-images.ts (to verify)')
    console.log('   2. Run: npx tsx scripts/migrate-google-images-to-supabase.ts (to migrate images)')
    
  } catch (error) {
    console.error('❌ Extraction failed:', error)
    process.exit(1)
  }
}

// Run the extraction
if (require.main === module) {
  main()
}
