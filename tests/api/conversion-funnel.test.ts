/**
 * The Conversion report's arithmetic (#1068): two instruments that never form a fraction, and three
 * states of the installs count that never print alike.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  parseConversionFunnel,
  installsState,
  rateOfEntered,
  notEntered,
  funnelMax,
  readFunnel,
} from '../../lib/conversion/funnel'

const raw = (installsTotal: number | null, entered: number) => ({
  month: '2026-10',
  installs: { ios: installsTotal === null ? null : 612, android: installsTotal === null ? null : 388, total: installsTotal },
  entered,
  account: 312,
  used_hours: 455,
  purchased: 61,
})

test('happy path: measured installs, difference printed, steps as share of entered', () => {
  const f = parseConversionFunnel(raw(1000, 720))
  assert.deepEqual(f, {
    month: '2026-10',
    installs: { ios: 612, android: 388, total: 1000 },
    entered: 720,
    account: 312,
    usedHours: 455,
    purchased: 61,
  })
  const v = readFunnel(f)
  assert.equal(v.installs, 'measured')
  assert.equal(v.max, 1000)
  assert.equal(v.notEntered, 280)
  assert.equal(v.rates.account, 312 / 720)
  assert.equal(v.rates.purchased, 61 / 720)
})

test('DS-COMPONENTE-084 item 1: installs.total null stays null (no GA4 row), never 0', () => {
  const f = parseConversionFunnel(raw(null, 720))
  assert.equal(f.installs.total, null)
  assert.equal(f.installs.ios, null)
  const v = readFunnel(f)
  assert.equal(v.installs, 'unknown')
  assert.equal(v.notEntered, null)
  // an unknown count does not set the ruler: entered does
  assert.equal(v.max, 720)
})

test('DS-COMPONENTE-084 item 1: installs.total 0 is a measurement, not an absence', () => {
  const f = parseConversionFunnel(raw(0, 0))
  assert.equal(f.installs.total, 0)
  assert.equal(installsState(0, 0), 'measured')
  assert.equal(notEntered(0, 0), 0)
})

test('DS-COMPONENTE-084 item 1: installs below entered is a floor, with no difference', () => {
  assert.equal(installsState(500, 720), 'floor')
  assert.equal(notEntered(500, 720), null)
  // the ruler is entered, so the installs bar comes out shorter and the defect shows
  assert.equal(funnelMax(500, 720), 720)
})

test('DS-COMPONENTE-084 item 2: entered = 0 prints no rate, not 0 nor 100%', () => {
  assert.equal(rateOfEntered(0, 0), null)
  assert.equal(rateOfEntered(5, 0), null)
  const v = readFunnel(parseConversionFunnel({ ...raw(40, 0), account: 0, used_hours: 0, purchased: 0 }))
  assert.deepEqual(v.rates, { account: null, usedHours: null, purchased: null })
  assert.equal(v.notEntered, 40)
})

test('BR-USUARIO-037 3.j: purchased can exceed account, each is a share of entered alone', () => {
  const f = parseConversionFunnel({ ...raw(1000, 100), account: 10, purchased: 20 })
  const v = readFunnel(f)
  assert.equal(v.rates.account, 0.1)
  assert.equal(v.rates.purchased, 0.2)
})

test('a missing or empty payload parses to zeros and an unknown installs count', () => {
  const f = parseConversionFunnel(null)
  assert.equal(f.installs.total, null)
  assert.equal(f.entered, 0)
})
