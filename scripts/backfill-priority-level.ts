/**
 * Backfill priority_level (1 Padrão Tuggi · 2 Complementar · 3 Adicional)
 *
 * Deriva o nível da taxonomia + importância (mesma regra do SSOT poi-taxonomy.ts e do
 * UPDATE SQL). A coluna nasce DEFAULT 3, então só gravamos os níveis 1 e 2 (target 3 = no-op).
 * Updates em LOTE via .in('id', chunk) — rápido e leve (HOT update, priority_level sem índice;
 * não bumpa osm_last_updated). Idempotente, resumível, com retry.
 *
 * ⚠️ Requer a coluna priority_level (rode o ALTER de 20260616_add_priority_level.sql antes).
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/backfill-priority-level.ts            # banco todo
 *   npx tsx --env-file=.env scripts/backfill-priority-level.ts --dry-run
 *   npx tsx --env-file=.env scripts/backfill-priority-level.ts --resume-after <id>
 */

import { getSupabase } from '../lib/core/supabase-client'
import { LEVEL_1_CATEGORIES, LEVEL_2_CATEGORIES } from '../lib/shared/poi-taxonomy'

const supabase = getSupabase('service')

const SELECT_COLS = [
  'id', 'category', 'primary_category', 'priority_level',
  'importance_score', 'is_historic', 'heritage_status', 'unesco_status',
].join(', ')

function norm(v: unknown): string | null {
  if (v == null) return null
  const s = String(v).trim().toLowerCase()
  return s || null
}

/** Mesma lógica do CASE SQL (usa o importance_score JÁ gravado). */
function targetLevel(row: any): 1 | 2 | 3 {
  if (row.category === 'geofence') return 1
  if ((row.importance_score ?? -1) >= 40) return 1
  if (row.is_historic === true) return 1
  const h = norm(row.heritage_status); if (h && h !== 'none' && h !== 'no') return 1
  const u = norm(row.unesco_status); if (u && u !== 'none' && u !== 'no') return 1
  const cat = norm(row.primary_category)
  if (cat && LEVEL_1_CATEGORIES.has(cat)) return 1
  if (cat && LEVEL_2_CATEGORIES.has(cat)) return 2
  return 3
}

function parseArgs() {
  const a = process.argv.slice(2)
  const o: { dryRun: boolean; pageSize: number; chunk: number; resumeAfter?: string } =
    { dryRun: false, pageSize: 2000, chunk: 500 }
  for (let i = 0; i < a.length; i++) {
    const k = a[i]?.replace(/^--/, '')
    if (k === 'dry-run') { o.dryRun = true; continue }
    const v = a[++i]
    if (v === undefined) break
    if (k === 'page-size') o.pageSize = parseInt(v, 10)
    else if (k === 'chunk') o.chunk = parseInt(v, 10)
    else if (k === 'resume-after') o.resumeAfter = v
  }
  return o
}

async function updateChunk(ids: string[], level: number, dryRun: boolean): Promise<number> {
  if (dryRun || ids.length === 0) return ids.length
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { error } = await supabase.schema('core').from('attractions')
      .update({ priority_level: level }).in('id', ids)
    if (!error) return ids.length
    if (attempt === 3) { console.warn(`⚠️ chunk lvl${level} (${ids.length}) falhou: ${error.message}`); return 0 }
    await new Promise(r => setTimeout(r, 400 * attempt))
  }
  return 0
}

async function main() {
  const o = parseArgs()
  console.log(`🚀 Backfill priority_level — dryRun=${o.dryRun} page=${o.pageSize} chunk=${o.chunk}`)
  const startedAt = Date.now()
  let cursor = o.resumeAfter || '', lastId = cursor
  let scanned = 0, set1 = 0, set2 = 0, already = 0, failed = 0
  let buf1: string[] = [], buf2: string[] = []

  const flush = async () => {
    while (buf1.length) { const c = buf1.splice(0, o.chunk); const n = await updateChunk(c, 1, o.dryRun); set1 += n; failed += c.length - n }
    while (buf2.length) { const c = buf2.splice(0, o.chunk); const n = await updateChunk(c, 2, o.dryRun); set2 += n; failed += c.length - n }
  }

  while (true) {
    let q = supabase.schema('core').from('attractions').select(SELECT_COLS)
      .order('id', { ascending: true }).limit(o.pageSize)
    if (cursor) q = q.gt('id', cursor)
    let data: any[] | null = null
    for (let attempt = 1; attempt <= 5; attempt++) {
      const res = await q
      if (!res.error) { data = res.data as any[]; break }
      if (attempt === 5) { console.error(`❌ fetch falhou (lastId=${lastId}): ${res.error.message}`); process.exit(1) }
      await new Promise(r => setTimeout(r, 2000 * attempt))
    }
    if (!data || data.length === 0) break

    for (const row of data) {
      scanned++; lastId = row.id
      const target = targetLevel(row)
      if (target === row.priority_level) { already++; continue }   // já está certo (ex.: nível 3 default)
      if (target === 1) buf1.push(row.id)
      else if (target === 2) buf2.push(row.id)
      else already++ // target 3 mas current != 3 (raro: rebaixar) — deixa o default; ignorar
    }
    if (buf1.length >= o.chunk * 4 || buf2.length >= o.chunk * 4) await flush()

    cursor = lastId
    const el = ((Date.now() - startedAt) / 1000).toFixed(0)
    console.log(`… scanned=${scanned} set1=${set1} set2=${set2} already=${already} fail=${failed} (lastId=${lastId}, ${el}s)`)
    if (data.length < o.pageSize) break
  }
  await flush()

  console.log('\n' + '='.repeat(56))
  console.log(`📊 priority_level ${o.dryRun ? '(DRY-RUN)' : '(LIVE)'}`)
  console.log(`scanned: ${scanned}`)
  console.log(`nível 1: ${set1}`)
  console.log(`nível 2: ${set2}`)
  console.log(`nível 3 (default, intocado): ${already}`)
  console.log(`falhas: ${failed}`)
  console.log('='.repeat(56))
}

main().catch(e => { console.error('Fatal:', e); process.exit(1) })
