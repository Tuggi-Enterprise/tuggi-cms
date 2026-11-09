/**
 * #1166: the four fixes of the design validation of the Engagement page, pure, on the October fixture of
 * contract Parte 27: the legend of a chart that draws one of its series, the month chart with no point in
 * the window, and the bank DAU/MAU under partial coverage of app opens.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { ACTIVE, BANK_RETENTION, CONVERSION, GA4, MONTHS, TODAY, USAGE } from '../ct/engagement-fixtures'
import { buildBlock2, buildBlock3, hasNoPoint, type QuestionsInput } from '@/lib/engagement/blocks'
import { buildActiveBank } from '@/lib/engagement/signals'
import { drawnLegend } from '@/components/dashboard/reports/engagement/question-charts'
import type { EngagementBankReport } from '@/lib/engagement/report'

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

/** The bank before the split by mode and before the heartbeats: no mode and no off-screen share in any month. */
const BANK_BEFORE_SPLIT: EngagementBankReport = {
  ...BANK_RETENTION,
  months: BANK_RETENTION.months.map((m) => ({ ...m, modes: { drive_only: null, explore_only: null, both: null }, guide_background_share: null })),
}

test('#1166 DS-A11Y-007: a chart that defines two series or more names every series it draws, even when only one has a number', () => {
  const b2 = buildBlock2(input({ bank: BANK_BEFORE_SPLIT }))
  const series = b2.series.map((key) => ({ key }))
  assert.ok(series.length > 1)
  assert.deepEqual(
    drawnLegend(series, b2.chart).map((x) => x.key),
    ['trip_total'],
  )
  // November has the split: the modes are drawn and named, and the total of the months before them too
  const split = drawnLegend(series, buildBlock2(input({ month: '2026-11' })).chart).map((x) => x.key)
  assert.ok(split.includes('drive_only') && split.includes('both') && split.includes('explore_only'))
  // a single-series chart has no legend
  assert.deepEqual(drawnLegend([{ key: 'ratio' }], [{ values: { ratio: 0.1 } }]), [])
  // a series that is never drawn is not named
  assert.deepEqual(drawnLegend([{ key: 'a' }, { key: 'b' }], [{ values: { a: 1, b: null } }, { values: { a: 2 } }]).map((x) => x.key), ['a'])
})

test('#1166 spec E9 BR-COMUNICACAO-022 item 4: block 3 with no off-screen share in any month has no point in the window, and the month says why, never 0', () => {
  const b3 = buildBlock3(input({ bank: BANK_BEFORE_SPLIT }))
  assert.equal(b3.status, 'ready')
  assert.equal(hasNoPoint(b3.chart), true)
  const oct = b3.chart[b3.chart.length - 1]
  assert.equal(oct.month, '2026-10')
  assert.deepEqual(oct.values, {})
  // the row carries the same reason as the number above it, "App fora da tela"
  const off = b3.stats[2]
  assert.equal(off.key, 'questions.block_3.off_screen')
  assert.equal(off.cell.value, null)
  assert.equal(oct.reason, off.cell.state)
  assert.equal(oct.since ?? null, off.cell.since)
  // November has the share: its window has a point and draws
  assert.equal(hasNoPoint(buildBlock3(input({ month: '2026-11' })).chart), false)
  // a measured zero is a point, not "no data"
  assert.equal(hasNoPoint([{ month: '2026-10', values: { on_screen: 1, off_screen: 0 }, reason: null }]), false)
  assert.equal(hasNoPoint([{ month: '2026-10', values: { on_screen: null }, reason: 'no_source' }]), true)
})

test('#1166 DS-COMPONENTE-084 item 2: with open_coverage partial the bank DAU/MAU prints no number and names when the opens started; DAU, WAU and MAU stay as floors', () => {
  const oct = buildActiveBank(input())
  const [dau, wau, mau, ratio] = oct.stats.map((s) => s.cell)
  for (const c of [dau, wau, mau]) {
    assert.equal(c.state, 'floor')
    assert.notEqual(c.value, null)
  }
  assert.equal(ratio.state, 'before_source')
  assert.equal(ratio.value, null)
  assert.equal(ratio.since, ACTIVE.data_since.open)
  // the ratio compares nothing: there is no number to compare
  assert.equal(oct.stats[3].delta?.curr.cell.value ?? null, null)
  // off the chart, with the same reason
  const row = oct.chart.find((r) => r.month === '2026-10')!
  assert.deepEqual(row.values, {})
  assert.equal(row.reason, 'before_source')
  // a full month still prints the ratio as measured
  const nov = buildActiveBank(input({ month: '2026-11' }))
  assert.equal(nov.stats[3].cell.state, 'measured')
  assert.equal(nov.stats[3].cell.value, 0.1292)
})
