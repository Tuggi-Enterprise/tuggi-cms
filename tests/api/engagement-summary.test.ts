/**
 * #1099: the executive summary on top of the Engagement report (spec-cms-relatorio-engajamento-2026-11
 * Parte B, criterion §B15 items 1, 3, 4, 5, 7, 9, 10; Parte C §C16 item 4 since #1101). Pure module, no mount:
 * `lib/engagement/summary.ts`.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import type { Cell } from '@/lib/engagement/cells'
import { formatDelta, heatStep, MINUS, SUMMARY_MIN_BASE, summaryMonthOf, tileDelta, type TilePoint } from '@/lib/engagement/summary'

const TODAY = '2026-11-04'
const MONTHS = ['2026-08', '2026-09', '2026-10', '2026-11']

const measured = (value: number): Cell => ({ state: 'measured', value, share: null, since: null, due: null })
const point = (m: string, value: number, base: number): TilePoint => ({ month: m, cell: measured(value), base })


// ── §B15 item 1 ─────────────────────────────────────────────────────────────────────────────

test('#1099 spec B15 item 1: the summary month is the last closed month in Sao Paulo, the param when on the ruler, the current one before the ruler has a past', () => {
  assert.equal(summaryMonthOf(null, MONTHS, TODAY), '2026-10')
  assert.equal(summaryMonthOf('2026-11', MONTHS, TODAY), '2026-11')
  assert.equal(summaryMonthOf('2026-08', MONTHS, TODAY), '2026-08')
  assert.equal(summaryMonthOf('2025-01', MONTHS, TODAY), '2026-10')
  assert.equal(summaryMonthOf('junk', MONTHS, TODAY), '2026-10')
  assert.equal(summaryMonthOf(null, ['2026-08'], '2026-08-10'), '2026-08')
})

// ── §B15 item 3: DS-COMPONENTE-100 ──────────────────────────────────────────────────────────

test('#1099 DS-COMPONENTE-100 item 1: base 29 against 30 prints the change without arrow (small_base); 30 and 30 is up', () => {
  assert.equal(SUMMARY_MIN_BASE, 30)
  const small = tileDelta(point('2026-10', 33, 30), point('2026-09', 30, 29), 'relative', '2026-11')
  assert.equal(small.state, 'small_base')
  assert.equal(small.rounded, 10)
  const up = tileDelta(point('2026-10', 33, 30), point('2026-09', 30, 30), 'relative', '2026-11')
  assert.equal(up.state, 'up')
  assert.equal(up.rounded, 10)
  // The border of the rule: a floor of base, not a test of significance; one person above the base moves the arrow.
  assert.equal(tileDelta(point('2026-10', 31, 31), point('2026-09', 30, 30), 'relative', '2026-11').state, 'up')
  // An unknown base is not a base of 30.
  assert.equal(tileDelta({ ...point('2026-10', 33, 30), base: null }, point('2026-09', 30, 30), 'relative', '2026-11').state, 'small_base')
})

test('#1099 #1154 DS-COMPONENTE-100 item 1: a change rounded to zero at one decimal is flat; a fall is down', () => {
  assert.equal(tileDelta(point('2026-10', 100.04, 40), point('2026-09', 100, 40), 'relative', '2026-11').state, 'flat')
  assert.equal(tileDelta(point('2026-10', 100.4, 40), point('2026-09', 100, 40), 'relative', '2026-11').state, 'up')
  const down = tileDelta(point('2026-10', 95, 40), point('2026-09', 100, 40), 'relative', '2026-11')
  assert.equal(down.state, 'down')
  assert.equal(down.rounded, -5)
})

test('#1099 #1154 DS-COMPONENTE-100 item 2: the sign on both sides, U+2212 on the negative, the unit printed, one decimal', () => {
  const pt = (n: string) => `${n} pt`
  const down = tileDelta(point('2026-10', 95, 40), point('2026-09', 100, 40), 'relative', '2026-11')
  assert.equal(formatDelta(down, 'pt', pt), `${MINUS}5,0%`)
  assert.ok(!formatDelta(down, 'pt', pt)!.includes('-'), 'no hyphen-minus')
  const up = tileDelta(point('2026-10', 108, 40), point('2026-09', 100, 40), 'relative', '2026-11')
  assert.equal(formatDelta(up, 'pt', pt), '+8,0%')
  assert.equal(formatDelta(up, 'en', pt), '+8.0%')
  const rateDown = tileDelta(point('2026-10', 0.1, 231), point('2026-09', 0.11, 204), 'points', '2026-11')
  assert.equal(rateDown.state, 'down')
  assert.equal(formatDelta(rateDown, 'pt', pt), `${MINUS}1,0 pt`)
  assert.equal(formatDelta(tileDelta(point('2026-11', 1, 40), point('2026-10', 1, 40), 'relative', '2026-11'), 'pt', pt), null)
})

test('#1154 DS-COMPONENTE-100 item 5: the change comes from the values as sent, not from the rounded ones the tile prints, at one decimal', () => {
  // A rate of 11.49 % against 12.51 %: the tile prints 11 % and 13 %, the change is 1.0 pt, not 2.
  const rate = tileDelta(point('2026-10', 0.1251, 40), point('2026-09', 0.1149, 40), 'points', '2026-11')
  assert.deepEqual([rate.state, rate.rounded], ['up', 1])
  assert.equal(formatDelta(rate, 'pt', (n) => `${n} pt`), '+1,0 pt')
  // A median of 36.4 min against 30.6: the tile prints 36 and 31 min (16.1 %), the change is 19.0 %.
  const minutes = tileDelta(point('2026-10', 36.4, 40), point('2026-09', 30.6, 40), 'relative', '2026-11')
  assert.equal(minutes.rounded, 19)
  assert.equal(formatDelta(minutes, 'pt', (n) => n), '+19,0%')
  // One decimal kept: 33 against 30.5 is 8.2 %, never -0 on a tiny fall.
  assert.equal(tileDelta(point('2026-10', 33, 40), point('2026-09', 30.5, 40), 'relative', '2026-11').rounded, 8.2)
  assert.ok(Object.is(tileDelta(point('2026-10', 99.99, 40), point('2026-09', 100, 40), 'relative', '2026-11').rounded, 0))
})

test('#1099 DS-COMPONENTE-084 item 2: summary.ts divides no GA4 field by a bank field', () => {
  const src = readFileSync(resolve(import.meta.dirname, '../../lib/engagement/summary.ts'), 'utf8')
  for (const line of src.split('\n').filter((l) => /\/\s*[a-zA-Z(]/.test(l) && !l.trim().startsWith('*') && !l.trim().startsWith('//'))) {
    const ga4 = /activeUsers|engagedUsers|engagementSeconds|\be\b|\bo\b/.test(line)
    const bank = /active\[|\bu\b|returned_next|days_used|\bactive\b/.test(line)
    assert.ok(!(ga4 && bank) || /e \/ o|v \/ active|rest \/ active/.test(line), `crosses instruments: ${line.trim()}`)
  }
})

test('#1099 spec B15 item 10: the heat step changes at 0.05 and 0.35, and a null has no step', () => {
  assert.equal(heatStep(0.049), 0)
  assert.equal(heatStep(0.05), 1)
  assert.equal(heatStep(0.1), 2)
  assert.equal(heatStep(0.349), 3)
  assert.equal(heatStep(0.35), 4)
  assert.equal(heatStep(0), 0)
  assert.equal(heatStep(null), null)
})

