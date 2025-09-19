import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface OrphanedImage {
  path: string
  size: number
  lastModified: string
}

async function findOrphanedImages(): Promise<OrphanedImage[]> {
  console.log('🔍 Scanning storage for orphaned images...')
  
  // Get all images from storage
  const { data: storageFiles, error: storageError } = await supabase.storage
    .from('travel-app-images')
    .list('', {
      limit: 1000,
      sortBy: { column: 'created_at', order: 'desc' }
    })

  if (storageError) {
    throw new Error(`Failed to list storage files: ${storageError.message}`)
  }

  console.log(`📊 Found ${storageFiles?.length || 0} files in storage`)

  // Get all image URLs from database
  const { data: dbImages, error: dbError } = await supabase
    .schema('core')
    .from('attractions')
    .select('image_url, thumbnail_url')
    .not('image_url', 'is', null)

  if (dbError) {
    throw new Error(`Failed to fetch database images: ${dbError.message}`)
  }

  // Get all image URLs from attraction_image table
  const { data: dbImageRefs, error: dbRefError } = await supabase
    .schema('core')
    .from('attraction_image')
    .select('image_url, thumbnail_url')
    .not('image_url', 'is', null)

  if (dbRefError) {
    throw new Error(`Failed to fetch attraction_image references: ${dbRefError.message}`)
  }

  // Collect all referenced URLs
  const referencedUrls = new Set<string>()
  
  // Add URLs from attractions table
  dbImages?.forEach(attraction => {
    if (attraction.image_url) referencedUrls.add(attraction.image_url)
    if (attraction.thumbnail_url) referencedUrls.add(attraction.thumbnail_url)
  })
  
  // Add URLs from attraction_image table
  dbImageRefs?.forEach(imageRef => {
    if (imageRef.image_url) referencedUrls.add(imageRef.image_url)
    if (imageRef.thumbnail_url) referencedUrls.add(imageRef.thumbnail_url)
  })

  console.log(`📊 Found ${referencedUrls.size} referenced URLs in database`)

  // Find orphaned files
  const orphanedImages: OrphanedImage[] = []
  
  for (const file of storageFiles || []) {
    if (file.name && file.metadata) {
      const filePath = file.name
      const fullUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/travel-app-images/${filePath}`
      
      // Check if this file is referenced in the database
      const isReferenced = Array.from(referencedUrls).some(url => 
        url.includes(filePath) || filePath.includes(url.split('/').pop() || '')
      )
      
      if (!isReferenced) {
        orphanedImages.push({
          path: filePath,
          size: file.metadata.size || 0,
          lastModified: file.updated_at || file.created_at || 'unknown'
        })
      }
    }
  }

  return orphanedImages
}

async function deleteOrphanedImages(orphanedImages: OrphanedImage[]): Promise<{
  deleted: number
  failed: number
  totalSize: number
}> {
  if (orphanedImages.length === 0) {
    console.log('✅ No orphaned images found!')
    return { deleted: 0, failed: 0, totalSize: 0 }
  }

  console.log(`\n🗑️ Found ${orphanedImages.length} orphaned images:`)
  
  let totalSize = 0
  orphanedImages.forEach((img, index) => {
    console.log(`   [${index + 1}] ${img.path} (${(img.size / 1024 / 1024).toFixed(2)} MB)`)
    totalSize += img.size
  })

  console.log(`\n📊 Total orphaned size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`)
  
  // Ask for confirmation (in a real script, you might want to add a prompt)
  console.log('\n⚠️ This will permanently delete orphaned images!')
  console.log('🔄 Proceeding with deletion...')

  let deleted = 0
  let failed = 0

  for (const orphanedImage of orphanedImages) {
    try {
      console.log(`🗑️ Deleting: ${orphanedImage.path}`)
      
      const { error } = await supabase.storage
        .from('travel-app-images')
        .remove([orphanedImage.path])

      if (error) {
        console.error(`   ❌ Failed to delete: ${error.message}`)
        failed++
      } else {
        console.log(`   ✅ Deleted successfully`)
        deleted++
      }
    } catch (error) {
      console.error(`   ❌ Error deleting ${orphanedImage.path}:`, error)
      failed++
    }
  }

  return { deleted, failed, totalSize }
}

async function cleanupOrphanedImages() {
  console.log('🧹 Starting Orphaned Images Cleanup...')
  console.log('=' .repeat(50))
  
  try {
    // Find orphaned images
    const orphanedImages = await findOrphanedImages()
    
    // Delete orphaned images
    const result = await deleteOrphanedImages(orphanedImages)
    
    console.log(`\n📊 Cleanup Summary:`)
    console.log('=' .repeat(50))
    console.log(`   ✅ Successfully deleted: ${result.deleted}`)
    console.log(`   ❌ Failed to delete: ${result.failed}`)
    console.log(`   💰 Space freed: ${(result.totalSize / 1024 / 1024).toFixed(2)} MB`)
    
    if (result.deleted > 0) {
      console.log(`\n🎉 Cleanup completed! Freed ${(result.totalSize / 1024 / 1024).toFixed(2)} MB of storage space.`)
    } else {
      console.log(`\n✅ No cleanup needed - all images are properly referenced.`)
    }
    
  } catch (error) {
    console.error('❌ Cleanup failed:', error)
  }
}

cleanupOrphanedImages()
