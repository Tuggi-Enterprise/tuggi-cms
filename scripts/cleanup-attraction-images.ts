#!/usr/bin/env tsx

/**
 * Cleanup Attraction Images
 * 
 * This script identifies and cleans up orphaned and duplicate records
 * in the attraction_image table to maintain a 1:1 relationship with attractions.
 * 
 * Usage: npx tsx scripts/cleanup-attraction-images.ts
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config()

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface AttractionImageRecord {
  id: string
  attraction_id: string
  image_url: string | null
  photo_reference: string | null
  created_at: string
}

interface AttractionRecord {
  id: string
  name: string
  image_url: string | null
}

async function analyzeDataIntegrity(): Promise<void> {
  console.log('🔍 Analyzing data integrity...')
  
  // Count attractions
  const { count: attractionCount, error: attractionError } = await supabase
    .schema('core')
    .from('attractions')
    .select('*', { count: 'exact', head: true })

  if (attractionError) {
    console.error('❌ Error counting attractions:', attractionError)
    throw attractionError
  }

  // Count attraction_images
  const { count: imageCount, error: imageError } = await supabase
    .schema('core')
    .from('attraction_image')
    .select('*', { count: 'exact', head: true })

  if (imageError) {
    console.error('❌ Error counting attraction_images:', imageError)
    throw imageError
  }

  console.log(`📊 Current state:`)
  console.log(`   🏢 Attractions: ${attractionCount}`)
  console.log(`   🖼️  Attraction Images: ${imageCount}`)
  console.log(`   📈 Ratio: ${(imageCount! / attractionCount!).toFixed(2)}:1`)
  console.log(`   🎯 Expected: 1:1`)
}

async function findOrphanedImages(): Promise<AttractionImageRecord[]> {
  console.log('\n🔍 Finding orphaned attraction_image records...')
  
  // Get all attraction_image records
  const { data: allImages, error: allImagesError } = await supabase
    .schema('core')
    .from('attraction_image')
    .select('id, attraction_id, image_url, photo_reference, created_at')

  if (allImagesError) {
    console.error('❌ Error fetching attraction_images:', allImagesError)
    throw allImagesError
  }

  // Get all attraction IDs
  const { data: allAttractions, error: allAttractionsError } = await supabase
    .schema('core')
    .from('attractions')
    .select('id')

  if (allAttractionsError) {
    console.error('❌ Error fetching attractions:', allAttractionsError)
    throw allAttractionsError
  }

  const attractionIds = new Set(allAttractions?.map(a => a.id) || [])
  const orphanedImages = allImages?.filter(img => !attractionIds.has(img.attraction_id)) || []

  console.log(`📊 Orphaned images found: ${orphanedImages.length}`)
  
  if (orphanedImages.length > 0) {
    console.log(`\n📋 Sample orphaned records:`)
    orphanedImages.slice(0, 5).forEach((img, index) => {
      console.log(`   ${index + 1}. ID: ${img.id}, Attraction ID: ${img.attraction_id}`)
    })
    if (orphanedImages.length > 5) {
      console.log(`   ... and ${orphanedImages.length - 5} more`)
    }
  }

  return orphanedImages
}

async function findDuplicateImages(): Promise<Map<string, AttractionImageRecord[]>> {
  console.log('\n🔍 Finding duplicate attraction_image records...')
  
  // Get all attraction_image records
  const { data: allImages, error: allImagesError } = await supabase
    .schema('core')
    .from('attraction_image')
    .select('id, attraction_id, image_url, photo_reference, created_at')

  if (allImagesError) {
    console.error('❌ Error fetching attraction_images:', allImagesError)
    throw allImagesError
  }

  // Group by attraction_id
  const imagesByAttraction = new Map<string, AttractionImageRecord[]>()
  
  allImages?.forEach(img => {
    if (!imagesByAttraction.has(img.attraction_id)) {
      imagesByAttraction.set(img.attraction_id, [])
    }
    imagesByAttraction.get(img.attraction_id)!.push(img)
  })

  // Find attractions with multiple images
  const duplicates = new Map<string, AttractionImageRecord[]>()
  let totalDuplicateRecords = 0

  imagesByAttraction.forEach((images, attractionId) => {
    if (images.length > 1) {
      duplicates.set(attractionId, images)
      totalDuplicateRecords += images.length
    }
  })

  console.log(`📊 Attractions with multiple images: ${duplicates.size}`)
  console.log(`📊 Total duplicate records: ${totalDuplicateRecords}`)

  if (duplicates.size > 0) {
    console.log(`\n📋 Sample duplicate records:`)
    let count = 0
    for (const [attractionId, images] of duplicates) {
      if (count >= 3) break
      console.log(`   Attraction ${attractionId}: ${images.length} images`)
      images.forEach((img, index) => {
        console.log(`     ${index + 1}. ID: ${img.id}, Created: ${img.created_at}`)
      })
      count++
    }
    if (duplicates.size > 3) {
      console.log(`   ... and ${duplicates.size - 3} more attractions with duplicates`)
    }
  }

  return duplicates
}

async function findAttractionsWithoutImages(): Promise<AttractionRecord[]> {
  console.log('\n🔍 Finding attractions without images...')
  
  // Get all attractions
  const { data: allAttractions, error: allAttractionsError } = await supabase
    .schema('core')
    .from('attractions')
    .select('id, name, image_url')

  if (allAttractionsError) {
    console.error('❌ Error fetching attractions:', allAttractionsError)
    throw allAttractionsError
  }

  // Get all attraction_image records
  const { data: allImages, error: allImagesError } = await supabase
    .schema('core')
    .from('attraction_image')
    .select('attraction_id')

  if (allImagesError) {
    console.error('❌ Error fetching attraction_images:', allImagesError)
    throw allImagesError
  }

  const imageAttractionIds = new Set(allImages?.map(img => img.attraction_id) || [])
  const attractionsWithoutImages = allAttractions?.filter(attraction => 
    !imageAttractionIds.has(attraction.id)
  ) || []

  console.log(`📊 Attractions without images: ${attractionsWithoutImages.length}`)
  
  if (attractionsWithoutImages.length > 0) {
    console.log(`\n📋 Sample attractions without images:`)
    attractionsWithoutImages.slice(0, 5).forEach((attraction, index) => {
      console.log(`   ${index + 1}. ${attraction.name} (${attraction.id})`)
    })
    if (attractionsWithoutImages.length > 5) {
      console.log(`   ... and ${attractionsWithoutImages.length - 5} more`)
    }
  }

  return attractionsWithoutImages
}

async function cleanupOrphanedImages(orphanedImages: AttractionImageRecord[]): Promise<void> {
  if (orphanedImages.length === 0) {
    console.log('\n✅ No orphaned images to clean up')
    return
  }

  console.log(`\n🧹 Cleaning up ${orphanedImages.length} orphaned images...`)
  
  const orphanedIds = orphanedImages.map(img => img.id)
  
  // Delete in batches to avoid overwhelming the database
  const batchSize = 100
  let deletedCount = 0
  
  for (let i = 0; i < orphanedIds.length; i += batchSize) {
    const batch = orphanedIds.slice(i, i + batchSize)
    
    const { error } = await supabase
      .schema('core')
      .from('attraction_image')
      .delete()
      .in('id', batch)

    if (error) {
      console.error(`❌ Error deleting batch ${Math.floor(i / batchSize) + 1}:`, error)
      continue
    }

    deletedCount += batch.length
    console.log(`   ✅ Deleted batch ${Math.floor(i / batchSize) + 1}: ${batch.length} records`)
  }

  console.log(`✅ Successfully deleted ${deletedCount} orphaned images`)
}

async function cleanupDuplicateImages(duplicates: Map<string, AttractionImageRecord[]>): Promise<void> {
  if (duplicates.size === 0) {
    console.log('\n✅ No duplicate images to clean up')
    return
  }

  console.log(`\n🧹 Cleaning up duplicates for ${duplicates.size} attractions...`)
  
  let totalDeleted = 0
  
  for (const [attractionId, images] of duplicates) {
    // Sort by created_at to keep the oldest record
    const sortedImages = images.sort((a, b) => 
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    )
    
    // Keep the first (oldest) record, delete the rest
    const toDelete = sortedImages.slice(1)
    
    if (toDelete.length > 0) {
      const idsToDelete = toDelete.map(img => img.id)
      
      const { error } = await supabase
        .schema('core')
        .from('attraction_image')
        .delete()
        .in('id', idsToDelete)

      if (error) {
        console.error(`❌ Error deleting duplicates for attraction ${attractionId}:`, error)
        continue
      }

      totalDeleted += idsToDelete.length
      console.log(`   ✅ Attraction ${attractionId}: kept 1, deleted ${idsToDelete.length}`)
    }
  }

  console.log(`✅ Successfully deleted ${totalDeleted} duplicate images`)
}

async function main(): Promise<void> {
  console.log('🧹 Attraction Images Cleanup')
  console.log('============================')
  
  try {
    // Analyze current state
    await analyzeDataIntegrity()
    
    // Find issues
    const orphanedImages = await findOrphanedImages()
    const duplicates = await findDuplicateImages()
    const attractionsWithoutImages = await findAttractionsWithoutImages()
    
    // Summary
    console.log(`\n📊 Summary:`)
    console.log(`   🏢 Total attractions: ${orphanedImages.length + duplicates.size + attractionsWithoutImages.length}`)
    console.log(`   🗑️  Orphaned images: ${orphanedImages.length}`)
    console.log(`   🔄 Duplicate images: ${duplicates.size} attractions affected`)
    console.log(`   ❌ Attractions without images: ${attractionsWithoutImages.length}`)
    
    if (orphanedImages.length === 0 && duplicates.size === 0) {
      console.log(`\n✅ No cleanup needed! Data integrity is good.`)
      return
    }
    
    // Ask for confirmation (in a real scenario)
    console.log(`\n⚠️  This will delete ${orphanedImages.length} orphaned records and clean up duplicates.`)
    console.log(`   Proceeding with cleanup...`)
    
    // Perform cleanup
    await cleanupOrphanedImages(orphanedImages)
    await cleanupDuplicateImages(duplicates)
    
    // Final analysis
    console.log(`\n🔍 Final analysis:`)
    await analyzeDataIntegrity()
    
    console.log(`\n✅ Cleanup completed!`)
    
  } catch (error) {
    console.error('❌ Cleanup failed:', error)
    process.exit(1)
  }
}

// Run the cleanup
if (require.main === module) {
  main()
}
