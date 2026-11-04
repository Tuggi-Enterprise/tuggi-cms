/**
 * #1099: the executive summary on top of the Engagement report (spec-cms-relatorio-engajamento-2026-11
 * Parte B, criterion §B15 items 1, 3, 4, 5, 7, 8, 9, 10). Pure module, no mount:
 * `lib/engagement/summary.ts`.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { buildGrid, type Cell, type GridInput } from '@/lib/engagement/cells'
import { parseBankReport, parseGa4Report } from '@/lib/engagement/report'
import {
  buildFrequencyColumns,
  buildFunnel,
  buildModeColumns,
  buildModesPanel,
  buildTiles,
  cohortCurve,
  COLUMN_PLOT_PX,
  formatDelta,
  heatStep,
  MINUS,
  SUMMARY_MIN_BASE,
  summaryMonthOf,
  SUPPRESSED_SEGMENT,
  tileDelta,
  type SummaryInput,
  type TilePoint,
} from '@/lib/engagement/summary'

const TODAY = '2026-11-04'
const MONTHS = ['2026-08', '2026-09', '2026-10', '2026-11']

function month(m: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    month: m,
    active: { open: null, trip: 150, audio: 204 },
    new: { open: null, trip: 142, audio: 160 },
    guide_minutes_median: 30,
    guide_minutes_p75: 72,
    modes: { drive_only: null, explore_only: null, both: null },
    guide_foreground_minutes_median: null,
    guide_background_minutes_median: null,
    guide_background_share: null,
    days_used: {
      open: { d1: null, d2: null, d3_5: null, d6_plus: null },
      trip: { d1: 100, d2: 30, d3_5: 15, d6_plus: 5 },
      audio: { d1: 131, d2: 40, d3_5: 26, d6_plus: 7 },
    },
    returned_next_month: { open: null, trip: 0.1, audio: 0.12 },
    activation: { audio_24h: null, audio_7d: null },
    cohort: { size: 142, retention: { d1: 0.23, d7: 0.31, d30: 0.14, d60: 0.09, d90: null }, second_trip: { d30: 0.11, d60: 0.15, d90: null } },
    ...over,
  }
}

const SINCE = { open: '2026-10-28', trip: '2026-08-01', audio: '2026-08-01' }

const BANK = parseBankReport({
  data_since: SINCE,
  months: [
    month('2026-08'),
    month('2026-09', { active: { open: null, trip: 160, audio: 231 }, returned_next_month: { open: null, trip: 0.09, audio: 0.11 } }),
    month('2026-10', { active: { open: null, trip: 120, audio: 187 }, guide_minutes_median: 36, returned_next_month: { open: null, trip: null, audio: null } }),
    month('2026-11', {
      active: { open: 41, trip: 20, audio: 29 },
      modes: { drive_only: 9, explore_only: 21, both: 11 },
      guide_foreground_minutes_median: 18,
      guide_background_minutes_median: 14,
      guide_background_share: 0.44,
      returned_next_month: { open: null, trip: null, audio: null },
    }),
  ],
})

const GA4 = parseGa4Report({
  months: [
    { month: '2026-08', activeUsers: 318, engagementSeconds: 318 * 540, sessionsPerUser: 2.3, engagedUsers: 160 },
    { month: '2026-09', activeUsers: 327, engagementSeconds: 327 * 480, sessionsPerUser: 2.1, engagedUsers: 175 },
    { month: '2026-10', activeUsers: 262, engagementSeconds: 262 * 600, sessionsPerUser: 2.4, engagedUsers: 189 },
    { month: '2026-11', activeUsers: 41, engagementSeconds: 41 * 420, sessionsPerUser: 1.6, engagedUsers: 30 },
  ],
  clicks: [],
})!

const input = (over: Partial<SummaryInput> = {}): SummaryInput => ({
  months: MONTHS,
  today: TODAY,
  use: 'audio',
  bank: BANK,
  bankFailed: false,
  ga4: GA4,
  ga4Failed: false,
  ga4Filtered: false,
  summaryMonth: '2026-10',
  ...over,
})

const measured = (value: number): Cell => ({ state: 'measured', value, share: null, since: null, due: null })
const point = (m: string, value: number, base: number): TilePoint => ({ month: m, cell: measured(value), base })
const tile = (inp: SummaryInput, key: string) => buildTiles(inp).find((t) => t.key === key)!

/** Every printed state with a null value must not carry a number. */
const noZeroFromNull = (c: Cell) => assert.ok(c.value !== 0 || c.state === 'measured', JSON.stringify(c))

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

test('#1099 DS-COMPONENTE-100 item 1: a change rounded to zero is flat; a fall is down', () => {
  assert.equal(tileDelta(point('2026-10', 100.4, 40), point('2026-09', 100, 40), 'relative', '2026-11').state, 'flat')
  const down = tileDelta(point('2026-10', 95, 40), point('2026-09', 100, 40), 'relative', '2026-11')
  assert.equal(down.state, 'down')
  assert.equal(down.rounded, -5)
})

test('#1099 DS-COMPONENTE-100 item 3 DS-COMPONENTE-084 item 2: the current month prints until today and no change; a floor never compares', () => {
  assert.equal(tileDelta(point('2026-11', 30, 40), point('2026-10', 100, 40), 'relative', '2026-11').state, 'partial')
  const floor: TilePoint = { month: '2026-10', cell: { ...measured(0.09), state: 'floor' }, base: 187 }
  assert.equal(tileDelta(floor, point('2026-09', 0.11, 231), 'points', '2026-11').state, 'partial')
  // Selecting the current month: no tile compares, not even the return tile that falls back to September.
  const tiles = buildTiles(input({ summaryMonth: '2026-11' }))
  assert.deepEqual(tiles.map((t) => t.delta.state), ['partial', 'partial', 'partial', 'partial'])
})

test('#1099 DS-COMPONENTE-100 item 2: the sign on both sides, U+2212 on the negative, the unit printed', () => {
  const pt = (n: string) => `${n} pt`
  const down = tileDelta(point('2026-10', 95, 40), point('2026-09', 100, 40), 'relative', '2026-11')
  assert.equal(formatDelta(down, 'pt', pt), `${MINUS}5%`)
  assert.ok(!formatDelta(down, 'pt', pt)!.includes('-'), 'no hyphen-minus')
  const up = tileDelta(point('2026-10', 108, 40), point('2026-09', 100, 40), 'relative', '2026-11')
  assert.equal(formatDelta(up, 'pt', pt), '+8%')
  const rateDown = tileDelta(point('2026-10', 0.1, 231), point('2026-09', 0.11, 204), 'points', '2026-11')
  assert.equal(rateDown.state, 'down')
  assert.equal(formatDelta(rateDown, 'pt', pt), `${MINUS}1 pt`)
  assert.equal(formatDelta(tileDelta(point('2026-11', 1, 40), point('2026-10', 1, 40), 'relative', '2026-11'), 'pt', pt), null)
})

test('#1099 DS-COMPONENTE-100 item 5: a rate changes in points, a count and a duration in relative percent', () => {
  const tiles = buildTiles(input())
  assert.deepEqual(tiles.map((t) => [t.key, t.delta.unit]), [
    ['engaged', 'relative'],
    ['guide_median', 'relative'],
    ['screen_minutes', 'relative'],
    ['returned', 'points'],
  ])
  // guide median: 36 against 30, bases 120 and 160 people who travelled
  const guide = tiles[1]
  assert.equal(guide.delta.state, 'up')
  assert.equal(guide.delta.rounded, 20)
  assert.deepEqual([guide.delta.prev.base, guide.delta.curr.base], [160, 120])
})

// ── §B15 item 4 ─────────────────────────────────────────────────────────────────────────────

test('#1099 DS-COMPONENTE-100 item 4 spec B15 item 4: the return tile of a month not due shows the last measured month, names it, and compares it with the one before', () => {
  const ret = tile(input(), 'returned')
  assert.equal(ret.month, '2026-09')
  assert.equal(ret.point.cell.value, 0.11)
  assert.equal(ret.point.base, 231)
  assert.equal(ret.delta.prev.month, '2026-08')
  assert.equal(ret.delta.curr.month, '2026-09')
  assert.equal(ret.delta.state, 'down')
  assert.equal(ret.delta.rounded, -1)
  // August selected: its window closed, it is itself.
  assert.equal(tile(input({ summaryMonth: '2026-08' }), 'returned').month, '2026-08')
})

// ── §B15 item 5 ─────────────────────────────────────────────────────────────────────────────

test('#1099 DS-COMPONENTE-084 item 2: the engaged share is GA4 engaged over GA4 active of the same month, and an over-count prints no share', () => {
  const engaged = tile(input(), 'engaged')
  assert.equal(engaged.point.cell.value, 189)
  assert.equal(engaged.share, 189 / 262)
  assert.equal(engaged.over, false)
  const over = parseGa4Report({ months: [{ ...GA4.months[2], engagedUsers: 300 }], clicks: [] })!
  const t = tile(input({ ga4: over }), 'engaged')
  assert.equal(t.share, null)
  assert.equal(t.over, true)
})

test('#1099 DS-COMPONENTE-084 item 2: summary.ts divides no GA4 field by a bank field', () => {
  const src = readFileSync(resolve(import.meta.dirname, '../../lib/engagement/summary.ts'), 'utf8')
  for (const line of src.split('\n').filter((l) => /\/\s*[a-zA-Z(]/.test(l) && !l.trim().startsWith('*') && !l.trim().startsWith('//'))) {
    const ga4 = /activeUsers|engagedUsers|engagementSeconds|\be\b|\bo\b/.test(line)
    const bank = /active\[|\bu\b|returned_next|days_used|\bactive\b/.test(line)
    assert.ok(!(ga4 && bank) || /e \/ o|v \/ active|rest \/ active/.test(line), `crosses instruments: ${line.trim()}`)
  }
})

test('#1099 BR-COMUNICACAO-022 item 4 DS-COMPONENTE-084: a missing number is a state, never 0, in tiles, funnel, modes and frequency', () => {
  const failed = input({ bankFailed: true, bank: undefined, ga4Failed: true, ga4: undefined })
  for (const t of buildTiles(failed)) {
    assert.equal(t.point.cell.state, 'source_failed', t.key)
    assert.equal(t.point.cell.value, null)
    assert.equal(t.delta.state, 'unknown')
    assert.ok(t.spark.every((s) => s.value === null))
  }
  const f = buildFunnel('2026-10', failed)
  assert.ok(f.steps.every((s) => s.value === null && s.rate === null))
  assert.equal(f.biggestDrop, null)
  assert.equal(f.max, 0)
  // GA4 deployed before engagedUsers: the field is absent, the tile says the source does not send it.
  const old = parseGa4Report({ months: GA4.months.map(({ engagedUsers: _e, ...m }) => m), clicks: [] })!
  const engaged = tile(input({ ga4: old }), 'engaged')
  assert.equal(engaged.point.cell.state, 'no_source')
  assert.equal(engaged.point.cell.value, null)
  // Migration 20261104140000 not applied: the modes keys are absent and say so, never 0.
  const before1098 = parseBankReport({ data_since: SINCE, months: [month('2026-11', { modes: undefined })].map(({ modes: _m, ...m }) => m) })
  assert.equal(before1098.has_mode_fields, false)
  const panel = buildModesPanel('2026-11', input({ bank: before1098 }))
  for (const c of Object.values(panel)) {
    assert.equal(c.state, 'no_source')
    noZeroFromNull(c)
  }
})

// ── §B15 item 6 helpers (the sparkline series) ─────────────────────────────────────────────

test('#1099 spec B4.3: the tile line has six slots ending at the tile month; months before the ruler are gaps', () => {
  const engaged = tile(input(), 'engaged')
  assert.deepEqual(engaged.spark.map((s) => s.month), ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'])
  assert.deepEqual(engaged.spark.map((s) => s.value), [null, null, null, 160, 175, 189])
})

// ── §B15 item 7 ─────────────────────────────────────────────────────────────────────────────

test('#1099 spec B15 item 7: modes columns follow the ruler; a month before data_since.open is before_source in all three, on one stripTop ruler', () => {
  const { columns, top } = buildModeColumns(input())
  assert.deepEqual(columns.map((c) => c.month), MONTHS)
  assert.deepEqual(columns[3].segments.map((s) => s.key), ['drive_only', 'both', 'explore_only'])
  assert.equal(top, 50)
  assert.ok(Math.abs(columns[3].segments[0].fraction * COLUMN_PLOT_PX - (9 / 50) * 160) < 1)
  // contract Parte 25: the three groups are null until open is measured, drive_only too
  for (const s of columns[1].segments) {
    assert.equal(s.cell.state, 'before_source')
    assert.equal(s.cell.since, '2026-10-28')
    assert.equal(s.fraction, 0)
  }
  const panel = buildModesPanel('2026-11', input())
  assert.deepEqual([panel.drive_only.value, panel.explore_only.value, panel.both.value, panel.fg.value, panel.bg.value, panel.bg_share.value], [9, 21, 11, 18, 14, 0.44])
})

// ── §B15 item 8 ─────────────────────────────────────────────────────────────────────────────

test('#1099 DS-COMPONENTE-084 item 2 spec B15 item 8: of_opened is GA4 over GA4, of_used bank over bank, the max is the largest of four, one biggest drop', () => {
  const sep = buildFunnel('2026-09', input())
  assert.deepEqual(sep.steps.map((s) => [s.key, s.source]), [['opened', 'ga4'], ['engaged', 'ga4'], ['used', 'bank'], ['returned', 'bank']])
  assert.equal(sep.steps[1].rate, 175 / 327)
  assert.equal(sep.steps[3].rate, 0.11)
  assert.equal(sep.steps[3].value, Math.round(0.11 * 231))
  assert.equal(sep.max, 327)
  assert.equal(sep.biggestDrop, 'returned')
  // October: the return window is open, one rate measured, no badge
  const oct = buildFunnel('2026-10', input())
  assert.equal(oct.steps[3].cell.state, 'not_due')
  assert.equal(oct.steps[3].value, null)
  assert.equal(oct.biggestDrop, null)
  // a source filter empties the GA4 heads and keeps the bank steps
  const filtered = buildFunnel('2026-09', input({ ga4Filtered: true }))
  assert.deepEqual(filtered.steps.map((s) => s.cell.state), ['ga4_filter', 'ga4_filter', 'measured', 'measured'])
})

// ── §B15 item 9 ─────────────────────────────────────────────────────────────────────────────

test('#1099 spec B15 item 9: a frequency column sums 100 % of active[use]; a null band with a known base becomes the suppressed segment', () => {
  const cols = buildFrequencyColumns(input())
  const aug = cols[0]
  assert.ok(Math.abs(aug.segments.reduce((s, x) => s + x.fraction, 0) - 1) < 1e-9)
  const withNull = parseBankReport({
    data_since: SINCE,
    months: [month('2026-08', { days_used: { open: { d1: null, d2: null, d3_5: null, d6_plus: null }, trip: { d1: 1, d2: 1, d3_5: 1, d6_plus: 1 }, audio: { d1: 131, d2: 40, d3_5: 30, d6_plus: null } } })],
  })
  const col = buildFrequencyColumns(input({ months: ['2026-08'], bank: withNull }))[0]
  const rest = col.segments.find((s) => s.key === SUPPRESSED_SEGMENT)!
  assert.equal(rest.cell.state, 'suppressed')
  assert.equal(rest.cell.value, 3)
  assert.ok(Math.abs(col.segments.reduce((s, x) => s + x.fraction, 0) - 1) < 1e-9)
  // the base unknown: no segment, the column says why
  const open = buildFrequencyColumns(input())[1]
  assert.equal(buildFrequencyColumns(input({ use: 'open' }))[1].empty?.state, 'before_source')
  assert.equal(open.empty, null)
})

// ── §B15 item 10 ────────────────────────────────────────────────────────────────────────────

test('#1099 spec B15 item 10: the heat step changes at 0.05 and 0.35, and a null has no step', () => {
  assert.equal(heatStep(0.049), 0)
  assert.equal(heatStep(0.05), 1)
  assert.equal(heatStep(0.1), 2)
  assert.equal(heatStep(0.349), 3)
  assert.equal(heatStep(0.35), 4)
  assert.equal(heatStep(0), 0)
  assert.equal(heatStep(null), null)
})

test('#1099 spec B15 item 10: no curve with five closed cohorts; with six, the median of each D-N', () => {
  const months = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07']
  const cohortBank = (n: number) =>
    parseBankReport({
      data_since: { open: '2026-10-28', trip: '2026-01-01', audio: '2026-01-01' },
      months: months.map((m, i) =>
        month(m, { cohort: { size: 100, retention: { d1: 0.2 + i / 100, d7: 0.3, d30: i < n ? 0.1 + i / 100 : null, d60: null, d90: null }, second_trip: { d30: 0.1, d60: null, d90: null } } })
      ),
    })
  const card = (n: number) => {
    const g: GridInput = { months, today: '2026-11-04', use: 'audio', bank: cohortBank(n), bankFailed: false, ga4Failed: false, ga4Filtered: false }
    return buildGrid(g).find((c) => c.key === 'card_after_first')!
  }
  const five = cohortCurve(card(5))
  assert.equal(five.closed, 5)
  assert.equal(five.points, null)
  const six = cohortCurve(card(6))
  assert.equal(six.closed, 6)
  assert.equal(six.points!.length, 5)
  assert.ok(Math.abs(six.points![0]! - 0.23) < 1e-9)
  assert.ok(Math.abs(six.points![2]! - 0.125) < 1e-9)
  assert.equal(six.points![3], null)
})
