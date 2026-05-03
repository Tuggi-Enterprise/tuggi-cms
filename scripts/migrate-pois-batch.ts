/**
 * Batch Migration Script - Migrate POIs from homolog to core
 * 
 * Usage:
 *   npx tsx scripts/migrate-pois-batch.ts --country "Brazil" --state "São Paulo" --city "São Paulo" --batch-size 25
 */

import pLimit from 'p-limit'
import fs from 'fs/promises'
import * as dotenv from 'dotenv'
import { MigrationService } from '../lib/services/migration-service'
import { PoiMigrationPipeline, PipelineOptions } from '../lib/services/poi-migration-pipeline'
import { getSupabase } from '../lib/core/supabase-client'
import { redisCache } from '../lib/cache/redis-cache'

// Load env files when running from CLI without a wrapper.
dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const supabase = getSupabase('service')

interface ScriptOptions {
  country?: string
  state?: string
  city?: string
  processing_status?: string
  approved?: boolean
  category?: string
  batch_size?: number
  mode?: 'enrichment_migration_triggers' | 'migration_only' | 'migration_description' | 'migration_description_audio' | 'full'
  auto_generate_audio?: boolean
  auto_approve_if_satisfactory?: boolean
  skip_if_exists?: boolean
  update_if_exists?: boolean
  limit?: number
}

async function main() {
  const hasUrl = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL)
  const hasServiceKey = Boolean(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)

  if (!hasUrl || !hasServiceKey) {
    console.error('❌ Missing Supabase environment variables for migration script')
    console.error('   Required: NEXT_PUBLIC_SUPABASE_URL')
    console.error('   Required: SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
  }

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
  const mode = options.mode || 'enrichment_migration_triggers'
  const autoGenerateAudio = options.auto_generate_audio ?? false
  const autoApprove = options.auto_approve_if_satisfactory ?? true
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

  // ── Pagination & concurrency config ────────────────────────────────────────
  // PAGE_SIZE: how many POIs fetched per page — heap is bounded to this window.
  // Use --batch-size to override (default 500). --limit caps the grand total.
  const PAGE_SIZE = batchSize
  const CONCURRENCY = 15
  const limiter = pLimit(CONCURRENCY)
  const hardLimit = options.limit ?? Infinity

  // ── Pipeline options ─────────────────────────────────────────────────────────
  const pipelineOptions: PipelineOptions = {
    auto_generate_audio: autoGenerateAudio,
    auto_approve_if_satisfactory: autoApprove,
    skip_if_exists: skipIfExists,
    update_if_exists: updateIfExists,
    mode
  }

  // ── Statistics ────────────────────────────────────────────────────────────────
  const stats = {
    total: 0,
    successful: 0,
    failed: 0,
    skipped: 0,
    errors: [] as Array<{ uuid_id: string; name: string; error: string }>
  }

  type PoiRow = { uuid_id: string; name: string; city: string; state: string; country: string; processing_status: string; approved: boolean; category: string }

  // ── Single-POI processor ──────────────────────────────────────────────────────
  const processPoi = async (poi: PoiRow, globalIndex: number): Promise<void> => {
    const progress = `[${globalIndex}]`
    console.log(`\n${progress} Processing: ${poi.name} (${poi.city}, ${poi.state})`)

    try {
      const result = await PoiMigrationPipeline.executePipeline(poi.uuid_id, pipelineOptions)

      if (result.success) {
        stats.successful++
        console.log(`✅ ${progress} Success: ${poi.name}`)
        result.steps.forEach(step => {
          const status = step.success ? '✅' : '❌'
          console.log(`   ${status} ${step.step}: ${step.processing_time}ms`)
          if (step.error) console.log(`      Error: ${step.error}`)
        })
      } else {
        stats.failed++
        stats.errors.push({ uuid_id: poi.uuid_id, name: poi.name, error: result.error || 'Unknown error' })
        console.log(`❌ ${progress} Failed: ${poi.name} - ${result.error}`)
      }
    } catch (error) {
      stats.failed++
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      stats.errors.push({ uuid_id: poi.uuid_id, name: poi.name, error: errorMsg })
      console.error(`❌ ${progress} Error: ${poi.name} - ${errorMsg}`)
    }
  }

  // ── Cursor-based pagination loop ──────────────────────────────────────────────
  // Each page is fetched, processed concurrently, then released from memory
  // before the next page is fetched. Heap usage stays bounded to PAGE_SIZE.
  let cursor: string | null = null
  let pageNumber = 0
  let globalIndex = 0

  while (globalIndex < hardLimit) {
    const pageLimit = Math.min(PAGE_SIZE, hardLimit - globalIndex)

    let q = supabase
      .schema('homolog')
      .from('pois')
      .select('uuid_id, name, city, state, country, processing_status, approved, category')
      .order('uuid_id')
      .limit(pageLimit)

    if (cursor) {
      q = q.gt('uuid_id', cursor)
    }

    if (options.country && options.country !== 'all') q = q.eq('country', options.country)
    if (options.state && options.state !== 'all') q = q.eq('state', options.state)
    if (options.city && options.city !== 'all') q = q.eq('city', options.city)
    if (options.processing_status && options.processing_status !== 'all') {
      q = q.eq('processing_status', options.processing_status)
    } else {
      q = q.in('processing_status', ['pending', 'processing'])
    }
    if (options.approved !== undefined) q = q.eq('approved', options.approved)
    if (options.category && options.category !== 'all') q = q.eq('category', options.category)

    const { data: page, error: pageError } = await q

    if (pageError) {
      console.error('❌ Error fetching page:', pageError)
      break
    }

    if (!page || page.length === 0) break

    pageNumber++
    stats.total += page.length
    console.log(`\n📦 Page ${pageNumber}: ${page.length} POIs (cumulative: ${stats.total})`)

    // Process this page concurrently, then let it be GC'd before fetching next
    await Promise.all(
      page.map((poi, i) => limiter(() => processPoi(poi as PoiRow, globalIndex + i + 1)))
    )

    globalIndex += page.length
    cursor = page[page.length - 1].uuid_id as string

    if (page.length < pageLimit) break // last page reached
  }

  if (stats.total === 0) {
    console.log('ℹ️ No POIs found matching filters')
    process.exit(0)
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

  await redisCache.disconnect()
}

// Run script
main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})


