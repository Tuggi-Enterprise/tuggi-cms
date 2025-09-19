import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const GOOGLE_API_KEY = process.env.VITE_GOOGLE_MAPS_API_KEY

interface GooglePlaceDetails {
  place_id: string
  name: string
  photos?: Array<{
    photo_reference: string
    height: number
    width: number
  }>
}

async function getGooglePlaceDetails(placeId: string): Promise<GooglePlaceDetails | null> {
  if (!GOOGLE_API_KEY) {
    throw new Error('Google API key not found')
  }

  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=place_id,name,photos&key=${GOOGLE_API_KEY}`
  
  try {
    const response = await fetch(url)
    const data = await response.json()
    
    if (data.status === 'OK' && data.result) {
      return data.result
    } else {
      console.warn(`Google API error for ${placeId}: ${data.status} - ${data.error_message || 'Unknown error'}`)
      return null
    }
  } catch (error) {
    console.error(`Error fetching Google Place details for ${placeId}:`, error)
    return null
  }
}

async function storePhotoReferences(attractionId: string, photoReferences: string[]): Promise<void> {
  const imageReferences = photoReferences.slice(0, 1).map((photoRef) => ({
    attraction_id: attractionId,
    storage_path: `pending/${attractionId}/${photoRef}`,
    photo_reference: photoRef
  }))

  const { error } = await supabase
    .schema('core')
    .from('attraction_image')
    .insert(imageReferences)

  if (error) {
    throw new Error(`Failed to save photo references: ${error.message}`)
  }
}

async function callEdgeFunction(attractionId: string, googlePlaceId: string, photoReferences: string[], attractionName: string): Promise<boolean> {
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/store-poi-images`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({
        attractionId: attractionId,
        googlePlaceId: googlePlaceId,
        photoReferences: photoReferences,
        attractionName: attractionName
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`Edge Function failed: ${response.status} - ${errorText}`)
      return false
    }

    const result = await response.json()
    return result.success && result.images && result.images.length > 0
  } catch (error) {
    console.error('Error calling Edge Function:', error)
    return false
  }
}

async function migrateWikimediaAttractions() {
  console.log('🚀 Starting Wikimedia to Supabase migration...')
  
  // Get attractions with Wikimedia URLs that have Google Place IDs
  const { data: attractions, error } = await supabase
    .schema('core')
    .from('attractions')
    .select('id, name, google_place_id, image_url')
    .like('image_url', '%wikimedia%')
    .not('google_place_id', 'is', null)
    .limit(10) // Start with 10 for testing
  
  if (error) {
    console.error('Error fetching attractions:', error)
    return
  }

  console.log(`📊 Found ${attractions?.length || 0} attractions to migrate`)
  
  let successCount = 0
  let errorCount = 0

  for (const attraction of attractions || []) {
    try {
      console.log(`\n🔄 Processing: ${attraction.name}`)
      console.log(`   Google Place ID: ${attraction.google_place_id}`)
      console.log(`   Current URL: ${attraction.image_url}`)
      
      // Get Google Place details
      const placeDetails = await getGooglePlaceDetails(attraction.google_place_id)
      
      if (!placeDetails || !placeDetails.photos || placeDetails.photos.length === 0) {
        console.log(`   ⚠️ No photos found for ${attraction.name}`)
        continue
      }

      const photoReferences = placeDetails.photos.map(photo => photo.photo_reference)
      console.log(`   📸 Found ${photoReferences.length} photos`)

      // Store photo references
      await storePhotoReferences(attraction.id, photoReferences)
      console.log(`   ✅ Stored photo references`)

      // Call Edge Function
      const edgeFunctionSuccess = await callEdgeFunction(
        attraction.id,
        attraction.google_place_id,
        photoReferences,
        attraction.name
      )

      if (edgeFunctionSuccess) {
        console.log(`   ✅ Edge Function processed successfully`)
        successCount++
      } else {
        console.log(`   ❌ Edge Function failed`)
        errorCount++
      }

      // Wait 1 second between requests to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000))

    } catch (error) {
      console.error(`   ❌ Error processing ${attraction.name}:`, error)
      errorCount++
    }
  }

  console.log(`\n📊 Migration Summary:`)
  console.log(`   ✅ Successful: ${successCount}`)
  console.log(`   ❌ Failed: ${errorCount}`)
  console.log(`   📊 Total processed: ${successCount + errorCount}`)
}

migrateWikimediaAttractions()
