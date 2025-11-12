/**
 * Batch Migration Script - Migrate POIs from homolog to core
 * 
 * Usage:
 *   npx tsx scripts/migrate-pois-batch.ts --country "Brazil" --state "São Paulo" --city "São Paulo" --batch-size 25
 */

import { MigrationService } from '../lib/services/migration-service'
import { PoiMigrationPipeline, PipelineOptions } from '../lib/services/poi-migration-pipeline'
import { getSupabase } from '../lib/core/supabase-client'

const supabase = getSupabase('service')

interface ScriptOptions {
  country?: string
  state?: string
  city?: string
  processing_status?: string
  approved?: boolean
  category?: string
  batch_size?: number
  mode?: 'migration_only' | 'migration_description' | 'migration_description_audio' | 'full'
  auto_generate_audio?: boolean
  auto_approve_if_satisfactory?: boolean
  skip_if_exists?: boolean
  update_if_exists?: boolean
  limit?: number
}

async function main() {
  // Parse command line arguments
  const args = process.argv.slice(2)
  const options: ScriptOptions = {}

  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.replace('--', '')
    const value = args[i + 1]

    if (key && value) {
      switch (key) {
        case 'country':
          options.country = value
          break
        case 'state':
          options.state = value
          break
        case 'city':
          options.city = value
          break
        case 'processing-status':
          options.processing_status = value
          break
        case 'approved':
          options.approved = value === 'true'
          break
        case 'category':
          options.category = value
          break
        case 'batch-size':
          options.batch_size = parseInt(value, 10)
          break
        case 'mode':
          options.mode = value as any
          break
        case 'auto-generate-audio':
          options.auto_generate_audio = value === 'true'
          break
        case 'auto-approve':
          options.auto_approve_if_satisfactory = value === 'true'
          break
        case 'skip-if-exists':
          options.skip_if_exists = value === 'true'
          break
        case 'update-if-exists':
          options.update_if_exists = value === 'true'
          break
        case 'limit':
          options.limit = parseInt(value, 10)
          break
      }
    }
  }

  // Default values
  const batchSize = options.batch_size || 25
  const mode = options.mode || 'full'
  const autoGenerateAudio = options.auto_generate_audio ?? true
  const autoApprove = options.auto_approve_if_satisfactory ?? false
  const skipIfExists = options.skip_if_exists ?? true
  const updateIfExists = options.update_if_exists ?? false

  console.log('🚀 Starting batch migration...')
  console.log('Options:', {
    country: options.country || 'all',
    state: options.state || 'all',
    city: options.city || 'all',
    processing_status: options.processing_status || 'pending',
    batch_size: batchSize,
    mode,
    auto_generate_audio: autoGenerateAudio,
    auto_approve: autoApprove
  })

  // Build query to get POIs from homolog
  let query = supabase
    .schema('homolog')
    .from('pois')
    .select('uuid_id, name, city, state, country, processing_status, approved, category')

  // Apply filters
  if (options.country && options.country !== 'all') {
    query = query.eq('country', options.country)
  }
  if (options.state && options.state !== 'all') {
    query = query.eq('state', options.state)
  }
  if (options.city && options.city !== 'all') {
    query = query.eq('city', options.city)
  }
  if (options.processing_status && options.processing_status !== 'all') {
    query = query.eq('processing_status', options.processing_status)
  } else {
    // Default: only pending or processing
    query = query.in('processing_status', ['pending', 'processing'])
  }
  if (options.approved !== undefined) {
    query = query.eq('approved', options.approved)
  }
  if (options.category && options.category !== 'all') {
    query = query.eq('category', options.category)
  }

  // Apply limit
  if (options.limit) {
    query = query.limit(options.limit)
  } else {
    query = query.limit(batchSize)
  }

  const { data: pois, error: poisError } = await query

  if (poisError) {
    console.error('❌ Error fetching POIs:', poisError)
    process.exit(1)
  }

  if (!pois || pois.length === 0) {
    console.log('ℹ️ No POIs found matching filters')
    process.exit(0)
  }

  console.log(`📊 Found ${pois.length} POIs to migrate`)

  // Statistics
  const stats = {
    total: pois.length,
    successful: 0,
    failed: 0,
    skipped: 0,
    errors: [] as Array<{ uuid_id: string; name: string; error: string }>
  }

  // Process each POI
  const pipelineOptions: PipelineOptions = {
    auto_generate_audio: autoGenerateAudio,
    auto_approve_if_satisfactory: autoApprove,
    skip_if_exists: skipIfExists,
    update_if_exists: updateIfExists,
    mode
  }

  for (let i = 0; i < pois.length; i++) {
    const poi = pois[i]
    const progress = `[${i + 1}/${pois.length}]`

    console.log(`\n${progress} Processing: ${poi.name} (${poi.city}, ${poi.state})`)

    try {
      const result = await PoiMigrationPipeline.executePipeline(poi.uuid_id, pipelineOptions)

      if (result.success) {
        stats.successful++
        console.log(`✅ ${progress} Success: ${poi.name}`)
        
        // Log steps
        result.steps.forEach(step => {
          const status = step.success ? '✅' : '❌'
          console.log(`   ${status} ${step.step}: ${step.processing_time}ms`)
          if (step.error) {
            console.log(`      Error: ${step.error}`)
          }
        })
      } else {
        stats.failed++
        stats.errors.push({
          uuid_id: poi.uuid_id,
          name: poi.name,
          error: result.error || 'Unknown error'
        })
        console.log(`❌ ${progress} Failed: ${poi.name} - ${result.error}`)
      }
    } catch (error) {
      stats.failed++
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      stats.errors.push({
        uuid_id: poi.uuid_id,
        name: poi.name,
        error: errorMsg
      })
      console.error(`❌ ${progress} Error: ${poi.name} - ${errorMsg}`)
    }

    // Small delay between POIs to avoid rate limiting
    if (i < pois.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }

  // Print summary
  console.log('\n' + '='.repeat(60))
  console.log('📊 Migration Summary')
  console.log('='.repeat(60))
  console.log(`Total POIs: ${stats.total}`)
  console.log(`✅ Successful: ${stats.successful}`)
  console.log(`❌ Failed: ${stats.failed}`)
  console.log(`⏭️  Skipped: ${stats.skipped}`)
  console.log('='.repeat(60))

  if (stats.errors.length > 0) {
    console.log('\n❌ Errors:')
    stats.errors.forEach((err, idx) => {
      console.log(`${idx + 1}. ${err.name} (${err.uuid_id}): ${err.error}`)
    })
  }

  // Save results to file
  const timestamp = Date.now()
  const resultsFile = `migration-results-${timestamp}.json`
  const fs = await import('fs/promises')
  await fs.writeFile(
    resultsFile,
    JSON.stringify({
      timestamp: new Date().toISOString(),
      options,
      stats,
      errors: stats.errors
    }, null, 2)
  )

  console.log(`\n💾 Results saved to: ${resultsFile}`)
}

// Run script
main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})

