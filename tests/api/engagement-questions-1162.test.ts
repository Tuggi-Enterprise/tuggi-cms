/**
 * #1162: blocks 5 to 8 and the three signal cards of the Engagement page (spec Parte E §E5.6 to §E5.9 and
 * §E7), pure, on the October fixture of contract Parte 27 (40 people spent minutes, median 30 min, p75
 * 108.3; 42 used without buying; 95 devices saw the paywall and 9 bought; 89 trips, 40 with no story).
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { ACTIVE, BANK_RETENTION, CONVERSION, GA4, MONTHS, TODAY, USAGE } from '../ct/engagement-fixtures'
import { buildBlock5, buildBlock6, buildBlock7, buildBlock8, buildBlocks, type QuestionsInput } from '@/lib/engagement/blocks'
import { answerOf } from '@/lib/engagement/answers'
import { pickHeadlines } from '@/lib/engagement/headlines'
import { BENCHMARKS } from '@/lib/engagement/benchmarks'
import { buildActiveBank, buildActiveGa4, buildPermissions, buildWhere } from '@/lib/engagement/signals'
import { parseUsageReport } from '@/lib/engagement/usage'
import { parseActiveUsersReport } from '@/lib/engagement/active-users'

const input = (over: Partial<QuestionsInput> = {}): QuestionsInput => ({
  month: '2026-10',
  months: MONTHS,
  today: TODAY,
  bank: BANK_RETENTION,
  bankFailed: false,
  ga4: GA4,
  ga4Failed: false,
  ga4Filtered: false,
  usage: USAGE,
  usageFailed: false,
  conversion: CONVERSION,
  conversionFailed: false,
  active: ACTIVE,
  activeFailed: false,
  filtered: false,
  ...over,
})

// ── Parsers ─────────────────────────────────────────────────────────────────────────────────

test('#1162 BR-COMUNICACAO-022 item 4 contract Parte 27 §4: the usage parser reads minutes, without-buying bands, stories and cities, and an absent block stays null, never 0', () => {
  const r = parseUsageReport({
    data_since: { ledger: '2026-08-18T20:41:00Z' },
    months: [
      {
        month: '2026-10',
        consumed_minutes: { ledger_coverage: 'full', total: { people: 40, median: 30, p75: 108.3 }, free: { people: 33, median: 30, p75: 77 }, paid: { people: 8, median: 69.5, p75: 127.5 } },
        used_without_buying: { people: 42, zero: 15, up_to_15: 9, up_to_60: 8, over_60: 10 },
        stories: { trips: 89, trips_without_story: 40, stories: 727, per_guide_hour: 11.57 },
        top_cities: { by_trips: [{ city_id: -298285, city: 'São Paulo', trips: 9 }, { city_id: 1, city: 'sem contagem' }], by_trips_without_story: [{ city_id: -298179, city: 'Bragança Paulista', trips_without_story: 2, trips: 7 }], unresolved_trips: 42 },
      },
      { month: '2026-07', consumed_minutes: { ledger_coverage: 'none', total: null }, used_without_buying: { people: 3, zero: null }, stories: null, top_cities: null },
    ],
  })
  const [oct, jul] = r.months
  assert.deepEqual(oct.consumed?.paid, { people: 8, median: 69.5, p75: 127.5 })
  assert.equal(oct.used_without_buying.over_60, 10)
  assert.equal(oct.stories?.per_guide_hour, 11.57)
  // a city row without its count is dropped, not printed as 0
  assert.deepEqual(oct.top_cities?.by_trips, [{ city_id: -298285, city: 'São Paulo', trips: 9 }])
  assert.equal(oct.top_cities?.by_trips_without_story?.[0].trips_without_story, 2)
  assert.equal(jul.consumed, null)
  assert.equal(jul.used_without_buying.zero, null)
  assert.equal(jul.stories, null)
  assert.equal(jul.top_cities, null)
})

test('#1162 contract Parte 27 §5: the active parser keeps open_coverage and a null ruler, and an unknown coverage is null', () => {
  const r = parseActiveUsersReport({ data_since: { open: '2026-10-28T17:27:03Z', use: '2025-07-31T20:39:39Z' }, months: [{ month: '2026-10', days: 31, all_sources: { open_coverage: 'sometimes', dau: 4.3 }, trip_or_story: null }] })
  assert.equal(r.data_since.open, '2026-10-28')
  assert.equal(r.months[0].all_sources.open_coverage, null)
  assert.equal(r.months[0].all_sources.mau, null)
  assert.deepEqual(r.months[0].trip_or_story, { dau: null, wau: null, mau: null, dau_mau: null })
})

// ── Block 5 ─────────────────────────────────────────────────────────────────────────────────

test('#1162 spec E5.6 DS-COMPONENTE-100: block 5 answers with the median of minutes spent per person in October, 30 min, then the p75; free and paid are each over who spent that kind', () => {
  const b = buildBlock5(input())
  assert.equal(b.status, 'ready')
  const [median, free, paid, p75] = b.stats
  assert.equal(median.cell.value, 30)
  assert.equal(median.base, 40)
  assert.equal(free.cell.value, 30)
  assert.equal(free.base, 33)
  assert.equal(paid.cell.value, 69.5)
  assert.equal(paid.base, 8)
  assert.equal(paid.small, true)
  assert.equal(p75.cell.value, 108.3)
  // September 36 min over 45 people, October 30 over 40: a fall over two bases of 30 or more
  assert.equal(median.delta?.state, 'down')
  const a = answerOf(b, '2026-10', TODAY)!
  assert.equal(a.key, 'questions.block_5.answer')
  assert.deepEqual(a.values.median, { kind: 'minutes', value: 30 })
  assert.deepEqual(a.values.p75, { kind: 'minutes', value: 108.3 })
})

test('#1162 DS-COMPONENTE-084 item 1 DS-COMPONENTE-100 item 1: in the ledger\'s first month (partial) block 5 is a floor, compares nothing and says so; a month with no ledger is no data', () => {
  const aug = buildBlock5(input({ month: '2026-08' }))
  assert.equal(aug.headline.cell.state, 'floor')
  assert.notEqual(aug.headline.delta?.state, 'up')
  assert.notEqual(aug.headline.delta?.state, 'down')
  const a = answerOf(aug, '2026-08', TODAY)!
  assert.equal(a.floor, true)
  assert.equal(a.cmp, null)
  // September compares against a floor: no coloured change either
  const sep = buildBlock5(input({ month: '2026-09' }))
  assert.equal(sep.headline.delta?.state, 'partial')
  const jul = buildBlock5(input({ month: '2026-07', months: ['2026-07', ...MONTHS] }))
  assert.equal(jul.headline.cell.state, 'before_source')
  assert.equal(jul.headline.cell.value, null)
  assert.equal(answerOf(jul, '2026-07')!.key, 'questions.common.answer_no_data_bank')
})

// ── Block 6 ─────────────────────────────────────────────────────────────────────────────────

test('#1162 spec E5.7 DS-COMPONENTE-084 item 2: block 6 counts who used and did not buy, 42, with no share (no denominator of the same ruler); each band is a share of those 42', () => {
  const b = buildBlock6(input())
  const [people, up15, up60, over] = b.stats
  assert.equal(people.cell.value, 42)
  assert.equal(people.pct, null)
  // the first band includes who spent none (copy §8): 15 + 9
  assert.equal(up15.cell.value, 24)
  assert.equal(up15.pct, 24 / 42)
  assert.equal(up60.cell.value, 8)
  assert.equal(over.cell.value, 10)
  assert.equal(up15.cell.value! + up60.cell.value! + over.cell.value!, people.cell.value)
  assert.deepEqual(b.chart.find((r) => r.month === '2026-10')?.values, { up_to_15: 24, up_to_60: 8, over_60: 10 })
  const a = answerOf(b, '2026-10', TODAY)!
  assert.equal(a.key, 'questions.block_6.answer_count')
  assert.deepEqual(a.values, { n: { kind: 'int', value: 42 }, over: { kind: 'int', value: 10 } })
})

// ── Block 7 ─────────────────────────────────────────────────────────────────────────────────

test('#1162 spec E5.8 DS-COMPONENTE-084 item 2: block 7 is GA4 end to end; 86 of the 95 devices that saw the paywall did not buy, and both chart rates are over who saw', () => {
  const b = buildBlock7(input())
  assert.ok([b.headline, ...b.stats].every((s) => s.source === 'ga4'))
  assert.equal(b.headline.cell.value, 86 / 95)
  const [viewed, closed, tapped, failed] = b.stats
  assert.equal(viewed.cell.value, 95)
  assert.equal(closed.pct, 79 / 95)
  assert.equal(tapped.pct, 2 / 95)
  // October has no paywall_purchase_failed in the fixture: "no data", and the short sentence
  assert.equal(failed.cell.value, null)
  assert.deepEqual(b.chart.find((r) => r.month === '2026-10')?.values, { tapped: 2 / 95, bought: 9 / 95 })
  const a = answerOf(b, '2026-10', TODAY)!
  assert.equal(a.key, 'questions.block_7.answer_short')
  assert.deepEqual(a.values.n, { kind: 'int', value: 86 })
})

test('#1162 spec E5.8: a rise of "did not buy" is never an improvement, so block 7 prints no change and stays out of the three lines on top', () => {
  const b = buildBlock7(input())
  assert.equal(b.headline.delta, null)
  assert.equal(answerOf(b, '2026-10', TODAY)!.cmp, null)
  assert.ok(!pickHeadlines(buildBlocks(input()), '2026-10', TODAY).lines.some((l) => l.block === 'block_7'))
})

test('#1162 spec E9: under a filter GA4 does not have, block 7 is filtered and states nothing; GA4 down is a failed block with a retry', () => {
  const filtered = buildBlock7(input({ ga4Filtered: true }))
  assert.equal(filtered.status, 'filtered')
  assert.equal(answerOf(filtered, '2026-10', TODAY), null)
  const down = buildBlock7(input({ ga4: undefined, ga4Failed: true }))
  assert.equal(down.status, 'failed')
  assert.equal(answerOf(down, '2026-10', TODAY)!.retry, true)
})

// ── Block 8 ─────────────────────────────────────────────────────────────────────────────────

test('#1162 spec E5.9 DS-COMPONENTE-100 item 4: block 8 reads "returned on day N" of the cohort; an open D30 is not drawn and says when it closes, and the market comes from benchmarks.ts', () => {
  const b = buildBlock8(input())
  assert.equal(b.headline.cell.value, 0.08)
  assert.equal(b.headline.base, 97)
  assert.equal(b.headline.reference, 'retention_d1')
  assert.equal(b.stats[1].reference, 'retention_d30')
  const [d1, d7, d30] = b.curve!
  assert.equal(d1.market, BENCHMARKS.retention_d1.value)
  assert.equal(d7.market, null)
  assert.equal(d30.market, BENCHMARKS.retention_d30.value)
  assert.equal(d30.cell.state, 'not_due')
  assert.equal(d30.cell.due, '2026-12-01')
  const a = answerOf(b, '2026-10', TODAY)!
  assert.equal(a.key, 'questions.block_8.answer_30_open')
  assert.deepEqual(a.values.date, { kind: 'date', value: '2026-12-01' })
  const sep = answerOf(buildBlock8(input({ month: '2026-09' })), '2026-09', TODAY)!
  assert.equal(sep.key, 'questions.block_8.answer')
  assert.deepEqual(sep.values.second, { kind: 'pct', value: 0.09 })
  // the current month never compares: the cohort is still forming
  const nov = { ...BANK_RETENTION, months: BANK_RETENTION.months.map((m) => (m.month === '2026-11' ? { ...m, cohort: { ...m.cohort, retention_on: { d1: 0.05, d7: null, d30: null } } } : m)) }
  const inProgress = answerOf(buildBlock8(input({ month: '2026-11', bank: nov })), '2026-11', TODAY)!
  assert.equal(inProgress.key, 'questions.block_8.answer_in_progress')
  assert.equal(inProgress.cmp, null)
})

test('#1162 spec E4: the market numbers live only in benchmarks.ts; blocks.ts and signals.ts hold no literal of them', () => {
  for (const f of ['lib/engagement/blocks.ts', 'lib/engagement/signals.ts']) {
    const src = readFileSync(join(process.cwd(), f), 'utf8')
    assert.doesNotMatch(src, /0\.18\b|0\.028\b/, f)
  }
})

// ── Active ──────────────────────────────────────────────────────────────────────────────────

test('#1162 spec E7.5 DS-COMPONENTE-084 items 1 and 2: the bank half counts people; October (partial opens) is a floor, kept off the chart, with no sentence; November (full) is measured; August (none) is no data', () => {
  const oct = buildActiveBank(input())
  assert.ok(oct.stats.every((s) => s.source === 'bank'))
  assert.equal(oct.stats[0].cell.state, 'floor')
  assert.equal(oct.stats[0].cell.value, 4.3)
  assert.equal(oct.answer, null)
  const chart = Object.fromEntries(oct.chart.map((r) => [r.month, r.values.ratio ?? null]))
  assert.equal(chart['2026-10'], null)
  assert.equal(chart['2026-08'], null)
  const nov = buildActiveBank(input({ month: '2026-11' }))
  assert.equal(nov.stats[3].cell.state, 'measured')
  assert.equal(nov.stats[3].cell.value, 0.1292)
  assert.equal(nov.answer?.key, 'questions.extra_active.answer')
  const aug = buildActiveBank(input({ month: '2026-08' }))
  assert.equal(aug.stats[0].cell.state, 'before_source')
  assert.equal(aug.stats[0].cell.value, null)
})

test('#1162 spec E7.5 DS-COMPONENTE-084 item 2: the GA4 half counts devices, DAU/MAU is GA4 over GA4 of the same month, and the two halves never share a number', () => {
  const g = buildActiveGa4(input())
  assert.ok(g.stats.every((s) => s.source === 'ga4'))
  assert.equal(g.stats[0].cell.value, 10.9)
  assert.equal(g.stats[2].cell.value, 262)
  assert.equal(g.stats[3].cell.value, 10.9 / 262)
  assert.equal(g.answer?.key, 'questions.extra_active.answer_ga4')
  assert.equal(buildActiveGa4(input({ ga4Filtered: true })).status, 'filtered')
  assert.equal(buildActiveBank(input({ active: undefined, activeFailed: true })).answer?.retry, true)
})

// ── Permissions and where ───────────────────────────────────────────────────────────────────

test('#1162 spec E7.2 DS-COMPONENTE-084 item 2: permissions are devices that allowed over devices that answered, one GA4 event, by type', () => {
  const p = buildPermissions(input())
  assert.deepEqual(p.rows.map((r) => [r.type, r.allowed.value, r.asked.value]), [['location', 60, 61], ['motion', 8, 10], ['notifications', 19, 24]])
  assert.equal(p.rows[0].share, 60 / 61)
  assert.equal(p.answer?.key, 'questions.extra_permissions.answer')
  // August had no permission event: no data, never 0
  const aug = buildPermissions(input({ month: '2026-08' }))
  assert.equal(aug.rows[0].allowed.value, null)
  assert.equal(aug.answer?.key, 'questions.common.answer_no_data_ga4')
})

test('#1162 spec E7.4: where they use it, 40 of 89 trips with no story, 11.57 stories per guide hour, the five cities by trips and the ones with most trips with no story', () => {
  const w = buildWhere(input())
  const [noStory, perHour] = w.stats
  assert.equal(noStory.cell.value, 40)
  assert.equal(noStory.pct, 40 / 89)
  assert.equal(perHour.cell.value, 11.57)
  assert.equal(w.byTrips.length, 5)
  assert.equal(w.byTrips[0].name, 'São Paulo')
  assert.equal(w.byNoStory?.[0].withoutStory, 2)
  assert.equal(w.answer?.key, 'questions.extra_no_story.answer')
  assert.equal(buildWhere(input({ usage: undefined, usageFailed: true })).answer?.retry, true)
})
