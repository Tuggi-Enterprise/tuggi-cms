/**
 * #1266: the live pin says whether the guide is on and whether there is balance.
 *
 * Run with: npx tsx --import ./tests/api/setup/console-to-stderr.mjs --experimental-test-module-mocks --test tests/api/dashboard-live-pin-1266.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { LIVE_PIN_STATES, livePinColor, livePinState, livePinTitle } from '../../lib/dashboard/live-pin'
import { CHART_COLORS, CHART_NEUTRAL } from '../../lib/constants/chart-colors'

const base = { user_id: '0123456789abcdef', nickname: 'artedeviajarbem' }

// Stand-in for useTranslations('Pages.Dashboard'): echoes the key and the minutes.
const t = (key: string, values?: Record<string, string | number>) =>
  values ? `${key}(${values.minutes})` : key

test('#1266 BR-MONETIZACAO-046: guide on with a paid state is "guide on", green', () => {
  for (const entitlement_state of ['metered', 'unlimited']) {
    const state = livePinState({ ...base, guide_on: true, entitlement_state })
    assert.equal(state, 'guide_on')
    assert.equal(livePinColor(state), CHART_COLORS.green)
  }
})

test('#1266 BR-MONETIZACAO-046: guide on and free is "guide on, no balance", red', () => {
  const state = livePinState({ ...base, guide_on: true, entitlement_state: 'free', balance_minutes: 0 })
  assert.equal(state, 'guide_on_no_balance')
  assert.equal(livePinColor(state), CHART_COLORS.red)
})

test('#1266: guide off is "location only", grey, whatever the balance', () => {
  for (const entitlement_state of ['free', 'metered', 'unlimited']) {
    const state = livePinState({ ...base, guide_on: false, entitlement_state, balance_minutes: 90 })
    assert.equal(state, 'location_only')
    assert.equal(livePinColor(state), CHART_NEUTRAL)
  }
})

test('#1266: a row from the RPC before the migration (no new fields) is "location only" and does not throw', () => {
  const row = { user_id: base.user_id, lat: -22.9, lng: -43.2, timestamp: '2026-11-24T10:00:00Z' }
  assert.equal(livePinState(row), 'location_only')
  assert.equal(livePinTitle(row, t), '01234567 · live_pin.location_only')
  assert.equal(livePinState({ ...base, guide_on: null, entitlement_state: null }), 'location_only')
})

test('#1266 BR-MONETIZACAO-046: guide on with the state missing is never read as free', () => {
  assert.equal(livePinState({ ...base, guide_on: true }), 'guide_on')
})

test('#1266: the title carries the balance only when metered', () => {
  assert.equal(
    livePinTitle({ ...base, guide_on: true, entitlement_state: 'metered', balance_minutes: 119.6 }, t),
    'artedeviajarbem · live_pin.guide_on · live_pin.balance(120)',
  )
  assert.equal(
    livePinTitle({ ...base, guide_on: true, entitlement_state: 'unlimited', balance_minutes: 500 }, t),
    'artedeviajarbem · live_pin.guide_on',
  )
  assert.equal(
    livePinTitle({ ...base, guide_on: true, entitlement_state: 'free', balance_minutes: 0 }, t),
    'artedeviajarbem · live_pin.guide_on_no_balance',
  )
  assert.equal(
    livePinTitle({ ...base, guide_on: true, entitlement_state: 'metered', balance_minutes: null }, t),
    'artedeviajarbem · live_pin.guide_on',
  )
})

test('#1266 BR-USUARIO-042: without a nickname the title names the person by the truncated user_id', () => {
  assert.ok(livePinTitle({ user_id: base.user_id, nickname: '  ' }, t).startsWith('01234567 · '))
})

test('#1266: every legend state has its label in pt, en and es', () => {
  for (const locale of ['pt', 'en', 'es']) {
    const messages = JSON.parse(readFileSync(join(__dirname, '../../messages', `${locale}.json`), 'utf8'))
    const block = messages.Pages.Dashboard.live_pin
    for (const { state } of LIVE_PIN_STATES) assert.ok(block[state], `${locale}: live_pin.${state}`)
    assert.match(block.balance, /\{minutes\}/, `${locale}: live_pin.balance`)
  }
})
