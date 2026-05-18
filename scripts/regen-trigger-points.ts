/**
 * Regenera TPs para POIs do core (sem passar por homolog).
 *
 * Uso — POI único:
 *   npx tsx scripts/regen-trigger-points.ts --id 37c4c50e-58ae-5378-a8cf-1246b59fe157
 *
 * Uso — batch por cidade:
 *   npx tsx scripts/regen-trigger-points.ts --city "New York" --state "NY" --limit 4000
 */

import { PoiMigrationPipeline } from '../lib/services/poi-migration-pipeline'
import { getSupabase } from '../lib/core/supabase-client'

const supabase = getSupabase('service')

async function regenSingle(attractionId: string) {
  console.log(`\n🔄 Regenerating TPs for: ${attractionId}`)
  const result = await PoiMigrationPipeline.executePipeline(attractionId, {
    mode: 'reprocess_triggers_core',
    auto_approve_if_satisfactory: true,
  })
  console.log(`✅ Done:`, JSON.stringify(result, null, 2))
}

async function regenBatch(filters: { city?: string; state?: string; country?: string; limit?: number }) {
  const { city, state, country, limit = 100 } = filters

  let query = supabase
    .from('core.attractions')
    .select('id')
    .eq('status', 'active')

  if (country) query = query.eq('country', country)
  if (state)   query = query.eq('state', state)
  if (city)    query = query.eq('city', city)

  query = query.limit(limit)

  const { data, error } = await query
  if (error) { console.error('❌ Query error:', error); process.exit(1) }
  if (!data?.length) { console.log('No POIs found.'); return }

  console.log(`\n📋 Found ${data.length} POIs to reprocess`)

  let ok = 0, fail = 0
  for (let i = 0; i < data.length; i++) {
    const id = data[i].id
    process.stdout.write(`[${i + 1}/${data.length}] ${id}... `)
    try {
      await PoiMigrationPipeline.executePipeline(id, {
        mode: 'reprocess_triggers_core',
        auto_approve_if_satisfactory: true,
      })
      console.log('✅')
      ok++
    } catch (e: any) {
      console.log(`❌ ${e.message}`)
      fail++
    }
  }

  console.log(`\n📊 Done: ${ok} ok, ${fail} failed out of ${data.length}`)
}

async function main() {
  const args = process.argv.slice(2)
  const get = (flag: string) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined }

  const id      = get('--id')
  const city    = get('--city')
  const state   = get('--state')
  const country = get('--country')
  const limit   = get('--limit') ? parseInt(get('--limit')!) : undefined

  if (id) {
    await regenSingle(id)
  } else if (city || state || country) {
    await regenBatch({ city, state, country, limit })
  } else {
    console.log(`
Usage:
  # Single POI
  npx tsx scripts/regen-trigger-points.ts --id <core_attraction_id>

  # Batch by city
  npx tsx scripts/regen-trigger-points.ts --city "New York" --state "NY" --limit 4000
    `)
    process.exit(1)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
