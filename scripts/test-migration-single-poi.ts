/**
 * Test script for single POI migration
 * 
 * Tests the complete migration pipeline for a single POI
 * Usage: npx tsx scripts/test-migration-single-poi.ts <poi_uuid_id>
 * 
 * Example: npx tsx scripts/test-migration-single-poi.ts 1259e7b9-77c1-3db0-b538-380218aebb77
 */

import { PoiMigrationPipeline } from '../lib/services/poi-migration-pipeline'
import { MigrationService } from '../lib/services/migration-service'

const POI_UUID_ID = process.argv[2] || '1259e7b9-77c1-3db0-b538-380218aebb77'

async function testMigration() {
  console.log('🧪 Testing Migration Pipeline for Single POI')
  console.log('=' .repeat(60))
  console.log(`📋 POI UUID: ${POI_UUID_ID}`)
  console.log('=' .repeat(60))
  console.log('')

  try {
    // Step 0: Check if POI should be processed
    console.log('🔍 Step 0: Checking if POI should be processed...')
    const shouldProcess = await MigrationService.shouldProcessPOI(POI_UUID_ID)
    console.log(`   Result: ${shouldProcess.should_process ? '✅ Should process' : '❌ Should NOT process'}`)
    if (!shouldProcess.should_process) {
      console.log(`   Reason: ${shouldProcess.reason}`)
      console.log('')
      console.log('❌ Test aborted: POI should not be processed')
      process.exit(1)
    }
    console.log('')

    // Step 1: Execute full pipeline
    console.log('🚀 Step 1: Executing full migration pipeline...')
    console.log('   Options:')
    console.log('   - auto_generate_audio: true')
    console.log('   - auto_approve_if_satisfactory: true')
    console.log('   - mode: full')
    console.log('')

    const startTime = Date.now()
    const result = await PoiMigrationPipeline.executePipeline(POI_UUID_ID, {
      auto_generate_audio: true,
      auto_approve_if_satisfactory: true,
      skip_if_exists: true,
      update_if_exists: false,
      mode: 'full'
    })
    const totalTime = Date.now() - startTime

    console.log('')
    console.log('=' .repeat(60))
    console.log('📊 PIPELINE RESULTS')
    console.log('=' .repeat(60))
    console.log(`✅ Success: ${result.success ? 'YES' : 'NO'}`)
    console.log(`⏱️  Total Time: ${(totalTime / 1000).toFixed(2)}s`)
    console.log(`🆔 Attraction ID: ${result.attraction_id || 'N/A'}`)
    if (result.error) {
      console.log(`❌ Error: ${result.error}`)
    }
    if (result.warnings && result.warnings.length > 0) {
      console.log(`⚠️  Warnings: ${result.warnings.length}`)
      result.warnings.forEach((w, i) => console.log(`   ${i + 1}. ${w}`))
    }
    console.log('')

    // Step 2: Display step-by-step results
    console.log('=' .repeat(60))
    console.log('📋 STEP-BY-STEP RESULTS')
    console.log('=' .repeat(60))
    result.steps.forEach((step, index) => {
      const status = step.success ? '✅' : '❌'
      const time = `${(step.processing_time / 1000).toFixed(2)}s`
      console.log(`${index + 1}. ${status} ${step.step.padEnd(25)} (${time})`)
      if (!step.success && step.error) {
        console.log(`   Error: ${step.error}`)
      }
      if (step.data) {
        // Show relevant data
        if (step.step === 'migration' && step.data.attraction_id) {
          console.log(`   Attraction ID: ${step.data.attraction_id}`)
        }
        if (step.step === 'description' && step.data.description_id) {
          console.log(`   Description ID: ${step.data.description_id}`)
        }
        if (step.step === 'audio' && step.data.audio_url) {
          console.log(`   Audio URL: ${step.data.audio_url}`)
        }
        if (step.step === 'trigger_points' && step.data.trigger_points_saved) {
          console.log(`   Trigger Points Saved: ${step.data.trigger_points_saved}`)
        }
        if (step.step === 'approval' && step.data.approved) {
          console.log(`   Approved: ${step.data.approved}`)
        }
        if (step.step === 'remove_duplicates' && step.data.removed_count) {
          console.log(`   Duplicates Removed: ${step.data.removed_count}`)
          if (step.data.removed_ids && step.data.removed_ids.length > 0) {
            console.log(`   Removed IDs: ${step.data.removed_ids.join(', ')}`)
          }
        }
        if (step.step === 'delete_from_homolog' && step.data.deleted) {
          console.log(`   Deleted from homolog: ${step.data.deleted}`)
        }
      }
    })
    console.log('')

    // Step 3: Summary
    console.log('=' .repeat(60))
    console.log('📊 SUMMARY')
    console.log('=' .repeat(60))
    const successfulSteps = result.steps.filter(s => s.success).length
    const failedSteps = result.steps.filter(s => !s.success).length
    console.log(`✅ Successful Steps: ${successfulSteps}/${result.steps.length}`)
    console.log(`❌ Failed Steps: ${failedSteps}/${result.steps.length}`)
    console.log('')

    if (result.success) {
      console.log('🎉 MIGRATION COMPLETED SUCCESSFULLY!')
      console.log('')
      console.log('Next steps:')
      console.log('1. Verify POI in core.attractions')
      console.log('2. Check description in core.attraction_descriptions')
      console.log('3. Check trigger points in core.attraction_trigger_points')
      console.log('4. Verify POI was removed from homolog.pois')
    } else {
      console.log('❌ MIGRATION FAILED')
      console.log('')
      console.log('Please check the errors above and fix them before running batch migration.')
      process.exit(1)
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

// Run test
testMigration()
  .then(() => {
    console.log('')
    console.log('✅ Test completed')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Test failed:', error)
    process.exit(1)
  })

