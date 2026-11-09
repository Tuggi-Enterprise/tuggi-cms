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
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  bankSliceEmpty,
  buildGrid,
  cellFormatters,
  formatCell,
  windowCloses,
  type GridCard,
  type GridInput,
} from '@/lib/engagement/cells'
import { conversionRedirectTarget, ENGAGEMENT_MAX_MONTHS, engagementMonths, engagementRange, saoPauloDay } from '@/lib/engagement/months'
import { parseBankReport, parseEngagementFilters, parseGa4Report, type EngagementBankMonth } from '@/lib/engagement/report'
import { clickBlocks, screenColor, SCREEN_RENAMES } from '@/lib/engagement/clicks'
import { ENGAGEMENT_DICTIONARY } from '@/lib/engagement/dictionary'
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
  // The rows of spec §4: 6, 6 and 11, plus "returned on day 1, 7 and 30" since #1154.
  assert.deepEqual(grid().map((c) => c.groups.reduce((s, g) => s + g.rows.length, 0)), [6, 6, 14])
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

test('#1101 spec C16 item 10 BR-COMUNICACAO-022 item 4: a GA4 payload without newEngagedUsers parses to null, a 0 stays 0', () => {
  const r = parseGa4Report({ months: [{ month: '2026-10', activeUsers: 262, engagedUsers: 189 }, { month: '2026-11', activeUsers: 41, engagedUsers: 30, newEngagedUsers: 0 }], clicks: [] })!
  assert.equal(r.months[0].newEngagedUsers, null)
  assert.equal(r.months[1].newEngagedUsers, 0)
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
  // guide_map is the old name of guide_map_screen (#1154): the line carries the new name
  assert.deepEqual(blocks.map((b) => b.screen), ['guide_map_screen', 'poi_detail'])
  assert.deepEqual(blocks[0].rows.map((r) => r.button), ['start_guide', 'open_explore'])
})

test('#1154 DS-COMPONENTE-100: an old screen name adds up on the line of its new name, button by button, and takes its color from the same table', () => {
  const clicks = [
    { month: '2026-10', screen: 'guide_map_screen', button: 'start_guide', events: 200, users: 90 },
    { month: '2026-10', screen: 'guide_map', button: 'start_guide', events: 101, users: 52 },
    { month: '2026-10', screen: 'guide_map', button: 'open_explore', events: 40, users: 30 },
    { month: '2026-10', screen: 'route_explorer', button: 'start_route', events: 12, users: 9 },
    { month: '2026-10', screen: 'route_explorer_sheet', button: 'start_route', events: 8, users: 6 },
    { month: '2026-09', screen: 'guide_map', button: 'start_guide', events: 999, users: 500 },
  ]
  const { blocks, max } = clickBlocks(clicks, '2026-10')
  assert.deepEqual(blocks.map((b) => b.screen), ['guide_map_screen', 'route_explorer_sheet'], 'no line keeps an old name')
  const guide = blocks[0]
  assert.deepEqual(guide.rows.map((r) => [r.button, r.events, r.users]), [['start_guide', 301, 142], ['open_explore', 40, 30]])
  assert.equal(guide.users, 172)
  assert.deepEqual(blocks[1].rows.map((r) => [r.button, r.events, r.users]), [['start_route', 20, 15]])
  // the ruler is the merged row, the other month never leaks in
  assert.equal(max, 142)
  for (const [old, now] of Object.entries(SCREEN_RENAMES)) assert.equal(screenColor(old), screenColor(now), old)
})

test('#1154 DS-COMPONENTE-084 item 2: every grid row has a dictionary entry with its own source', () => {
  const defined = new Map<string, Set<string>>()
  for (const e of ENGAGEMENT_DICTIONARY) for (const r of e.rows) defined.set(r, (defined.get(r) ?? new Set()).add(e.source))
  for (const c of grid()) for (const g of c.groups) for (const r of g.rows) {
    assert.deepEqual([...(defined.get(r.key) ?? [])], [r.source], r.key)
  }
})

test('#1154 spec D5 item 1: each entry prints the keys of its own line, which exist in the three languages; no entry carries a copied definition', () => {
  const engagement = (lang: string) => JSON.parse(readFileSync(resolve(process.cwd(), `messages/${lang}.json`), 'utf8')).Pages.Dashboard.reports.engagement
  const at = (o: Record<string, unknown>, path: string) => path.split('.').reduce<unknown>((acc, p) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[p] : undefined), o)
  for (const lang of ['en', 'pt', 'es']) {
    const m = engagement(lang)
    for (const e of ENGAGEMENT_DICTIONARY) {
      for (const key of [...e.terms, e.definition]) assert.equal(typeof at(m, key), 'string', `${lang} ${e.key} ${key}`)
    }
    assert.equal(m.dictionary.items, undefined, `${lang}: the copied definitions of the first version are gone`)
  }
  // a grid row's definition is the hint that row already carries
  for (const e of ENGAGEMENT_DICTIONARY) for (const r of e.rows) {
    if (/^(ret|ret_on|second)_/.test(r)) continue
    if (e.rows.length === 1) assert.equal(e.definition, `rows.${r}_hint`, e.key)
  }
  assert.deepEqual(new Set(ENGAGEMENT_DICTIONARY.map((e) => e.key)).size, ENGAGEMENT_DICTIONARY.length)
})

test('#1154 BR-COMUNICACAO-022 item 4: "returned on day N" is no data while the function does not send retention_on, never 0; sent, it prints with its n', () => {
  const absent = grid()
  for (const k of ['ret_on_d1', 'ret_on_d7', 'ret_on_d30']) {
    const c = cell(absent, k, '2026-08')
    assert.equal(c.state, 'no_source', k)
    assert.equal(c.value, null)
    assert.equal(formatCell(c.kind, c, f).main, UNKNOWN_VALUE)
  }
  const cohort = { size: 31, retention: { d1: 0.2258, d7: 0.3871, d30: 0.14, d60: null, d90: null }, retention_on: { d1: 0.2258, d7: 0.0645, d30: null }, second_trip: { d30: null, d60: null, d90: null } }
  const sent = grid({ bank: bank(MONTHS.map((m) => month(m, { cohort }))) })
  const on7 = cell(sent, 'ret_on_d7', '2026-08')
  assert.equal(on7.state, 'measured')
  assert.deepEqual(formatCell(on7.kind, on7, f), { main: '6%', share: null, n: { count: '2', base: '31' } })
  // NULL means what it means in retention: below the base of 5 or a window still open, never 0
  assert.notEqual(cell(sent, 'ret_on_d30', '2026-08').state, 'no_source')
  assert.equal(cell(sent, 'ret_on_d30', '2026-08').value, null)
  // "returned by day 7" is the share with another trip on day 1 to 7, so it can never be under "on day 7"
  assert.ok(cohort.retention.d7 >= cohort.retention_on.d7)
})

test('#1154: every rate prints the people behind it, "38% · 12 of 31", from the base of the same month and source', () => {
  const cards = grid()
  // returned the next month: 0.12 of active.audio 204
  assert.deepEqual(printed(cards, 'returned_next', '2026-08').n, { count: '24', base: '204' })
  // activation: base new.trip (D15 of 20261104130000), 0.71 of 142
  assert.deepEqual(printed(cards, 'audio_24h', '2026-08').n, { count: '101', base: '142' })
  // cohort rates: base cohort.size
  assert.deepEqual(printed(cards, 'ret_d7', '2026-08').n, { count: '44', base: '142' })
  assert.deepEqual(printed(cards, 'second_30', '2026-08').n, { count: '16', base: '142' })
  // an unknown base prints the percent alone, never "of 0"
  const noBase = grid({ bank: bank(MONTHS.map((m) => month(m, { active: { open: null, trip: 150, audio: null } }))) })
  assert.equal(printed(noBase, 'returned_next', '2026-08').n, null)
})

test('#1101 spec C16 item 1: the old Conversion route goes to the purchase funnel, a valid ?month=YYYY-MM-DD becomes ?month=YYYY-MM, anything else is dropped', () => {
  assert.equal(conversionRedirectTarget('pt', undefined), '/pt/dashboard/reports/engagement#conversion')
  assert.equal(conversionRedirectTarget('pt', '2026-10-01'), '/pt/dashboard/reports/engagement?month=2026-10#conversion')
  assert.equal(conversionRedirectTarget('en', '2026-09-15'), '/en/dashboard/reports/engagement?month=2026-09#conversion')
  for (const bad of ['2026-10', '2026-13-01', 'x', ['2026-10-01'], '2026-10-01&x=1']) {
    assert.equal(conversionRedirectTarget('pt', bad), '/pt/dashboard/reports/engagement#conversion', JSON.stringify(bad))
  }
})

test('#1101 spec C8.3: the Conversion page only redirects, with redirect() (307), and the screen it replaced is gone', () => {
  const src = readFileSync(resolve(import.meta.dirname, '../../app/[locale]/dashboard/reports/conversion/page.tsx'), 'utf8')
  assert.match(src, /redirect\(conversionRedirectTarget\(/)
  assert.doesNotMatch(src, /permanentRedirect|'use client'/)
  assert.equal(existsSync(resolve(import.meta.dirname, '../../components/dashboard/reports/conversion')), false)
})
