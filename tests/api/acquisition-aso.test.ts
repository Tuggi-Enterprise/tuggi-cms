/**
 * The ruler of the ASO section of the Acquisition page (#1309): stores by country and the store search
 * position, `lib/acquisition/aso.ts`. DS-COMPONENTE-084: a country a store did not send is unknown and
 * never 0; a day the store blocked is a day not read and makes the coverage partial; "not in results"
 * and "not read" are different facts; the month trend has a sign both ways and only on the same ruler.
 * And the read itself: a month that passes the 1,000-row cap is paged to the end, and a page that fails
 * in the middle is reported, never drawn as a whole month.
 *
 * Run with: npx tsx --import ./tests/api/setup/console-to-stderr.mjs --experimental-test-module-mocks --test tests/api/acquisition-aso.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  countryTable,
  defaultCountrySort,
  downloadsGap,
  parseRankDays,
  parseStoreCountryDays,
  parseStoreFilter,
  pickCountry,
  rankAxisTop,
  rankBlock,
  rankCountries,
  rankCoverage,
  rankDelta,
  readAllPages,
  sortCountryRows,
  sortRankRows,
  tableCoverage,
  visibleStores,
  type PageResult,
  type RankApp,
  type RankDay,
  type RankKeyword,
  type StoreCountryDay,
} from '../../lib/acquisition/aso'

const collator = new Intl.Collator('pt')
const r = (day: string, position: number | null, resultsRead = 200) => ({ day, position, resultsRead })

// ── rankDelta ────────────────────────────────────────────────────────────────────────────────

test('DS-COMPONENTE-084 item 3: a move has a sign both ways, up is a smaller position', () => {
  assert.deepEqual(rankDelta(r('2026-11-01', 8), r('2026-11-20', 5)), { kind: 'moved', delta: 3 })
  assert.deepEqual(rankDelta(r('2026-11-01', 5), r('2026-11-20', 7)), { kind: 'moved', delta: -2 })
  assert.deepEqual(rankDelta(r('2026-11-01', 4), r('2026-11-20', 4)), { kind: 'moved', delta: 0 })
})

test('DS-COMPONENTE-084: not in results first and found last is "entered", the reverse is "left"', () => {
  assert.deepEqual(rankDelta(r('2026-11-01', null, 50), r('2026-11-20', 30)), { kind: 'entered' })
  assert.deepEqual(rankDelta(r('2026-11-01', 30), r('2026-11-20', null, 50)), { kind: 'left' })
})

test('DS-COMPONENTE-084: out of results both days is "out all month", not a move of zero', () => {
  assert.deepEqual(rankDelta(r('2026-11-01', null), r('2026-11-20', null)), { kind: 'out_both' })
})

test('DS-COMPONENTE-084 item 1: one reading, or none, has no trend', () => {
  assert.deepEqual(rankDelta(undefined, undefined), { kind: 'unknown', reason: 'one_read' })
  const one = r('2026-11-03', 9)
  assert.deepEqual(rankDelta(one, one), { kind: 'unknown', reason: 'one_read' })
})

test('DS-COMPONENTE-084 item 2: "not in the 50 read" against "position 120" is not the same ruler', () => {
  assert.deepEqual(rankDelta(r('2026-11-01', null, 50), r('2026-11-20', 120)), { kind: 'unknown', reason: 'ruler' })
  assert.deepEqual(rankDelta(r('2026-11-01', 120), r('2026-11-20', null, 50)), { kind: 'unknown', reason: 'ruler' })
})

// ── Coverage ─────────────────────────────────────────────────────────────────────────────────

test('DS-COMPONENTE-084 item 1: stores by country start at the table first row, not at the job covered_from', () => {
  // the store total is collected since September; the detail by country only since 12/10
  const c = tableCoverage('2026-10-01', '2026-09-01', { first: '2026-10-12', last: '2026-10-31' })
  assert.equal(c.state, 'partial')
  assert.equal(c.from, '2026-10-12')
  assert.equal(tableCoverage('2026-11-01', '2026-09-01', { first: '2026-10-12', last: '2026-11-30' }).state, 'full')
})

test('DS-COMPONENTE-084 item 1: no job and no row is "not configured"; a job with no row yet is a floor with no rows', () => {
  const none = tableCoverage('2026-11-01', null, { first: null, last: null })
  assert.equal(none.state, 'none')
  assert.equal(none.none, 'not_configured')
  const waiting = tableCoverage('2026-11-01', '2026-11-20', { first: null, last: null })
  assert.equal(waiting.state, 'partial')
  assert.equal(waiting.noRows, true)
  assert.equal(tableCoverage('2026-10-01', '2026-11-20', { first: null, last: null }).none, 'before_start')
  // rows only up to October, read in November: no row of the month, not "data up to 31/10"
  const stopped = tableCoverage('2026-11-01', '2026-09-01', { first: '2026-09-01', last: '2026-10-31' })
  assert.equal(stopped.noRows, true)
  assert.deepEqual(rankCoverage('2026-11-01', '2026-09-01', { first: '2026-09-01', last: '2026-10-31' }, []).missingDays, [])
})

test('DS-COMPONENTE-084 item 1: a store day with no row inside the read range is a day not read, and the coverage is partial', () => {
  const read = ['2026-10-01', '2026-10-02', '2026-10-04', ...Array.from({ length: 27 }, (_, i) => `2026-10-${String(i + 5).padStart(2, '0')}`)]
  const blocked = rankCoverage('2026-10-01', '2026-09-20', { first: '2026-09-20', last: '2026-10-31' }, read)
  assert.deepEqual(blocked.missingDays, ['2026-10-03'])
  assert.equal(blocked.coverage.state, 'partial')
  const all = rankCoverage('2026-10-01', '2026-09-20', { first: '2026-09-20', last: '2026-10-31' }, [...read, '2026-10-03'])
  assert.deepEqual(all.missingDays, [])
  assert.equal(all.coverage.state, 'full')
})

test('the days not read only count from the first row of the month on, and never past the last one', () => {
  const c = rankCoverage('2026-11-01', '2026-11-10', { first: '2026-11-10', last: '2026-11-14' }, ['2026-11-10', '2026-11-11', '2026-11-14'])
  assert.deepEqual(c.missingDays, ['2026-11-12', '2026-11-13'])
  assert.equal(c.coverage.from, '2026-11-10')
})

// ── Paging ───────────────────────────────────────────────────────────────────────────────────

function pages<T>(all: T[], opts: { failAt?: number; count?: boolean; cap?: number } = {}) {
  const calls: [number, number][] = []
  let n = 0
  const fetchPage = async (from: number, to: number): Promise<PageResult<T>> => {
    calls.push([from, to])
    const page = n++
    if (opts.failAt === page) return { data: null, error: { code: '57014', message: 'canceling statement' }, count: null }
    const end = Math.min(to + 1, from + (opts.cap ?? Infinity))
    return { data: all.slice(from, end), error: null, count: opts.count === false ? null : all.length }
  }
  return { fetchPage, calls }
}

test('a month past the 1,000-row cap is read to the end, page by page, by range', async () => {
  const all = Array.from({ length: 2500 }, (_, i) => i)
  const { fetchPage, calls } = pages(all)
  const res = await readAllPages(fetchPage)
  assert.equal(res.state, 'complete')
  assert.equal(res.rows.length, 2500)
  assert.deepEqual(calls, [[0, 999], [1000, 1999], [2000, 2999]])
})

test('a server cap under the page size does not end the read early: the exact count decides', async () => {
  const all = Array.from({ length: 1200 }, (_, i) => i)
  const res = await readAllPages(pages(all, { cap: 500 }).fetchPage)
  assert.equal(res.state, 'complete')
  assert.equal(res.rows.length, 1200)
})

test('a page that fails in the middle is an incomplete read, never a whole month', async () => {
  const res = await readAllPages(pages(Array.from({ length: 2500 }, (_, i) => i), { failAt: 1 }).fetchPage)
  assert.equal(res.state, 'incomplete')
  assert.equal(res.rows.length, 1000)
})

test('the first page failing is a failed read; a thrown fetch too', async () => {
  assert.equal((await readAllPages(pages([1, 2, 3], { failAt: 0 }).fetchPage)).state, 'failed')
  assert.equal((await readAllPages(async () => Promise.reject(new Error('network')))).state, 'failed')
})

test('an empty page before the count is incomplete; with no count, a short page ends the read', async () => {
  let n = 0
  const shrinking = async (): Promise<PageResult<number>> => (n++ === 0 ? { data: Array(1000).fill(1), error: null, count: 1500 } : { data: [], error: null, count: 1500 })
  assert.equal((await readAllPages(shrinking)).state, 'incomplete')
  const res = await readAllPages(pages(Array.from({ length: 1300 }, (_, i) => i), { count: false }).fetchPage)
  assert.equal(res.state, 'complete')
  assert.equal(res.rows.length, 1300)
})

// ── A. Stores by country ─────────────────────────────────────────────────────────────────────

const cd = (day: string, store: StoreCountryDay['store'], country: string, impressions: number | null, pageViews: number | null, downloads: number | null): StoreCountryDay => ({ day, store, country, impressions, pageViews, downloads })

const COUNTRY_DAYS: StoreCountryDay[] = [
  cd('2026-11-01', 'app_store', 'BR', 1000, 300, 60),
  cd('2026-11-02', 'app_store', 'BR', 2120, 510, 100),
  cd('2026-11-01', 'app_store', 'IT', 210, 40, 9),
  cd('2026-11-01', 'play_store', 'BR', null, 640, 150),
  cd('2026-11-01', 'play_store', 'US', null, 70, 9),
  cd('2026-11-01', 'app_store', 'US', 420, 90, 18),
  cd('2026-11-01', 'play_store', 'AR', null, 0, 0),
  cd('2026-11-01', 'play_store', 'FR', null, null, null),
]

test('DS-COMPONENTE-084 item 1: a country a covered store did not send is unknown, never 0', () => {
  const rows = countryTable(COUNTRY_DAYS, ['app_store', 'play_store'])
  const it = rows.find((x) => x.country === 'IT')
  assert.ok(it)
  assert.equal(it.stores.play_store?.absent, true)
  assert.equal(it.stores.play_store?.downloads, null)
  assert.equal(it.stores.app_store?.downloads, 9)
})

test('a country is a row with one known value, even zero; a country with only nulls is not', () => {
  const codes = countryTable(COUNTRY_DAYS, ['app_store', 'play_store']).map((x) => x.country).sort()
  assert.deepEqual(codes, ['AR', 'BR', 'IT', 'US'])
  const ar = countryTable(COUNTRY_DAYS, ['play_store']).find((x) => x.country === 'AR')
  assert.equal(ar?.stores.play_store?.downloads, 0)
  // a zero base prints no rate (DS-COMPONENTE-084 item 2)
  assert.equal(ar?.stores.play_store?.conversion, null)
})

test('DS-COMPONENTE-084 item 2: the conversion has the funnel base, impressions on the App Store, page views on Play, which has no impressions', () => {
  const br = countryTable(COUNTRY_DAYS, ['app_store', 'play_store']).find((x) => x.country === 'BR')
  assert.equal(br?.stores.app_store?.impressions, 3120)
  assert.equal(br?.stores.app_store?.downloads, 160)
  assert.equal(br?.stores.app_store?.conversion, 160 / 3120)
  assert.equal(br?.stores.play_store?.impressions, null)
  assert.equal(br?.stores.play_store?.conversion, 150 / 640)
})

test('stores by country sort by downloads of the first visible store, unknown last in both directions', () => {
  const rows = countryTable(COUNTRY_DAYS, ['app_store', 'play_store'])
  const nameOf = (c: string) => c
  const desc = sortCountryRows(rows, defaultCountrySort(['app_store', 'play_store']), nameOf, collator).map((x) => x.country)
  assert.deepEqual(desc, ['BR', 'US', 'IT', 'AR'])
  const asc = sortCountryRows(rows, { key: 'app_store.downloads', dir: 1 }, nameOf, collator).map((x) => x.country)
  assert.deepEqual(asc, ['IT', 'US', 'BR', 'AR'])
  assert.equal(defaultCountrySort(['play_store']).key, 'play_store.downloads')
})

test('the funnel total above the sum of the countries gives the difference; equal or below gives nothing', () => {
  const rows = countryTable(COUNTRY_DAYS, ['app_store'])
  assert.equal(downloadsGap(200, rows, 'app_store'), 13)
  assert.equal(downloadsGap(187, rows, 'app_store'), null)
  assert.equal(downloadsGap(null, rows, 'app_store'), null)
})

test('null stays null when reading the rows; zero stays zero', () => {
  const [row] = parseStoreCountryDays([{ day: '2026-11-01', store: 'play_store', country: 'BR', impressions: null, page_views: '0', downloads: 3 }])
  assert.equal(row.impressions, null)
  assert.equal(row.pageViews, 0)
  const [d] = parseRankDays([{ day: '2026-11-01', store: 'app_store', keyword_id: 'k', app_id: 'a', position: null, results_read: 200 }])
  assert.equal(d.position, null)
  assert.equal(d.resultsRead, 200)
})

// ── B. Search position ───────────────────────────────────────────────────────────────────────

const KW: RankKeyword[] = [
  { id: 'k-audio', keyword: 'audioguia', country: 'BR', active: true },
  { id: 'k-guide', keyword: 'guia de viagem', country: 'BR', active: true },
  { id: 'k-route', keyword: 'roteiro', country: 'BR', active: true },
  { id: 'k-new', keyword: 'búzios', country: 'BR', active: true },
  { id: 'k-old', keyword: 'antiga', country: 'BR', active: false },
]
const APPS: RankApp[] = [
  { id: 'own-ios', store: 'app_store', name: 'Tuggi', isOwn: true },
  { id: 'gyg', store: 'app_store', name: 'GetYourGuide', isOwn: false },
  { id: 'smart', store: 'app_store', name: 'SmartGuide', isOwn: false },
  { id: 'voice', store: 'app_store', name: 'VoiceMap', isOwn: false },
  { id: 'idle', store: 'app_store', name: 'Idle', isOwn: false },
  { id: 'own-play', store: 'play_store', name: 'Tuggi', isOwn: true },
]
const rd = (day: string, keywordId: string, appId: string, position: number | null, resultsRead = 200): RankDay => ({ day, store: 'app_store', keywordId, appId, position, resultsRead })

const RANK_DAYS: RankDay[] = [
  // audioguia: 7 on the 1st, 4 on the 3rd; the 2nd is a day the store blocked
  rd('2026-11-01', 'k-audio', 'own-ios', 7), rd('2026-11-01', 'k-audio', 'gyg', 2), rd('2026-11-01', 'k-audio', 'smart', null),
  rd('2026-11-03', 'k-audio', 'own-ios', 4), rd('2026-11-03', 'k-audio', 'gyg', 2), rd('2026-11-03', 'k-audio', 'smart', null), rd('2026-11-03', 'k-audio', 'voice', 11),
  // guia de viagem: 16 then 18, last read on the 1st only for the rival, the 3rd for us
  rd('2026-11-01', 'k-guide', 'own-ios', 16), rd('2026-11-01', 'k-guide', 'gyg', 1),
  rd('2026-11-03', 'k-guide', 'own-ios', 18), rd('2026-11-03', 'k-guide', 'gyg', 1), rd('2026-11-03', 'k-guide', 'smart', 9),
  // roteiro: found on the 1st, not in the results on the 3rd
  rd('2026-11-01', 'k-route', 'own-ios', 30), rd('2026-11-03', 'k-route', 'own-ios', null), rd('2026-11-03', 'k-route', 'smart', 3),
  // búzios: last read on the 1st, the store blocked it after
  rd('2026-11-01', 'k-new', 'own-ios', 2),
]

test('DS-COMPONENTE-084: every position of a row is of the pair last reading, and "not in results" is not "not read"', () => {
  const b = rankBlock('app_store', KW, APPS, RANK_DAYS, collator)
  const audio = b.rows.find((x) => x.keywordId === 'k-audio')
  assert.equal(audio?.lastDay, '2026-11-03')
  assert.equal(audio?.own?.position, 4)
  assert.deepEqual(audio?.delta, { kind: 'moved', delta: 3 })
  assert.equal(audio?.competitors.smart?.position, null)
  assert.equal(audio?.competitors.smart?.resultsRead, 200)
  // read that day without the app: no entry, which the screen prints as not read
  assert.equal(b.rows.find((x) => x.keywordId === 'k-guide')?.competitors.voice, undefined)
  const route = b.rows.find((x) => x.keywordId === 'k-route')
  assert.equal(route?.own?.position, null)
  assert.deepEqual(route?.delta, { kind: 'left' })
})

test('DS-COMPONENTE-084 item 1: a pair with no reading in the month is a row with no number, an inactive keyword with none is no row', () => {
  const b = rankBlock('app_store', [...KW, { id: 'k-none', keyword: 'nunca lida', country: 'BR', active: true }], APPS, RANK_DAYS, collator)
  const none = b.rows.find((x) => x.keywordId === 'k-none')
  assert.equal(none?.own, null)
  assert.equal(none?.lastDay, null)
  assert.deepEqual(none?.delta, { kind: 'unknown', reason: 'one_read' })
  assert.equal(b.rows.some((x) => x.keywordId === 'k-old'), false)
})

test('a pair whose last reading is older than the store last day read is stale', () => {
  const b = rankBlock('app_store', KW, APPS, RANK_DAYS, collator)
  assert.equal(b.lastStoreDay, '2026-11-03')
  assert.equal(b.rows.find((x) => x.keywordId === 'k-new')?.stale, true)
  assert.equal(b.rows.find((x) => x.keywordId === 'k-audio')?.stale, false)
})

test('rows by our position, then not in results, then not read; ties by keyword in the locale', () => {
  const extra: RankKeyword[] = [...KW, { id: 'k-none', keyword: 'nunca lida', country: 'BR', active: true }, { id: 'k-out', keyword: 'abc fora', country: 'BR', active: true }]
  const days = [...RANK_DAYS, rd('2026-11-03', 'k-out', 'own-ios', null)]
  const b = rankBlock('app_store', extra, APPS, days, collator)
  assert.deepEqual(b.rows.map((x) => x.keyword), ['búzios', 'audioguia', 'guia de viagem', 'abc fora', 'roteiro', 'nunca lida'])
  const byKeyword = sortRankRows(b.rows, { key: 'keyword', dir: 1 }, collator).map((x) => x.keyword)
  assert.deepEqual(byKeyword, ['abc fora', 'audioguia', 'búzios', 'guia de viagem', 'nunca lida', 'roteiro'])
  const byTrend = sortRankRows(b.rows, { key: 'trend', dir: -1 }, collator).map((x) => x.keyword)
  assert.deepEqual(byTrend.slice(0, 3), ['audioguia', 'guia de viagem', 'roteiro'])
})

test('competitors by in how many keywords they showed up on the last reading, then name; an app with no row is no column', () => {
  const b = rankBlock('app_store', KW, APPS, RANK_DAYS, collator)
  // SmartGuide: guia de viagem and roteiro; GetYourGuide: audioguia and guia de viagem; VoiceMap: one
  assert.deepEqual(b.competitors.map((a) => a.name), ['GetYourGuide', 'SmartGuide', 'VoiceMap'])
  assert.equal(b.competitors.some((a) => a.id === 'idle'), false)
})

test('the block counts keywords read, where we showed up and the top 10, on each pair last reading', () => {
  const b = rankBlock('app_store', KW, APPS, RANK_DAYS, collator)
  assert.equal(b.read, 4)
  assert.equal(b.found, 3)
  assert.equal(b.top10, 2)
})

test('DS-COMPONENTE-084 item 1: the daily series has a hole on a day not read, with its reason', () => {
  const audio = rankBlock('app_store', KW, APPS, RANK_DAYS, collator).rows.find((x) => x.keywordId === 'k-audio')
  assert.deepEqual(audio?.series.map((p) => [p.day, p.position, p.reason?.kind ?? null]), [
    ['2026-11-01', 7, null],
    ['2026-11-02', null, 'not_read'],
    ['2026-11-03', 4, null],
  ])
  assert.equal(audio?.daysFound, 2)
  assert.equal(audio?.daysMissing, 1)
  const route = rankBlock('app_store', KW, APPS, RANK_DAYS, collator).rows.find((x) => x.keywordId === 'k-route')
  assert.deepEqual(route?.series[2].reason, { kind: 'not_found', resultsRead: 200 })
  assert.equal(rankAxisTop(route?.series ?? []), 30)
  assert.equal(rankAxisTop(audio?.series ?? []), 10)
})

test('the other store of the same month is another block, and a store with no row has no row read', () => {
  const play = rankBlock('play_store', KW, APPS, RANK_DAYS, collator)
  assert.equal(play.read, 0)
  assert.equal(play.lastStoreDay, null)
  assert.equal(play.rows.length, 4)
})

test('the store filter of the URL, and the country: given, then Brazil, then the first', () => {
  assert.equal(parseStoreFilter('play_store'), 'play_store')
  assert.equal(parseStoreFilter('nope'), 'both')
  assert.deepEqual(visibleStores('both'), ['app_store', 'play_store'])
  assert.equal(pickCountry(null, ['AR', 'BR']), 'BR')
  assert.equal(pickCountry(null, ['AR', 'PT']), 'AR')
  assert.equal(pickCountry('US', ['BR']), 'US')
  assert.equal(pickCountry(null, []), null)
  const names: Record<string, string> = { BR: 'Brasil', AR: 'Argentina', PT: 'Portugal' }
  assert.deepEqual(rankCountries([{ ...KW[0], country: 'PT' }, KW[0], { ...KW[0], country: 'AR' }], (c) => names[c], collator), ['AR', 'BR', 'PT'])
})
