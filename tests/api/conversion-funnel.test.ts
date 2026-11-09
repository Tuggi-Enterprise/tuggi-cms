/**
 * The arithmetic of the two funnels of the Engagement and conversion page (#1068, #1101 spec Parte C
 * §C16 items 5 and 6): two instruments that never form a fraction, three states of the installs count
 * that never print alike, and a purchase funnel whose branches compare only over a base big enough.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  parseConversionFunnel,
  installsState,
  rateOfEntered,
  notEntered,
  readUseFunnel,
  readPurchaseFunnel,
  LEDGER_FIRST_MONTH,
  type ConversionFunnel,
} from '../../lib/conversion/funnel'

const raw = (installsTotal: number | null, entered: number, over: Record<string, unknown> = {}) => ({
  month: '2026-10',
  installs: { ios: installsTotal === null ? null : 612, android: installsTotal === null ? null : 388, total: installsTotal },
  entered,
  account: 312,
  used_hours: 455,
  purchased: 61,
  tested_free: 300,
  purchased_after_free: 45,
  purchased_without_free: 16,
  used_guide_or_story: 500,
  ...over,
})

/** A purchase funnel with two branches of the given bases and buyers. */
const purchase = (tested: number, boughtTested: number, untested: number, boughtUntested: number): ConversionFunnel =>
  parseConversionFunnel(
    raw(1000, tested + untested, {
      tested_free: tested,
      purchased_after_free: boughtTested,
      purchased_without_free: boughtUntested,
      purchased: boughtTested + boughtUntested,
    })
  )

test('#1100 happy path: the parser reads the four fields of #1100 and keeps installs, entered, account and purchased', () => {
  const f = parseConversionFunnel(raw(1000, 720))
  assert.deepEqual(f, {
    month: '2026-10',
    installs: { ios: 612, android: 388, total: 1000 },
    entered: 720,
    account: 312,
    purchased: 61,
    testedFree: 300,
    purchasedAfterFree: 45,
    purchasedWithoutFree: 16,
    usedGuideOrStory: 500,
    consumed1h: null,
  })
})

test('#1101 BR-COMUNICACAO-022 item 4: a jsonb from before #1100 parses the new fields to null, never 0, and a sent 0 stays 0', () => {
  const { tested_free: _t, purchased_after_free: _a, purchased_without_free: _w, used_guide_or_story: _u, ...old } = raw(1000, 720)
  const f = parseConversionFunnel(old)
  assert.equal(f.testedFree, null)
  assert.equal(f.purchasedAfterFree, null)
  assert.equal(f.purchasedWithoutFree, null)
  assert.equal(f.usedGuideOrStory, null)
  const zero = parseConversionFunnel(raw(1000, 720, { tested_free: 0, used_guide_or_story: 0 }))
  assert.equal(zero.testedFree, 0)
  assert.equal(zero.usedGuideOrStory, 0)
})

// ── Use funnel ──────────────────────────────────────────────────────────────────────────────

test('#1101 spec C16 item 5 DS-COMPONENTE-084 item 2: the use funnel rates account and guide or story over entered, bank over bank; interacted only sets the ruler', () => {
  const v = readUseFunnel(parseConversionFunnel(raw(1000, 720)), 640)
  assert.equal(v.installs, 'measured')
  assert.equal(v.notEntered, 280)
  assert.equal(v.guest, 720 - 312)
  assert.equal(v.rates.account, 312 / 720)
  assert.equal(v.rates.used, 500 / 720)
  assert.deepEqual(Object.keys(v.rates), ['account', 'used', 'consumed1h'])
  // the ruler is the largest of the four, GA4 counts included
  assert.equal(v.max, 1000)
  assert.equal(readUseFunnel(parseConversionFunnel(raw(null, 720)), 900).max, 900)
  assert.equal(readUseFunnel(parseConversionFunnel(raw(null, 720)), null).max, 720)
})

test('#1101 spec C16 item 5 DS-COMPONENTE-084 item 2: funnel.ts never divides the GA4 counts', () => {
  const src = readFileSync(resolve(import.meta.dirname, '../../lib/conversion/funnel.ts'), 'utf8')
  for (const line of src.split('\n').filter((l) => /newEngaged|installs/.test(l) && !l.trim().startsWith('*') && !l.trim().startsWith('//'))) {
    assert.doesNotMatch(line, /\/\s*[a-zA-Z(]|[a-zA-Z)]\s*\//, `divides a GA4 count: ${line.trim()}`)
  }
})

test('#1101 DS-COMPONENTE-084 item 2 BR-COMUNICACAO-022 item 4: no guide-or-story field prints no rate; entered = 0 prints no rate at all', () => {
  const v = readUseFunnel(parseConversionFunnel(raw(1000, 720, { used_guide_or_story: undefined })), null)
  assert.equal(v.rates.used, null)
  const empty = readUseFunnel(parseConversionFunnel(raw(40, 0, { account: 0, purchased: 0, used_guide_or_story: 0 })), 0)
  assert.deepEqual(empty.rates, { account: null, used: null, consumed1h: null })
  assert.equal(empty.notEntered, 40)
})

test('#1156 spec D2 happy path DS-COMPONENTE-101 item 2: consumed 1 hour is read from consumed_1h and rated over entered, never over guide or story', () => {
  const v = readUseFunnel(parseConversionFunnel(raw(1000, 720, { consumed_1h: 180 })), 640)
  assert.equal(v.rates.consumed1h, 180 / 720)
  assert.notEqual(v.rates.consumed1h, 180 / 500)
  assert.equal(v.consumed1hFloor, false)
})

test('#1156 spec D8 item 1 BR-COMUNICACAO-022 item 4: consumed_1h null (a function before #1155, a month before the ledger) is no data with no rate, never 0; a sent 0 is a measured 0', () => {
  const absent = parseConversionFunnel(raw(1000, 720))
  assert.equal(absent.consumed1h, null)
  const v = readUseFunnel(absent, null)
  assert.equal(v.rates.consumed1h, null)
  assert.equal(readUseFunnel(parseConversionFunnel(raw(1000, 720, { consumed_1h: null })), null).rates.consumed1h, null)
  const zero = readUseFunnel(parseConversionFunnel(raw(1000, 720, { consumed_1h: 0 })), null)
  assert.equal(zero.rates.consumed1h, 0)
})

test('#1156 spec D8 item 1 BR-USUARIO-037 3.j: consumed 1 hour larger than guide or story is drawn wider, no error, and it sets the ruler when it is the largest', () => {
  const f = parseConversionFunnel(raw(null, 700, { used_guide_or_story: 300, consumed_1h: 710 }))
  const v = readUseFunnel(f, 200)
  assert.equal(v.max, 710)
  assert.equal(v.rates.consumed1h, 710 / 700)
  assert.equal(v.rates.used, 300 / 700)
})

test('#1156 contract Parte 26 §2: the month the minute ledger starts in is a floor, the month after is not', () => {
  assert.equal(LEDGER_FIRST_MONTH, '2026-08')
  assert.equal(readUseFunnel(parseConversionFunnel(raw(1000, 720, { month: '2026-08', consumed_1h: 30 })), null).consumed1hFloor, true)
  assert.equal(readUseFunnel(parseConversionFunnel(raw(1000, 720, { month: '2026-08', consumed_1h: null })), null).consumed1hFloor, false)
  assert.equal(readUseFunnel(parseConversionFunnel(raw(1000, 720, { month: '2026-09', consumed_1h: 30 })), null).consumed1hFloor, false)
})

test('#1101 spec C15.6: account larger than entered has no guest part', () => {
  assert.equal(readUseFunnel(parseConversionFunnel(raw(1000, 10, { account: 12 })), null).guest, null)
})

test('DS-COMPONENTE-084 item 1: installs null is unknown, 0 is measured, below entered is a floor with no difference', () => {
  assert.equal(parseConversionFunnel(raw(null, 720)).installs.total, null)
  assert.equal(installsState(null, 720), 'unknown')
  assert.equal(installsState(0, 0), 'measured')
  assert.equal(notEntered(0, 0), 0)
  assert.equal(installsState(500, 720), 'floor')
  assert.equal(notEntered(500, 720), null)
  assert.equal(rateOfEntered(5, 0), null)
})

// ── Purchase funnel ─────────────────────────────────────────────────────────────────────────

test('#1101 spec C16 item 6 DS-COMPONENTE-101 item 1: the two branches are disjoint and sum to entered; the rest of each is named, not measured', () => {
  const v = readPurchaseFunnel(parseConversionFunnel(raw(1000, 720)))
  const [t, u] = v.branches
  assert.equal(v.split, true)
  assert.equal((t.size as number) + (u.size as number), v.entered)
  assert.deepEqual(t, { key: 'tested', size: 300, share: 300 / 720, bought: 45, notBought: 255, rate: 45 / 300 })
  assert.deepEqual(u, { key: 'untested', size: 420, share: 420 / 720, bought: 16, notBought: 404, rate: 16 / 420 })
  assert.equal(v.purchased, 61)
  assert.equal(v.purchasedRate, 61 / 720)
})

test('#1101 spec C16 item 6 DS-COMPONENTE-101 item 3: bases 30 and 30 with 25 % and 4 % highlight the tested branch', () => {
  // 25 % of 30 is not a whole person, so 7.5 rounds: 8 of 32 is 25 %, 1 of 30 is 3 %
  const v = readPurchaseFunnel(purchase(32, 8, 30, 1))
  assert.equal(v.branches[0].rate, 0.25)
  assert.equal(v.convertsMore, 'tested')
  assert.equal(v.smallBase, false)
  assert.equal(readPurchaseFunnel(purchase(30, 1, 32, 8)).convertsMore, 'untested')
})

test('#1101 DS-COMPONENTE-101 item 3 DS-COMPONENTE-100 item 1: a base of 29 against 30 prints no highlight and says small base', () => {
  const v = readPurchaseFunnel(purchase(29, 10, 30, 1))
  assert.equal(v.convertsMore, null)
  assert.equal(v.smallBase, true)
})

test('#1101 DS-COMPONENTE-101 borders: 25 % against 24 % over 100 highlights; 25,4 % against 24,6 % rounds to a tie and does not', () => {
  assert.equal(readPurchaseFunnel(purchase(100, 25, 100, 24)).convertsMore, 'tested')
  const tie = readPurchaseFunnel(purchase(500, 127, 500, 123))
  assert.equal(tie.branches[0].rate, 0.254)
  assert.equal(tie.branches[1].rate, 0.246)
  assert.equal(tie.convertsMore, null)
  assert.equal(tie.smallBase, false)
})

test('#1101 DS-COMPONENTE-101 item 2: a branch of zero people is a measured 0 with no rate, and no highlight', () => {
  const v = readPurchaseFunnel(purchase(0, 0, 40, 3))
  assert.equal(v.branches[0].size, 0)
  assert.equal(v.branches[0].rate, null)
  assert.equal(v.branches[1].rate, 3 / 40)
  assert.equal(v.convertsMore, null)
  assert.equal(v.smallBase, false)
})

test('#1101 DS-COMPONENTE-101 item 5 BR-COMUNICACAO-022 item 4: without the fields of #1100 the branches are null and the trunk still prints entered and purchased', () => {
  const { tested_free: _t, purchased_after_free: _a, purchased_without_free: _w, ...old } = raw(1000, 720)
  const v = readPurchaseFunnel(parseConversionFunnel(old))
  assert.equal(v.split, false)
  assert.equal(v.entered, 720)
  assert.equal(v.purchased, 61)
  for (const b of v.branches) assert.deepEqual([b.size, b.share, b.bought, b.notBought, b.rate], [null, null, null, null, null])
  assert.equal(v.convertsMore, null)
  // tested_free sent but a branch purchase missing: the size prints, the rate does not
  const half = readPurchaseFunnel(parseConversionFunnel(raw(1000, 720, { purchased_without_free: null })))
  assert.equal(half.branches[1].size, 420)
  assert.equal(half.branches[1].rate, null)
  assert.equal(half.convertsMore, null)
})

test('#1101 DS-COMPONENTE-101 item 1: tested_free above entered breaks the contract, so nothing splits', () => {
  assert.equal(readPurchaseFunnel(parseConversionFunnel(raw(1000, 10, { tested_free: 12 }))).split, false)
})
