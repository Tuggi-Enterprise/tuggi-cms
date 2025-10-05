import { getSupabase } from '../lib/core/supabase-client'
import dotenv from 'dotenv'

dotenv.config()

const supabase = getSupabase('service')

interface AttractionWithWikimedia {
  id: string
  name: string
  image_url: string
}

async function downloadImageFromUrl(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'image/jpeg, image/png, image/webp, image/*'
    }
  })

  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.status} ${response.statusText}`)
  }

  return await response.arrayBuffer()
}

async function uploadToSupabaseStorage(
  imageData: ArrayBuffer, 
  attractionId: string, 
  originalUrl: string,
  contentType: string = 'image/jpeg'
): Promise<string> {
  // Extract filename from URL
  const urlParts = originalUrl.split('/')
  const originalFilename = urlParts[urlParts.length - 1]
  
  // Generate new filename with timestamp
  const timestamp = Date.now()
  const fileExtension = originalFilename.split('.').pop() || 'jpg'
  const newFilename = `wikimedia-${attractionId.substring(0, 8)}-${timestamp}.${fileExtension}`
  
  // Create folder structure: wikimedia/attractionId/filename
  const storagePath = `wikimedia/${attractionId}/${newFilename}`
  
  // Upload to Supabase Storage
  const { error: uploadError } = await supabase.storage
    .from('travel-app-images')
    .upload(storagePath, imageData, {
      contentType,
      duplex: 'half'
    })

  if (uploadError) {
    throw new Error(`Failed to upload to storage: ${uploadError.message}`)
  }

  // Get public URL
  const { data: publicUrlData } = supabase.storage
    .from('travel-app-images')
    .getPublicUrl(storagePath)

  return publicUrlData.publicUrl
}

async function updateAttractionImageUrl(attractionId: string, newImageUrl: string): Promise<void> {
  const { error } = await supabase
    .schema('core')
    .from('attractions')
    .update({ image_url: newImageUrl })
    .eq('id', attractionId)

  if (error) {
    throw new Error(`Failed to update attraction: ${error.message}`)
  }
}

async function processWikimediaAttraction(attraction: AttractionWithWikimedia): Promise<boolean> {
  try {
    console.log(`🔄 Processing: ${attraction.name}`)
    console.log(`   Original URL: ${attraction.image_url}`)
    
    // Download image from Wikimedia
    const imageData = await downloadImageFromUrl(attraction.image_url)
    console.log(`   ✅ Downloaded image (${imageData.byteLength} bytes)`)
    
    // Upload to Supabase Storage
    const newImageUrl = await uploadToSupabaseStorage(imageData, attraction.id, attraction.image_url)
    console.log(`   ✅ Uploaded to Supabase: ${newImageUrl}`)
    
    // Update attraction table
    await updateAttractionImageUrl(attraction.id, newImageUrl)
    console.log(`   ✅ Updated attraction table`)
    
    return true
    
  } catch (error) {
    console.error(`   ❌ Error processing ${attraction.name}:`, error instanceof Error ? error.message : 'Unknown error')
    return false
  }
}

async function downloadWikimediaImages() {
  console.log('🚀 Starting Wikimedia images download to Supabase bucket...')
  
  // Get attractions with Wikimedia URLs
  const { data: attractions, error } = await supabase
    .schema('core')
    .from('attractions')
    .select('id, name, image_url')
    .like('image_url', '%wikimedia%')
    // Remove limit to process all Wikimedia images
  
  if (error) {
    console.error('Error fetching attractions:', error)
    return
  }

  console.log(`📊 Found ${attractions?.length || 0} attractions with Wikimedia URLs`)
  
  let successCount = 0
  let errorCount = 0

  for (const attraction of attractions || []) {
    const success = await processWikimediaAttraction(attraction)
    
    if (success) {
      successCount++
    } else {
      errorCount++
    }
    
    // Wait 2 seconds between requests to avoid overwhelming the servers
    await new Promise(resolve => setTimeout(resolve, 2000))
  }

  console.log(`\n📊 Migration Summary:`)
  console.log(`   ✅ Successful: ${successCount}`)
  console.log(`   ❌ Failed: ${errorCount}`)
  console.log(`   📊 Total processed: ${successCount + errorCount}`)
}

downloadWikimediaImages()
