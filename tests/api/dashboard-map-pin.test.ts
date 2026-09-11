/**
 * `lib/dashboard/map-pin.ts` — what a pin on the Overview hero map is allowed to claim.
 *
 * The map is the screen where a wrong claim is invisible: every pin looks plausible. Three
 * of them were wrong at once until #732, and each one is pinned here.
 *
 * 1. **BR-MONETIZACAO-046** — three entitlement states, three colours. The colour came from
 *    `is_premium`, which merges `unlimited` with `metered`, and 68 of the 73 pins holding a
 *    canonical entitlement rendered as non-paying. A missing state is grey, never `free`:
 *    the rule says an unknown entitlement never becomes `free` by omission.
 * 2. **Freshness is a cut, and the cut has one owner.** `LIVE_SIGNAL_MAX_AGE_SECONDS` is
 *    provisional and belongs to `design` (`docs/contracts/banco-para-cms.md`, Part 6, item
 *    1); these tests are written against the constant, never against `300`, so the day the
 *    decision arrives the suite moves with it instead of failing.
 * 3. **"The guide is on" is `guide_active` and nothing else.** `guide_state` outlives the
 *    session that carries it (#731: 750 orphan heartbeats in 30 days), so a test that lets
 *    it light up the pin would be pinning the defect.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  LIVE_SIGNAL_MAX_AGE_SECONDS,
  entitlementPinColor,
  livePinAppearance,
  minutesSinceIso,
  signalAgeMinutes,
  signalFreshness,
  userPinAppearance,
} from '@/lib/dashboard/map-pin'
import { CHART_NEUTRAL, ENTITLEMENT_COLOR } from '@/lib/constants/chart-colors'
import { ENTITLEMENT_STATES } from '@/lib/credit/entitlement'

test('BR-MONETIZACAO-046: the three entitlement states get three different colours', () => {
  const colors = ENTITLEMENT_STATES.map((state) => entitlementPinColor(state))

  assert.equal(new Set(colors).size, ENTITLEMENT_STATES.length, 'two states sharing a colour is is_premium again')
  for (const state of ENTITLEMENT_STATES) {
    assert.equal(entitlementPinColor(state), ENTITLEMENT_COLOR[state], `${state} must read the shared palette, not a local hex`)
  }
})

test('BR-MONETIZACAO-046: metered is not painted as free — the 68 pins of #732', () => {
  assert.notEqual(entitlementPinColor('metered'), entitlementPinColor('free'))
  assert.equal(userPinAppearance({ entitlement_state: 'metered' }).tone, 'metered')
})

test('BR-MONETIZACAO-046: an unknown entitlement is grey, never free by omission', () => {
  for (const absent of [null, undefined, '', 'premium']) {
    const look = userPinAppearance({ entitlement_state: absent })
    assert.equal(look.color, CHART_NEUTRAL, `${String(absent)} must not claim a product state`)
    assert.equal(look.tone, 'unknown')
    assert.notEqual(look.color, entitlementPinColor('free'))
  }
})

test('a signal at the cut is live, one second past it is archive', () => {
  assert.equal(signalFreshness(0), 'live')
  assert.equal(signalFreshness(LIVE_SIGNAL_MAX_AGE_SECONDS), 'live')
  assert.equal(signalFreshness(LIVE_SIGNAL_MAX_AGE_SECONDS + 1), 'archived')
})

test('a negative age is a signal from now, not from the future', () => {
  // `drive.insert_location_batch` clamps the device clock to now()+5min, so a fast phone
  // legitimately reports a negative age. Reading it as "old" would dim the freshest pin.
  assert.equal(signalFreshness(-1), 'live')
  assert.equal(signalFreshness(-299), 'live')
  assert.equal(signalAgeMinutes(-299), 0, 'the panel must never write "-4 minutes ago"')
  assert.equal(userPinAppearance({ entitlement_state: 'free', last_signal_age_seconds: -120 }).dimmed, false)
})

test('a user who never emitted a signal is never live, and the age is not zero', () => {
  const look = userPinAppearance({ entitlement_state: 'free', last_signal_age_seconds: null })

  assert.equal(look.freshness, 'never')
  assert.equal(look.dimmed, true)
  assert.equal(signalAgeMinutes(null), null, 'null age is an absent measurement, not a measured zero')
})

test('an archived position stays on the map, dimmed', () => {
  const thirtyDays = 30 * 24 * 60 * 60
  const look = userPinAppearance({ entitlement_state: 'unlimited', last_signal_age_seconds: thirtyDays })

  assert.equal(look.freshness, 'archived')
  assert.equal(look.dimmed, true)
  assert.equal(look.color, ENTITLEMENT_COLOR.unlimited, 'dimming is opacity; it must not take the colour away')
  assert.equal(look.active, false)
})

test('a live ping outranks an old column: the pin is not dimmed', () => {
  const stale = { entitlement_state: 'metered', last_signal_age_seconds: 90_000 }

  assert.equal(userPinAppearance(stale).dimmed, true)
  assert.equal(userPinAppearance(stale, true).dimmed, false, 'the presence RPC is fresher than the pin row')
})

test('#731: guide_state alone never lights the pin — only guide_active does', () => {
  const heartbeatOnly = userPinAppearance({
    entitlement_state: 'metered',
    guide_active: false,
    last_signal_age_seconds: 60,
    // An orphan heartbeat carries `guide_state: 'active'` hours after the session closed.
    // It is not in `MapPinFacts` on purpose; passing it must change nothing.
    ...({ guide_state: 'active' } as Record<string, unknown>),
  })

  assert.equal(heartbeatOnly.active, false)
})

test('the guide being on wins over an old signal: highlighted, never dimmed', () => {
  const look = userPinAppearance({
    entitlement_state: 'free',
    guide_active: true,
    last_signal_age_seconds: 60 * 60 * 24,
  })

  assert.equal(look.active, true)
  assert.equal(look.dimmed, false, 'the database just said this person has an open session')
  assert.equal(look.color, ENTITLEMENT_COLOR.free, 'the highlight is size and pulse; the colour is still the state')
})

test('"on since" is floored at zero — the operator clock may lag the server', () => {
  const now = Date.parse('2026-09-11T12:00:00Z')

  assert.equal(minutesSinceIso('2026-09-11T10:30:00Z', now), 90)
  assert.equal(minutesSinceIso('2026-09-11T12:05:00Z', now), 0, 'a session that started "later" reads as 0, never -5')
  assert.equal(minutesSinceIso(null, now), null)
  assert.equal(minutesSinceIso('not a date', now), null)
})

test('the live-only pin claims a position, not an entitlement', () => {
  const look = livePinAppearance()

  assert.equal(look.dimmed, false)
  assert.equal(look.active, false, 'a ping is not an open guide session')
  assert.equal(look.tone, 'live-only')
  for (const state of ENTITLEMENT_STATES) {
    assert.notEqual(look.color, ENTITLEMENT_COLOR[state], 'a pin with no entitlement column must not wear one')
  }
})
