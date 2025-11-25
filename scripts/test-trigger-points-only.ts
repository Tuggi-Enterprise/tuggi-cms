/**
 * Test Trigger Points generation only for a POI
 * 
 * Usage: npx tsx scripts/test-trigger-points-only.ts <attraction_id>
 */

import { PoiMigrationPipeline } from '../lib/services/poi-migration-pipeline'
import { MigrationService } from '../lib/services/migration-service'

const attractionId = process.argv[2] || '1259e7b9-77c1-3db0-b538-380218aebb77'

async function testTriggerPoints() {
  console.log('🧪 Testing Trigger Points Generation Only')
  console.log('=' .repeat(60))
  console.log(`📋 Attraction ID: ${attractionId}`)
  console.log('=' .repeat(60))
  console.log('')

  try {
    // Check if POI exists
    const poiResult = await MigrationService.loadPOIWithCoordinates(attractionId)
    
    if (!poiResult.success || !poiResult.data) {
      console.error('❌ POI not found:', poiResult.error)
      process.exit(1)
    }

    const { poi, coordinate } = poiResult.data
    console.log(`✅ POI found: ${poi.name} (${poi.city}, ${poi.state})`)
    console.log(`📍 Coordinates: ${coordinate.latitude}, ${coordinate.longitude}`)
    console.log('')

    // Execute trigger points step
    console.log('🚀 Executing Trigger Points generation...')
    console.log('')
    
    const result = await (PoiMigrationPipeline as any).executeTriggerPointsStep(attractionId)

    console.log('')
    console.log('=' .repeat(60))
    console.log('📊 TRIGGER POINTS RESULT')
    console.log('=' .repeat(60))
    console.log(`✅ Success: ${result.success ? 'YES' : 'NO'}`)
    console.log(`⏱️  Processing Time: ${(result.processing_time / 1000).toFixed(2)}s`)
    
    if (result.success) {
      console.log('')
      console.log('📊 Data:')
      console.log(`   - Trigger Points Generated: ${result.data?.trigger_points_generated || 0}`)
      console.log(`   - Trigger Points Saved: ${result.data?.trigger_points_saved || 0}`)
      console.log(`   - Trigger Points Skipped: ${result.data?.trigger_points_skipped || 0}`)
      console.log(`   - Max Confidence: ${((result.data?.confidence_score || 0) * 100).toFixed(1)}%`)
      console.log(`   - Boundary Source: ${result.data?.boundary_source || 'unknown'}`)
    } else {
      console.log('')
      console.log('❌ Error:', result.error)
    }

  } catch (error) {
    console.error('')
    console.error('=' .repeat(60))
    console.error('❌ UNEXPECTED ERROR')
    console.error('=' .repeat(60))
    console.error('Error:', error)
    if (error instanceof Error) {
      console.error('Stack:', error.stack)
    }
    process.exit(1)
  }
}

testTriggerPoints()
  .then(() => {
    console.log('')
    console.log('✅ Test completed')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Test failed:', error)
    process.exit(1)
  })

