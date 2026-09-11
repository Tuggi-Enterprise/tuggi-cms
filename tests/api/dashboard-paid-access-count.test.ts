/**
 * How many people pay the Tuggi — **one** number, on every surface that prints it (#735).
 *
 * **BR-MONETIZACAO-046**: "paid access", anywhere in this repository, reads as `metered` or
 * `unlimited`, and the tier decides nothing any more. The panel answered it twice: the Overview
 * counted the canonical entitlement and said **73**, while `/dashboard/reports/users` and
 * `/dashboard/reports/premium` counted `subscription_tier_id` and said **5** — 68 of the 73
 * (93 %) invisible, because whoever buys a pack of hours never gets a tier. The founder clicked
 * the KPI that said 73 and landed on a screen that said 5.
 *
 * Half of this suite reads the source of the four surfaces. That is deliberate: the defect was
 * never in a function — it was in which wrapper a JSX line called. A test of `paidAccessTotal`
 * alone would have stayed green throughout the whole divergence.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { paidAccessTotal, type EntitlementOverview } from '@/lib/services/dashboard-service'

const source = (relative: string) => readFileSync(join(process.cwd(), relative), 'utf8')

/** Every surface that prints "how many pay", and they must all print the same integer. */
const SURFACES = [
  'app/[locale]/dashboard/page.tsx',
  'components/dashboard/PaidAccessCard.tsx',
  'components/dashboard/reports/UsersAll.tsx',
  'components/dashboard/reports/UsersPremium.tsx',
]

const overview = (partial: Partial<EntitlementOverview>): EntitlementOverview => ({
  total_users: 378,
  unlimited_users: 0,
  metered_users: 0,
  free_users: 0,
  purchased_users: 0,
  granted_users: 0,
  low_balance_users: 0,
  total_balance_minutes: 0,
  consumed_minutes_paid: null,
  consumed_minutes_granted: null,
  ...partial,
})

test('BR-MONETIZACAO-046: paid access is unlimited + metered, and metered is not dropped', () => {
  // The five with a term plus the sixty-eight with a balance are the 73 of #735. Counting only
  // the ones with a tier is the 5, and that is the number the reports were printing.
  assert.equal(paidAccessTotal(overview({ unlimited_users: 5, metered_users: 68 })), 73)
  assert.equal(paidAccessTotal(overview({ unlimited_users: 5, metered_users: 0 })), 5)
  assert.equal(paidAccessTotal(overview({ unlimited_users: 0, metered_users: 68 })), 68)
})

test('BR-MONETIZACAO-046: a missing aggregate is not zero paying users', () => {
  // The RPC belongs to `data` and may not be applied. Zero would be a claim nobody made — the
  // surfaces print an em dash for `null`, the same pact as `formatDurationOrDash`.
  assert.equal(paidAccessTotal(null), null)
  assert.equal(paidAccessTotal(overview({})), 0, 'a measured zero is still a measurement')
})

test('BR-MONETIZACAO-046: every surface that prints who pays reads the same owner', () => {
  for (const file of SURFACES) {
    const code = source(file)
    assert.ok(code.includes('paidAccessTotal'), `${file} must read the single owner of the sum`)
    assert.ok(
      !/unlimited_users\s*\+\s*.*metered_users/.test(code),
      `${file} must not add the two columns on its own — that is how the second answer is born`,
    )
  }
})

test('BR-MONETIZACAO-046: the reports stopped counting paying users by subscription_tier_id', () => {
  const usersAll = source('components/dashboard/reports/UsersAll.tsx')
  const usersPremium = source('components/dashboard/reports/UsersPremium.tsx')

  // `total_premium_users` (block 11 of `core.dashboard_user_analytics`) and `premium_users`
  // (`core.dashboard_subscription_stats`) both count `subscription_tier_id`. They are not
  // wrong — they answer "how many hold a subscription tier" — they were just labelled with a
  // word that on this panel means "pays the Tuggi".
  assert.ok(!usersAll.includes('totalPremiumUsers'), 'the tier count has no reader in the users report')
  assert.ok(!/value=\{subStats\?\.premium_/.test(usersPremium), 'the tier count is not a KPI of paid access')
  assert.ok(!/subStats\?\.premium_percentage/.test(usersPremium), 'and neither is the share derived from it')

  // The service dropped the field rather than leaving it typed with no reader (CLAUDE.md §6).
  // The field, not the word: the wrapper's doc still names it, because knowing what left and
  // why is the point of the comment.
  const service = source('lib/services/dashboard-service.ts')
  assert.ok(!/totalPremiumUsers\s*[:?]/.test(service), 'a field nobody reads is a fourth answer waiting to be printed')
})

test('BR-MONETIZACAO-046: the share of paying users is computed over the same numerator', () => {
  const usersPremium = source('components/dashboard/reports/UsersPremium.tsx')
  const share = usersPremium.split('const paidShare')[1]?.split('\n\n')[0] ?? ''

  assert.ok(share.includes('paidAccessTotal'), 'the percentage must not have a numerator of its own')
  assert.ok(share.includes('total_users'), 'over the whole base, which is where the RPC got its denominator')
})
