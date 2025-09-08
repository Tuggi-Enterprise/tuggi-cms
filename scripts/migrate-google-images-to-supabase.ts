#!/usr/bin/env tsx

/**
 * Migration Script: Google Images to Supabase Storage
 * 
 * This script identifies attractions that have Google Maps API URLs in their image_url field
 * and migrates them to use the store-poi-images Edge Function to download and store
 * the images in Supabase Storage.
 * 
 * Usage:
 * 1. Make sure you have the store-poi-images Edge Function deployed
 * 2. Run: npx tsx scripts/migrate-google-images-to-supabase.ts
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config()

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface AttractionToMigrate {
  id: string
  name: string
  google_place_id: string | null
  image_url: string
  photos_references: string[] | null
}

async function findAttractionsWithGoogleImages(): Promise<AttractionToMigrate[]> {
  console.log('🔍 Searching for attractions with Google Maps API URLs...')
  
  // Get attractions with Google URLs and their photo references from attraction_image table
  const { data, error } = await supabase
    .schema('core')
    .from('attractions')
    .select(`
      id, 
      name, 
      google_place_id, 
      image_url,
      attraction_image!inner(photo_reference)
    `)
    .not('image_url', 'is', null)
    .like('image_url', '%maps.googleapis.com%')

  if (error) {
    console.error('❌ Error fetching attractions:', error)
    throw error
  }

  // Transform the data to match our interface
  const attractionsToMigrate: AttractionToMigrate[] = []
  
  data?.forEach(attraction => {
    if (attraction.attraction_image && attraction.attraction_image.length > 0) {
      const photoReferences = attraction.attraction_image
        .map((img: any) => img.photo_reference)
        .filter((ref: string) => ref) // Remove null/undefined references
      
      if (photoReferences.length > 0) {
        attractionsToMigrate.push({
          id: attraction.id,
          name: attraction.name,
          google_place_id: attraction.google_place_id,
          image_url: attraction.image_url,
          photos_references: photoReferences
        })
      }
    }
  })

  console.log(`📊 Found ${attractionsToMigrate.length} attractions with Google Maps URLs and photo references`)
  return attractionsToMigrate
}

async function migrateAttractionImages(attractions: AttractionToMigrate[]): Promise<void> {
  console.log(`🚀 Starting migration of ${attractions.length} attractions...`)
  
  let successCount = 0
  let errorCount = 0
  
  for (const [index, attraction] of attractions.entries()) {
    console.log(`\n[${index + 1}/${attractions.length}] Processing: ${attraction.name}`)
    
    try {
      // Check if we have photo references
      if (!attraction.photos_references || attraction.photos_references.length === 0) {
        console.log(`⚠️  No photo references found for ${attraction.name}, skipping...`)
        continue
      }

      // Check if we have google_place_id
      if (!attraction.google_place_id) {
        console.log(`⚠️  No Google Place ID found for ${attraction.name}, skipping...`)
        continue
      }

      // Call the store-poi-images Edge Function
      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/store-poi-images`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
        },
        body: JSON.stringify({
          attractionId: attraction.id,
          googlePlaceId: attraction.google_place_id,
          photoReferences: attraction.photos_references,
          attractionName: attraction.name
        })
      })

      if (response.ok) {
        const result = await response.json()
        if (result.success && result.images && result.images.length > 0) {
          console.log(`✅ Successfully migrated ${attraction.name}: ${result.processed} images processed`)
          successCount++
        } else {
          console.log(`⚠️  Edge Function completed but no images processed for ${attraction.name}`)
          if (result.errors) {
            console.log(`   Errors: ${result.errors.join(', ')}`)
          }
        }
      } else {
        const errorText = await response.text()
        console.error(`❌ Edge Function failed for ${attraction.name}:`, errorText)
        errorCount++
      }

      // Add a small delay to avoid overwhelming the API
      await new Promise(resolve => setTimeout(resolve, 1000))

    } catch (error) {
      console.error(`❌ Error processing ${attraction.name}:`, error)
      errorCount++
    }
  }

  console.log(`\n📈 Migration Summary:`)
  console.log(`   ✅ Successful: ${successCount}`)
  console.log(`   ❌ Errors: ${errorCount}`)
  console.log(`   📊 Total processed: ${successCount + errorCount}`)
}

async function verifyMigration(): Promise<void> {
  console.log('\n🔍 Verifying migration results...')
  
  // Check how many attractions still have Google URLs
  const { data: remainingGoogle, error: googleError } = await supabase
    .schema('core')
    .from('attractions')
    .select('id, name, image_url')
    .not('image_url', 'is', null)
    .like('image_url', '%maps.googleapis.com%')

  if (googleError) {
    console.error('❌ Error checking remaining Google URLs:', googleError)
    return
  }

  // Check how many attractions now have Supabase URLs
  const { data: supabaseImages, error: supabaseError } = await supabase
    .schema('core')
    .from('attractions')
    .select('id, name, image_url')
    .not('image_url', 'is', null)
    .like('image_url', '%supabase%')

  if (supabaseError) {
    console.error('❌ Error checking Supabase URLs:', supabaseError)
    return
  }

  console.log(`📊 Verification Results:`)
  console.log(`   🔗 Still using Google URLs: ${remainingGoogle?.length || 0}`)
  console.log(`   🗄️  Now using Supabase URLs: ${supabaseImages?.length || 0}`)

  if (remainingGoogle && remainingGoogle.length > 0) {
    console.log(`\n⚠️  Attractions still using Google URLs:`)
    remainingGoogle.forEach(attraction => {
      console.log(`   - ${attraction.name} (${attraction.id})`)
    })
  }
}

async function main(): Promise<void> {
  console.log('🔄 Google Images to Supabase Storage Migration')
  console.log('================================================')
  
  try {
    // Find attractions that need migration
    const attractionsToMigrate = await findAttractionsWithGoogleImages()
    
    if (attractionsToMigrate.length === 0) {
      console.log('✅ No attractions found with Google Maps URLs. Migration not needed.')
      return
    }

    // Show what will be migrated
    console.log('\n📋 Attractions to migrate:')
    attractionsToMigrate.forEach((attraction, index) => {
      console.log(`   ${index + 1}. ${attraction.name} (${attraction.id})`)
      console.log(`      Google URL: ${attraction.image_url}`)
      console.log(`      Photo refs: ${attraction.photos_references?.length || 0}`)
    })

    // Ask for confirmation
    console.log('\n⚠️  This will download images from Google and store them in Supabase Storage.')
    console.log('   This process may take a while and will use your Google API quota.')
    
    // For automated execution, we'll proceed without user confirmation
    // In a real scenario, you might want to add a confirmation prompt here
    
    // Perform migration
    await migrateAttractionImages(attractionsToMigrate)
    
    // Verify results
    await verifyMigration()
    
    console.log('\n✅ Migration completed!')
    
  } catch (error) {
    console.error('❌ Migration failed:', error)
    process.exit(1)
  }
}

// Run the migration
if (require.main === module) {
  main()
}
