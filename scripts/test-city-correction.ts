#!/usr/bin/env tsx

/**
 * Test City Correction Service
 * 
 * Script to test and execute city corrections using free geocoding APIs
 * 
 * Usage:
 * npm run tsx scripts/test-city-correction.ts
 */

import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { CityCorrectionService, resetRateLimiters, getRateLimiterStatus } from '../lib/services/poi-processing/city-correction.service'

// Load environment variables
config()

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface TestOptions {
  mode: 'single' | 'batch' | 'candidates' | 'dry_run'
  country?: string
  state?: string
  limit?: number
  poi_id?: string
}

async function main() {
  console.log('🚀 City Correction Service Test')
  console.log('===============================\n')

  // Parse command line arguments
  const args = process.argv.slice(2)
  const options: TestOptions = {
    mode: 'candidates', // default mode
    limit: 10
  }

  // Simple argument parsing
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--mode':
        options.mode = args[i + 1] as TestOptions['mode']
        i++
        break
      case '--country':
        options.country = args[i + 1]
        i++
        break
      case '--state':
        options.state = args[i + 1]
        i++
        break
      case '--limit':
        options.limit = parseInt(args[i + 1])
        i++
        break
      case '--poi-id':
        options.poi_id = args[i + 1]
        i++
        break
    }
  }

  console.log('📋 Test Configuration:')
  console.log(`   Mode: ${options.mode}`)
  console.log(`   Country: ${options.country || 'all'}`)
  console.log(`   State: ${options.state || 'all'}`)
  console.log(`   Limit: ${options.limit}`)
  console.log(`   POI ID: ${options.poi_id || 'auto-select'}\n`)

  try {
    switch (options.mode) {
      case 'candidates':
        await testGetCandidates(options)
        break
      case 'single':
        await testSingleCorrection(options)
        break
      case 'dry_run':
        await testDryRun(options)
        break
      case 'batch':
        await testBatchCorrection(options)
        break
      default:
        console.log('❌ Unknown mode. Use: candidates, single, dry_run, or batch')
    }
  } catch (error) {
    console.error('💥 Test failed:', error)
    process.exit(1)
  }
}

async function testGetCandidates(options: TestOptions) {
  console.log('🔍 Testing: Get POI Candidates for Correction\n')

  const pois = await CityCorrectionService.getPOIsForCorrection(
    options.limit || 10,
    options.country,
    options.state
  )

  console.log(`📊 Results: Found ${pois.length} POIs that may need correction\n`)

  if (pois.length > 0) {
    console.log('📋 Sample POIs:')
    pois.slice(0, 5).forEach((poi, index) => {
      console.log(`   ${index + 1}. ${poi.name}`)
      console.log(`      Current city: ${poi.city}`)
      console.log(`      Location: ${poi.latitude}, ${poi.longitude}`)
      console.log(`      Country: ${poi.country}`)
      console.log(`      ID: ${poi.id}\n`)
    })

    if (pois.length > 5) {
      console.log(`   ... and ${pois.length - 5} more POIs\n`)
    }

    console.log('💡 To test a specific POI, run:')
    console.log(`   npm run tsx scripts/test-city-correction.ts --mode single --poi-id ${pois[0].id}`)
  }
}

async function testSingleCorrection(options: TestOptions) {
  console.log('🎯 Testing: Single POI Correction\n')

  // Get POI to test
  let testPOI
  if (options.poi_id) {
    const pois = await CityCorrectionService.getPOIsForCorrection(1000)
    testPOI = pois.find(poi => poi.id === options.poi_id)
    if (!testPOI) {
      console.log(`❌ POI with ID ${options.poi_id} not found or doesn't need correction`)
      return
    }
  } else {
    const pois = await CityCorrectionService.getPOIsForCorrection(1, options.country, options.state)
    if (pois.length === 0) {
      console.log('❌ No POIs found that need correction')
      return
    }
    testPOI = pois[0]
  }

  console.log('🏢 Testing POI:')
  console.log(`   Name: ${testPOI.name}`)
  console.log(`   Current city: ${testPOI.city}`)
  console.log(`   Coordinates: ${testPOI.latitude}, ${testPOI.longitude}`)
  console.log(`   Country: ${testPOI.country}\n`)

  console.log('⏳ Verifying city with geocoding services...\n')

  const result = await CityCorrectionService.verifySinglePOI(testPOI, {
    confidence_threshold: 85,
    enable_cross_validation: true
  })

  console.log('📊 Verification Results:')
  console.log(`   Original city: ${result.original_city}`)
  console.log(`   Verified city: ${result.verified_city || 'No change'}`)
  console.log(`   Confidence: ${result.confidence}%`)
  console.log(`   Source: ${result.source}`)
  console.log(`   Needs correction: ${result.needs_correction ? 'YES' : 'NO'}`)
  console.log(`   Needs manual review: ${result.needs_manual_review ? 'YES' : 'NO'}`)

  if (result.error) {
    console.log(`   Error: ${result.error}`)
  }

  if (result.raw_data) {
    console.log('\n🔍 Raw Data Summary:')
    if (result.raw_data.nominatim) {
      console.log(`   Nominatim: Found city "${result.raw_data.nominatim.city}"`)
    }
    if (result.raw_data.geonames) {
      console.log(`   GeoNames: Found city "${result.raw_data.geonames.city}"`)
    }
  }

  // Show rate limiter status
  const rateLimiterStatus = getRateLimiterStatus()
  console.log('\n📈 Rate Limiter Status:')
  console.log(`   Nominatim: ${rateLimiterStatus.nominatim.requestCount}/${rateLimiterStatus.nominatim.dailyLimit} requests`)
  console.log(`   GeoNames: ${rateLimiterStatus.geonames.requestCount}/${rateLimiterStatus.geonames.dailyLimit} requests`)
}

async function testDryRun(options: TestOptions) {
  console.log('🧪 Testing: Dry Run Batch Correction\n')

  const pois = await CityCorrectionService.getPOIsForCorrection(
    options.limit || 5,
    options.country,
    options.state
  )

  if (pois.length === 0) {
    console.log('❌ No POIs found that need correction')
    return
  }

  console.log(`📦 Processing ${pois.length} POIs in dry-run mode...\n`)

  const result = await CityCorrectionService.processBatch(pois, {
    confidence_threshold: 85,
    enable_cross_validation: true,
    dry_run: true, // Don't actually apply corrections
    batch_size: 10
  })

  console.log('📊 Dry Run Results:')
  console.log(`   Total processed: ${result.total_processed}`)
  console.log(`   Would correct: ${result.corrections_applied}`)
  console.log(`   Would need manual review: ${result.manual_review_needed}`)
  console.log(`   Errors: ${result.errors}`)
  console.log(`   Processing time: ${(result.processing_time / 1000).toFixed(2)}s\n`)

  if (result.corrections_applied > 0) {
    console.log('🔧 Sample Corrections (would be applied):')
    result.results
      .filter(r => r.needs_correction)
      .slice(0, 3)
      .forEach((correction, index) => {
        console.log(`   ${index + 1}. ${correction.original_city} → ${correction.verified_city} (${correction.confidence}%)`)
      })
  }

  if (result.manual_review_needed > 0) {
    console.log('\n📋 Sample Manual Reviews (would be flagged):')
    result.results
      .filter(r => r.needs_manual_review)
      .slice(0, 3)
      .forEach((review, index) => {
        console.log(`   ${index + 1}. ${review.original_city} → ${review.verified_city} (${review.confidence}%)`)
      })
  }

  console.log('\n💡 To apply these corrections, run:')
  console.log(`   npm run tsx scripts/test-city-correction.ts --mode batch --limit ${options.limit}`)
}

async function testBatchCorrection(options: TestOptions) {
  console.log('⚡ Testing: Batch Correction (LIVE MODE)\n')
  
  console.log('⚠️  WARNING: This will make actual changes to the database!')
  console.log('   - POI cities will be updated')
  console.log('   - Audit logs will be created')
  console.log('   - Manual review records will be added\n')
  
  // Simple confirmation (in a real implementation, you might want better confirmation)
  console.log('🔄 Starting batch correction in 3 seconds...')
  await new Promise(resolve => setTimeout(resolve, 3000))

  const pois = await CityCorrectionService.getPOIsForCorrection(
    options.limit || 5,
    options.country,
    options.state
  )

  if (pois.length === 0) {
    console.log('❌ No POIs found that need correction')
    return
  }

  console.log(`📦 Processing ${pois.length} POIs with live corrections...\n`)

  const result = await CityCorrectionService.processBatch(pois, {
    confidence_threshold: 85,
    enable_cross_validation: true,
    dry_run: false, // Apply corrections
    batch_size: 10
  })

  console.log('✅ Batch Correction Results:')
  console.log(`   Total processed: ${result.total_processed}`)
  console.log(`   Corrections applied: ${result.corrections_applied}`)
  console.log(`   Manual review needed: ${result.manual_review_needed}`)
  console.log(`   Errors: ${result.errors}`)
  console.log(`   Processing time: ${(result.processing_time / 1000).toFixed(2)}s\n`)

  if (result.corrections_applied > 0) {
    console.log('✅ Applied Corrections:')
    result.results
      .filter(r => r.needs_correction)
      .forEach((correction, index) => {
        console.log(`   ${index + 1}. ${correction.original_city} → ${correction.verified_city} (${correction.confidence}%)`)
      })
  }

  if (result.manual_review_needed > 0) {
    console.log('\n📋 Manual Reviews Created:')
    result.results
      .filter(r => r.needs_manual_review)
      .forEach((review, index) => {
        console.log(`   ${index + 1}. ${review.original_city} → ${review.verified_city} (${review.confidence}%)`)
      })
  }

  if (result.errors > 0) {
    console.log('\n❌ Errors:')
    result.results
      .filter(r => r.error)
      .forEach((error, index) => {
        console.log(`   ${index + 1}. ${error.poi_id}: ${error.error}`)
      })
  }

  // Final rate limiter status
  const rateLimiterStatus = getRateLimiterStatus()
  console.log('\n📈 Final Rate Limiter Status:')
  console.log(`   Nominatim: ${rateLimiterStatus.nominatim.requestCount}/${rateLimiterStatus.nominatim.dailyLimit} requests`)
  console.log(`   GeoNames: ${rateLimiterStatus.geonames.requestCount}/${rateLimiterStatus.geonames.dailyLimit} requests`)
}

// Show usage if no arguments
if (process.argv.length <= 2) {
  console.log('🚀 City Correction Service Test')
  console.log('===============================\n')
  console.log('Usage:')
  console.log('  npm run tsx scripts/test-city-correction.ts [options]\n')
  console.log('Options:')
  console.log('  --mode <mode>       Test mode: candidates, single, dry_run, batch')
  console.log('  --country <country> Filter by country (e.g., "Brazil")')
  console.log('  --state <state>     Filter by state (e.g., "São Paulo")')
  console.log('  --limit <number>    Limit number of POIs (default: 10)')
  console.log('  --poi-id <id>       Specific POI ID for single mode\n')
  console.log('Examples:')
  console.log('  npm run tsx scripts/test-city-correction.ts --mode candidates --limit 20')
  console.log('  npm run tsx scripts/test-city-correction.ts --mode single --poi-id abc123')
  console.log('  npm run tsx scripts/test-city-correction.ts --mode dry_run --country Brazil --limit 5')
  console.log('  npm run tsx scripts/test-city-correction.ts --mode batch --limit 10')
  process.exit(0)
}

// Run the main function
main().catch(error => {
  console.error('💥 Unhandled error:', error)
  process.exit(1)
})
