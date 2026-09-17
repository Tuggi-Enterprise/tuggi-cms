/**
 * #745 — THE SAME NUMBER, THE SAME PRECISION, ON THE TWO SURFACES.
 *
 * The field defect, observed in production on 2026-09-17 with the two screens side by side: the
 * CMS printed `65.72`, `30.15`, `24.76`, `1.36` and the app printed `65,7`, `30,2`, `24,8`,
 * `1,4`. Two surfaces, two rulers of precision, one number.
 *
 * What made it a DEFECT and not an inconsistency was what the app's screen looked like:
 *
 *   8º  Viajante        0
 *   9º  Leandro Ramos   0
 *   9º  Viajante        0
 *   9º  Viajante        0
 *
 * `rank()` gives EQUAL values the SAME position — `BR-RANKING-005` item 9 — so if the four
 * values were zero the four would be 8th. The 8th held a small NON-ZERO value that the rounding
 * printed as `0`, and the operator read the screen as wrong data.
 *
 * NOTHING HERE TOUCHES THE VALUE, THE FORMULA OR THE TIE. `points_official` is `BR-RANKING-004`
 * and `BR-RANKING-009`; the tie by construction is `BR-RANKING-005` item 9, which says there is
 * no written tie-break and that one is not to be invented in code. This is display: it stops
 * HIDING the difference the source already publishes.
 *
 * THE PARITY WITH THE APP IS THIS FILE. The two repos cannot share code (CLAUDE.md §6 — one
 * contract and a parity test, never a forced abstraction), so the twin of this file is
 * `src/__tests__/rankingFormat.test.ts` of `tuggi-drive-v2`, over `formatRankPoints`, citing the
 * same two rule IDs. Whoever changes the precision on one side and not on the other breaks a
 * test on the side he did not touch.
 *
 * Run with: npm run test:api  (or `npx tsx --experimental-test-module-mocks --test
 * tests/api/ranking-points-format.test.ts`)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { formatPoints } from '../../lib/ranking/scoreboard'

/** The five interface locales the product publishes, and the separator each one owns. */
const COMMA_LOCALES = ['pt', 'es', 'fr', 'it'] as const

test('BR-RANKING-004 — a point prints with EXACTLY two decimals, whatever the value', () => {
  assert.equal(formatPoints(65.72, 'pt'), '65,72')
  assert.equal(formatPoints(1.36, 'pt'), '1,36')
  // The two values that used to change the number of decimals: a whole number and a single
  // decimal. The precision no longer depends on the value.
  assert.equal(formatPoints(45, 'pt'), '45,00')
  assert.equal(formatPoints(0.5, 'pt'), '0,50')
  assert.equal(formatPoints(7, 'en'), '7.00')
})

test('BR-RANKING-005 — two rows with different rank() no longer print the same text', () => {
  // The repro of the screen above: 8th and 9th, values a hundredth apart. `rank()` only gives
  // the same position to EQUAL values, so two different positions must read as two different
  // texts — and no tie-break is being invented, the ordinals come from the source untouched.
  const eighth = formatPoints(0.04, 'pt')
  const ninth = formatPoints(0, 'pt')

  assert.equal(eighth, '0,04')
  assert.equal(ninth, '0,00')
  assert.notEqual(eighth, ninth)

  assert.equal(formatPoints(0.04, 'en'), '0.04')
  assert.equal(formatPoints(0, 'en'), '0.00')
})

test('BR-RANKING-004 — the separator is the locale`s, never a forced character', () => {
  for (const locale of COMMA_LOCALES) {
    assert.equal(formatPoints(24.76, locale), '24,76', locale)
  }
  assert.equal(formatPoints(24.76, 'en'), '24.76')
})

test('BR-RANKING-004 — absence stays absence, and is never a zero with two decimals', () => {
  // A quantity the read did not produce is the em dash, exactly as before. `0,00` is a MEASURED
  // zero and the two must not converge — the whole point of the change is telling them apart.
  assert.notEqual(formatPoints(null, 'pt'), '0,00')
  assert.equal(formatPoints(null, 'pt'), formatPoints(undefined, 'pt'))
  assert.equal(formatPoints(Number.NaN, 'pt'), formatPoints(null, 'pt'))
})
