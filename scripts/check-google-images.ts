#!/usr/bin/env tsx

/**
 * Check Script: Google Images Analysis
 * 
 * This script analyzes the current state of image URLs in the attractions table
 * to identify which ones are using Google Maps API URLs vs Supabase Storage URLs.
 * 
 * Usage: npx tsx scripts/check-google-images.ts
 */

import { getSupabase } from '../lib/core/supabase-client'
import { config } from 'dotenv'

config()

const supabase = getSupabase('service')

interface ImageAnalysis {
  total: number
  withImages: number
  googleUrls: number
  supabaseUrls: number
  otherUrls: number
  noImages: number
  withPhotoRefs: number
  withGooglePlaceId: number
  readyForMigration: number
}

async function analyzeImageUrls(): Promise<ImageAnalysis> {
  console.log('🔍 Analyzing image URLs in attractions table...')
  
  // Get all attractions
  const { data: allAttractions, error: allError } = await supabase
    .schema('core')
    .from('attractions')
    .select('id, name, image_url, photos_references, google_place_id')

  if (allError) {
    console.error('❌ Error fetching attractions:', allError)
    throw allError
  }

  const analysis: ImageAnalysis = {
    total: allAttractions?.length || 0,
    withImages: 0,
    googleUrls: 0,
    supabaseUrls: 0,
    otherUrls: 0,
    noImages: 0,
    withPhotoRefs: 0,
    withGooglePlaceId: 0,
    readyForMigration: 0
  }

  allAttractions?.forEach(attraction => {
    if (attraction.image_url) {
      analysis.withImages++
      
      if (attraction.image_url.includes('maps.googleapis.com')) {
        analysis.googleUrls++
      } else if (attraction.image_url.includes('supabase')) {
        analysis.supabaseUrls++
      } else {
        analysis.otherUrls++
      }
    } else {
      analysis.noImages++
    }

    if (attraction.photos_references && attraction.photos_references.length > 0) {
      analysis.withPhotoRefs++
    }

    if (attraction.google_place_id) {
      analysis.withGooglePlaceId++
    }

    // Ready for migration: has Google URL and Google Place ID (photo refs will be in attraction_image table)
    if (attraction.image_url?.includes('maps.googleapis.com') && 
        attraction.google_place_id) {
      analysis.readyForMigration++
    }
  })

  return analysis
}

async function showDetailedBreakdown(): Promise<void> {
  console.log('\n📋 Detailed Breakdown:')
  
  // Show attractions with Google URLs
  const { data: googleAttractions, error: googleError } = await supabase
    .schema('core')
    .from('attractions')
    .select('id, name, image_url, photos_references, google_place_id')
    .not('image_url', 'is', null)
    .like('image_url', '%maps.googleapis.com%')
    .limit(10)

  if (googleError) {
    console.error('❌ Error fetching Google URL attractions:', googleError)
    return
  }

  if (googleAttractions && googleAttractions.length > 0) {
    console.log(`\n🔗 Sample attractions with Google URLs (showing first 10):`)
    googleAttractions.forEach((attraction, index) => {
      const hasPhotoRefs = attraction.photos_references && attraction.photos_references.length > 0
      const hasGooglePlaceId = !!attraction.google_place_id
      const readyForMigration = hasPhotoRefs && hasGooglePlaceId
      
      console.log(`   ${index + 1}. ${attraction.name}`)
      console.log(`      ID: ${attraction.id}`)
      console.log(`      Photo refs: ${hasPhotoRefs ? '✅' : '❌'} (${attraction.photos_references?.length || 0})`)
      console.log(`      Google Place ID: ${hasGooglePlaceId ? '✅' : '❌'}`)
      console.log(`      Ready for migration: ${readyForMigration ? '✅' : '❌'}`)
      console.log(`      URL: ${attraction.image_url}`)
      console.log('')
    })
  }

  // Show attractions with Supabase URLs
  const { data: supabaseAttractions, error: supabaseError } = await supabase
    .schema('core')
    .from('attractions')
    .select('id, name, image_url')
    .not('image_url', 'is', null)
    .like('image_url', '%supabase%')
    .limit(5)

  if (supabaseError) {
    console.error('❌ Error fetching Supabase URL attractions:', supabaseError)
    return
  }

  if (supabaseAttractions && supabaseAttractions.length > 0) {
    console.log(`\n🗄️  Sample attractions with Supabase URLs (showing first 5):`)
    supabaseAttractions.forEach((attraction, index) => {
      console.log(`   ${index + 1}. ${attraction.name}`)
      console.log(`      URL: ${attraction.image_url}`)
    })
  }
}

async function main(): Promise<void> {
  console.log('📊 Google Images Analysis')
  console.log('=========================')
  
  try {
    const analysis = await analyzeImageUrls()
    
    console.log('\n📈 Analysis Results:')
    console.log(`   📊 Total attractions: ${analysis.total}`)
    console.log(`   🖼️  With images: ${analysis.withImages}`)
    console.log(`   🔗 Google Maps URLs: ${analysis.googleUrls}`)
    console.log(`   🗄️  Supabase URLs: ${analysis.supabaseUrls}`)
    console.log(`   🌐 Other URLs: ${analysis.otherUrls}`)
    console.log(`   ❌ No images: ${analysis.noImages}`)
    console.log(`   📸 With photo references: ${analysis.withPhotoRefs}`)
    console.log(`   🏢 With Google Place ID: ${analysis.withGooglePlaceId}`)
    console.log(`   ✅ Ready for migration: ${analysis.readyForMigration}`)
    
    // Calculate percentages
    const googlePercentage = analysis.total > 0 ? ((analysis.googleUrls / analysis.total) * 100).toFixed(1) : '0'
    const supabasePercentage = analysis.total > 0 ? ((analysis.supabaseUrls / analysis.total) * 100).toFixed(1) : '0'
    const readyPercentage = analysis.total > 0 ? ((analysis.readyForMigration / analysis.total) * 100).toFixed(1) : '0'
    
    console.log('\n📊 Percentages:')
    console.log(`   🔗 Google URLs: ${googlePercentage}%`)
    console.log(`   🗄️  Supabase URLs: ${supabasePercentage}%`)
    console.log(`   ✅ Ready for migration: ${readyPercentage}%`)
    
    if (analysis.readyForMigration > 0) {
      console.log(`\n🚀 Migration Recommendation:`)
      console.log(`   ${analysis.readyForMigration} attractions are ready for migration`)
      console.log(`   Run: npx tsx scripts/migrate-google-images-to-supabase.ts`)
    } else {
      console.log(`\n✅ No attractions need migration`)
    }
    
    // Show detailed breakdown
    await showDetailedBreakdown()
    
  } catch (error) {
    console.error('❌ Analysis failed:', error)
    process.exit(1)
  }
}

// Run the analysis
if (require.main === module) {
  main()
}
