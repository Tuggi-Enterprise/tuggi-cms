/**
 * backfill-uk-ireland.ts — backfill city-aware p/ UK + Ireland (batches 23/24).
 *
 * Diferente do backfill geral: enumera triplas (state, city) da MV e passa city
 * ao SSOT, pois UK/Ireland resolvem nação/província → conselho/condado pela cidade.
 * UPDATE em lotes via ctid. Idempotente, sem DELETE (mas seta state=NULL onde a
 * cidade não resolve p/ um conselho — comportamento intencional do batch 24).
 *
 *   npx tsx scripts/backfill-uk-ireland.ts            # DRY-RUN
 *   npx tsx scripts/backfill-uk-ireland.ts --execute
 */
import * as fs from 'fs'
import * as path from 'path'
import { createClient } from '@supabase/supabase-js'
import { normalizeLocation } from '../lib/shared/location-normalize'

const envPath = path.join(__dirname, '../.env')
fs.readFileSync(envPath, 'utf8').split('\n').forEach(l => {
  const t = l.trim(); if (t && !t.startsWith('#')) { const i = t.indexOf('='); if (i > 0 && !process.env[t.slice(0, i).trim()]) process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim() }
})
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!, { db: { schema: 'core' }, auth: { persistSession: false } })
const EXECUTE = process.argv.includes('--execute')
const BATCH = 2000

const diag = async (q: string) => { const { data, error } = await db.rpc('diag_sql', { q: q.replace(/\s+/g, ' ').trim() }); if (error) throw new Error(error.message); return (data || []) as any[] }
const exec = async (q: string): Promise<number> => { const { data, error } = await db.rpc('exec_sql', { q }); if (error) throw new Error(error.message); return typeof data === 'number' ? data : 0 }
const lit = (s: string | null): string => (s == null ? 'NULL' : `'${s.replace(/'/g, "''")}'`)

// Valores de país que representam UK/Ireland (inclui variantes de nação como país).
const TARGETS = ['United Kingdom', 'UK', 'GB', 'Great Britain', 'England', 'Scotland', 'Wales', 'Northern Ireland', 'Ireland']

;(async () => {
  if (EXECUTE) { try { await exec('select 1') } catch (e: any) { console.error('❌ exec_sql:', e.message); process.exit(1) } }

  interface Chg { rawC: string; rawS: string; rawCi: string; newC: string | null; newS: string | null; n: number }
  const changes: Chg[] = []

  for (const rawC of TARGETS) {
    const rows = await diag(`select state, city, sum(cnt)::bigint n from core.mv_poi_geo_counts where country = ${lit(rawC)} group by state, city`)
    for (const r of rows) {
      const rawS = r.state ?? '', rawCi = r.city ?? ''
      const loc = normalizeLocation(rawC, rawS === '' ? null : rawS, rawCi === '' ? null : rawCi)
      const curState = rawS === '' ? null : rawS
      if (loc.country !== rawC || loc.state !== curState) {
        changes.push({ rawC, rawS, rawCi, newC: loc.country, newS: loc.state, n: Number(r.n) })
      }
    }
  }

  console.log(`Triplas (state,city) que mudam: ${changes.length} (~${changes.reduce((a, c) => a + c.n, 0)} linhas)`)
  // resumo por (country,state)→newState
  const summary = new Map<string, number>()
  for (const c of changes) { const k = `${c.rawC}/${c.rawS || '∅'} → ${c.newC}/${c.newS ?? '∅'}`; summary.set(k, (summary.get(k) || 0) + c.n) }
  ;[...summary.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).forEach(([k, n]) => console.log(`  ${String(n).padStart(6)}  ${k}`))

  if (!EXECUTE) { console.log('\n[DRY-RUN] nada escrito.'); return }

  console.log(`\n=== EXECUTANDO (lotes de ${BATCH}) ===`)
  let grand = 0, i = 0
  for (const c of changes) {
    i++
    const sCond = c.rawS === '' ? `(state is null or state = '')` : `state = ${lit(c.rawS)}`
    const ciCond = c.rawCi === '' ? `(city is null or city = '')` : `city = ${lit(c.rawCi)}`
    try {
      let moved = 0
      while (true) {
        const n = await exec(`update core.attractions set country = ${lit(c.newC)}, state = ${lit(c.newS)} where ctid in (select ctid from core.attractions where country = ${lit(c.rawC)} and ${sCond} and ${ciCond} limit ${BATCH})`)
        moved += n; if (n < BATCH) break
      }
      grand += moved
    } catch (e: any) { console.error(`\n❌ ${c.rawC}/${c.rawS}/${c.rawCi}: ${e.message}`); process.exit(1) }
    if (i % 200 === 0) console.log(`  …${i}/${changes.length} (${grand} linhas)`)
  }
  console.log(`\n✅ Concluído. Linhas afetadas: ${grand}`)
  await exec('select core.refresh_poi_geo_counts()')
  console.log('MV refrescada.')
})()
