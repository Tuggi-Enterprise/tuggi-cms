/**
 * The sixth KPI of the dashboard: hours consumed, cut by how the minute was granted — #658.
 *
 * The card swapped the pending-demand KPI for consumption. Three things break in silence
 * here, and none of them has a symptom on screen:
 *
 * 1. **a missing column becoming a zero.** `consumed_minutes_*` belong to `data` and the
 *    migration may not be applied. `Number(undefined || 0)` prints `0 min`, and on a
 *    screen `0 min` is an assertion — "nobody listened" — on top of data that never
 *    arrived. Same reasoning as the paid-access card (BR-MONETIZACAO-046), where zero
 *    would claim that nobody pays;
 * 2. **the sum growing a second owner.** The RPC has no total column: the one that adds is
 *    `consumedMinutesTotal`, and the next screen reads that function instead of summing
 *    again;
 * 3. **the waitlist leaving with it.** Only the KPI was replaced. The demand list and the
 *    red pins on the map stay, and they are easy to drag along in the same diff.
 *
 * The split is by **origin of the minute** (BR-MONETIZACAO-047: a pass purchase on one
 * side; welcome, coupon and CMS grant on the other) — never by who the user is today. No
 * third slice is invented here: a minute that is neither paid nor granted is a decision
 * for `data`, and comes back as a card.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  consumedMinutesTotal,
  dashboardService,
  EntitlementOverview,
} from '@/lib/services/dashboard-service'
import { formatDuration } from '@/lib/format/duration'

const REPO_ROOT = resolve(import.meta.dirname, '../..')
const PAGE = 'app/[locale]/dashboard/page.tsx'

function source(path: string): string {
  return readFileSync(resolve(REPO_ROOT, path), 'utf8')
}

/** The aggregate with both contract columns, overridable per case. */
function overview(partial: Partial<EntitlementOverview> = {}): EntitlementOverview {
  return {
    total_users: 900,
    unlimited_users: 37,
    metered_users: 375,
    free_users: 488,
    purchased_users: 120,
    granted_users: 292,
    low_balance_users: 14,
    total_balance_minutes: 51_240,
    consumed_minutes_paid: 2_460,
    consumed_minutes_granted: 12_600,
    ...partial,
  }
}

// ---------------------------------------------------------------------------
// 1. The total is the sum of both columns, and it has a single owner
// ---------------------------------------------------------------------------

test('BR-MONETIZACAO-046: the KPI adds up the two consumption columns', () => {
  assert.equal(consumedMinutesTotal(overview()), 15_060)
  assert.equal(formatDuration(15_060), '251 h')
})

test('BR-MONETIZACAO-047: the parts close the total — whole minutes, exact sum', () => {
  const row = overview({ consumed_minutes_paid: 90, consumed_minutes_granted: 95 })
  assert.equal(formatDuration(row.consumed_minutes_paid), '1 h 30 min')
  assert.equal(formatDuration(row.consumed_minutes_granted), '1 h 35 min')
  assert.equal(formatDuration(consumedMinutesTotal(row)), '3 h 5 min')
})

test('a measured zero is a zero, not an em dash', () => {
  const row = overview({ consumed_minutes_paid: 0, consumed_minutes_granted: 0 })
  assert.equal(consumedMinutesTotal(row), 0)
})

// ---------------------------------------------------------------------------
// 2. Absence is not zero — the KPI shows an em dash
// ---------------------------------------------------------------------------

test('BR-MONETIZACAO-046: with no aggregate the total is null (em dash), never 0', () => {
  assert.equal(consumedMinutesTotal(null), null)
})

test('one missing column takes the whole total down to null', () => {
  // Half a total printed as a number would read as a measurement, not as a gap.
  assert.equal(consumedMinutesTotal(overview({ consumed_minutes_paid: null })), null)
  assert.equal(consumedMinutesTotal(overview({ consumed_minutes_granted: null })), null)
})

test('an older RPC (without the columns) arrives as null, not as zero consumption', async () => {
  const row = {
    total_users: 900,
    unlimited_users: 37,
    metered_users: 375,
    free_users: 488,
    purchased_users: 120,
    granted_users: 292,
    low_balance_users: 14,
    total_balance_minutes: 51_240,
    // consumed_minutes_paid and consumed_minutes_granted: not in the RPC yet
  }

  const globals = globalThis as unknown as { window?: unknown; fetch: typeof fetch }
  const realFetch = globals.fetch
  globals.window = {}
  globals.fetch = (async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      data: {
        overview: { data: [row], error: null },
        meteredUsers: { data: [], error: null },
      },
    }),
  })) as unknown as typeof fetch

  try {
    const res = await dashboardService.getPaidAccess(20, 60)
    assert.equal(res.success, true)
    const agg = res.data?.overview ?? null
    assert.equal(agg?.consumed_minutes_paid, null)
    assert.equal(agg?.consumed_minutes_granted, null)
    assert.equal(consumedMinutesTotal(agg), null)
    // The rest of the aggregate is still read: a missing column does not take the block down.
    assert.equal(agg?.metered_users, 375)
  } finally {
    globals.fetch = realFetch
    delete globals.window
  }
})

// ---------------------------------------------------------------------------
// 3. The screen: one owner for the sum, and duration from whoever already owns it
// ---------------------------------------------------------------------------

test('the KPI total is not summed in the JSX — the page calls the owner', () => {
  const page = source(PAGE)
  assert.match(page, /consumedMinutesTotal\(paidAccess\.overview\)/)
  assert.doesNotMatch(page, /consumed_minutes_paid\s*\+\s*consumed_minutes_granted/)
})

test('the KPI prints an em dash when the aggregate did not arrive', () => {
  assert.match(source(PAGE), /consumedMinutes === null\s*\?\s*'—'/)
})

test('duration still comes from lib/format/duration — no dividing by 60 on screen', () => {
  const page = source(PAGE)
  assert.match(page, /import \{ formatDuration \} from '@\/lib\/format\/duration'/)
  assert.doesNotMatch(page, /consumedMinutes\s*\/\s*60/)
})

test('the paid x free split exists in the three locales, with both amounts', () => {
  for (const locale of ['pt', 'en', 'es']) {
    const messages = JSON.parse(source(`messages/${locale}.json`))
    const split = messages.Pages.Dashboard.labels.consumption_split
    assert.ok(split, `messages/${locale}.json has no Pages.Dashboard.labels.consumption_split`)
    assert.ok(split.includes('{paid}'), `${locale}: missing {paid}`)
    assert.ok(split.includes('{granted}'), `${locale}: missing {granted}`)
    // `h` and `min` come from formatDuration and do not translate: the key never repeats them.
    assert.doesNotMatch(split, /\bmin\b/)
  }
})

// ---------------------------------------------------------------------------
// 4. Only the KPI was replaced
// ---------------------------------------------------------------------------

test('the pending-demand list is still on the dashboard', () => {
  const page = source(PAGE)
  assert.match(page, /import \{ WaitlistDemandList \}/)
  assert.match(page, /<WaitlistDemandList pins=\{waitlistPins\} \/>/)
})

test('the red demand pins are still fed', () => {
  const page = source(PAGE)
  assert.match(page, /dashboardService\.getWaitlistPins\(/)
  assert.match(page, /for \(const w of waitlistPins\)/)
})

test('the demand KPI still exists in the geography report', () => {
  // The waitlist aggregate did not die: it lost the top slot and kept its own.
  const report = source('components/dashboard/reports/GeoDemand.tsx')
  assert.match(report, /labels\.demand_pending/)
  assert.match(report, /getWaitlistStats\(/)
})
