/**
 * The acquisition screen's ruler: identified place and missing data never add up.
 *
 * The bug this guards against was live for one render. `core.dashboard_acquisition`
 * grouped cities by name alone, so accounts with no city landed in a single row —
 * mixing 17 accounts with NO coordinate at all with 36 that HAD one but fell outside
 * the imported municipalities. On screen it read "no city: 53", and 53 is a number
 * that sends the operator hunting for a capture bug when the real problem is a
 * boundary catalogue holding seven countries.
 *
 * Those two gaps have different fixes: `outside_boundaries` is repaired by importing
 * boundaries (or by core.geocode_cache filling it in), `without_origin` has no
 * retroactive repair at all. A screen that adds them hides which lever to pull.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  splitCities,
  splitCountries,
  rankMax,
  dailyAverage,
  hasOriginCoverage,
} from '../../lib/acquisition/split'
import type { AcquisitionCity, AcquisitionCountry } from '../../lib/services/acquisition-service'

const city = (city: string, status: AcquisitionCity['status'], total: number): AcquisitionCity => ({
  city,
  country: 'Brazil',
  status,
  total,
  withPartner: 0,
})

const country = (
  country: string,
  status: AcquisitionCountry['status'],
  total: number
): AcquisitionCountry => ({ country, status, total, withPartner: 0, ios: 0, android: 0 })

// August 2026, the month that produced the ruler.
const AUGUST_CITIES: AcquisitionCity[] = [
  city('Cabo Frio', 'located', 58),
  city('', 'outside_boundaries', 36),
  city('', 'without_origin', 17),
  city('Saquarema', 'located', 10),
]

test('the two gaps stay apart from each other', () => {
  const { real, gaps } = splitCities(AUGUST_CITIES)

  assert.deepEqual(
    real.map((c) => c.city),
    ['Cabo Frio', 'Saquarema']
  )
  assert.equal(gaps.length, 2, 'outside_boundaries and without_origin are separate rows')
  assert.deepEqual(
    gaps.map((g) => g.status),
    ['outside_boundaries', 'without_origin']
  )
  assert.notEqual(
    gaps.reduce((a, g) => a + g.total, 0),
    gaps[0].total,
    'the collapsed "53" must not be reachable from the split'
  )
})

test('every account is accounted for exactly once', () => {
  const { real, gaps } = splitCities(AUGUST_CITIES)
  const counted = [...real, ...gaps].reduce((a, c) => a + c.total, 0)
  assert.equal(counted, 121, 'splitting must not drop or duplicate an account')
})

test('a gap never sets the bar scale', () => {
  // Without this, "no city: 36" would be the longest bar and crush Cabo Frio's 58
  // against the left edge — the largest real city rendering smaller than a hole.
  const { real, gaps } = splitCities(AUGUST_CITIES)
  assert.equal(rankMax(real), 58)
  assert.ok(rankMax(real) > gaps[0].total, 'the scale comes from real places only')
})

test('rankMax never returns zero, so a bar width is never a division by zero', () => {
  assert.equal(rankMax([]), 1)
  assert.equal(rankMax([city('X', 'located', 0)]), 1)
})

test('countries split on their own status name', () => {
  // Countries say `identified`/`unidentified` where cities say `located`/
  // `outside_boundaries`. Reusing splitCities here would silently return zero rows.
  const rows = [
    country('Brazil', 'identified', 105),
    country('', 'unidentified', 36),
    country('', 'without_origin', 17),
  ]
  const { real, gaps } = splitCountries(rows)

  assert.deepEqual(
    real.map((c) => c.country),
    ['Brazil']
  )
  assert.equal(gaps.length, 2)
})

test('the daily average divides by days elapsed, not by the length of the month', () => {
  // On the 3rd of a 31-day month, dividing by 31 would report a collapse in
  // acquisition that only exists because the month has not happened yet.
  assert.equal(dailyAverage({ total: 30, daysElapsed: 3 }), 10)
  assert.equal(dailyAverage({ total: 197, daysElapsed: 31 }).toFixed(1), '6.4')
})

test('daysElapsed of zero does not divide by zero', () => {
  assert.equal(dailyAverage({ total: 5, daysElapsed: 0 }), 5)
})

test('months before location capture are flagged, not silently shown as empty', () => {
  // drive.user_location_history only carries usable data from May 2026 on. Earlier
  // months have almost no origin and zero pings within an hour of signup, so their
  // emptiness is a data gap, not an acquisition result.
  assert.equal(hasOriginCoverage('2026-04-01'), false)
  assert.equal(hasOriginCoverage('2025-08-01'), false)
  assert.equal(hasOriginCoverage('2026-05-01'), true)
  assert.equal(hasOriginCoverage('2026-08-01'), true)
})
