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

import { buildGrid, type Cell, type GridInput } from '@/lib/engagement/cells'
import { parseBankReport, parseGa4Report } from '@/lib/engagement/report'
import {
  buildFrequencyColumns,
  buildModeColumns,
  buildModesPanel,
  buildTiles,
  cohortCurve,
  COLUMN_PLOT_PX,
  formatDelta,
  heatStep,
  MINUS,
  modesSplitSince,
  newEngagedCell,
  SUMMARY_MIN_BASE,
  summaryMonthOf,
  SUPPRESSED_SEGMENT,
  tileDelta,
  UNSPLIT_SEGMENT,
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

test('#1099 #1154 DS-COMPONENTE-100 item 1: a change rounded to zero at one decimal is flat; a fall is down', () => {
  assert.equal(tileDelta(point('2026-10', 100.04, 40), point('2026-09', 100, 40), 'relative', '2026-11').state, 'flat')
  assert.equal(tileDelta(point('2026-10', 100.4, 40), point('2026-09', 100, 40), 'relative', '2026-11').state, 'up')
  const down = tileDelta(point('2026-10', 95, 40), point('2026-09', 100, 40), 'relative', '2026-11')
  assert.equal(down.state, 'down')
  assert.equal(down.rounded, -5)
})

test('#1099 DS-COMPONENTE-100 item 3 DS-COMPONENTE-084 item 2: the current month prints until today and no change; a floor never compares', () => {
  assert.equal(tileDelta(point('2026-11', 30, 40), point('2026-10', 100, 40), 'relative', '2026-11').state, 'partial')
  // A floor never compares: as the month before it is partial; as the tile's own month it says when it closes (#1154).
  const floor: TilePoint = { month: '2026-10', cell: { ...measured(0.09), state: 'floor', due: '2026-12-01' }, base: 187 }
  assert.equal(tileDelta(point('2026-11', 0.1, 40), floor, 'points', '2026-12').state, 'partial')
  const own = tileDelta(floor, point('2026-09', 0.11, 231), 'points', '2026-11')
  assert.deepEqual([own.state, own.due, own.rounded], ['closes', '2026-12-01', null])
  // Selecting the current month: no tile compares; the return tile says when November closes.
  const tiles = buildTiles(input({ summaryMonth: '2026-11' }))
  assert.deepEqual(tiles.map((t) => t.delta.state), ['partial', 'partial', 'partial', 'closes'])
  assert.equal(tiles[3].delta.due, '2027-01-01')
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

test('#1154 DS-COMPONENTE-100: with no measured month before, the tile says "new" instead of a change', () => {
  const before: TilePoint = { month: '2026-09', cell: { state: 'before_source', value: null, share: null, since: '2026-10-01', due: null }, base: null }
  assert.deepEqual([tileDelta(point('2026-10', 30, 40), before, 'relative', '2026-11').state, tileDelta(point('2026-10', 30, 40), before, 'relative', '2026-11').rounded], ['new', null])
  const fewer: TilePoint = { month: '2026-09', cell: { state: 'suppressed', value: null, share: null, since: null, due: null }, base: 3 }
  assert.equal(tileDelta(point('2026-10', 0.2, 40), fewer, 'points', '2026-11').state, 'new')
  // from a measured zero a count is new, and zero to zero is steady
  assert.equal(tileDelta(point('2026-10', 12, 40), point('2026-09', 0, 40), 'relative', '2026-11').state, 'new')
  assert.equal(tileDelta(point('2026-10', 0, 40), point('2026-09', 0, 40), 'relative', '2026-11').state, 'flat')
  // a failed or pending read before is not "new": it stays unknown
  const failed: TilePoint = { month: '2026-09', cell: { state: 'source_failed', value: null, share: null, since: null, due: null }, base: null }
  assert.equal(tileDelta(point('2026-10', 30, 40), failed, 'relative', '2026-11').state, 'unknown')
  // the current month still prints until today, never "new"
  assert.equal(tileDelta(point('2026-11', 30, 40), before, 'relative', '2026-11').state, 'partial')
  // the first month of the ruler: the month before was never read, so no tile calls itself new
  const august = buildTiles(input({ summaryMonth: '2026-08' }))
  assert.ok(august.every((t) => t.delta.state !== 'new'), JSON.stringify(august.map((t) => t.delta.state)))
  // September of a bank whose guide time starts in September: the guide tile is new
  const late = parseBankReport({ data_since: SINCE, months: [month('2026-08', { guide_minutes_median: null }), month('2026-09'), month('2026-10'), month('2026-11')] })
  assert.equal(tile(input({ bank: late, summaryMonth: '2026-09' }), 'guide_median').delta.state, 'new')
})

// ── §B15 item 4 ─────────────────────────────────────────────────────────────────────────────

test('#1154 DS-COMPONENTE-100 item 4: the return tile shows the month of the page; while its window is open it says it closes on the first day of the month after the next', () => {
  // October selected on 2026-11-04: October's return is known only when November ends.
  const ret = tile(input(), 'returned')
  assert.equal(ret.month, '2026-10')
  assert.equal(ret.point.cell.state, 'not_due')
  assert.equal(ret.point.cell.value, null)
  assert.deepEqual([ret.delta.state, ret.delta.due, ret.delta.rounded], ['closes', '2026-12-01', null])
  // September selected: closed, measured, and compared with August.
  const sep = tile(input({ summaryMonth: '2026-09' }), 'returned')
  assert.deepEqual([sep.month, sep.point.cell.value, sep.point.base], ['2026-09', 0.11, 231])
  assert.deepEqual([sep.delta.state, sep.delta.rounded, sep.delta.due], ['down', -1, null])
  // The day it closes moves with the month, across the year.
  const dec = tileDelta({ month: '2026-12', cell: { state: 'not_due', value: null, share: null, since: null, due: '2027-02-01' }, base: 30 }, point('2026-11', 0.1, 30), 'points', '2027-01')
  assert.deepEqual([dec.state, dec.due], ['closes', '2027-02-01'])
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
  assert.equal(newEngagedCell('2026-10', failed).state, 'source_failed')
  assert.equal(newEngagedCell('2026-10', failed).value, null)
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

test('#1099 #1101 spec B15 item 7: November splits in three modes on one stripTop ruler, the months before data_since.open draw the neutral segment', () => {
  const { columns, top } = buildModeColumns(input())
  assert.deepEqual(columns.map((c) => c.month), MONTHS)
  assert.deepEqual(columns[3].segments.map((s) => s.key), ['drive_only', 'both', 'explore_only'])
  // the tallest month is August's 150 people who used the guide, not November's 41
  assert.equal(top, 200)
  assert.ok(Math.abs(columns[3].segments[0].fraction * COLUMN_PLOT_PX - (9 / 200) * 160) < 1)
  const panel = buildModesPanel('2026-11', input())
  assert.deepEqual([panel.drive_only.value, panel.explore_only.value, panel.both.value, panel.fg.value, panel.bg.value, panel.bg_share.value], [9, 21, 11, 18, 14, 0.44])
})

test('#1101 spec C16 item 4 BR-COMUNICACAO-022 item 4: a month the database cannot split draws one trip_total segment of active.trip, never three zeros; with no active.trip the column stays empty with the modes reason', () => {
  const { columns, top } = buildModeColumns(input())
  for (const [i, trip] of [[0, 150], [1, 160], [2, 120]] as const) {
    const segs = columns[i].segments
    assert.equal(UNSPLIT_SEGMENT, 'trip_total')
    assert.deepEqual(segs.map((s) => s.key), [UNSPLIT_SEGMENT])
    assert.equal(segs[0].cell.value, trip)
    assert.ok(Math.abs(segs[0].fraction * 160 - (trip / top) * 160) < 1)
  }
  assert.equal(modesSplitSince(input()), '2026-11')
  // migration 20261104140000 not applied: every month is unsplit, November included
  const noModes = parseBankReport({ data_since: SINCE, months: MONTHS.map((m) => month(m)).map(({ modes: _m, ...m }) => m) })
  assert.equal(noModes.has_mode_fields, false)
  const all = buildModeColumns(input({ bank: noModes }))
  assert.ok(all.columns.every((c) => c.segments.length === 1 && c.segments[0].key === UNSPLIT_SEGMENT))
  assert.equal(modesSplitSince(input({ bank: noModes })), null)
  // active.trip null: no grey segment and no zero, the three modes keep their reason and draw nothing
  const noTrip = parseBankReport({ data_since: SINCE, months: [month('2026-09', { active: { open: null, trip: null, audio: 231 } })] })
  const col = buildModeColumns(input({ bank: noTrip })).columns[1]
  assert.deepEqual(col.segments.map((s) => [s.key, s.cell.state, s.fraction]), [['drive_only', 'before_source', 0], ['both', 'before_source', 0], ['explore_only', 'before_source', 0]])
  for (const s of col.segments) noZeroFromNull(s.cell)
  // the bank failed: nothing claims a split month
  assert.equal(modesSplitSince(input({ bank: undefined, bankFailed: true })), null)
})

test('#1101 spec C16 item 10 BR-COMUNICACAO-022 item 4: the interacted cell is GA4 of the month; a payload without newEngagedUsers is no_source, never 0', () => {
  const withNew = parseGa4Report({ months: GA4.months.map((m) => ({ ...m, newEngagedUsers: m.month === '2026-10' ? 150 : 0 })), clicks: [] })!
  assert.deepEqual(newEngagedCell('2026-10', input({ ga4: withNew })), { ...newEngagedCell('2026-10', input({ ga4: withNew })), state: 'measured', value: 150 })
  assert.equal(newEngagedCell('2026-09', input({ ga4: withNew })).value, 0)
  const old = newEngagedCell('2026-10', input())
  assert.equal(old.state, 'no_source')
  assert.equal(old.value, null)
  assert.equal(newEngagedCell('2026-10', input({ ga4: undefined, ga4Failed: true })).state, 'source_failed')
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
