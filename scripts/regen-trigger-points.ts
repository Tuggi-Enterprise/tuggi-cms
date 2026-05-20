/**
 * Regenera TPs para POIs do core usando fila com claim atômico (SKIP LOCKED).
 * Múltiplos workers podem rodar em paralelo sem coordenação manual.
 *
 * Fluxo:
 *   1. `--create-batch` — cria a fila no DB (1x por cidade/região)
 *   2. `--run-batch`    — worker consome a fila (rodar N vezes em paralelo)
 *   3. `--status`       — ver progresso
 *
 * Exemplos:
 *   npx tsx scripts/regen-trigger-points.ts --id <uuid>
 *
 *   npx tsx scripts/regen-trigger-points.ts \
 *     --create-batch ny-2026-05-18 \
 *     --city "New York" --state "NY" --country "United States"
 *
 *   npx tsx scripts/regen-trigger-points.ts --run-batch ny-2026-05-18
 *   # (abrir N terminais com o mesmo comando para N workers)
 *
 *   npx tsx scripts/regen-trigger-points.ts --status ny-2026-05-18
 */

import { PoiMigrationPipeline } from '../lib/services/poi-migration-pipeline'
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'
import * as os from 'os'
import * as fs from 'fs'
import * as path from 'path'

// Parse .env manually if running directly in node/tsx
const envPath = path.join(__dirname, '../.env')
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8')
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim()
    if (trimmed && !trimmed.startsWith('#')) {
      const idx = trimmed.indexOf('=')
      if (idx !== -1) {
        const key = trimmed.substring(0, idx).trim()
        const val = trimmed.substring(idx + 1).trim()
        process.env[key] = val
      }
    }
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || ''
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || ''

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ SUPABASE_URL e SUPABASE_SECRET_KEY são obrigatórios.')
  process.exit(1)
}

// Cliente para o schema 'core' (attractions, tp_regen_queue, RPCs)
const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  db: { schema: 'core' },
  auth: { autoRefreshToken: false, persistSession: false },
})

const WORKER_ID = `${os.hostname()}-${process.pid}`

// ─── POI único ───────────────────────────────────────────────────────────────

async function regenSingle(attractionId: string) {
  console.log(`\n🔄 Regenerando TPs para: ${attractionId}`)
  const result = await PoiMigrationPipeline.executePipeline(attractionId, {
    mode: 'reprocess_triggers_core',
    auto_approve_if_satisfactory: true,
  })
  console.log(`✅ Concluído:`, JSON.stringify(result, null, 2))
}

// ─── Criar fila ──────────────────────────────────────────────────────────────

async function createBatch(batchId: string, filters: {
  city?: string; state?: string; country?: string
}) {
  // Verificar se batch já existe (só informa, não bloqueia — o insert usa ON CONFLICT DO NOTHING)
  const { count: existingCount } = await db
    .from('tp_regen_queue')
    .select('*', { count: 'exact', head: true })
    .eq('batch_id', batchId)

  if (existingCount && existingCount > 0) {
    console.log(`ℹ️  Batch "${batchId}" já tem ${existingCount} itens — adicionando apenas os que faltam.`)
  }

  // Buscar IDs com paginação (Supabase limita por request)
  const PAGE = 1000
  const allIds: string[] = []
  let page = 0

  while (true) {
    let q = db.from('attractions').select('id')
      .range(page * PAGE, (page + 1) * PAGE - 1)

    if (filters.country) q = q.eq('country', filters.country)
    if (filters.state)   q = q.eq('state',   filters.state)
    if (filters.city)    q = q.eq('city',     filters.city)

    const { data: pageData, error } = await q
    if (error) { console.error('❌ Erro ao buscar POIs:', error.message); process.exit(1) }
    if (!pageData?.length) break

    pageData.forEach((r: any) => allIds.push(r.id))
    process.stdout.write(`\r   Buscando POIs... ${allIds.length} encontrados`)

    if (pageData.length < PAGE) break
    page++
  }

  const data = allIds.map(id => ({ id }))
  console.log(`\n📋 ${data.length} POIs encontrados.`)
  if (!data.length) { console.log('Nenhum POI encontrado com esses filtros.'); return }

  console.log(`📋 Inserindo ${data.length} POIs na fila "${batchId}"...`)

  // Inserir em chunks de 500 (limite do Supabase por request)
  const CHUNK = 500
  let inserted = 0
  for (let i = 0; i < data.length; i += CHUNK) {
    const chunk = data.slice(i, i + CHUNK).map((r: any) => ({
      id: randomUUID(),
      attraction_id: r.id,
      batch_id: batchId,
      status: 'pending',
    }))
    const { error: insertErr } = await db.from('tp_regen_queue')
      .upsert(chunk, { onConflict: 'batch_id,attraction_id', ignoreDuplicates: true })
    if (insertErr) { console.error('❌ Erro ao inserir chunk:', insertErr.message); process.exit(1) }
    inserted += chunk.length
    process.stdout.write(`\r   ${inserted}/${data.length} inseridos...`)
  }

  console.log(`\n✅ Batch "${batchId}" criado com ${inserted} POIs.`)
  console.log(`\nInicie os workers (1 por terminal):`)
  console.log(`  npx tsx scripts/regen-trigger-points.ts --run-batch ${batchId}`)
}

// ─── Worker: consome fila ─────────────────────────────────────────────────────

async function runBatch(batchId: string) {
  console.log(`🚀 Worker ${WORKER_ID} iniciado para batch "${batchId}"`)
  let processed = 0, failed = 0
  const startMs = Date.now()

  while (true) {
    // Claim atômico via SKIP LOCKED — só 1 worker pega cada POI
    const { data: attractionId, error: claimErr } = await db
      .rpc('claim_next_regen', { p_batch_id: batchId, p_worker_id: WORKER_ID })

    if (claimErr) { console.error('❌ Erro no claim:', claimErr.message); break }
    if (!attractionId) {
      console.log(`\n✅ Worker concluído — fila vazia.`)
      break
    }

    process.stdout.write(`[${processed + failed + 1}] ${attractionId}... `)

    let errorMsg: string | null = null

    try {
      await PoiMigrationPipeline.executePipeline(attractionId, {
        mode: 'reprocess_triggers_core',
        auto_approve_if_satisfactory: true,
      })
      processed++
      const elapsed = ((Date.now() - startMs) / 1000).toFixed(0)
      const rate = (processed / parseFloat(elapsed || '1')).toFixed(2)
      console.log(`✅  (${elapsed}s, ${rate} POIs/s)`)
    } catch (e: any) {
      errorMsg = e.message?.slice(0, 200)
      failed++
      console.log(`❌ ${errorMsg}`)
    }

    // Marcar como done ou failed
    await db.from('tp_regen_queue')
      .update({
        status:        errorMsg ? 'failed' : 'done',
        completed_at:  new Date().toISOString(),
        error_message: errorMsg,
        tp_count:      0,
      })
      .eq('batch_id',      batchId)
      .eq('attraction_id', attractionId)
  }

  const totalS = ((Date.now() - startMs) / 1000).toFixed(1)
  console.log(`\n📊 Worker: ${processed} ok, ${failed} falhou em ${totalS}s`)
}

// ─── Status ───────────────────────────────────────────────────────────────────

async function batchStatus(batchId: string) {
  const PAGE = 1000
  const data: any[] = []
  let page = 0
  while (true) {
    const { data: chunk, error } = await db
      .from('tp_regen_queue')
      .select('status, tp_count, error_message')
      .eq('batch_id', batchId)
      .range(page * PAGE, (page + 1) * PAGE - 1)
    if (error) { console.error('❌', error.message); return }
    if (!chunk?.length) break
    data.push(...chunk)
    if (chunk.length < PAGE) break
    page++
  }
  if (!data.length) { console.log(`Batch "${batchId}" não encontrado.`); return }

  const counts = data.reduce((acc: any, r: any) => {
    acc[r.status] = (acc[r.status] || 0) + 1; return acc
  }, {} as Record<string, number>)

  const totalTPs = data
    .filter((r: any) => r.status === 'done')
    .reduce((s: number, r: any) => s + (r.tp_count || 0), 0)

  console.log(`\n📊 Batch "${batchId}":`)
  console.log(`  pending:    ${counts.pending    || 0}`)
  console.log(`  processing: ${counts.processing || 0}`)
  console.log(`  done:       ${counts.done       || 0}  (${totalTPs} TPs salvos)`)
  console.log(`  failed:     ${counts.failed     || 0}`)
  console.log(`  total:      ${data.length}`)

  const failures = data.filter((r: any) => r.status === 'failed')
  if (failures.length > 0) {
    console.log(`\nÚltimas falhas:`)
    failures.slice(0, 5).forEach((r: any) =>
      console.log(`  ${r.error_message?.slice(0, 100)}`)
    )
  }
}

// ─── Resetar processing travados ─────────────────────────────────────────────

async function resetStuck(batchId: string) {
  const { count, error } = await db
    .from('tp_regen_queue')
    .update({ status: 'pending', worker_id: null, claimed_at: null })
    .eq('batch_id', batchId)
    .eq('status', 'processing')
    .select('*', { count: 'exact', head: true } as any)

  if (error) { console.error('❌', error.message); return }
  console.log(`✅ ${count || 0} itens "processing" resetados para "pending".`)
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2)
  const get = (flag: string) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined }

  const id            = get('--id')
  const createBatchId = get('--create-batch')
  const runBatchId    = get('--run-batch')
  const statusId      = get('--status')
  const resetId       = get('--reset-stuck')
  const city          = get('--city')
  const state         = get('--state')
  const country       = get('--country')

  if (id) {
    await regenSingle(id)
  } else if (createBatchId) {
    await createBatch(createBatchId, { city, state, country })
  } else if (runBatchId) {
    await runBatch(runBatchId)
  } else if (statusId) {
    await batchStatus(statusId)
  } else if (resetId) {
    await resetStuck(resetId)
  } else {
    console.log(`
Uso:
  # POI único
  npx tsx scripts/regen-trigger-points.ts --id <uuid>

  # 1. Criar fila (1x por cidade)
  npx tsx scripts/regen-trigger-points.ts \\
    --create-batch ny-2026-05-18 \\
    --city "New York" --state "NY" --country "United States"

  # 2. Rodar workers (1 por terminal, quantos quiser)
  npx tsx scripts/regen-trigger-points.ts --run-batch ny-2026-05-18

  # Ver progresso
  npx tsx scripts/regen-trigger-points.ts --status ny-2026-05-18

  # Resetar itens travados (após crash de worker)
  npx tsx scripts/regen-trigger-points.ts --reset-stuck ny-2026-05-18
    `)
    process.exit(1)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
