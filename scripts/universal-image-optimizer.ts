import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'
import dotenv from 'dotenv'

dotenv.config()

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface ImageSource {
  id: string
  name: string
  image_url: string
  image_source?: string
  needsOptimization: boolean
  source: 'supabase' | 'external' | 'google' | 'wikimedia'
}

interface OptimizationResult {
  originalSize: number
  optimizedSize: number
  thumbnailSize: number
  spaceSaved: number
  dimensions: { width: number; height: number }
  format: string
  needsOptimization: boolean
}

// Configurações de otimização
const OPTIMIZATION_CONFIG = {
  maxWidth: 1024,
  maxHeight: 1024,
  quality: 85,
  thumbnailSize: 300,
  thumbnailQuality: 80,
  maxFileSize: 50 * 1024 * 1024, // 50MB máximo
  minOptimizationThreshold: 0.1 // 10% - só otimiza se economizar pelo menos 10%
}

async function analyzeImageSource(imageUrl: string): Promise<{
  source: 'supabase' | 'external' | 'google' | 'wikimedia'
  needsOptimization: boolean
}> {
  if (imageUrl.includes('supabase.co')) {
    return { source: 'supabase', needsOptimization: true }
  } else if (imageUrl.includes('googleusercontent.com')) {
    return { source: 'google', needsOptimization: true }
  } else if (imageUrl.includes('upload.wikimedia.org')) {
    return { source: 'wikimedia', needsOptimization: true }
  } else {
    return { source: 'external', needsOptimization: true }
  }
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

async function optimizeImageWithSharp(imageData: ArrayBuffer, originalUrl: string): Promise<{
  optimizedData: ArrayBuffer
  thumbnailData: ArrayBuffer
  result: OptimizationResult
}> {
  const originalSize = imageData.byteLength
  const buffer = Buffer.from(imageData)
  
  // Get original image metadata
  const metadata = await sharp(buffer).metadata()
  console.log(`   📏 Original: ${metadata.width}x${metadata.height} (${(originalSize / 1024 / 1024).toFixed(2)} MB)`)
  
  // Check if image needs optimization
  const needsOptimization = 
    (metadata.width && metadata.width > OPTIMIZATION_CONFIG.maxWidth) ||
    (metadata.height && metadata.height > OPTIMIZATION_CONFIG.maxHeight) ||
    originalSize > (OPTIMIZATION_CONFIG.maxWidth * OPTIMIZATION_CONFIG.maxHeight * 0.5) // Rough estimate
  
  if (!needsOptimization) {
    console.log(`   ✅ Image already optimized, skipping...`)
    return {
      optimizedData: imageData,
      thumbnailData: imageData,
      result: {
        originalSize,
        optimizedSize: originalSize,
        thumbnailSize: originalSize,
        spaceSaved: 0,
        dimensions: { width: metadata.width || 0, height: metadata.height || 0 },
        format: metadata.format || 'jpeg',
        needsOptimization: false
      }
    }
  }
  
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
  
  console.log(`   📏 Optimized: ${optimizedMetadata.width}x${optimizedMetadata.height} (${(optimizedSize / 1024 / 1024).toFixed(2)} MB)`)
  console.log(`   📏 Thumbnail: ${thumbnailMetadata.width}x${thumbnailMetadata.height} (${(thumbnailSize / 1024).toFixed(2)} KB)`)
  
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
      format: optimizedMetadata.format || 'jpeg',
      needsOptimization: true
    }
  }
}

async function deleteOldImageFromStorage(imageUrl: string): Promise<void> {
  try {
    // Extract path from Supabase URL
    if (imageUrl.includes('supabase.co')) {
      const urlParts = imageUrl.split('/storage/v1/object/public/travel-app-images/')
      if (urlParts.length === 2) {
        const storagePath = urlParts[1]
        console.log(`   🗑️ Deleting old image: ${storagePath}`)
        
        const { error } = await supabase.storage
          .from('travel-app-images')
          .remove([storagePath])
        
        if (error) {
          console.warn(`   ⚠️ Failed to delete old image: ${error.message}`)
        } else {
          console.log(`   ✅ Old image deleted successfully`)
        }
      }
    } else {
      console.log(`   ℹ️ External image, skipping deletion: ${imageUrl.substring(0, 50)}...`)
    }
  } catch (error) {
    console.warn(`   ⚠️ Error deleting old image: ${error}`)
  }
}

async function uploadOptimizedImages(
  attractionId: string,
  originalUrl: string,
  optimizedData: ArrayBuffer,
  thumbnailData: ArrayBuffer,
  result: OptimizationResult,
  source: string
): Promise<{ mainUrl: string; thumbnailUrl: string; oldImageDeleted: boolean }> {
  const timestamp = Date.now()
  const fileExtension = 'jpg' // Always use jpg for optimized images
  
  // Upload imagem principal otimizada
  const mainFilename = `optimized-${attractionId.substring(0, 8)}-${timestamp}-main.${fileExtension}`
  const mainPath = `optimized/${attractionId}/${mainFilename}`
  
  const { error: mainError } = await supabase.storage
    .from('travel-app-images')
    .upload(mainPath, optimizedData, {
      contentType: 'image/jpeg',
      duplex: 'half'
    })

  if (mainError) {
    throw new Error(`Failed to upload optimized image: ${mainError.message}`)
  }

  // Upload thumbnail
  const thumbnailFilename = `optimized-${attractionId.substring(0, 8)}-${timestamp}-thumb.${fileExtension}`
  const thumbnailPath = `optimized/${attractionId}/${thumbnailFilename}`
  
  const { error: thumbnailError } = await supabase.storage
    .from('travel-app-images')
    .upload(thumbnailPath, thumbnailData, {
      contentType: 'image/jpeg',
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

  // Delete old image if it's from Supabase storage
  let oldImageDeleted = false
  if (source === 'supabase') {
    await deleteOldImageFromStorage(originalUrl)
    oldImageDeleted = true
  }

  return {
    mainUrl: mainUrlData.publicUrl,
    thumbnailUrl: thumbnailUrlData.publicUrl,
    oldImageDeleted
  }
}

async function updateAttractionWithOptimizedImages(
  attractionId: string, 
  mainUrl: string, 
  thumbnailUrl: string,
  optimizationResult: OptimizationResult,
  originalUrl: string,
  source: string
): Promise<void> {
  // Update attraction_image table
  const { data: existingImage, error: checkError } = await supabase
    .schema('core')
    .from('attraction_image')
    .select('id')
    .eq('attraction_id', attractionId)
    .single()

  if (checkError && checkError.code !== 'PGRST116') {
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
          reductionPercentage: optimizationResult.spaceSaved > 0 ? 
            ((optimizationResult.spaceSaved / optimizationResult.originalSize) * 100).toFixed(1) : '0',
          dimensions: optimizationResult.dimensions,
          format: optimizationResult.format,
          processedAt: new Date().toISOString(),
          originalUrl: originalUrl,
          source: source
        },
        image_processing_status: 'completed',
        image_processed_at: new Date().toISOString(),
        image_width: optimizationResult.dimensions.width,
        image_height: optimizationResult.dimensions.height,
        image_file_size_bytes: optimizationResult.optimizedSize,
        image_format: optimizationResult.format,
        image_quality_score: 85,
        image_source: source
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
          reductionPercentage: optimizationResult.spaceSaved > 0 ? 
            ((optimizationResult.spaceSaved / optimizationResult.originalSize) * 100).toFixed(1) : '0',
          dimensions: optimizationResult.dimensions,
          format: optimizationResult.format,
          processedAt: new Date().toISOString(),
          originalUrl: originalUrl,
          source: source
        },
        image_processing_status: 'completed',
        image_processed_at: new Date().toISOString(),
        image_width: optimizationResult.dimensions.width,
        image_height: optimizationResult.dimensions.height,
        image_file_size_bytes: optimizationResult.optimizedSize,
        image_format: optimizationResult.format,
        image_quality_score: 85,
        image_source: source
      })

    if (insertError) {
      throw new Error(`Failed to insert new attraction_image: ${insertError.message}`)
    }
  }

  // Update attractions table
  const { error: attractionError } = await supabase
    .schema('core')
    .from('attractions')
    .update({ 
      image_url: mainUrl,
      thumbnail_url: thumbnailUrl,
      image_source: source
    })
    .eq('id', attractionId)

  if (attractionError) {
    throw new Error(`Failed to update attraction: ${attractionError.message}`)
  }
}

async function processAttractionImage(
  attraction: ImageSource, 
  index: number, 
  total: number
): Promise<{ success: boolean; optimizationResult?: OptimizationResult; error?: string }> {
  try {
    console.log(`\n[${index + 1}/${total}] 🔄 Processing: ${attraction.name}`)
    console.log(`   Source: ${attraction.source} | URL: ${attraction.image_url.substring(0, 80)}...`)
    
    // Download image
    const imageData = await downloadImageFromUrl(attraction.image_url)
    console.log(`   ✅ Downloaded (${(imageData.byteLength / 1024 / 1024).toFixed(2)} MB)`)
    
    // Check file size limit
    if (imageData.byteLength > OPTIMIZATION_CONFIG.maxFileSize) {
      throw new Error(`Image too large: ${(imageData.byteLength / 1024 / 1024).toFixed(2)} MB (max: ${OPTIMIZATION_CONFIG.maxFileSize / 1024 / 1024} MB)`)
    }
    
    // Optimize image
    console.log(`   🔧 Optimizing with Sharp...`)
    const { optimizedData, thumbnailData, result } = await optimizeImageWithSharp(imageData, attraction.image_url)
    
    if (!result.needsOptimization) {
      console.log(`   ✅ Image already optimized, skipping upload`)
      return { success: true, optimizationResult: result }
    }
    
    console.log(`   📊 Optimization results:`)
    console.log(`      Space saved: ${(result.spaceSaved / 1024 / 1024).toFixed(2)} MB (${((result.spaceSaved / result.originalSize) * 100).toFixed(1)}%)`)
    
    // Upload optimized images
    console.log(`   📤 Uploading optimized images...`)
    const { mainUrl, thumbnailUrl, oldImageDeleted } = await uploadOptimizedImages(
      attraction.id, 
      attraction.image_url, 
      optimizedData, 
      thumbnailData, 
      result,
      attraction.source
    )
    
    console.log(`   ✅ Uploaded:`)
    console.log(`      Main: ${mainUrl.substring(0, 80)}...`)
    console.log(`      Thumbnail: ${thumbnailUrl.substring(0, 80)}...`)
    if (oldImageDeleted) {
      console.log(`      🗑️ Old image deleted from storage`)
    }
    
    // Update database
    await updateAttractionWithOptimizedImages(
      attraction.id, 
      mainUrl, 
      thumbnailUrl, 
      result, 
      attraction.image_url,
      attraction.source
    )
    console.log(`   ✅ Updated database`)
    
    return { success: true, optimizationResult: result }
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error(`   ❌ Error processing ${attraction.name}:`, errorMessage)
    return { success: false, error: errorMessage }
  }
}


async function getAttractionsWithImages(processAll: boolean = false): Promise<ImageSource[]> {
  console.log('🔍 Analyzing all attractions with images...')
  
  // Simple and efficient query: get all attractions that need optimization
  // 1. External URLs (wikimedia, google) that need migration
  // 2. Supabase URLs without thumbnail_url (not processed yet)
  
  let query = supabase
    .schema('core')
    .from('attractions')
    .select(`
      id, 
      name, 
      image_url, 
      image_source,
      thumbnail_url
    `)
    .not('image_url', 'is', null)
    .or('image_url.like.%upload.wikimedia.org%,image_url.like.%googleusercontent.com%,thumbnail_url.is.null')
  
  if (!processAll) {
    query = query.limit(200) // Limited batch for testing
  }
  
  const { data: attractions, error } = await query
  
  if (error) {
    throw new Error(`Failed to fetch attractions: ${error.message}`)
  }

  console.log(`📊 Found ${attractions?.length || 0} attractions that need optimization`)

  const imageSources: ImageSource[] = []
  
  for (const attraction of attractions || []) {
    const { source, needsOptimization } = await analyzeImageSource(attraction.image_url)
    
    imageSources.push({
      id: attraction.id,
      name: attraction.name,
      image_url: attraction.image_url,
      image_source: attraction.image_source || 'unknown',
      needsOptimization,
      source
    })
  }
  
  // Group by source for reporting
  const sourceCounts = imageSources.reduce((acc, img) => {
    acc[img.source] = (acc[img.source] || 0) + 1
    return acc
  }, {} as Record<string, number>)
  
  console.log('📊 Image sources found:')
  Object.entries(sourceCounts).forEach(([source, count]) => {
    console.log(`   ${source}: ${count} images`)
  })
  
  return imageSources
}

async function universalImageOptimizer(processAll: boolean = false) {
  console.log('🚀 Starting Universal Image Optimizer...')
  console.log('=' .repeat(60))
  
  if (processAll) {
    console.log('🌐 Processing ALL images (no limit)')
  } else {
    console.log('🔍 Processing with smart filters (limited batch)')
  }
  
  try {
    // Get all attractions with images
    const imageSources = await getAttractionsWithImages(processAll)
    
    if (imageSources.length === 0) {
      console.log('✅ No images found to process!')
      return
    }
    
    console.log(`\n📊 Found ${imageSources.length} attractions with images to process`)
    console.log(`🔧 Optimization config:`)
    console.log(`   Max dimensions: ${OPTIMIZATION_CONFIG.maxWidth}x${OPTIMIZATION_CONFIG.maxHeight}`)
    console.log(`   Quality: ${OPTIMIZATION_CONFIG.quality}%`)
    console.log(`   Thumbnail size: ${OPTIMIZATION_CONFIG.thumbnailSize}x${OPTIMIZATION_CONFIG.thumbnailSize}`)
    console.log(`   Max file size: ${OPTIMIZATION_CONFIG.maxFileSize / 1024 / 1024} MB`)
    
    let successCount = 0
    let errorCount = 0
    let skippedCount = 0
    let totalSpaceSaved = 0
    let totalOriginalSize = 0
    let totalOptimizedSize = 0

    for (let i = 0; i < imageSources.length; i++) {
      const attraction = imageSources[i]
      const result = await processAttractionImage(attraction, i, imageSources.length)
      
      if (result.success && result.optimizationResult) {
        if (result.optimizationResult.needsOptimization) {
          successCount++
          totalSpaceSaved += result.optimizationResult.spaceSaved
          totalOriginalSize += result.optimizationResult.originalSize
          totalOptimizedSize += result.optimizationResult.optimizedSize
        } else {
          skippedCount++
        }
      } else {
        errorCount++
      }
      
      // Wait 2 seconds between requests
      if (i < imageSources.length - 1) {
        console.log('   ⏳ Waiting 2 seconds...')
        await new Promise(resolve => setTimeout(resolve, 2000))
      }
    }

    console.log(`\n📊 Universal Image Optimization Summary:`)
    console.log('=' .repeat(60))
    console.log(`   ✅ Successfully optimized: ${successCount}`)
    console.log(`   ⏭️ Skipped (already optimized): ${skippedCount}`)
    console.log(`   ❌ Failed: ${errorCount}`)
    console.log(`   📊 Total processed: ${successCount + skippedCount + errorCount}`)
    
    if (successCount > 0) {
      console.log(`\n💾 Space Optimization Results:`)
      console.log(`   📏 Total original size: ${(totalOriginalSize / 1024 / 1024).toFixed(2)} MB`)
      console.log(`   📏 Total optimized size: ${(totalOptimizedSize / 1024 / 1024).toFixed(2)} MB`)
      console.log(`   💰 Total space saved: ${(totalSpaceSaved / 1024 / 1024).toFixed(2)} MB`)
      console.log(`   📈 Average reduction: ${((totalSpaceSaved / totalOriginalSize) * 100).toFixed(1)}%`)
    }
    
  } catch (error) {
    console.error('❌ Fatal error:', error)
  }
}

// Check command line arguments for processing mode
const processAll = process.argv.includes('--all') || process.argv.includes('-a')

universalImageOptimizer(processAll)
