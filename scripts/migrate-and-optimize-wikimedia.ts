import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'
import dotenv from 'dotenv'

dotenv.config()

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface AttractionWithWikimedia {
  id: string
  name: string
  image_url: string
}

interface OptimizationResult {
  originalSize: number
  optimizedSize: number
  thumbnailSize: number
  spaceSaved: number
  dimensions: { width: number; height: number }
  format: string
}

// Configurações de otimização baseadas no sistema de otimização
const OPTIMIZATION_CONFIG = {
  maxWidth: 1024,
  maxHeight: 1024,
  quality: 85,
  thumbnailSize: 300,
  thumbnailQuality: 80,
  maxFileSize: 50 * 1024 * 1024 // 50MB máximo
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

async function optimizeImage(imageData: ArrayBuffer, originalUrl: string): Promise<{
  optimizedData: ArrayBuffer
  thumbnailData: ArrayBuffer
  result: OptimizationResult
}> {
  const originalSize = imageData.byteLength
  const buffer = Buffer.from(imageData)
  
  // Get original image metadata
  const metadata = await sharp(buffer).metadata()
  console.log(`   📏 Original dimensions: ${metadata.width}x${metadata.height}`)
  console.log(`   📊 Original format: ${metadata.format}`)
  
  // Optimize main image (max 1024x1024, quality 85%)
  const optimizedBuffer = await sharp(buffer)
    .resize(OPTIMIZATION_CONFIG.maxWidth, OPTIMIZATION_CONFIG.maxHeight, {
      fit: 'inside',
      withoutEnlargement: true
    })
    .jpeg({ 
      quality: OPTIMIZATION_CONFIG.quality,
      progressive: true,
      mozjpeg: true
    })
    .toBuffer()
  
  // Create thumbnail (300x300, quality 80%)
  const thumbnailBuffer = await sharp(buffer)
    .resize(OPTIMIZATION_CONFIG.thumbnailSize, OPTIMIZATION_CONFIG.thumbnailSize, {
      fit: 'cover',
      position: 'center'
    })
    .jpeg({ 
      quality: OPTIMIZATION_CONFIG.thumbnailQuality,
      progressive: true,
      mozjpeg: true
    })
    .toBuffer()
  
  // Get optimized image metadata
  const optimizedMetadata = await sharp(optimizedBuffer).metadata()
  const thumbnailMetadata = await sharp(thumbnailBuffer).metadata()
  
  const optimizedSize = optimizedBuffer.length
  const thumbnailSize = thumbnailBuffer.length
  const spaceSaved = originalSize - optimizedSize
  
  console.log(`   📏 Optimized dimensions: ${optimizedMetadata.width}x${optimizedMetadata.height}`)
  console.log(`   📏 Thumbnail dimensions: ${thumbnailMetadata.width}x${thumbnailMetadata.height}`)
  
  return {
    optimizedData: optimizedBuffer.buffer,
    thumbnailData: thumbnailBuffer.buffer,
    result: {
      originalSize,
      optimizedSize,
      thumbnailSize,
      spaceSaved,
      dimensions: {
        width: optimizedMetadata.width || 0,
        height: optimizedMetadata.height || 0
      },
      format: optimizedMetadata.format || 'jpeg'
    }
  }
}

async function uploadOptimizedImages(
  attractionId: string,
  originalUrl: string,
  optimizedData: ArrayBuffer,
  thumbnailData: ArrayBuffer,
  result: OptimizationResult
): Promise<{ mainUrl: string; thumbnailUrl: string }> {
  const timestamp = Date.now()
  const fileExtension = originalUrl.split('.').pop() || 'jpg'
  
  // Upload imagem principal otimizada
  const mainFilename = `wikimedia-${attractionId.substring(0, 8)}-${timestamp}-optimized.${fileExtension}`
  const mainPath = `wikimedia/${attractionId}/${mainFilename}`
  
  const { error: mainError } = await supabase.storage
    .from('travel-app-images')
    .upload(mainPath, optimizedData, {
      contentType: `image/${result.format}`,
      duplex: 'half'
    })

  if (mainError) {
    throw new Error(`Failed to upload optimized image: ${mainError.message}`)
  }

  // Upload thumbnail
  const thumbnailFilename = `wikimedia-${attractionId.substring(0, 8)}-${timestamp}-thumbnail.${fileExtension}`
  const thumbnailPath = `wikimedia/${attractionId}/${thumbnailFilename}`
  
  const { error: thumbnailError } = await supabase.storage
    .from('travel-app-images')
    .upload(thumbnailPath, thumbnailData, {
      contentType: `image/${result.format}`,
      duplex: 'half'
    })

  if (thumbnailError) {
    throw new Error(`Failed to upload thumbnail: ${thumbnailError.message}`)
  }

  // Get public URLs
  const { data: mainUrlData } = supabase.storage
    .from('travel-app-images')
    .getPublicUrl(mainPath)

  const { data: thumbnailUrlData } = supabase.storage
    .from('travel-app-images')
    .getPublicUrl(thumbnailPath)

  return {
    mainUrl: mainUrlData.publicUrl,
    thumbnailUrl: thumbnailUrlData.publicUrl
  }
}

async function updateAttractionWithOptimizedImages(
  attractionId: string, 
  mainUrl: string, 
  thumbnailUrl: string,
  optimizationResult: OptimizationResult,
  originalWikimediaUrl: string
): Promise<void> {
  // First, check if there's already an attraction_image record for this attraction
  const { data: existingImage, error: checkError } = await supabase
    .schema('core')
    .from('attraction_image')
    .select('id')
    .eq('attraction_id', attractionId)
    .like('image_url', '%upload.wikimedia.org%')
    .single()

  if (checkError && checkError.code !== 'PGRST116') { // PGRST116 = no rows found
    throw new Error(`Failed to check existing attraction_image: ${checkError.message}`)
  }

  if (existingImage) {
    // Update existing record
    const { error: updateError } = await supabase
      .schema('core')
      .from('attraction_image')
      .update({ 
        image_url: mainUrl,
        thumbnail_url: thumbnailUrl,
        image_optimization_data: {
          originalSize: optimizationResult.originalSize,
          optimizedSize: optimizationResult.optimizedSize,
          thumbnailSize: optimizationResult.thumbnailSize,
          spaceSaved: optimizationResult.spaceSaved,
          reductionPercentage: ((optimizationResult.spaceSaved / optimizationResult.originalSize) * 100).toFixed(1),
          dimensions: optimizationResult.dimensions,
          format: optimizationResult.format,
          processedAt: new Date().toISOString(),
          originalUrl: originalWikimediaUrl
        },
        image_processing_status: 'completed',
        image_processed_at: new Date().toISOString(),
        image_width: optimizationResult.dimensions.width,
        image_height: optimizationResult.dimensions.height,
        image_file_size_bytes: optimizationResult.optimizedSize,
        image_format: optimizationResult.format,
        image_quality_score: 85, // Based on our optimization config
        image_source: 'wikimedia_commons'
      })
      .eq('id', existingImage.id)

    if (updateError) {
      throw new Error(`Failed to update existing attraction_image: ${updateError.message}`)
    }
  } else {
    // Create new record
    const { error: insertError } = await supabase
      .schema('core')
      .from('attraction_image')
      .insert({
        attraction_id: attractionId,
        image_url: mainUrl,
        thumbnail_url: thumbnailUrl,
        alt_text: `Optimized image for attraction ${attractionId}`,
        image_optimization_data: {
          originalSize: optimizationResult.originalSize,
          optimizedSize: optimizationResult.optimizedSize,
          thumbnailSize: optimizationResult.thumbnailSize,
          spaceSaved: optimizationResult.spaceSaved,
          reductionPercentage: ((optimizationResult.spaceSaved / optimizationResult.originalSize) * 100).toFixed(1),
          dimensions: optimizationResult.dimensions,
          format: optimizationResult.format,
          processedAt: new Date().toISOString(),
          originalUrl: originalWikimediaUrl
        },
        image_processing_status: 'completed',
        image_processed_at: new Date().toISOString(),
        image_width: optimizationResult.dimensions.width,
        image_height: optimizationResult.dimensions.height,
        image_file_size_bytes: optimizationResult.optimizedSize,
        image_format: optimizationResult.format,
        image_quality_score: 85,
        image_source: 'wikimedia_commons'
      })

    if (insertError) {
      throw new Error(`Failed to insert new attraction_image: ${insertError.message}`)
    }
  }

  // Then, update the attractions table with the main image URL and thumbnail
  const { error: attractionError } = await supabase
    .schema('core')
    .from('attractions')
    .update({ 
      image_url: mainUrl,
      thumbnail_url: thumbnailUrl,
      image_source: 'wikimedia_commons'
    })
    .eq('id', attractionId)

  if (attractionError) {
    throw new Error(`Failed to update attraction: ${attractionError.message}`)
  }
}

async function processWikimediaAttractionWithOptimization(
  attraction: AttractionWithWikimedia, 
  index: number, 
  total: number
): Promise<{ success: boolean; optimizationResult?: OptimizationResult; error?: string }> {
  try {
    console.log(`\n[${index + 1}/${total}] 🔄 Processing: ${attraction.name}`)
    console.log(`   Original URL: ${attraction.image_url}`)
    
    // Download image from Wikimedia
    const imageData = await downloadImageFromUrl(attraction.image_url)
    console.log(`   ✅ Downloaded image (${(imageData.byteLength / 1024 / 1024).toFixed(2)} MB)`)
    
    // Check file size limit
    if (imageData.byteLength > OPTIMIZATION_CONFIG.maxFileSize) {
      throw new Error(`Image too large: ${(imageData.byteLength / 1024 / 1024).toFixed(2)} MB (max: ${OPTIMIZATION_CONFIG.maxFileSize / 1024 / 1024} MB)`)
    }
    
    // Optimize image
    console.log(`   🔧 Optimizing image...`)
    const { optimizedData, thumbnailData, result } = await optimizeImage(imageData, attraction.image_url)
    
    console.log(`   📊 Optimization results:`)
    console.log(`      Original: ${(result.originalSize / 1024 / 1024).toFixed(2)} MB`)
    console.log(`      Optimized: ${(result.optimizedSize / 1024 / 1024).toFixed(2)} MB`)
    console.log(`      Thumbnail: ${(result.thumbnailSize / 1024).toFixed(2)} KB`)
    console.log(`      Space saved: ${(result.spaceSaved / 1024 / 1024).toFixed(2)} MB (${((result.spaceSaved / result.originalSize) * 100).toFixed(1)}%)`)
    console.log(`      Dimensions: ${result.dimensions.width}x${result.dimensions.height}`)
    
    // Upload optimized images
    console.log(`   📤 Uploading optimized images...`)
    const { mainUrl, thumbnailUrl } = await uploadOptimizedImages(
      attraction.id, 
      attraction.image_url, 
      optimizedData, 
      thumbnailData, 
      result
    )
    
    console.log(`   ✅ Uploaded to Supabase:`)
    console.log(`      Main: ${mainUrl}`)
    console.log(`      Thumbnail: ${thumbnailUrl}`)
    
    // Update attraction table
    await updateAttractionWithOptimizedImages(attraction.id, mainUrl, thumbnailUrl, result, attraction.image_url)
    console.log(`   ✅ Updated attraction and attraction_image tables`)
    
    return { success: true, optimizationResult: result }
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error(`   ❌ Error processing ${attraction.name}:`, errorMessage)
    return { success: false, error: errorMessage }
  }
}

async function migrateAndOptimizeWikimediaImages() {
  console.log('🚀 Starting Wikimedia images migration with optimization...')
  console.log('=' .repeat(60))
  
  // Check initial status
  const { count: initialWikimediaCount } = await supabase
    .schema('core')
    .from('attractions')
    .select('*', { count: 'exact', head: true })
    .like('image_url', '%upload.wikimedia.org%')
  
  console.log(`📊 Initial status: ${initialWikimediaCount} Wikimedia URLs found`)
  console.log(`🔧 Optimization config:`)
  console.log(`   Max dimensions: ${OPTIMIZATION_CONFIG.maxWidth}x${OPTIMIZATION_CONFIG.maxHeight}`)
  console.log(`   Quality: ${OPTIMIZATION_CONFIG.quality}%`)
  console.log(`   Thumbnail size: ${OPTIMIZATION_CONFIG.thumbnailSize}x${OPTIMIZATION_CONFIG.thumbnailSize}`)
  console.log(`   Max file size: ${OPTIMIZATION_CONFIG.maxFileSize / 1024 / 1024} MB`)
  
  // Get attractions with actual Wikimedia URLs
  const { data: attractions, error } = await supabase
    .schema('core')
    .from('attractions')
    .select('id, name, image_url')
    .like('image_url', '%upload.wikimedia.org%')
    .limit(10) // Start with 10 for testing
  
  if (error) {
    console.error('Error fetching attractions:', error)
    return
  }

  console.log(`📊 Found ${attractions?.length || 0} attractions with Wikimedia URLs to process`)
  
  if (!attractions || attractions.length === 0) {
    console.log('✅ No Wikimedia URLs found to process!')
    return
  }
  
  let successCount = 0
  let errorCount = 0
  let totalSpaceSaved = 0
  let totalOriginalSize = 0
  let totalOptimizedSize = 0

  for (let i = 0; i < attractions.length; i++) {
    const attraction = attractions[i]
    const result = await processWikimediaAttractionWithOptimization(attraction, i, attractions.length)
    
    if (result.success && result.optimizationResult) {
      successCount++
      totalSpaceSaved += result.optimizationResult.spaceSaved
      totalOriginalSize += result.optimizationResult.originalSize
      totalOptimizedSize += result.optimizationResult.optimizedSize
    } else {
      errorCount++
    }
    
    // Wait 2 seconds between requests
    if (i < attractions.length - 1) {
      console.log('   ⏳ Waiting 2 seconds...')
      await new Promise(resolve => setTimeout(resolve, 2000))
    }
  }

  // Check final status
  const { count: finalWikimediaCount } = await supabase
    .schema('core')
    .from('attractions')
    .select('*', { count: 'exact', head: true })
    .like('image_url', '%upload.wikimedia.org%')

  console.log(`\n📊 Migration and Optimization Summary:`)
  console.log('=' .repeat(60))
  console.log(`   ✅ Successful: ${successCount}`)
  console.log(`   ❌ Failed: ${errorCount}`)
  console.log(`   📊 Total processed: ${successCount + errorCount}`)
  console.log(`   🎯 Wikimedia URLs before: ${initialWikimediaCount}`)
  console.log(`   🎯 Wikimedia URLs after: ${finalWikimediaCount}`)
  console.log(`   📉 Wikimedia URLs reduced: ${initialWikimediaCount - finalWikimediaCount}`)
  
  if (successCount > 0) {
    console.log(`\n💾 Space Optimization Results:`)
    console.log(`   📏 Total original size: ${(totalOriginalSize / 1024 / 1024).toFixed(2)} MB`)
    console.log(`   📏 Total optimized size: ${(totalOptimizedSize / 1024 / 1024).toFixed(2)} MB`)
    console.log(`   💰 Total space saved: ${(totalSpaceSaved / 1024 / 1024).toFixed(2)} MB`)
    console.log(`   📈 Average reduction: ${((totalSpaceSaved / totalOriginalSize) * 100).toFixed(1)}%`)
  }
}

migrateAndOptimizeWikimediaImages()
