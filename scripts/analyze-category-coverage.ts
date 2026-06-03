/**
 * Category Coverage Analyzer (read-only)
 *
 * Runs the shared poi-taxonomy `classify` over real core.attractions rows and
 * reports how much of the dataset would be classified, broken down by how the
 * match was made (matched_by), by macro group, by specific category, plus the
 * notability/importance picture. Use it BEFORE the backfill (baseline) and
 * AFTER (delta) — target: classified rate 72.7% -> 90%+.
 *
 * Read-only: never writes. Does not require the new columns to exist.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/analyze-category-coverage.ts --country "United States"
 *   npx tsx --env-file=.env scripts/analyze-category-coverage.ts --country "United States" --limit 20000
 */

import { getSupabase } from '../lib/core/supabase-client'
import { classify, importanceScore, isNotable, ClassifyInput } from '../lib/shared/poi-taxonomy'

const supabase = getSupabase('service')

const SELECT_COLS = [
  'id', 'name', 'osm_category', 'osm_tags',
  'amenity', 'leisure', 'natural_water', 'waterway', 'man_made', 'building',
  'place', 'landuse', 'shop', 'park_type', 'monument_type', 'artwork_type',
  'information', 'type',
  'is_historic', 'is_touristic', 'wikidata', 'wikipedia',
  'heritage_status', 'unesco_status', 'importance_level', 'landmark_level',
].join(', ')

function parseArgs() {
  const args = process.argv.slice(2)
  const o: { country: string; limit?: number; pageSize: number; samples: number } = {
    country: 'United States', pageSize: 1000, samples: 12,
  }
  for (let i = 0; i < args.length; i += 2) {
    const k = args[i]?.replace(/^--/, '')
    const v = args[i + 1]
    if (!k || v === undefined) continue
    if (k === 'country') o.country = v
    else if (k === 'limit') o.limit = parseInt(v, 10)
    else if (k === 'page-size') o.pageSize = parseInt(v, 10)
    else if (k === 'samples') o.samples = parseInt(v, 10)
  }
  return o
}

function inc(m: Map<string, number>, k: string) { m.set(k, (m.get(k) || 0) + 1) }
function sortDesc(m: Map<string, number>) { return [...m.entries()].sort((a, b) => b[1] - a[1]) }
function pct(n: number, total: number) { return total ? ((100 * n) / total).toFixed(1) : '0.0' }

async function main() {
  const opts = parseArgs()
  console.log(`\n🔎 Category coverage — country="${opts.country}"  (read-only)\n`)

  const byMatched = new Map<string, number>()
  const byGroup = new Map<string, number>()
  const bySpecific = new Map<string, number>()
  const byGroupSpecific = new Map<string, Map<string, number>>()
  const unmappedSamples: string[] = []
  const heuristicSamples: string[] = []
  const importanceBuckets = new Map<string, number>() // 0,1-29,30-59,60-100
  let n = 0, classified = 0, excluded = 0, notable = 0
  let cursor = ''
  let lastId = ''

  while (true) {
    let q = supabase.schema('core').from('attractions')
      .select(SELECT_COLS)
      .eq('country', opts.country)
      .order('id', { ascending: true })
      .limit(opts.pageSize)
    if (cursor) q = q.gt('id', cursor)

    const { data, error } = await q
    if (error) { console.error('❌ query error:', error.message); process.exit(1) }
    if (!data || data.length === 0) break

    for (const row of data as any[]) {
      n++
      lastId = row.id
      const res = classify(row as ClassifyInput)
      inc(byMatched, res.matched_by)
      if (res.excluded) excluded++
      if (res.primary_category) {
        classified++
        inc(bySpecific, res.primary_category)
        const g = res.category_group ?? 'null'
        inc(byGroup, g)
        if (!byGroupSpecific.has(g)) byGroupSpecific.set(g, new Map())
        inc(byGroupSpecific.get(g)!, res.primary_category)
      }
      const score = importanceScore(row as ClassifyInput)
      if (isNotable(row as ClassifyInput)) notable++
      inc(importanceBuckets, score === 0 ? '0' : score < 30 ? '1-29' : score < 60 ? '30-59' : '60-100')

      if (res.matched_by === 'unmapped' && row.name && unmappedSamples.length < opts.samples)
        unmappedSamples.push(`[oc=${row.osm_category ?? '∅'}] ${row.name}`)
      if (res.matched_by === 'name_heuristic' && heuristicSamples.length < opts.samples)
        heuristicSamples.push(`${res.primary_category} <- ${row.name}`)
    }

    cursor = lastId
    if (opts.limit && n >= opts.limit) break
    if (data.length < opts.pageSize) break
  }

  console.log(`Rows scanned: ${n}`)
  console.log(`✅ Classified (primary_category set): ${classified} (${pct(classified, n)}%)`)
  console.log(`🚫 Excluded streets: ${excluded} (${pct(excluded, n)}%)`)
  console.log(`⭐ Notable (importance ≥ 30): ${notable} (${pct(notable, n)}%)`)

  console.log('\n=== matched_by ===')
  for (const [k, v] of sortDesc(byMatched)) console.log(`${String(v).padStart(8)}  ${pct(v, n).padStart(5)}%  ${k}`)

  console.log('\n=== category_group ===')
  for (const [k, v] of sortDesc(byGroup)) console.log(`${String(v).padStart(8)}  ${pct(v, n).padStart(5)}%  ${k}`)

  console.log('\n=== category_group → specific categories ===')
  for (const [g, v] of sortDesc(byGroup)) {
    console.log(`\n▸ ${g}  (${v}, ${pct(v, n)}%)`)
    const sub = byGroupSpecific.get(g)
    if (sub) for (const [k, c] of sortDesc(sub)) console.log(`     ${String(c).padStart(7)}  ${k}`)
  }

  console.log('\n=== top primary_category (40) ===')
  for (const [k, v] of sortDesc(bySpecific).slice(0, 40)) console.log(`${String(v).padStart(8)}  ${pct(v, n).padStart(5)}%  ${k}`)
  console.log(`distinct specific categories: ${bySpecific.size}`)

  console.log('\n=== importance_score buckets ===')
  for (const bk of ['0', '1-29', '30-59', '60-100']) console.log(`${String(importanceBuckets.get(bk) || 0).padStart(8)}  ${bk}`)

  console.log('\n=== sample name_heuristic matches ===')
  heuristicSamples.forEach(s => console.log('  ' + s))
  console.log('\n=== sample UNMAPPED (extend dictionary) ===')
  unmappedSamples.forEach(s => console.log('  ' + s))
  console.log('')
}

main().catch(e => { console.error('Fatal:', e); process.exit(1) })
