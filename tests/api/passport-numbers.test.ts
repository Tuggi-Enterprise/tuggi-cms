/**
 * #978: the Passaporte tab printed numbers the RPCs never sent. The speed read `avg_speed`, a
 * column `drive.get_user_trips_with_stats` does not have, so every trip said 0.0 km/h; the
 * favourite category printed the generic import type `point_of_interest`, raw.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { favoriteCategoryLabel, tripAverageSpeedKmh } from '@/lib/format/passport'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

test('speed is distance over moving time, in km/h (numeric arrives as a string)', () => {
  assert.equal(tripAverageSpeedKmh({ distance_traveled_m: '1000.00', moving_seconds: 360 }), 10)
})

test('a trip with no moving time or no distance has no speed, not a zero', () => {
  assert.equal(tripAverageSpeedKmh({ distance_traveled_m: '0.00', moving_seconds: 0 }), null)
  assert.equal(tripAverageSpeedKmh({ distance_traveled_m: null, moving_seconds: 120 }), null)
  assert.equal(tripAverageSpeedKmh({ distance_traveled_m: 500, moving_seconds: null }), null)
})

test('moving with zero distance is a measured zero', () => {
  assert.equal(tripAverageSpeedKmh({ distance_traveled_m: '0.00', moving_seconds: 16 }), 0)
})

test('the trip list no longer reads a column the RPC does not return', () => {
  assert.doesNotMatch(read('components/admin/passport/TripList.tsx'), /avg_speed/)
})

test('favourite category skips the generic buckets and uses the POI screens label', () => {
  const top = [
    { category: 'point_of_interest', count: 4 },
    { category: 'park', count: 4 },
    { category: 'historic', count: 1 },
  ]
  assert.equal(favoriteCategoryLabel(top), 'Parks & Gardens')
})

test('an unknown category is humanised, never printed raw', () => {
  assert.equal(favoriteCategoryLabel([{ category: 'water_park' }]), 'Water park')
})

test('only generic buckets, or none, means no favourite', () => {
  assert.equal(favoriteCategoryLabel([{ category: 'point_of_interest' }, { category: 'Other' }]), null)
  assert.equal(favoriteCategoryLabel([]), null)
  assert.equal(favoriteCategoryLabel(null), null)
})
