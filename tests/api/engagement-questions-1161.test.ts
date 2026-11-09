/**
 * #1161: the page by questions (spec Parte E). The blocks 1 to 4, their answer sentences, the three lines
 * of block 0, the two step funnels and the market references, all pure, tested on the October fixture of
 * contract Parte 27 (119 entered, 35 guide, 22 first story, 12 used 1 hour, 6 2nd trip).
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { BANK, CONVERSION, GA4, MONTHS, TODAY, USAGE } from '../ct/engagement-fixtures'
import { buildBlock1, buildBlock2, buildBlock3, buildBlock4, buildBlocks, buildPaywallFunnel, buildUseFunnel, chartMonths, freeBeforeCell, type QuestionBlock, type QuestionsInput } from '@/lib/engagement/blocks'
import { answerOf, comparisonOf, firstSentence } from '@/lib/engagement/answers'
import { HEADLINE_LINES, pickHeadlines } from '@/lib/engagement/headlines'
import { BENCHMARKS, benchmark } from '@/lib/engagement/benchmarks'
import { readStepFunnel } from '@/lib/conversion/funnel'
import { SUMMARY_MIN_BASE, type TileDelta } from '@/lib/engagement/summary'

const input = (over: Partial<QuestionsInput> = {}): QuestionsInput => ({
  month: '2026-10',
  months: MONTHS,
  today: TODAY,
  bank: BANK,
  bankFailed: false,
  ga4: GA4,
  ga4Failed: false,
  ga4Filtered: false,
  usage: USAGE,
  usageFailed: false,
  conversion: CONVERSION,
  conversionFailed: false,
  activeFailed: false,
  filtered: false,
  ...over,
})

// ── Blocks ──────────────────────────────────────────────────────────────────────────────────

test('#1161 BR-USUARIO-037 item 3.j: block 1 answers with the share of who entered that turned the guide on the first day, 32 of 119', () => {
  const b = buildBlock1(input())
  assert.equal(b.status, 'ready')
  assert.equal(b.headline.cell.value, 32 / 119)
  assert.equal(b.headline.base, 119)
  // September 49 of 140 = 35 %, October 26.9 %: a fall in points over two bases of 30 or more
  assert.equal(b.headline.delta?.state, 'down')
  assert.equal(b.headline.delta?.unit, 'points')
})

test('#1161 DS-COMPONENTE-084 items 2 and 3: installs never divide entries; the gap is a signed difference, and installs under entries are a floor with no gap', () => {
  const b = buildBlock1(input())
  const [installed, entered, gap] = b.stats
  assert.equal(installed.source, 'ga4')
  assert.equal(installed.pct, null)
  assert.equal(installed.cell.value, 450)
  assert.equal(entered.cell.value, 119)
  assert.equal(gap.signed, true)
  assert.equal(gap.cell.value, 450 - 119)
  assert.equal(gap.pct, null)
  const low = buildBlock1(input({ conversion: { ...CONVERSION, installs: { ios: 50, android: 50, total: 100 } } }))
  assert.equal(low.stats[0].cell.state, 'floor')
  assert.equal(low.stats[0].cell.value, 100)
  assert.equal(low.stats[2].cell.value, null)
  assert.equal(low.stats[2].hint, 'questions.block_1.floor_hint')
})

test('#1161 BR-COMUNICACAO-022 item 4: under a filter the unfiltered installs print the filter state, never a number of another slice', () => {
  const b = buildBlock1(input({ filtered: true }))
  assert.equal(b.stats[0].cell.state, 'ga4_filter')
  assert.equal(b.stats[0].cell.value, null)
})

test('#1161 spec E12 item 3: the first day stacks in exclusive parts; before app opens the explored and the idle are one rest, never a guess', () => {
  const b = buildBlock1(input())
  const oct = b.chart.find((r) => r.month === '2026-10')!
  assert.deepEqual(oct.values, { guide: 32, story_only: 5, explore_only: null, nothing: null, rest: 82 })
  assert.equal(32 + 5 + 82, 119)
  const nov = buildBlock1(input({ month: '2026-11' })).chart.find((r) => r.month === '2026-11')!
  assert.deepEqual(nov.values, { guide: 9, story_only: 2, explore_only: 12, nothing: 7, rest: null })
  // six months ending on the month of the page; the ones before the ruler draw nothing and say why
  assert.deepEqual(b.chart.map((r) => r.month), chartMonths('2026-10'))
  assert.equal(b.chart[0].reason, 'before_source')
})

test('#1161: block 2 compares the count while app opens are not measured, and the share of who opened once they are', () => {
  const oct = buildBlock2(input())
  assert.equal(oct.headline.kind, 'count')
  assert.equal(oct.headline.cell.value, 44)
  assert.equal(oct.stats[1].cell.value, 0.2)
  const nov = buildBlock2(input({ month: '2026-11' }))
  assert.equal(nov.headline.kind, 'rate')
  assert.equal(nov.headline.cell.value, 12 / 41)
  assert.equal(nov.stats[2].cell.value, 9)
  assert.equal(nov.stats[2].pct, 9 / 41)
})

test('#1161 spec C4 item 1: block 2 draws the grey total before the split and the three modes after it, from the one builder of the modes', () => {
  const b = buildBlock2(input({ month: '2026-11' }))
  const oct = b.chart.find((r) => r.month === '2026-10')!
  const nov = b.chart.find((r) => r.month === '2026-11')!
  assert.deepEqual(oct.values, { trip_total: 120 })
  assert.deepEqual(nov.values, { drive_only: 9, both: 11, explore_only: 21 })
})

test('#1161: block 3 is the median with p75 and the share off screen; before the heartbeats the split is before its source, not 0', () => {
  const oct = buildBlock3(input())
  assert.equal(oct.headline.cell.value, 35)
  assert.equal(oct.facts.p75.value, 80)
  assert.equal(oct.facts.bg.state, 'before_source')
  const nov = buildBlock3(input({ month: '2026-11' }))
  assert.equal(nov.facts.bg.value, 0.44)
  assert.deepEqual(nov.chart.find((r) => r.month === '2026-11')!.values, { on_screen: 1 - 0.44, off_screen: 0.44 })
})

test('#1161 DS-COMPONENTE-084 item 1 BR-VIAGEM-008: block 4 prints the buckets the app records; August, 14 % of trips covered, is a floor; nothing is reclassified', () => {
  const oct = buildBlock4(input())
  assert.deepEqual(oct.stats.map((s) => [s.key, s.cell.state, s.cell.value]), [
    ['questions.block_4.vehicle', 'measured', 0],
    ['questions.block_4.walking', 'measured', 0.3],
    ['questions.block_4.stopped', 'measured', 1.9],
    ['questions.block_4.cycling', 'measured', 0],
  ])
  const aug = buildBlock4(input({ month: '2026-08' }))
  assert.ok(aug.stats.every((s) => s.cell.state === 'floor'))
  const src = readFileSync(join(process.cwd(), 'lib/engagement/blocks.ts'), 'utf8')
  assert.doesNotMatch(src, /km\/h|speed_?kmh|m\/s/)
})

test('#1161 BR-COMUNICACAO-022 item 4: a failed usage read fails blocks 1, 2 and 4 with a retry and leaves block 3; a loading one prints no sentence', () => {
  const blocks = buildBlocks(input({ usage: undefined, usageFailed: true }))
  // #1162: blocks 5 and 6 read the same function; 7 is GA4 and 8 the bank, they stand
  assert.deepEqual(blocks.map((b) => b.status), ['failed', 'failed', 'ready', 'failed', 'failed', 'failed', 'ready', 'ready'])
  for (const b of blocks.filter((x) => x.status === 'failed')) {
    const a = answerOf(b, '2026-10')!
    assert.equal(a.key, 'questions.common.answer_failed')
    assert.equal(a.retry, true)
    assert.ok(b.stats.every((s) => s.cell.value === null || s.source === 'ga4' || s.key.includes('summary.modes')), b.key)
  }
  const loading = buildBlocks(input({ usage: undefined }))
  assert.equal(answerOf(loading[0], '2026-10'), null)
})

test('#1161 DS-COMPONENTE-084 item 2: a zero base prints the empty sentence, never 0 %', () => {
  const usage = { ...USAGE, months: USAGE.months.map((m) => (m.month === '2026-10' ? { ...m, first_day: { ...m.first_day, entered: 0, guide: 0, guide_or_story: 0 } } : m)) }
  const b = buildBlock1(input({ usage }))
  assert.equal(b.status, 'empty')
  assert.equal(b.headline.cell.value, null)
  assert.equal(answerOf(b, '2026-10')!.key, 'questions.block_1.answer_empty')
})

// ── Answers ─────────────────────────────────────────────────────────────────────────────────

test('#1161 DS-COMPONENTE-100: the answer of block 1 states the share with the comparison of the month before, and the short form without who did nothing', () => {
  const a = answerOf(buildBlock1(input()), '2026-10')!
  assert.equal(a.key, 'questions.block_1.answer_short')
  assert.deepEqual(a.values.pct, { kind: 'pct', value: 32 / 119 })
  assert.equal(a.cmp?.key, 'questions.common.compare_down')
  assert.deepEqual(a.cmp?.prev, { kind: 'rate', value: 49 / 140 })
  assert.equal(a.cmp?.prevMonth, '2026-09')
  const nov = answerOf(buildBlock1(input({ month: '2026-11' })), '2026-11')!
  assert.equal(nov.key, 'questions.block_1.answer')
  assert.deepEqual(nov.values.nothing, { kind: 'int', value: 7 })
  // DS-COMPONENTE-100 item 3: the current month says "so far" and does not compare
  assert.equal(nov.cmp?.key, 'questions.common.compare_so_far')
})

test('#1161 DS-COMPONENTE-084 item 1: a floor answer prints no comparison and adds the floor sentence', () => {
  const a = answerOf(buildBlock4(input({ month: '2026-08' })), '2026-08')!
  assert.equal(a.key, 'questions.block_4.answer_medians')
  assert.equal(a.floor, true)
  assert.equal(a.cmp, null)
})

test('#1161 BR-COMUNICACAO-022 item 4: a month before the source answers "no data" for that month', () => {
  const usage = { ...USAGE, data_since: { ...USAGE.data_since, movement: '2026-11-02' } }
  const b = buildBlock4(input({ usage: { ...usage, months: usage.months.map((m) => ({ ...m, movement: m.month < '2026-11' ? null : m.movement })) } }))
  assert.equal(b.status, 'no_source')
  assert.equal(answerOf(b, '2026-10')!.key, 'questions.block_4.answer_no_source')
})

test('#1161 DS-COMPONENTE-100 item 1: under 30 the comparison says "against", not "more" or "less"', () => {
  const delta = (state: TileDelta['state']): TileDelta => ({
    state,
    unit: 'relative',
    rounded: 10,
    due: null,
    prev: { month: '2026-09', cell: { state: 'measured', value: 20, share: null, since: null, due: null }, base: 20 },
    curr: { month: '2026-10', cell: { state: 'measured', value: 22, share: null, since: null, due: null }, base: 22 },
  })
  assert.equal(comparisonOf(delta('small_base'), 'count')?.key, 'questions.common.compare_sample')
  assert.equal(comparisonOf(delta('new'), 'count'), null)
  assert.equal(comparisonOf(delta('unknown'), 'count'), null)
})

test('#1161: every answer and comparison key exists in pt, en and es', () => {
  const keys = new Set<string>()
  for (const month of ['2026-08', '2026-09', '2026-10', '2026-11']) {
    for (const b of [...buildBlocks(input({ month })), ...buildBlocks(input({ month, usage: undefined, usageFailed: true, bankFailed: true, bank: undefined }))]) {
      const a = answerOf(b, month)
      if (a) keys.add(a.key)
      if (a?.cmp) keys.add(a.cmp.key)
      for (const s of b.stats) for (const k of [s.key, s.hint, s.pctOf]) if (k) keys.add(k)
    }
  }
  for (const locale of ['pt', 'en', 'es']) {
    const e = JSON.parse(readFileSync(join(process.cwd(), `messages/${locale}.json`), 'utf8')).Pages.Dashboard.reports.engagement
    for (const k of keys) {
      const v = k.split('.').reduce((n: unknown, p) => (n && typeof n === 'object' ? (n as Record<string, unknown>)[p] : undefined), e)
      assert.equal(typeof v, 'string', `${locale}: ${k}`)
    }
  }
})

test('#1161: the first sentence ends at the first full stop followed by a space, never at a decimal point', () => {
  assert.equal(firstSentence('27% of those who entered turned the guide on, down from 35% in September. 7 people did nothing.'), '27% of those who entered turned the guide on, down from 35% in September.')
  assert.equal(firstSentence('Half covered more than 0.2 km with the guide on.'), 'Half covered more than 0.2 km with the guide on.')
  assert.equal(firstSentence('no stop'), 'no stop')
})

// ── Block 0 ─────────────────────────────────────────────────────────────────────────────────

const withDelta = (key: QuestionBlock['key'], state: TileDelta['state'], prev: number | null, curr: number | null, base = 40): QuestionBlock => {
  const b = buildBlock1(input())
  const c = (value: number | null) => ({ state: 'measured' as const, value, share: null, since: null, due: null })
  return { ...b, key, headline: { ...b.headline, delta: { state, unit: 'relative', rounded: 0, due: null, prev: { month: '2026-09', cell: c(prev), base }, curr: { month: '2026-10', cell: c(curr), base } } } }
}

test('#1161 DS-COMPONENTE-100 item 1: block 0 takes a base of 30 and leaves a base of 29, on the real blocks', () => {
  // October against September: vehicle 4 to 0 min (100 %), guide 80 to 44 people (45 %), median 28 to 35 min
  // (25 %), and the first-day share 35 % to 27 % (23 %) is the fourth, so it stays out
  const real = pickHeadlines(buildBlocks(input()).slice(0, 4), '2026-10', TODAY)
  assert.equal(real.lines.length, HEADLINE_LINES)
  assert.deepEqual(real.lines.map((l) => [l.block, l.direction]), [['block_4', 'down'], ['block_2', 'down'], ['block_3', 'up']])
  // the same fall over 29 people is small_base in tileDelta, so it never reaches the list
  const usage29 = { ...USAGE, months: USAGE.months.map((m) => (m.month === '2026-10' ? { ...m, first_day: { ...m.first_day, entered: SUMMARY_MIN_BASE - 1, guide: 8, guide_or_story: 10 } } : m)) }
  const b29 = buildBlock1(input({ usage: usage29 }))
  assert.equal(b29.headline.delta?.state, 'small_base')
  assert.ok(!pickHeadlines([b29], '2026-10', TODAY).lines.some((l) => l.block === 'block_1'))
  const usage30 = { ...USAGE, months: USAGE.months.map((m) => (m.month === '2026-10' ? { ...m, first_day: { ...m.first_day, entered: SUMMARY_MIN_BASE, guide: 8, guide_or_story: 10 } } : m)) }
  assert.equal(pickHeadlines([buildBlock1(input({ usage: usage30 }))], '2026-10', TODAY).lines[0]?.block, 'block_1')
})

test('#1161 copy §2: block 0 orders by the relative change from the raw values, at most three, a tie keeps the page order, a previous zero stays out', () => {
  const blocks = [
    withDelta('block_1', 'up', 100, 110), // 10 %
    withDelta('block_2', 'down', 100, 50), // 50 %
    withDelta('block_3', 'up', 0, 5), // previous zero: out
    withDelta('block_4', 'up', 100, 150), // 50 %, tie with block 2: page order
  ]
  const h = pickHeadlines(blocks, '2026-10', TODAY)
  assert.deepEqual(h.lines.map((l) => [l.block, l.direction]), [['block_2', 'down'], ['block_4', 'up'], ['block_1', 'up']])
  assert.equal(h.empty, null)
})

test('#1161 DS-COMPONENTE-100 item 3: the current month has no lines and says when they come; no candidate says why', () => {
  const now = pickHeadlines(buildBlocks(input({ month: '2026-11' })), '2026-11', TODAY)
  assert.deepEqual(now, { lines: [], empty: 'in_progress', closesOn: '2026-12-01' })
  assert.equal(pickHeadlines([withDelta('block_1', 'new', null, 5)], '2026-10', TODAY).empty, 'no_previous')
  assert.equal(pickHeadlines([withDelta('block_1', 'small_base', 10, 12), withDelta('block_2', 'new', null, 1)], '2026-10', TODAY).empty, 'sample')
  assert.equal(pickHeadlines([withDelta('block_1', 'flat', 10, 10)], '2026-10', TODAY).empty, 'steady')
})

// ── Funnels ─────────────────────────────────────────────────────────────────────────────────

test('#1161 BR-USUARIO-037 item 3.j DS-COMPONENTE-084 item 2: seven steps; installs and location are hollow with no rate; every bank rate is over entered', () => {
  const f = buildUseFunnel(input())
  assert.deepEqual(f.steps.map((s) => [s.key, s.source, s.hollow, s.value]), [
    ['step_1', 'ga4', true, 450],
    ['step_2', 'bank', false, 119],
    ['step_3', 'ga4', true, 60],
    ['step_4', 'bank', false, 35],
    ['step_5', 'bank', false, 22],
    ['step_6', 'bank', false, 12],
    ['step_7', 'bank', false, 6],
  ])
  assert.equal(f.base, 119)
  for (const s of f.steps) assert.equal(s.rate, s.hollow ? null : (s.value as number) / 119, s.key)
  assert.equal(f.max, 450)
})

test('#1161 spec E6: the biggest drop skips the GA4 step, entered to guide is 71 points; a negative drop has no lost and prints a gain', () => {
  const f = buildUseFunnel(input())
  assert.deepEqual(f.biggestDrop, { from: 'step_2', to: 'step_4', points: 71 })
  assert.equal(f.steps[3].lost, 119 - 35)
  const v = readStepFunnel('bank', [
    { key: 'a', source: 'bank', value: 100 },
    { key: 'g', source: 'ga4', value: 90 },
    { key: 'b', source: 'bank', value: 40 },
    { key: 'c', source: 'bank', value: 55 },
  ])
  assert.equal(v.steps[3].lost, null)
  assert.equal(v.steps[3].gain, 15)
  assert.deepEqual(v.biggestDrop, { from: 'a', to: 'b', points: 60 })
})

test('#1161 DS-COMPONENTE-100 item 1: no biggest drop under a base of 30, with fewer than two rates, or on a tie after rounding', () => {
  assert.equal(readStepFunnel('bank', [{ key: 'a', source: 'bank', value: 29 }, { key: 'b', source: 'bank', value: 3 }]).biggestDrop, null)
  assert.equal(readStepFunnel('bank', [{ key: 'a', source: 'bank', value: 100 }, { key: 'g', source: 'ga4', value: 50 }]).biggestDrop, null)
  assert.equal(readStepFunnel('bank', [{ key: 'a', source: 'bank', value: 100 }, { key: 'b', source: 'bank', value: 70 }, { key: 'c', source: 'bank', value: 40 }]).biggestDrop, null)
})

test('#1161 spec E6.1 step 7 DS-COMPONENTE-084 item 1: the 2nd trip of a month whose 30-day window is open is a floor that says when it closes', () => {
  const f = buildUseFunnel(input())
  const s7 = f.steps[6]
  assert.equal(s7.state, 'floor')
  assert.equal(s7.due, '2026-12-01')
  const closed = buildUseFunnel(input({ month: '2026-09' }))
  assert.equal(closed.steps[6].state, 'measured')
  // August is the ledger's first month: 1 hour is a floor
  assert.equal(buildUseFunnel(input({ month: '2026-08' })).steps[5].state, 'floor')
})

test('#1161 BR-COMUNICACAO-022 item 4: without the usage function the bank steps are unknown with their reason, never 0', () => {
  const f = buildUseFunnel(input({ usage: undefined, usageFailed: true }))
  for (const s of f.steps.filter((x) => x.source === 'bank')) {
    assert.equal(s.value, null)
    assert.equal(s.reason, 'source_failed')
    assert.equal(s.rate, null)
  }
  assert.equal(f.biggestDrop, null)
})

test('#1161 DS-COMPONENTE-084 item 2: the purchase funnel is GA4 over GA4, every share of who saw the paywall; exits are not steps', () => {
  const { view, closed, failed } = buildPaywallFunnel(input())
  assert.deepEqual(view.steps.map((s) => [s.key, s.value, s.hollow]), [['step_1', 95, false], ['step_2', 2, false], ['step_3', 9, false]])
  assert.equal(view.steps[1].rate, 2 / 95)
  assert.equal(view.steps[2].rate, 9 / 95)
  // more bought than tapped this month: a gain, and the biggest drop is the one from saw to tapped
  assert.equal(view.steps[2].gain, 7)
  assert.deepEqual(view.biggestDrop, { from: 'step_1', to: 'step_2', points: 98 })
  assert.equal(closed.value, 79)
  // never received by GA4: unknown, not 0
  assert.equal(failed.value, null)
  assert.equal(failed.state, 'before_source')
  const filtered = buildPaywallFunnel(input({ ga4Filtered: true }))
  assert.ok(filtered.view.steps.every((s) => s.reason === 'filter'))
})

test('#1161: the free minutes before buying come from the usage function, 150 in October', () => {
  assert.equal(freeBeforeCell(input()).value, 150)
  assert.equal(freeBeforeCell(input({ month: '2026-09' })).state, 'no_source')
})

// ── Benchmarks ──────────────────────────────────────────────────────────────────────────────

test('#1161 spec E4: the market references live in one module, each with its value, source, year and link', () => {
  assert.equal(benchmark('retention_d1').value, 0.18)
  assert.equal(benchmark('retention_d30').value, 0.028)
  assert.equal(benchmark('dau_mau').value, 0.18)
  for (const b of Object.values(BENCHMARKS)) {
    assert.ok(b.value > 0 && b.value < 1)
    assert.ok(b.source.length > 0 && b.year >= 2023)
    assert.match(b.url, /^https:\/\//)
  }
  // the numbers exist once: no component or other module writes them
  for (const file of ['lib/engagement/blocks.ts', 'lib/engagement/answers.ts', 'lib/engagement/headlines.ts']) {
    assert.doesNotMatch(readFileSync(join(process.cwd(), file), 'utf8'), /0\.028|\b0\.18\b/, file)
  }
})
