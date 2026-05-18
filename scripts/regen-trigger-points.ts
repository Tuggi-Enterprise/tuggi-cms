/**
 * Regenera TPs para POIs do core usando fila com claim atômico (SKIP LOCKED).
 * Múltiplos processos/workers podem rodar em paralelo sem coordenação manual.
 *
 * Fluxo:
 *   1. `--create-batch` — cria a fila no DB (rodar 1x)
 *   2. `--run-batch`    — worker consome a fila (rodar N vezes em paralelo)
 *
 * Uso:
 *   # 1. Criar batch (1x)
 *   npx tsx scripts/regen-trigger-points.ts \
 *     --create-batch ny-2026-05-18 \
 *     --city "New York" --state "NY" --country "United States"
 *
 *   # 2. Rodar 5 workers em paralelo (5 terminais ou processos em background)
 *   for i in 1 2 3 4 5; do
 *     npx tsx scripts/regen-trigger-points.ts --run-batch ny-2026-05-18 &
 *   done
 *
 *   # Status do batch
 *   npx tsx scripts/regen-trigger-points.ts --status ny-2026-05-18
 *
 *   # POI único (sem fila)
 *   npx tsx scripts/regen-trigger-points.ts --id <uuid>
 */

import { PoiMigrationPipeline } from '../lib/services/poi-migration-pipeline'
import { getSupabase } from '../lib/core/supabase-client'
import { randomUUID } from 'crypto'
import * as os from 'os'

const supabase = getSupabase('service')
const WORKER_ID = `${os.hostname()}-${process.pid}`

// ─── POI único ───────────────────────────────────────────────────────────────

async function regenSingle(attractionId: string) {
  console.log(`\n🔄 Regenerating TPs for: ${attractionId}`)
  const result = await PoiMigrationPipeline.executePipeline(attractionId, {
    mode: 'reprocess_triggers_core',
    auto_approve_if_satisfactory: true,
  })
  console.log(`✅ Done:`, JSON.stringify(result, null, 2))
}

// ─── Criar fila ──────────────────────────────────────────────────────────────

async function createBatch(batchId: string, filters: {
  city?: string; state?: string; country?: string
}) {
  // Verificar se batch já existe
  const { data: existing } = await (supabase as any)
    .schema('core').from('tp_regen_queue')
    .select('id', { count: 'exact', head: true })
    .eq('batch_id', batchId)

  if ((existing as any)?.count > 0) {
    console.log(`⚠️  Batch "${batchId}" já existe. Use --status para ver o progresso.`)
    return
  }

  // Buscar IDs do core
  let query = (supabase as any).schema('core').from('attractions')
    .select('id')
    .eq('status', 'active')

  if (filters.country) query = query.eq('country', filters.country)
  if (filters.state)   query = query.eq('state', filters.state)
  if (filters.city)    query = query.eq('city', filters.city)

  const { data, error } = await query
  if (error) { console.error('❌', error); process.exit(1) }
  if (!data?.length) { console.log('Nenhum POI encontrado.'); return }

  console.log(`📋 Inserindo ${data.length} POIs na fila "${batchId}"...`)

  // Inserir em batches de 500 (limite de upsert do Supabase)
  const CHUNK = 500
  let inserted = 0
  for (let i = 0; i < data.length; i += CHUNK) {
    const chunk = data.slice(i, i + CHUNK).map((r: any) => ({
      id: randomUUID(),
      attraction_id: r.id,
      batch_id: batchId,
      status: 'pending',
    }))
    const { error: insertErr } = await (supabase as any)
      .schema('core').from('tp_regen_queue')
      .insert(chunk)
    if (insertErr) { console.error('❌ Insert error:', insertErr); process.exit(1) }
    inserted += chunk.length
    process.stdout.write(`\r   ${inserted}/${data.length} inseridos...`)
  }

  console.log(`\n✅ Batch "${batchId}" criado com ${inserted} POIs.`)
  console.log(`\nAgora rode os workers:`)
  console.log(`  npx tsx scripts/regen-trigger-points.ts --run-batch ${batchId}`)
  console.log(`  # (rode N vezes em paralelo para N workers)`)
}

// ─── Worker: consome fila ─────────────────────────────────────────────────────

async function runBatch(batchId: string) {
  console.log(`🚀 Worker ${WORKER_ID} iniciado para batch "${batchId}"`)
  let processed = 0, failed = 0
  const startMs = Date.now()

  while (true) {
    // Claim atômico: pega o próximo POI disponível (SKIP LOCKED evita colisão entre workers)
    const { data: attractionId, error: claimErr } = await (supabase as any)
      .schema('core')
      .rpc('claim_next_regen', { p_batch_id: batchId, p_worker_id: WORKER_ID })

    if (claimErr) { console.error('❌ Claim error:', claimErr); break }
    if (!attractionId) {
      console.log(`\n✅ Worker ${WORKER_ID} concluído — fila vazia.`)
      break
    }

    const elapsed = ((Date.now() - startMs) / 1000).toFixed(0)
    process.stdout.write(`[${processed + failed + 1}] ${attractionId}... `)

    let tpCount = 0
    let errorMsg: string | null = null

    try {
      const result = await PoiMigrationPipeline.executePipeline(attractionId, {
        mode: 'reprocess_triggers_core',
        auto_approve_if_satisfactory: true,
      })
      tpCount = (result as any)?.steps?.trigger_points?.tp_count || 0
      processed++
      console.log(`✅ ${tpCount} TPs (${elapsed}s)`)
    } catch (e: any) {
      errorMsg = e.message?.slice(0, 200)
      failed++
      console.log(`❌ ${errorMsg}`)
    }

    // Marcar como done/failed na fila
    await (supabase as any)
      .schema('core').from('tp_regen_queue')
      .update({
        status: errorMsg ? 'failed' : 'done',
        completed_at: new Date().toISOString(),
        error_message: errorMsg,
        tp_count: tpCount,
      })
      .eq('batch_id', batchId)
      .eq('attraction_id', attractionId)
  }

  const totalS = ((Date.now() - startMs) / 1000).toFixed(1)
  console.log(`\n📊 Worker: ${processed} ok, ${failed} falhou em ${totalS}s`)
}

// ─── Status ───────────────────────────────────────────────────────────────────

async function batchStatus(batchId: string) {
  const { data, error } = await (supabase as any)
    .schema('core').from('tp_regen_queue')
    .select('status, tp_count, error_message')
    .eq('batch_id', batchId)

  if (error) { console.error('❌', error); return }
  if (!data?.length) { console.log(`Batch "${batchId}" não encontrado.`); return }

  const counts = data.reduce((acc: any, r: any) => {
    acc[r.status] = (acc[r.status] || 0) + 1; return acc
  }, {} as Record<string, number>)

  const totalTPs = data.filter((r: any) => r.status === 'done')
    .reduce((sum: number, r: any) => sum + (r.tp_count || 0), 0)
  const failed = data.filter((r: any) => r.status === 'failed')

  console.log(`\n📊 Batch "${batchId}":`)
  console.log(`  pending:    ${counts.pending || 0}`)
  console.log(`  processing: ${counts.processing || 0}`)
  console.log(`  done:       ${counts.done || 0}  (${totalTPs} TPs salvos)`)
  console.log(`  failed:     ${counts.failed || 0}`)
  console.log(`  total:      ${data.length}`)

  if (failed.length > 0) {
    console.log(`\nFalhas recentes:`)
    failed.slice(0, 5).forEach((r: any) =>
      console.log(`  ${r.error_message?.slice(0, 80)}`)
    )
  }
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2)
  const get = (flag: string) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined }
  const has = (flag: string) => args.includes(flag)

  const id          = get('--id')
  const createBatchId = get('--create-batch')
  const runBatchId  = get('--run-batch')
  const statusId    = get('--status')
  const city        = get('--city')
  const state       = get('--state')
  const country     = get('--country')

  if (id) {
    await regenSingle(id)
  } else if (createBatchId) {
    await createBatch(createBatchId, { city, state, country })
  } else if (runBatchId) {
    await runBatch(runBatchId)
  } else if (statusId) {
    await batchStatus(statusId)
  } else {
    console.log(`
Uso:
  # POI único
  npx tsx scripts/regen-trigger-points.ts --id <uuid>

  # 1. Criar fila (1x)
  npx tsx scripts/regen-trigger-points.ts \\
    --create-batch ny-2026-05-18 \\
    --city "New York" --state "NY" --country "United States"

  # 2. Rodar workers em paralelo (N terminais)
  npx tsx scripts/regen-trigger-points.ts --run-batch ny-2026-05-18

  # Status
  npx tsx scripts/regen-trigger-points.ts --status ny-2026-05-18
    `)
    process.exit(1)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
