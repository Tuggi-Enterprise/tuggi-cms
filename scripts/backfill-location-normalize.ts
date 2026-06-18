/**
 * backfill-location-normalize.ts
 *
 * Backfill ÚNICO de country/state, dirigido pelo SSOT lib/shared/location-normalize.ts
 * (mesma lógica usada nos imports — uma fonte da verdade, sem SQL duplicado).
 *
 * Enumera (country, state) de forma LIVE e escopada por país (índice em country),
 * aplica normalizeLocation(), e atualiza em LOTES via ctid (cabe no timeout do
 * gateway). Idempotente, sem DELETE.
 *
 * Pré-requisito p/ escrever: core.exec_sql(text) (supabase/manual/exec_sql_temp.sql).
 *
 *   npx tsx scripts/backfill-location-normalize.ts            # DRY-RUN
 *   npx tsx scripts/backfill-location-normalize.ts --execute  # aplica
 */
import * as fs from 'fs'
import * as path from 'path'
import { createClient } from '@supabase/supabase-js'
import { normalizeLocation, CANONICAL_COUNTRIES } from '../lib/shared/location-normalize'

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

;(async () => {
  if (EXECUTE) {
    try { await exec('select 1') } catch (e: any) {
      console.error(`❌ core.exec_sql indisponível: ${e.message}`); process.exit(1)
    }
  }

  // Lista de países: MV (valores crus pré-backfill) ∪ canônicos (rows já convertidos).
  const mvCountries = (await diag(`select distinct country from core.mv_poi_geo_counts where country is not null`)).map(r => r.country as string)
  const countries = Array.from(new Set([...mvCountries, ...CANONICAL_COUNTRIES])).sort()
  console.log(`Países a varrer: ${countries.length}`)

  interface Change { rawC: string; rawS: string; newC: string | null; newS: string | null }
  const changes: Change[] = []

  for (const rawC of countries) {
    let states: string[]
    try {
      states = (await diag(`select distinct state from core.attractions where country = ${lit(rawC)} and state is not null and state <> ''`)).map(r => r.state as string)
    } catch (e: any) {
      // fallback: estados da MV para este país
      states = (await diag(`select distinct state from core.mv_poi_geo_counts where country = ${lit(rawC)} and state <> ''`)).map(r => r.state as string)
    }
    for (const rawS of states) {
      const { country: newC, state: newS } = normalizeLocation(rawC, rawS)
      if (newC !== rawC || newS !== rawS) changes.push({ rawC, rawS, newC, newS })
    }
    // país sem estado pode precisar só do country normalizado:
    const newCountryOnly = normalizeLocation(rawC, null).country
    if (newCountryOnly !== rawC) changes.push({ rawC, rawS: '\0NULLSTATE', newC: newCountryOnly, newS: null })
  }

  console.log(`Pares que mudam: ${changes.length}\n`)
  for (const c of changes.slice(0, 40)) {
    const tag = c.rawS === '\0NULLSTATE' ? '(state ∅/qualquer)' : c.rawS
    console.log(`  ${c.rawC} / ${tag}  →  ${c.newC} / ${c.newS ?? '∅'}`)
  }
  if (changes.length > 40) console.log(`  … +${changes.length - 40}`)

  if (!EXECUTE) { console.log(`\n[DRY-RUN] nada escrito.`); return }

  console.log(`\n=== EXECUTANDO (lotes de ${BATCH}) ===`)
  let grand = 0, i = 0
  for (const c of changes) {
    i++
    const isNullStateRow = c.rawS === '\0NULLSTATE'
    const cond = isNullStateRow
      ? `country = ${lit(c.rawC)} and (state is null or state = '')`
      : `country = ${lit(c.rawC)} and state = ${lit(c.rawS)}`
    let pairTotal = 0
    try {
      while (true) {
        const sql = `update core.attractions set country = ${lit(c.newC)}, state = ${lit(c.newS)} where ctid in (select ctid from core.attractions where ${cond} limit ${BATCH})`
        const n = await exec(sql)
        pairTotal += n; grand += n
        if (n < BATCH) break
      }
    } catch (e: any) {
      console.error(`\n❌ FALHOU em ${c.rawC}/${c.rawS}: ${e.message}\nTotal até aqui: ${grand}. Idempotente — re-rode.`); process.exit(1)
    }
    if (pairTotal > 0) console.log(`  [${i}/${changes.length}] ${String(pairTotal).padStart(6)}  ${c.rawC}/${isNullStateRow ? '∅' : c.rawS} → ${c.newC}/${c.newS ?? '∅'}`)
  }
  console.log(`\n✅ Concluído. Linhas afetadas: ${grand}`)
  console.log('Atualize a MV: select core.refresh_poi_geo_counts();  e remova: drop function core.exec_sql(text);')
})()
