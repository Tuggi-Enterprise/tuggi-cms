#!/usr/bin/env tsx

/**
 * Check and Update Image URLs
 * 
 * This script checks if images with Google URLs are already stored in Supabase Storage
 * and updates the image_url in attractions table to point to Supabase Storage URLs.
 * 
 * Usage: npx tsx scripts/check-and-update-image-urls.ts
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

interface AttractionImageRecord {
  id: string
  attraction_id: string
  image_url: string
  storage_path: string | null
  photo_reference: string | null
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

async function findSupabaseImagesForAttractions(attractionIds: string[]): Promise<Map<string, AttractionImageRecord[]>> {
  console.log('🔍 Finding Supabase Storage images for these attractions...')
  
  const { data, error } = await supabase
    .schema('core')
    .from('attraction_image')
    .select('id, attraction_id, image_url, storage_path, photo_reference')
    .in('attraction_id', attractionIds)
    .like('image_url', '%supabase%')

  if (error) {
    console.error('❌ Error fetching attraction images:', error)
    throw error
  }

  // Group by attraction_id
  const imagesByAttraction = new Map<string, AttractionImageRecord[]>()
  
  data?.forEach(image => {
    if (!imagesByAttraction.has(image.attraction_id)) {
      imagesByAttraction.set(image.attraction_id, [])
    }
    imagesByAttraction.get(image.attraction_id)!.push(image)
  })

  console.log(`📊 Found ${data?.length || 0} Supabase Storage images for ${imagesByAttraction.size} attractions`)
  return imagesByAttraction
}

async function updateAttractionImageUrls(attractions: AttractionWithGoogleUrl[], imagesByAttraction: Map<string, AttractionImageRecord[]>): Promise<void> {
  console.log(`🚀 Checking and updating image URLs for ${attractions.length} attractions...`)
  
  let updatedCount = 0
  let alreadyCorrectCount = 0
  let noSupabaseImageCount = 0
  let errorCount = 0
  
  for (const [index, attraction] of attractions.entries()) {
    console.log(`\n[${index + 1}/${attractions.length}] Processing: ${attraction.name}`)
    
    try {
      const supabaseImages = imagesByAttraction.get(attraction.id)
      
      if (!supabaseImages || supabaseImages.length === 0) {
        console.log(`⚠️  No Supabase Storage image found for this attraction`)
        noSupabaseImageCount++
        continue
      }

      // Use the first Supabase image as the primary image
      const primaryImage = supabaseImages[0]
      
      // Check if the attraction's image_url already points to Supabase
      if (attraction.image_url.includes('supabase')) {
        console.log(`✅ Image URL already points to Supabase Storage`)
        alreadyCorrectCount++
        continue
      }

      // Update the attraction's image_url to point to Supabase Storage
      const { error: updateError } = await supabase
        .schema('core')
        .from('attractions')
        .update({ image_url: primaryImage.image_url })
        .eq('id', attraction.id)

      if (updateError) {
        console.error(`❌ Error updating image URL:`, updateError)
        errorCount++
        continue
      }

      console.log(`✅ Updated image URL to Supabase Storage:`)
      console.log(`   From: ${attraction.image_url}`)
      console.log(`   To:   ${primaryImage.image_url}`)
      updatedCount++

    } catch (error) {
      console.error(`❌ Error processing ${attraction.name}:`, error)
      errorCount++
    }
  }

  console.log(`\n📈 Update Summary:`)
  console.log(`   ✅ Updated: ${updatedCount}`)
  console.log(`   ✅ Already correct: ${alreadyCorrectCount}`)
  console.log(`   ⚠️  No Supabase image: ${noSupabaseImageCount}`)
  console.log(`   ❌ Errors: ${errorCount}`)
  console.log(`   📊 Total processed: ${updatedCount + alreadyCorrectCount + noSupabaseImageCount + errorCount}`)
}

async function verifyUpdates(): Promise<void> {
  console.log('\n🔍 Verifying updates...')
  
  // Check how many attractions now have Supabase URLs
  const { data: supabaseUrls, error: supabaseError } = await supabase
    .schema('core')
    .from('attractions')
    .select('id, name, image_url')
    .not('image_url', 'is', null)
    .like('image_url', '%supabase%')

  if (supabaseError) {
    console.error('❌ Error checking Supabase URLs:', supabaseError)
    return
  }

  // Check how many attractions still have Google URLs
  const { data: googleUrls, error: googleError } = await supabase
    .schema('core')
    .from('attractions')
    .select('id, name, image_url')
    .not('image_url', 'is', null)
    .like('image_url', '%maps.googleapis.com%')

  if (googleError) {
    console.error('❌ Error checking Google URLs:', googleError)
    return
  }

  console.log(`📊 Final Results:`)
  console.log(`   🗄️  Attractions with Supabase URLs: ${supabaseUrls?.length || 0}`)
  console.log(`   🔗 Attractions with Google URLs: ${googleUrls?.length || 0}`)

  if (googleUrls && googleUrls.length > 0) {
    console.log(`\n⚠️  Attractions still using Google URLs:`)
    googleUrls.slice(0, 5).forEach(attraction => {
      console.log(`   - ${attraction.name} (${attraction.id})`)
    })
    if (googleUrls.length > 5) {
      console.log(`   ... and ${googleUrls.length - 5} more`)
    }
  } else {
    console.log(`\n✅ All attractions now use Supabase Storage URLs!`)
  }
}

async function main(): Promise<void> {
  console.log('🔄 Check and Update Image URLs')
  console.log('==============================')
  
  try {
    // Find attractions with Google URLs
    const attractions = await findAttractionsWithGoogleUrls()
    
    if (attractions.length === 0) {
      console.log('✅ No attractions found with Google Maps URLs.')
      return
    }

    // Find Supabase Storage images for these attractions
    const attractionIds = attractions.map(a => a.id)
    const imagesByAttraction = await findSupabaseImagesForAttractions(attractionIds)

    // Show what will be processed
    console.log('\n📋 Attractions to check:')
    attractions.slice(0, 5).forEach((attraction, index) => {
      const hasSupabaseImage = imagesByAttraction.has(attraction.id)
      console.log(`   ${index + 1}. ${attraction.name}`)
      console.log(`      Has Supabase image: ${hasSupabaseImage ? '✅' : '❌'}`)
      console.log(`      Current URL: ${attraction.image_url}`)
    })
    
    if (attractions.length > 5) {
      console.log(`   ... and ${attractions.length - 5} more`)
    }

    // Update image URLs
    await updateAttractionImageUrls(attractions, imagesByAttraction)
    
    // Verify results
    await verifyUpdates()
    
    console.log('\n✅ Image URL update completed!')
    
  } catch (error) {
    console.error('❌ Update failed:', error)
    process.exit(1)
  }
}

// Run the update
if (require.main === module) {
  main()
}
