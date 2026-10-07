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
 *
 *   # Dry-run: gera e mede, sem gravar nada (nem TP, nem aprovação, nem fila)
 *   npx tsx scripts/regen-trigger-points.ts --dry-run --bbox=-43.85,-23.10,-43.05,-22.70 --limit 50
 *   npx tsx scripts/regen-trigger-points.ts --dry-run --ids <uuid>,<uuid>
 *
 *   # Borda gravada como referência (#779): a detecção que não é a borda gravada cede a ela
 *   # Vale para --id, --dry-run e --run-batch (cada POI da fila, inclusive no processo filho).
 *   npx tsx scripts/regen-trigger-points.ts --id <uuid> --stored-boundary
 *   npx tsx scripts/regen-trigger-points.ts --run-batch sp-2026-10-04 --stored-boundary
 */

import { PoiMigrationPipeline } from '../lib/services/poi-migration-pipeline'
import { MigrationService } from '../lib/services/migration-service'
import { ensureDemCell } from '../lib/services/dem/dem-prepare'
import { BoundaryDetector } from '../lib/services/trigger-points-google/core/boundary-detector'
import { SANITY_MAX_TP_DISTANCE_M } from '../lib/services/trigger-points-google/config/visibility-class'
import { ReusableChild, serveParentRequests } from '../lib/utils/run-in-child'
import { DemStore } from '../lib/services/dem/dem-store'
import {
  QUEUE_CHILD_FLAG, STORED_BOUNDARY_FLAG, parseIdsFile, parseQueueChildArgs, queueChildArgs, regenPipelineOptions, storedBoundaryLogSuffix,
} from '../lib/services/tp-regen-options'
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

/**
 * Deadline of one POI in the queue (#779). A healthy POI takes ~25 s; a landmark whose edge
 * is a large park (7,616 vertices, 46,444 streets in reach) spent hours in a synchronous loop
 * and held its worker. Past this, the POI goes to `failed` with `timeout…` and the worker goes on.
 */
const POI_TIMEOUT_MS = 5 * 60_000
/**
 * POIs one child serves before it is replaced. A fresh child costs ~5–8 s (modules under tsx,
 * the local OSM region, the relief); 200 POIs spread it to <0.05 s per POI and bound any cache
 * that grows per POI to 200 POIs' worth. The relief, the largest (~440 MB per 1° cell), is
 * trimmed to one cell after every POI (`DemStore.keepOnlyLastLoaded`).
 */
const POIS_PER_CHILD = 200
const CHILD_FLAG = QUEUE_CHILD_FLAG

// ─── POI único ───────────────────────────────────────────────────────────────

async function regenSingle(attractionId: string, storedBoundary = false) {
  console.log(`\n🔄 Regenerando TPs para: ${attractionId}${storedBoundaryLogSuffix(storedBoundary)}`)
  const result = await PoiMigrationPipeline.executePipeline(attractionId, regenPipelineOptions(storedBoundary))
  console.log(`✅ Concluído:`, JSON.stringify(result, null, 2))
}

// ─── Criar fila ──────────────────────────────────────────────────────────────

async function createBatch(batchId: string, filters: {
  city?: string; state?: string; country?: string; ids?: string[]
}) {
  // Verificar se batch já existe (só informa, não bloqueia — o insert usa ON CONFLICT DO NOTHING)
  const { count: existingCount } = await db
    .from('tp_regen_queue')
    .select('*', { count: 'exact', head: true })
    .eq('batch_id', batchId)

  if (existingCount && existingCount > 0) {
    console.log(`ℹ️  Batch "${batchId}" já tem ${existingCount} itens — adicionando apenas os que faltam.`)
  }

  // Buscar IDs com paginação (Supabase limita por request); --ids-file já traz a lista (#779)
  const PAGE = 1000
  const allIds: string[] = filters.ids ? [...filters.ids] : []
  let page = 0

  while (!filters.ids) {
    // Offset pages without ORDER BY may skip or repeat rows; by id it stays <0.5 s (Portugal, 35.8k).
    let q = db.from('attractions').select('id')
      .order('id')
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

async function runBatch(batchId: string, storedBoundary = false) {
  console.log(`🚀 Worker ${WORKER_ID} iniciado para batch "${batchId}"${storedBoundaryLogSuffix(storedBoundary)}`)
  let processed = 0, failed = 0
  const startMs = Date.now()
  // The POIs run in a child kept between them and killed at POI_TIMEOUT_MS: the hang is
  // synchronous, so a timer in this process would never fire (#779).
  const child = new ReusableChild(__filename, queueChildArgs(storedBoundary), POIS_PER_CHILD)

  // The next POI is claimed (and its relief prepared) while the child works on this one: the
  // round trips between two POIs (~0.9 s of ~4 s) overlap with the engine instead of adding up.
  let next = claimNext(batchId)
  while (true) {
    const item = await next
    if (!item) break
    next = claimNext(batchId)
    const { attractionId, reliefError } = item

    process.stdout.write(`[${processed + failed + 1}] ${attractionId}${storedBoundaryLogSuffix(storedBoundary)}... `)

    const outcome = reliefError
      ? { ok: false as const, error: reliefError, timedOut: false }
      : await child.run(attractionId, POI_TIMEOUT_MS)
    const errorMsg = outcome.ok ? null : outcome.error.slice(0, 200)
    const elapsed = ((Date.now() - startMs) / 1000).toFixed(0)
    if (outcome.ok) {
      processed++
      const rate = (processed / parseFloat(elapsed || '1')).toFixed(2)
      console.log(`✅  (${elapsed}s, ${rate} POIs/s)`)
    } else {
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

  child.close()
  const totalS = ((Date.now() - startMs) / 1000).toFixed(1)
  console.log(`\n📊 Worker: ${processed} ok, ${failed} falhou em ${totalS}s`)
}

/**
 * Claims the next POI of the queue (atomic, SKIP LOCKED: one worker per POI) and prepares its
 * relief; null when the queue is empty or the claim fails.
 */
async function claimNext(batchId: string): Promise<{ attractionId: string; reliefError: string | null } | null> {
  const { data: attractionId, error } = await db.rpc('claim_next_regen', { p_batch_id: batchId, p_worker_id: WORKER_ID })
  if (error) { console.error('❌ Erro no claim:', error.message); return null }
  if (!attractionId) { console.log(`\n✅ Worker concluído — fila vazia.`); return null }
  // #831: the relief of the POI's 1° cell is prepared here, outside the POI deadline (one
  // cell takes 2–11 min); a cell that cannot be prepared fails the item, the old TPs stay.
  return { attractionId, reliefError: await prepareReliefOf(attractionId) }
}

/**
 * #831: prepares the relief cell of the POI if no prepared area covers it; the error, or null.
 * BR-POI-010: a municipal border reads no relief, so its cell is not prepared.
 */
async function prepareReliefOf(attractionId: string): Promise<string | null> {
  const loaded = await MigrationService.loadPOIWithCoordinates(attractionId)
  if (!loaded.success || !loaded.data) return null // the child reports the missing POI
  const { latitude: lat, longitude: lng } = loaded.data.coordinate
  try {
    if (await new BoundaryDetector().adminBoundaryOf({ id: attractionId, location: { lat, lng }, osm_type: loaded.data.poi.osm_type, osm_id: loaded.data.poi.osm_id })) return null
    await ensureDemCell({ lat, lng, marginM: SANITY_MAX_TP_DISTANCE_M })
    return null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
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

// ─── Dry-run: gera e mede, sem gravar ──────────────────────────────────────────

async function dryRun(opts: { ids?: string[]; bbox?: [number, number, number, number]; limit?: number; storedBoundary?: boolean }) {
  const { dryRunPoi, listAttractionIdsInBbox, toCsvLines, summarizePoi, DRY_RUN_CSV_COLUMNS, TRACE_CSV_COLUMNS, toTraceCsvLines } =
    await import('../lib/services/tp-dry-run')

  let ids = opts.ids ?? (opts.bbox ? await listAttractionIdsInBbox(opts.bbox, opts.limit) : [])
  if (opts.limit) ids = ids.slice(0, opts.limit)
  if (!ids.length) { console.log('Nenhum POI para o dry-run.'); return }

  const outDir = path.join(__dirname, '../output')
  fs.mkdirSync(outDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const csvPath = path.join(outDir, `tp-dry-run-${stamp}.csv`)
  const summaryPath = path.join(outDir, `tp-dry-run-${stamp}.summary.json`)
  const tracePath = path.join(outDir, `tp-dry-run-${stamp}.trace.csv`)
  fs.writeFileSync(csvPath, DRY_RUN_CSV_COLUMNS.join(',') + '\n')
  fs.writeFileSync(tracePath, TRACE_CSV_COLUMNS.join(',') + '\n')

  console.log(`🧪 Dry-run de ${ids.length} POIs — nada é gravado. CSV: ${csvPath}`)
  const summaries = []
  for (const [i, attractionId] of ids.entries()) {
    const result = await dryRunPoi(attractionId, { storedBoundaryReference: opts.storedBoundary })
    const lines = toCsvLines(result.rows)
    if (lines.length) fs.appendFileSync(csvPath, lines.join('\n') + '\n')
    const traceLines = toTraceCsvLines(result.trace)
    if (traceLines.length) fs.appendFileSync(tracePath, traceLines.join('\n') + '\n')
    const summary = summarizePoi(result)
    summaries.push(summary)
    // Resumo reescrito a cada POI: um crash no meio não perde o que já foi medido.
    fs.writeFileSync(summaryPath, JSON.stringify({ bbox: opts.bbox ?? null, total: ids.length, pois: summaries }, null, 2))
    console.log(`[${i + 1}/${ids.length}] ${summary.poi_name || attractionId}: atual ${summary.current.count} (${summary.current.beyond_cap} além do teto) → gerado ${summary.generated.count} (cortados: ${JSON.stringify(summary.generated.dropped)})${summary.error ? ` ❌ ${summary.error}` : ''}`)
  }
  console.log(`\n✅ Dry-run concluído.\n   ${csvPath}\n   ${tracePath}\n   ${summaryPath}`)
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
  // `--bbox=-43.85,...` (com "=") evita que o valor negativo pareça outra flag.
  // #779: the stored border wins over a detection of another footprint (--id, --dry-run, --run-batch).
  const storedBoundary = args.includes(STORED_BOUNDARY_FLAG)
  const getEq = (flag: string) => args.find(a => a.startsWith(`${flag}=`))?.slice(flag.length + 1) ?? get(flag)

  if (args[0] === CHILD_FLAG) {
    // Worker child (runBatch): one POI per request, and the parent owns the queue rows.
    const options = regenPipelineOptions(parseQueueChildArgs(args).storedBoundary)
    serveParentRequests(async attractionId => {
      try {
        const result = await PoiMigrationPipeline.executePipeline(String(attractionId), options)
        return result.success ? null : result.error ?? 'pipeline failed'
      } finally {
        DemStore.getInstance().keepOnlyLastLoaded()
      }
    })
  } else if (args.includes('--dry-run')) {
    const idsArg = getEq('--ids') ?? id
    const bboxArg = getEq('--bbox')
    const limitArg = getEq('--limit')
    const bbox = bboxArg?.split(',').map(Number)
    if (bbox && (bbox.length !== 4 || bbox.some(n => !Number.isFinite(n)))) {
      console.error('❌ --bbox espera minLng,minLat,maxLng,maxLat'); process.exit(1)
    }
    if (!idsArg && !bbox) { console.error('❌ --dry-run exige --ids ou --bbox'); process.exit(1) }
    await dryRun({
      ids: idsArg?.split(',').map(s => s.trim()).filter(Boolean),
      bbox: bbox as [number, number, number, number] | undefined,
      limit: limitArg ? parseInt(limitArg, 10) : undefined,
      storedBoundary,
    })
  } else if (id) {
    await regenSingle(id, storedBoundary)
  } else if (createBatchId) {
    const idsFile = get('--ids-file')
    if (idsFile && (city || state || country)) {
      console.error('❌ --ids-file não se combina com --city/--state/--country'); process.exit(1)
    }
    const ids = idsFile ? parseIdsFile(fs.readFileSync(idsFile, 'utf8')) : undefined
    if (ids && !ids.length) { console.error(`❌ --ids-file sem ids: ${idsFile}`); process.exit(1) }
    await createBatch(createBatchId, { city, state, country, ids })
  } else if (runBatchId) {
    await runBatch(runBatchId, storedBoundary)
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
  # ou só os POIs listados, um id por linha (#779)
  npx tsx scripts/regen-trigger-points.ts --create-batch <id> --ids-file <caminho>

  # 2. Rodar workers (1 por terminal, quantos quiser)
  npx tsx scripts/regen-trigger-points.ts --run-batch ny-2026-05-18 [--stored-boundary]

  # Ver progresso
  npx tsx scripts/regen-trigger-points.ts --status ny-2026-05-18

  # Dry-run: gera e mede sem gravar (CSV + resumo em output/)
  npx tsx scripts/regen-trigger-points.ts --dry-run --bbox=-43.85,-23.10,-43.05,-22.70 [--limit 50]
  npx tsx scripts/regen-trigger-points.ts --dry-run --ids <uuid>,<uuid>

  # Borda gravada como referência (#779): a detecção que não é a borda gravada cede a ela
  # Vale com --id, --dry-run e --run-batch
  npx tsx scripts/regen-trigger-points.ts --id <uuid> --stored-boundary

  # Resetar itens travados (após crash de worker)
  npx tsx scripts/regen-trigger-points.ts --reset-stuck ny-2026-05-18
    `)
    process.exit(1)
  }
}

main().catch(e => {
  console.error(e); process.exit(1)
})
