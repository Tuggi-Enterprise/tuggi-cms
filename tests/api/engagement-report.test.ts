/**
 * #1094: the Engagement report grid, months and filters (spec-cms-relatorio-engajamento-2026-11 §3,
 * §4 and §6; contract banco-para-cms Parte 25). Pure modules, no mount:
 * `lib/engagement/cells.ts`, `lib/engagement/months.ts`, `lib/engagement/report.ts`,
 * `lib/engagement/clicks.ts`.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  bankSliceEmpty,
  buildGrid,
  cellFormatters,
  formatCell,
  windowCloses,
  type GridCard,
  type GridInput,
} from '@/lib/engagement/cells'
import { ENGAGEMENT_MAX_MONTHS, engagementMonths, engagementRange, saoPauloDay } from '@/lib/engagement/months'
import { parseBankReport, parseEngagementFilters, parseGa4Report, type EngagementBankMonth } from '@/lib/engagement/report'
import { clickBlocks, defaultClicksMonth } from '@/lib/engagement/clicks'
import { UNKNOWN_VALUE } from '@/lib/format/unknown'

const TODAY = '2026-11-04'
const MONTHS = ['2026-08', '2026-09', '2026-10', '2026-11']

function month(m: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    month: m,
    active: { open: null, trip: 150, audio: 204 },
    new: { open: null, trip: 142, audio: 160 },
    guide_minutes_median: 31.4,
    guide_minutes_p75: 72,
    days_used: {
      open: { d1: null, d2: null, d3_5: null, d6_plus: null },
      trip: { d1: 100, d2: 30, d3_5: 15, d6_plus: 5 },
      audio: { d1: 131, d2: 40, d3_5: 26, d6_plus: 7 },
    },
    returned_next_month: { open: null, trip: 0.1, audio: 0.12 },
    activation: { audio_24h: 0.71, audio_7d: 0.78 },
    cohort: { size: 142, retention: { d1: 0.23, d7: 0.31, d30: 0.14, d60: 0.09, d90: null }, second_trip: { d30: 0.11, d60: 0.15, d90: null } },
    ...over,
  }
}

const bank = (months: Record<string, unknown>[], since = { open: '2026-10-28', trip: '2026-08-01', audio: '2026-08-01' }) =>
  parseBankReport({ data_since: since, months })

const ga4 = parseGa4Report({
  months: [
    { month: '2026-08', activeUsers: 318, engagementSeconds: 318 * 540, sessionsPerUser: 2.3 },
    { month: '2026-09', activeUsers: 327, engagementSeconds: 327 * 480, sessionsPerUser: 2.1 },
    { month: '2026-10', activeUsers: 262, engagementSeconds: 262 * 600, sessionsPerUser: 2.4 },
  ],
  clicks: [],
})!

function grid(over: Partial<GridInput> = {}): GridCard[] {
  return buildGrid({
    months: MONTHS,
    today: TODAY,
    use: 'audio',
    bank: bank(MONTHS.map((m) => month(m))),
    bankFailed: false,
    ga4,
    ga4Failed: false,
    ga4Filtered: false,
    ...over,
  })
}

function cell(cards: GridCard[], row: string, m: string) {
  const i = MONTHS.indexOf(m)
  for (const c of cards) for (const g of c.groups) for (const r of g.rows) if (r.key === row) return { ...r.cells[i], kind: r.kind }
  throw new Error(`no row ${row}`)
}

const f = cellFormatters('pt')
const printed = (cards: GridCard[], row: string, m: string) => {
  const c = cell(cards, row, m)
  return formatCell(c.kind, c, f)
}

test('#1094 BR-COMUNICACAO-022 item 4 DS-COMPONENTE-084 item 1: a null cell prints "no data" with its reason, never 0, and the two reasons differ', () => {
  const months = MONTHS.map((m) =>
    m === '2026-08'
      ? month(m, { active: { open: null, trip: 150, audio: null }, days_used: { ...(month(m).days_used as object), audio: { d1: 131, d2: 40, d3_5: 26, d6_plus: null } } })
      : month(m)
  )
  // audio began recording in September: August is before the source, and d6_plus there is hidden for being under 5.
  const cards = grid({ bank: bank(months, { open: '2026-10-28', trip: '2026-08-01', audio: '2026-09-03' }) })
  const active = cell(cards, 'active_by', '2026-08')
  assert.equal(active.state, 'before_source')
  assert.equal(active.since, '2026-09-03')
  assert.equal(printed(cards, 'active_by', '2026-08').main, UNKNOWN_VALUE)

  const septemberSince = grid({ bank: bank(months, { open: '2026-10-28', trip: '2026-08-01', audio: '2026-08-01' }) })
  const d6 = cell(septemberSince, 'days_6_plus', '2026-08')
  assert.equal(d6.state, 'suppressed')
  assert.equal(formatCell(d6.kind, d6, f).main, UNKNOWN_VALUE)
  assert.notEqual(d6.state, active.state)

  // No cell anywhere prints 0 from a null.
  for (const c of cards) for (const g of c.groups) for (const r of g.rows) for (const x of r.cells) {
    if (x.value === null) assert.equal(formatCell(r.kind, x, f).main, UNKNOWN_VALUE, `${r.key}`)
  }
})

test('#1094 BR-COMUNICACAO-022 item 4: a measured zero prints 0, a null prints the dash', () => {
  const months = MONTHS.map((m) => (m === '2026-09' ? month(m, { new: { open: null, trip: 0, audio: 0 } }) : month(m)))
  const cards = grid({ bank: bank(months) })
  assert.equal(cell(cards, 'new_by', '2026-09').state, 'measured')
  assert.equal(printed(cards, 'new_by', '2026-09').main, '0')
})

test('#1094 DS-COMPONENTE-084 item 1: an open window prints a floor with a number and "not due" with null; D90 of a young cohort is not due, not suppressed', () => {
  const withNumber = grid()
  const oct = cell(withNumber, 'returned_next', '2026-10')
  assert.equal(oct.state, 'floor')
  assert.equal(oct.due, '2026-12-01')
  assert.equal(printed(withNumber, 'returned_next', '2026-10').main, '12%')
  // September closed on 2026-11-01: measured.
  assert.equal(cell(withNumber, 'returned_next', '2026-09').state, 'measured')

  const months = MONTHS.map((m) => (m === '2026-10' ? month(m, { returned_next_month: { open: null, trip: null, audio: null } }) : month(m)))
  const withNull = grid({ bank: bank(months) })
  assert.equal(cell(withNull, 'returned_next', '2026-10').state, 'not_due')

  // September's cohort: D90 closes on 2026-12-30.
  const d90 = cell(withNumber, 'ret_d90', '2026-09')
  assert.equal(d90.state, 'not_due')
  assert.equal(d90.due, '2026-12-30')
  // August's D90 closes on 2026-11-30 (2026-09-01 + 90 days), after today: still not due.
  assert.equal(cell(withNumber, 'ret_d90', '2026-08').state, 'not_due')
  // A closed window with null is suppressed: August D60 closed on 2026-10-31.
  const aug = MONTHS.map((m) => (m === '2026-08' ? month(m, { cohort: { size: 4, retention: { d1: null, d7: null, d30: null, d60: null, d90: null }, second_trip: { d30: null, d60: null, d90: null } } }) : month(m)))
  assert.equal(cell(grid({ bank: bank(aug) }), 'ret_d60', '2026-08').state, 'suppressed')
})

test('#1094: the current month marks no floor cell by cell, its header says "until today"', () => {
  const cards = grid()
  assert.equal(cell(cards, 'audio_7d', '2026-11').state, 'measured')
  // October's 7 days close on 2026-11-08, after today: a floor there.
  assert.equal(cell(cards, 'audio_7d', '2026-10').state, 'floor')
})

test('#1094: windows close from the end of the month (spec 3.2)', () => {
  assert.equal(windowCloses('2026-10', 'next_month'), '2026-12-01')
  assert.equal(windowCloses('2026-10', { days: 1 }), '2026-11-02')
  assert.equal(windowCloses('2026-10', { days: 7 }), '2026-11-08')
  assert.equal(windowCloses('2026-12', { days: 30 }), '2027-01-31')
})

test('#1094: `open` counts only whole months after its data_since; trip and audio count from the month of their first row', () => {
  const months = MONTHS.map((m) => month(m, { active: { open: m === '2026-11' ? 41 : null, trip: 150, audio: 204 } }))
  const cards = grid({ use: 'open', bank: bank(months) })
  assert.equal(cell(cards, 'active_by', '2026-10').state, 'before_source')
  assert.equal(cell(cards, 'active_by', '2026-11').state, 'measured')
  const tripLate = grid({ use: 'trip', bank: bank(months.map((m) => ({ ...m, active: { open: null, trip: null, audio: 204 } })), { open: '2026-10-28', trip: '2026-08-20', audio: '2026-08-01' }) })
  assert.equal(cell(tripLate, 'active_by', '2026-08').state, 'suppressed')
})

test('#1094 DS-COMPONENTE-084 item 2: the share of a day band is bank over bank of the same use and month, never over GA4', () => {
  const cards = grid()
  const d1 = cell(cards, 'days_1', '2026-08')
  assert.equal(d1.share, 131 / 204)
  assert.equal(printed(cards, 'days_1', '2026-08').share, '64%')
  const otherGa4 = grid({ ga4: { months: ga4.months.map((m) => ({ ...m, activeUsers: 9999 })), clicks: [] } })
  assert.equal(cell(otherGa4, 'days_1', '2026-08').share, 131 / 204)
  // No base: the count alone.
  const noBase = MONTHS.map((m) => month(m, { active: { open: null, trip: 150, audio: null } }))
  assert.equal(cell(grid({ bank: bank(noBase) }), 'days_1', '2026-08').share, null)
})

test('#1094: GA4 rows are GA4 by GA4, a month GA4 left out is zero active, and no active user is no average', () => {
  const cards = grid()
  assert.equal(printed(cards, 'active_ga4', '2026-08').main, '318')
  assert.equal(printed(cards, 'screen_minutes', '2026-08').main, '9 min')
  assert.equal(printed(cards, 'sessions_ga4', '2026-08').main, '2,3')
  assert.equal(cell(cards, 'active_ga4', '2026-11').value, 0)
  assert.equal(cell(cards, 'screen_minutes', '2026-11').state, 'suppressed')
})

test('#1094: a filter GA4 does not have, a failed GA4 and a failed bank each mark only their own rows', () => {
  const filtered = grid({ ga4Filtered: true })
  assert.equal(cell(filtered, 'active_ga4', '2026-08').state, 'ga4_filter')
  assert.equal(cell(filtered, 'active_by', '2026-08').state, 'measured')
  const ga4Down = grid({ ga4: undefined, ga4Failed: true })
  assert.equal(cell(ga4Down, 'sessions_ga4', '2026-08').state, 'source_failed')
  assert.equal(cell(ga4Down, 'days_1', '2026-08').state, 'measured')
  const bankDown = grid({ bank: undefined, bankFailed: true })
  assert.equal(cell(bankDown, 'cohort_size', '2026-08').state, 'source_failed')
  assert.equal(cell(bankDown, 'active_ga4', '2026-08').state, 'measured')
  const loading = grid({ bank: undefined, ga4: undefined })
  assert.equal(cell(loading, 'active_by', '2026-08').state, 'loading')
  assert.equal(cell(loading, 'active_ga4', '2026-08').state, 'loading')
})

test('#1094: a month the database did not return is a column of "before the source", same columns and rows as the data', () => {
  const cards = grid({ bank: bank(MONTHS.filter((m) => m !== '2026-08').map((m) => month(m))) })
  assert.equal(cell(cards, 'active_by', '2026-08').state, 'before_source')
  const rows = (c: GridCard[]) => c.map((x) => x.groups.map((g) => g.rows.map((r) => `${r.key}:${r.cells.length}`)))
  assert.deepEqual(rows(grid({ bank: undefined, ga4: undefined })), rows(grid()))
  // The rows of spec §4: 6, 6 and 11.
  assert.deepEqual(grid().map((c) => c.groups.reduce((s, g) => s + g.rows.length, 0)), [6, 6, 11])
})

test('#1094: the empty slice is every bank cell without a number', () => {
  const nothing = parseBankReport({
    data_since: { open: '2026-10-28', trip: '2026-08-01', audio: '2026-08-01' },
    months: MONTHS.map((m) => ({ month: m })),
  })
  assert.equal(bankSliceEmpty(grid({ bank: nothing })), true)
  assert.equal(bankSliceEmpty(grid()), false)
})

test('#1094: the month ruler runs from 2026-08 to the current month in Sao Paulo, at most thirteen, and the range fits the 400 days of the function', () => {
  assert.deepEqual(engagementMonths(new Date('2026-11-04T12:00:00Z')), MONTHS)
  // 23:00 of Nov 30 in Sao Paulo is already December in UTC.
  assert.equal(saoPauloDay(new Date('2026-12-01T02:00:00Z')), '2026-11-30')
  const lastOfNov = engagementMonths(new Date('2026-12-01T02:00:00Z'))
  assert.equal(lastOfNov[lastOfNov.length - 1], '2026-11')
  const later = engagementMonths(new Date('2028-03-10T12:00:00Z'))
  assert.equal(later.length, ENGAGEMENT_MAX_MONTHS)
  assert.equal(later[later.length - 1], '2028-03')
  assert.deepEqual(engagementRange(MONTHS), { p_from: '2026-08-01T00:00:00-03:00', p_to: '2026-12-01T00:00:00-03:00' })
  const r = engagementRange(later)
  assert.ok((Date.parse(r.p_to) - Date.parse(r.p_from)) / 86_400_000 <= 400)
})

test('#1094: filters take the domain of the contract and refuse anything else before the database', () => {
  const p = (q: string) => parseEngagementFilters(new URLSearchParams(q))
  assert.deepEqual(p(''), { source: null, country: null, platform: null, account: null })
  assert.deepEqual(p('source=none&country=BR&platform=ios&account=anonymous'), { source: 'none', country: 'BR', platform: 'ios', account: 'anonymous' })
  assert.deepEqual(p('platform=all&account=all'), { source: null, country: null, platform: null, account: null })
  for (const bad of ['country=Brazil', 'country=br', 'platform=web', 'account=guest', "source=x';drop", `source=${'a'.repeat(41)}`]) {
    assert.equal(p(bad), 'invalid', bad)
  }
})

test('#1094 BR-COMUNICACAO-022 item 4: the parser keeps null apart from zero and drops nothing it was sent', () => {
  const r = parseBankReport({ data_since: { open: '2026-10-28', trip: null }, months: [{ month: '2026-09', active: { open: 0 }, cohort: { size: null } }] })
  const m: EngagementBankMonth = r.months[0]
  assert.equal(r.data_since.trip, null)
  assert.equal(r.data_since.audio, null)
  assert.equal(m.active.open, 0)
  assert.equal(m.active.trip, null)
  assert.equal(m.cohort.size, null)
  assert.equal(m.cohort.retention.d90, null)
  assert.equal(parseGa4Report({ months: 'x' }), null)
})

test('#1094: clicks are one month, grouped by screen by the sum of people, on the ruler of the most people of the month', () => {
  const clicks = [
    { month: '2026-10', screen: 'guide_map', button: 'start_guide', events: 301, users: 142 },
    { month: '2026-10', screen: 'guide_map', button: 'open_explore', events: 140, users: 88 },
    { month: '2026-10', screen: 'poi_detail', button: 'play_audio', events: 264, users: 118 },
    { month: '2026-09', screen: 'poi_detail', button: 'play_audio', events: 999, users: 500 },
  ]
  const { blocks, max } = clickBlocks(clicks, '2026-10')
  assert.equal(max, 142)
  assert.deepEqual(blocks.map((b) => b.screen), ['guide_map', 'poi_detail'])
  assert.deepEqual(blocks[0].rows.map((r) => r.button), ['start_guide', 'open_explore'])
  assert.equal(defaultClicksMonth(MONTHS, clicks), '2026-10')
  assert.equal(defaultClicksMonth(MONTHS, []), '2026-11')
})
