#!/usr/bin/env tsx

/**
 * Test POI Importer Flow
 * 
 * This script tests the complete POI Importer flow to ensure it's working correctly:
 * 1. Creates a test attraction
 * 2. Stores photo references in attraction_image table
 * 3. Calls Edge Function to process images
 * 4. Verifies the results
 * 
 * Usage: npx tsx scripts/test-poi-importer-flow.ts
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config()

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function testPOIImporterFlow(): Promise<void> {
  console.log('🧪 Testing POI Importer Flow')
  console.log('============================')
  
  try {
    // Step 1: Get existing attraction
    console.log('\n1️⃣ Getting existing attraction...')
    
    const attractionId = '7dd766fd-8047-40ea-b3a7-1b618df78fa2'
    
    const { data: existingAttraction, error: attractionError } = await supabase
      .schema('core')
      .from('attractions')
      .select('id, name, google_place_id, image_url')
      .eq('id', attractionId)
      .single()

    if (attractionError) {
      console.error('❌ Error getting attraction:', attractionError)
      return
    }

    console.log(`✅ Found attraction: ${existingAttraction.name} (${existingAttraction.id})`)
    console.log(`   Google Place ID: ${existingAttraction.google_place_id}`)
    console.log(`   Current image_url: ${existingAttraction.image_url || 'null'}`)

    // Step 2: Store photo references in attraction_image table
    console.log('\n2️⃣ Storing photo references...')
    
    // Extract real photo reference from existing Google URL
    let realPhotoReference = 'TEST_PHOTO_REFERENCE_123'
    if (existingAttraction.image_url && existingAttraction.image_url.includes('photo_reference=')) {
      const url = new URL(existingAttraction.image_url)
      const extractedRef = url.searchParams.get('photo_reference')
      if (extractedRef) {
        realPhotoReference = extractedRef
        console.log(`📸 Using real photo reference: ${realPhotoReference.substring(0, 50)}...`)
      }
    }
    const imageReferences = [{
      attraction_id: existingAttraction.id,
      storage_path: `pending/${existingAttraction.google_place_id}/${realPhotoReference}`,
      photo_reference: realPhotoReference
    }]

    const { error: imageRefError } = await supabase
      .schema('core')
      .from('attraction_image')
      .insert(imageReferences)

    if (imageRefError) {
      console.error('❌ Error storing photo references:', imageRefError)
      return
    }

    console.log(`✅ Stored ${imageReferences.length} photo references`)

    // Step 3: Call Edge Function
    console.log('\n3️⃣ Calling Edge Function...')
    
    const edgeFunctionUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/store-poi-images`
    
    const response = await fetch(edgeFunctionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({
        attractionId: existingAttraction.id,
        googlePlaceId: existingAttraction.google_place_id,
        photoReferences: [realPhotoReference],
        attractionName: existingAttraction.name
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

    // Step 4: Verify results
    console.log('\n4️⃣ Verifying results...')
    
    // Check attractions table
    const { data: updatedAttraction, error: attractionCheckError } = await supabase
      .schema('core')
      .from('attractions')
      .select('id, name, image_url')
      .eq('id', existingAttraction.id)
      .single()

    if (attractionCheckError) {
      console.error('❌ Error checking attractions table:', attractionCheckError)
      return
    }

    console.log(`📊 Attraction table:`)
    console.log(`   Name: ${updatedAttraction.name}`)
    console.log(`   Image URL: ${updatedAttraction.image_url || 'null'}`)
    
    if (updatedAttraction.image_url) {
      if (updatedAttraction.image_url.includes('supabase') || updatedAttraction.image_url.includes('storage.googleapis.com')) {
        console.log('✅ attractions.image_url is correctly set to Supabase Storage URL!')
      } else {
        console.log('⚠️  attractions.image_url is not a Supabase Storage URL')
      }
    } else {
      console.log('❌ attractions.image_url is still null')
    }

    // Check attraction_image table
    const { data: imageData, error: imageCheckError } = await supabase
      .schema('core')
      .from('attraction_image')
      .select('id, image_url, storage_path, photo_reference')
      .eq('attraction_id', existingAttraction.id)

    if (imageCheckError) {
      console.error('❌ Error checking attraction_image table:', imageCheckError)
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

    // Step 5: Cleanup (only remove test image data, keep the attraction)
    console.log('\n5️⃣ Cleaning up test data...')
    
    // Delete only the test image data we created
    const { error: deleteImageError } = await supabase
      .schema('core')
      .from('attraction_image')
      .delete()
      .eq('attraction_id', existingAttraction.id)
      .eq('photo_reference', realPhotoReference)

    if (deleteImageError) {
      console.warn('⚠️  Error deleting test image data:', deleteImageError)
    } else {
      console.log('✅ Test image data cleaned up')
    }

    console.log('\n🎉 Test completed!')
    
  } catch (error) {
    console.error('❌ Test failed:', error)
    process.exit(1)
  }
}

// Run the test
if (require.main === module) {
  testPOIImporterFlow()
}
