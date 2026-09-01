/**
 * **BR-MONETIZACAO-046** — the hours of one tourist, as the user file reads them.
 *
 * The screen is proven in `tests/ct/app-user-link.spec.tsx`; what is proven here is the layer
 * under it, because that is where the mistake is silent. `core.dashboard_user_detail` gains
 * its nine hour columns in a migration that lands after this code, and the file's own
 * shorthand for a number — `Number(row.x || 0)` — turns a column that did not come back into
 * a `0`. On a screen `0` is a sentence: "consumed nothing", "never bought", "no balance".
 * Nobody said it, and nothing breaks when it appears.
 *
 * `null` is the only honest answer for a column that is not there, and it is the surface that
 * decides how to print it (`formatDurationOrDash` → `UNKNOWN_VALUE`). That division is the
 * whole test.
 *
 * **Nothing here resolves a state.** `unlimited` → `metered` → `free` is resolved once, by
 * `drive.get_entitlement`, and arrives decided. The parser's only job with `state` is to
 * refuse to invent one — including refusing `free`, which is the tempting default and is a
 * claim about somebody's access.
 *
 * **BR-USUARIO-042** rides along: the two columns the same migration removes are dropped at
 * the door rather than merely left out of the type, so a `UserDetail` cannot carry a name or
 * an e-mail into a component even while the old RPC is still answering with them.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { toUserDetail } from '@/lib/services/dashboard-service'
import { formatDuration, formatDurationOrDash } from '@/lib/format/duration'
import { UNKNOWN_VALUE } from '@/lib/format/unknown'

const USER_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

/** The row the RPC answers TODAY: no hour column exists, and the two removed ones still do. */
const preMigrationRow = () => ({
  user_id: USER_ID,
  nickname: 'hoppy-otter',
  full_name: 'Joana Ribeiro da Silva',
  email: 'joana.ribeiro@example.com',
  country: 'BR',
  login_count: 12,
  trip_count: 4,
  total_km: 210.4,
  poi_visits_count: 31,
  unique_cities_visited: 3,
})

/** The row after the migration, with the nine columns `core.dashboard_metered_users` returns. */
const postMigrationRow = () => ({
  user_id: USER_ID,
  nickname: 'hoppy-otter',
  login_count: 12,
  trip_count: 4,
  total_km: 210.4,
  poi_visits_count: 31,
  unique_cities_visited: 3,
  state: 'metered',
  balance_minutes: 150,
  minutes_granted_total: 600,
  minutes_consumed_total: 450,
  has_purchase: true,
  last_grant_source: 'purchase',
  last_grant_at: '2026-08-20T10:00:00Z',
  last_purchase_product_id: 'tuggi_hours_10',
  ends_at: null,
})

// ---------------------------------------------------------------------------
// A missing column is not a zero.
// ---------------------------------------------------------------------------

test('BR-MONETIZACAO-046: with no hour columns every hour field is null, never 0 and never false', () => {
  const detail = toUserDetail(preMigrationRow())

  assert.equal(detail.state, null)
  assert.equal(detail.balance_minutes, null)
  assert.equal(detail.minutes_granted_total, null)
  assert.equal(detail.minutes_consumed_total, null)
  // `false` here would read as "this person never bought", which is a different fact from
  // "the column is not there yet".
  assert.equal(detail.has_purchase, null)
  assert.equal(detail.last_grant_source, null)
  assert.equal(detail.last_grant_at, null)
  assert.equal(detail.last_purchase_product_id, null)
  assert.equal(detail.ends_at, null)
})

test('BR-MONETIZACAO-046: an absent duration prints as a dash, and a measured zero prints as 0 min', () => {
  // The two functions answer different questions and both are right. The bug is calling the
  // wrong one: `formatDuration(null)` is `0 min`, which is exactly the assertion the block
  // must not make about a column it does not have.
  assert.equal(formatDuration(null), '0 min')
  assert.equal(formatDurationOrDash(null), UNKNOWN_VALUE)
  assert.equal(formatDurationOrDash(undefined), UNKNOWN_VALUE)

  // Zero minutes IS a fact when the column came back: the tourist ran out, which is the row
  // the paid-access report exists to show.
  assert.equal(formatDurationOrDash(0), '0 min')
  assert.equal(formatDurationOrDash(150), '2 h 30 min')
})

test('BR-MONETIZACAO-046: the state arrives resolved, and an unknown value never becomes free', () => {
  assert.equal(toUserDetail(postMigrationRow()).state, 'metered')
  assert.equal(toUserDetail({ ...postMigrationRow(), state: 'unlimited' }).state, 'unlimited')
  assert.equal(toUserDetail({ ...postMigrationRow(), state: 'free' }).state, 'free')

  // A fourth value means the database learned something this code has not. `free` is the
  // tempting default and is a claim about somebody's access; the honest answer is absence.
  assert.equal(toUserDetail({ ...postMigrationRow(), state: 'trialing' }).state, null)
  assert.equal(toUserDetail({ ...postMigrationRow(), state: '' }).state, null)
})

test('BR-MONETIZACAO-046: the nine columns are carried through untouched, and no total is recomputed', () => {
  const detail = toUserDetail(postMigrationRow())

  assert.equal(detail.balance_minutes, 150)
  assert.equal(detail.minutes_granted_total, 600)
  assert.equal(detail.minutes_consumed_total, 450)
  assert.equal(detail.has_purchase, true)
  assert.equal(detail.last_grant_source, 'purchase')
  assert.equal(detail.last_purchase_product_id, 'tuggi_hours_10')

  // `granted − consumed` reconstructs the balance in the DATABASE, with a zero floor. Doing
  // the subtraction here would be a second implementation of the same resolution, which is
  // what the rule forbids — so the value stays the RPC's even when the arithmetic disagrees.
  const disagreeing = toUserDetail({ ...postMigrationRow(), balance_minutes: 99 })
  assert.equal(disagreeing.balance_minutes, 99)
})

test('BR-MONETIZACAO-046: has_purchase keeps its three answers apart', () => {
  assert.equal(toUserDetail({ ...postMigrationRow(), has_purchase: true }).has_purchase, true)
  assert.equal(toUserDetail({ ...postMigrationRow(), has_purchase: false }).has_purchase, false)
  assert.equal(toUserDetail({ ...postMigrationRow(), has_purchase: null }).has_purchase, null)
})

// ---------------------------------------------------------------------------
// BR-USUARIO-042: the two columns are dropped at the door, not just off the type.
// ---------------------------------------------------------------------------

test('BR-USUARIO-042: a UserDetail cannot carry a tourist name or e-mail, even before the migration', () => {
  const detail = toUserDetail(preMigrationRow()) as unknown as Record<string, unknown>

  assert.equal('full_name' in detail, false)
  assert.equal('email' in detail, false)

  // The type alone would let the payload through at runtime, and the only thing stopping a
  // component from reading `(user as any).email` would be somebody remembering the rule.
  assert.equal(JSON.stringify(detail).includes('Joana'), false)
  assert.equal(JSON.stringify(detail).includes('example.com'), false)

  // What identifies is still there, whole: the truncation to 8 characters is presentation and
  // belongs to `appUserLabel`, so the `user_id` travels intact.
  assert.equal(detail.user_id, USER_ID)
  assert.equal(detail.nickname, 'hoppy-otter')
})
