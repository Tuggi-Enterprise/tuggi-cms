#!/usr/bin/env tsx

/**
 * Test Edge Function
 * 
 * This script tests the store-poi-images Edge Function to ensure it's working correctly
 * and saving Supabase Storage URLs in the attractions table.
 * 
 * Usage: npx tsx scripts/test-edge-function.ts
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config()

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface TestAttraction {
  id: string
  name: string
  google_place_id: string
  image_url: string | null
}

async function findTestAttraction(): Promise<TestAttraction | null> {
  console.log('🔍 Looking for an attraction to test...')
  
  // Find an attraction that has a Google Place ID but no image_url (or Google URL)
  const { data, error } = await supabase
    .schema('core')
    .from('attractions')
    .select('id, name, google_place_id, image_url')
    .not('google_place_id', 'is', null)
    .or('image_url.is.null,image_url.not.like.%maps.googleapis.com%')
    .limit(1)
    .single()

  if (error) {
    console.error('❌ Error finding test attraction:', error)
    return null
  }

  return data
}

async function testEdgeFunction(attraction: TestAttraction): Promise<void> {
  console.log(`\n🧪 Testing Edge Function with attraction: ${attraction.name}`)
  console.log(`   ID: ${attraction.id}`)
  console.log(`   Google Place ID: ${attraction.google_place_id}`)
  console.log(`   Current image_url: ${attraction.image_url || 'null'}`)

  // Get photo references from attraction_image table
  const { data: imageData, error: imageError } = await supabase
    .schema('core')
    .from('attraction_image')
    .select('photo_reference')
    .eq('attraction_id', attraction.id)
    .limit(1)

  if (imageError || !imageData || imageData.length === 0) {
    console.log('⚠️  No photo references found in attraction_image table')
    return
  }

  const photoReference = imageData[0].photo_reference
  console.log(`   Photo reference: ${photoReference}`)

  // Call the Edge Function
  const edgeFunctionUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/store-poi-images`
  
  console.log(`\n🚀 Calling Edge Function: ${edgeFunctionUrl}`)
  
  try {
    const response = await fetch(edgeFunctionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({
        attractionId: attraction.id,
        googlePlaceId: attraction.google_place_id,
        photoReferences: [photoReference],
        attractionName: attraction.name
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`❌ Edge Function failed: ${response.status} ${response.statusText}`)
      console.error(`   Error: ${errorText}`)
      return
    }

    const result = await response.json()
    console.log('✅ Edge Function response:', JSON.stringify(result, null, 2))

    // Verify the result
    if (result.success && result.images && result.images.length > 0) {
      const imageUrl = result.images[0].url
      console.log(`\n📸 New image URL: ${imageUrl}`)
      
      // Check if it's a Supabase URL
      if (imageUrl.includes('supabase') || imageUrl.includes('storage.googleapis.com')) {
        console.log('✅ Image URL is from Supabase Storage!')
      } else {
        console.log('⚠️  Image URL is not from Supabase Storage')
      }
    }

  } catch (error) {
    console.error('❌ Error calling Edge Function:', error)
  }
}

async function verifyDatabaseUpdate(attractionId: string): Promise<void> {
  console.log(`\n🔍 Verifying database update for attraction ${attractionId}...`)
  
  // Check attractions table
  const { data: attractionData, error: attractionError } = await supabase
    .schema('core')
    .from('attractions')
    .select('id, name, image_url')
    .eq('id', attractionId)
    .single()

  if (attractionError) {
    console.error('❌ Error checking attractions table:', attractionError)
    return
  }

  console.log(`📊 Attraction table update:`)
  console.log(`   Name: ${attractionData.name}`)
  console.log(`   Image URL: ${attractionData.image_url || 'null'}`)
  
  if (attractionData.image_url) {
    if (attractionData.image_url.includes('supabase') || attractionData.image_url.includes('storage.googleapis.com')) {
      console.log('✅ attractions.image_url is correctly set to Supabase Storage URL!')
    } else {
      console.log('⚠️  attractions.image_url is not a Supabase Storage URL')
    }
  }

  // Check attraction_image table
  const { data: imageData, error: imageError } = await supabase
    .schema('core')
    .from('attraction_image')
    .select('id, image_url, storage_path, photo_reference')
    .eq('attraction_id', attractionId)

  if (imageError) {
    console.error('❌ Error checking attraction_image table:', imageError)
    return
  }

  console.log(`\n📊 attraction_image table:`)
  imageData.forEach((img, index) => {
    console.log(`   Image ${index + 1}:`)
    console.log(`     ID: ${img.id}`)
    console.log(`     Image URL: ${img.image_url || 'null'}`)
    console.log(`     Storage Path: ${img.storage_path || 'null'}`)
    console.log(`     Photo Reference: ${img.photo_reference || 'null'}`)
  })
}

async function main(): Promise<void> {
  console.log('🧪 Edge Function Test')
  console.log('====================')
  
  try {
    // Find a test attraction
    const testAttraction = await findTestAttraction()
    
    if (!testAttraction) {
      console.log('❌ No suitable attraction found for testing')
      return
    }

    // Test the Edge Function
    await testEdgeFunction(testAttraction)
    
    // Wait a moment for the function to complete
    console.log('\n⏳ Waiting 3 seconds for Edge Function to complete...')
    await new Promise(resolve => setTimeout(resolve, 3000))
    
    // Verify the database was updated
    await verifyDatabaseUpdate(testAttraction.id)
    
    console.log('\n✅ Test completed!')
    
  } catch (error) {
    console.error('❌ Test failed:', error)
    process.exit(1)
  }
}

// Run the test
if (require.main === module) {
  main()
}
