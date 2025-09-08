#!/usr/bin/env tsx

/**
 * Simple Check Images
 * 
 * This script checks the current state of images in both tables
 * without complex queries that might cause connection issues.
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config()

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function checkAttractionsTable(): Promise<void> {
  console.log('🔍 Checking attractions table...')
  
  // Get count of attractions with Google URLs
  const { count: googleCount, error: googleError } = await supabase
    .schema('core')
    .from('attractions')
    .select('*', { count: 'exact', head: true })
    .not('image_url', 'is', null)
    .like('image_url', '%maps.googleapis.com%')

  if (googleError) {
    console.error('❌ Error counting Google URLs:', googleError)
    return
  }

  // Get count of attractions with Supabase URLs
  const { count: supabaseCount, error: supabaseError } = await supabase
    .schema('core')
    .from('attractions')
    .select('*', { count: 'exact', head: true })
    .not('image_url', 'is', null)
    .like('image_url', '%supabase%')

  if (supabaseError) {
    console.error('❌ Error counting Supabase URLs:', supabaseError)
    return
  }

  console.log(`📊 Attractions table:`)
  console.log(`   🔗 Google URLs: ${googleCount}`)
  console.log(`   🗄️  Supabase URLs: ${supabaseCount}`)
}

async function checkAttractionImageTable(): Promise<void> {
  console.log('\n🔍 Checking attraction_image table...')
  
  // Get count of records with photo_reference
  const { count: photoRefCount, error: photoRefError } = await supabase
    .schema('core')
    .from('attraction_image')
    .select('*', { count: 'exact', head: true })
    .not('photo_reference', 'is', null)

  if (photoRefError) {
    console.error('❌ Error counting photo references:', photoRefError)
    return
  }

  // Get count of records with Supabase URLs
  const { count: supabaseImageCount, error: supabaseImageError } = await supabase
    .schema('core')
    .from('attraction_image')
    .select('*', { count: 'exact', head: true })
    .not('image_url', 'is', null)
    .like('image_url', '%supabase%')

  if (supabaseImageError) {
    console.error('❌ Error counting Supabase image URLs:', supabaseImageError)
    return
  }

  // Get count of records with Google URLs
  const { count: googleImageCount, error: googleImageError } = await supabase
    .schema('core')
    .from('attraction_image')
    .select('*', { count: 'exact', head: true })
    .not('image_url', 'is', null)
    .like('image_url', '%maps.googleapis.com%')

  if (googleImageError) {
    console.error('❌ Error counting Google image URLs:', googleImageError)
    return
  }

  console.log(`📊 attraction_image table:`)
  console.log(`   📸 With photo_reference: ${photoRefCount}`)
  console.log(`   🗄️  With Supabase URLs: ${supabaseImageCount}`)
  console.log(`   🔗 With Google URLs: ${googleImageCount}`)
}

async function showSampleData(): Promise<void> {
  console.log('\n📋 Sample data from attraction_image table:')
  
  // Get a few sample records
  const { data: sampleData, error: sampleError } = await supabase
    .schema('core')
    .from('attraction_image')
    .select('id, attraction_id, image_url, photo_reference')
    .limit(5)

  if (sampleError) {
    console.error('❌ Error fetching sample data:', sampleError)
    return
  }

  sampleData?.forEach((record, index) => {
    console.log(`   ${index + 1}. Attraction ID: ${record.attraction_id}`)
    console.log(`      Image URL: ${record.image_url?.substring(0, 80)}...`)
    console.log(`      Photo Reference: ${record.photo_reference ? '✅' : '❌'}`)
    console.log('')
  })
}

async function main(): Promise<void> {
  console.log('📊 Simple Image Check')
  console.log('====================')
  
  try {
    await checkAttractionsTable()
    await checkAttractionImageTable()
    await showSampleData()
    
    console.log('\n✅ Check completed!')
    
  } catch (error) {
    console.error('❌ Check failed:', error)
    process.exit(1)
  }
}

// Run the check
if (require.main === module) {
  main()
}
