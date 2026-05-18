/**
 * Regenera TPs para POIs do core (sem passar por homolog).
 *
 * Uso — POI único:
 *   npx tsx scripts/regen-trigger-points.ts --id 37c4c50e-58ae-5378-a8cf-1246b59fe157
 *
 * Uso — batch por cidade (concorrência 3 por default):
 *   npx tsx scripts/regen-trigger-points.ts --city "New York" --state "NY" --limit 4267
 *   npx tsx scripts/regen-trigger-points.ts --city "New York" --state "NY" --limit 4267 --concurrency 5
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

async function regenBatch(filters: {
  city?: string; state?: string; country?: string; limit?: number; concurrency?: number
}) {
  const { city, state, country, limit = 100, concurrency = 3 } = filters

  // Buscar IDs do core (schema correto para Supabase)
  let query = (supabase as any).schema('core').from('attractions')
    .select('id')
    .eq('status', 'active')

  if (country) query = query.eq('country', country)
  if (state)   query = query.eq('state', state)
  if (city)    query = query.eq('city', city)
  query = query.limit(limit)

  const { data, error } = await query
  if (error) { console.error('❌ Query error:', error); process.exit(1) }
  if (!data?.length) { console.log('No POIs found.'); return }

  const ids: string[] = data.map((r: any) => r.id)
  console.log(`\n📋 ${ids.length} POIs to reprocess (concurrency=${concurrency})`)

  let ok = 0, fail = 0
  const startMs = Date.now()

  // Pool simples: mantém até `concurrency` tarefas rodando ao mesmo tempo
  let idx = 0
  async function worker() {
    while (idx < ids.length) {
      const i = idx++
      const id = ids[i]
      process.stdout.write(`[${i + 1}/${ids.length}] ${id}... `)
      try {
        await PoiMigrationPipeline.executePipeline(id, {
          mode: 'reprocess_triggers_core',
          auto_approve_if_satisfactory: true,
        })
        ok++
        const elapsed = ((Date.now() - startMs) / 1000).toFixed(0)
        const rate = (ok / parseFloat(elapsed)).toFixed(2)
        const remaining = Math.round((ids.length - (ok + fail)) / parseFloat(rate))
        console.log(`✅  (${elapsed}s, ~${remaining}s restantes)`)
      } catch (e: any) {
        fail++
        console.log(`❌ ${e.message?.slice(0, 80)}`)
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()))

  const totalS = ((Date.now() - startMs) / 1000).toFixed(1)
  console.log(`\n📊 Concluído: ${ok} ok, ${fail} falhou — ${ids.length} POIs em ${totalS}s`)
}

async function main() {
  const args = process.argv.slice(2)
  const get = (flag: string) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined }

  const id          = get('--id')
  const city        = get('--city')
  const state       = get('--state')
  const country     = get('--country')
  const limit       = get('--limit')       ? parseInt(get('--limit')!)       : undefined
  const concurrency = get('--concurrency') ? parseInt(get('--concurrency')!) : undefined

  if (id) {
    await regenSingle(id)
  } else if (city || state || country) {
    await regenBatch({ city, state, country, limit, concurrency })
  } else {
    console.log(`
Usage:
  # Single POI
  npx tsx scripts/regen-trigger-points.ts --id <uuid>

  # Batch NY (default concurrency=3)
  npx tsx scripts/regen-trigger-points.ts --city "New York" --state "NY" --limit 4267

  # Batch com mais workers
  npx tsx scripts/regen-trigger-points.ts --city "New York" --state "NY" --limit 4267 --concurrency 5
    `)
    process.exit(1)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
