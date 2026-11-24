/**
 * How the Passaporte tab turns two RPC answers into the words on its cards (#978). Pure, so the
 * decisions are tested without a database.
 */

import { POI_CATEGORIES } from '@/constants/poi-importer'

/**
 * The trip row fields the speed is derived from, as `drive.get_user_trips_with_stats` returns
 * them. The RPC has no speed column, and the list read one that never came back.
 */
export interface TripSpeedSource {
  distance_traveled_m: number | string | null
  moving_seconds: number | null
}

/**
 * Average speed while moving, in km/h, or `null` when the trip has no movement to divide by.
 *
 * Moving time, not wall time: the RPC already splits the trip into buckets, and a stop at a
 * light is not travel. `null` is "no measurement", printed as the em dash; it is never a zero,
 * because a zero claims the tourist stood still.
 */
export function tripAverageSpeedKmh(trip: TripSpeedSource): number | null {
  const meters = trip.distance_traveled_m == null ? null : Number(trip.distance_traveled_m)
  const seconds = trip.moving_seconds
  if (meters == null || !Number.isFinite(meters) || seconds == null || seconds <= 0) return null
  return (meters / seconds) * 3.6
}

/**
 * Buckets the database groups by that say nothing about taste: the generic place type of the
 * import and the RPC's own fallback for a POI with no category.
 */
const NON_CATEGORIES = new Set(['point_of_interest', 'establishment', 'Other'])

/**
 * The favourite category as a label, or `null` when every bucket is a non-category.
 *
 * `get_user_passport_stats` returns the top five already ordered; the first one that names a
 * kind of place wins. The label is the one the POI screens already use (`POI_CATEGORIES`), and
 * an unknown value is humanised the way the POI modal does it, never printed raw.
 */
export function favoriteCategoryLabel(top: Array<{ category: string }> | null | undefined): string | null {
  const first = (top ?? []).find((row) => row.category && !NON_CATEGORIES.has(row.category))
  if (!first) return null
  const known = POI_CATEGORIES.find((c) => c.value === first.category)
  if (known) return known.label
  const text = first.category.replace(/_/g, ' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}
