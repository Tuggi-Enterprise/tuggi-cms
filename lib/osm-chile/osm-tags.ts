/**
 * #1203: reading OSM tags for the Santiago load.
 *
 * classifyPlaceOrAttraction answers "is this cadastro a lugar (lodging or commerce) or an
 * attraction?". Decision of the operator, 2026-11-11: lugar = lodging and commerce. An attraction
 * (museum, church, viewpoint, monument, park, a historic market like the Mercado Central) stays a
 * `poi` even when it has a shop or a restaurant inside. A doubtful case is not converted; it is
 * listed for the curator.
 *
 * isAttractionCandidate answers "is this OSM element an attraction worth a cadastro?" for the
 * missing-POI search.
 *
 * Changing entity_kind only changes the door the tourist finds the cadastro through (BR-POI-006
 * item 6); trigger points, boundary and audio are not touched by any of this (items 3 and 5).
 */
import { SPECIFIC_TO_GROUP } from '../shared/poi-taxonomy'

export type OsmTags = Record<string, string>

const LODGING_TOURISM = new Set(['hotel', 'hostel', 'guest_house', 'apartment', 'motel'])
const COMMERCE_AMENITY = new Set(['restaurant', 'bar', 'cafe', 'pub', 'fast_food'])

/** The element IS the attraction; a shop or a café tagged on it is something inside it. */
const ATTRACTION_TOURISM = new Set(['attraction', 'museum', 'viewpoint', 'artwork', 'gallery', 'zoo', 'aquarium', 'theme_park'])
const ATTRACTION_AMENITY = new Set(['place_of_worship', 'theatre', 'arts_centre', 'marketplace', 'monastery'])
const ATTRACTION_LEISURE = new Set(['park', 'garden', 'nature_reserve'])
const ATTRACTION_BUILDING = new Set(['church', 'cathedral', 'chapel', 'basilica'])

/**
 * Category values on the cadastro that say lugar. The taxonomy has no commerce group (commerce is
 * not a POI category there), so the Google and OSM raw values that reach the category column are
 * listed here; lodging reuses the taxonomy's own `lodging` group minus the mountain refuges.
 */
const PLACE_CATEGORY_HINTS = new Set([
  'hotel', 'hostel', 'guest_house', 'apartment', 'motel', 'lodging', 'accommodation',
  'restaurant', 'bar', 'cafe', 'pub', 'fast_food', 'food', 'meal_takeaway', 'bakery',
  'shop', 'store', 'mall', 'shopping', 'shopping_mall', 'supermarket', 'clothing_store',
])
const NON_ATTRACTION_GROUPS = new Set(['lodging', 'place'])

export type PlaceKind = 'lodging' | 'commerce'
export type PlaceDecision = 'place' | 'poi' | 'doubtful'

export interface PlaceVerdict {
  decision: PlaceDecision
  kind: PlaceKind | null
  /** The tag that decided, as `key=value`, for the dry-run line. */
  tag: string | null
  reason: string
}

function present(v: string | undefined): v is string {
  return !!v && v !== 'no'
}

function placeTag(t: OsmTags): { kind: PlaceKind; tag: string } | null {
  if (present(t.tourism) && LODGING_TOURISM.has(t.tourism)) return { kind: 'lodging', tag: `tourism=${t.tourism}` }
  if (present(t.amenity) && COMMERCE_AMENITY.has(t.amenity)) return { kind: 'commerce', tag: `amenity=${t.amenity}` }
  if (present(t.shop)) return { kind: 'commerce', tag: `shop=${t.shop}` }
  return null
}

function strongAttractionTag(t: OsmTags): string | null {
  if (present(t.tourism) && ATTRACTION_TOURISM.has(t.tourism)) return `tourism=${t.tourism}`
  if (present(t.amenity) && ATTRACTION_AMENITY.has(t.amenity)) return `amenity=${t.amenity}`
  if (present(t.leisure) && ATTRACTION_LEISURE.has(t.leisure)) return `leisure=${t.leisure}`
  if (present(t.building) && ATTRACTION_BUILDING.has(t.building)) return `building=${t.building}`
  if (present(t.natural)) return `natural=${t.natural}`
  return null
}

/** historic/heritage on a hotel or a shop: the building may be the attraction, the business may not. */
function weakAttractionTag(t: OsmTags): string | null {
  if (present(t.historic)) return `historic=${t.historic}`
  if (present(t.heritage)) return `heritage=${t.heritage}`
  return null
}

export function categoryHint(categories: Array<string | null | undefined>): 'place' | 'attraction' | null {
  let place = false
  for (const raw of categories) {
    const c = (raw ?? '').trim().toLowerCase()
    if (!c) continue
    const group = SPECIFIC_TO_GROUP[c]
    if (group && !NON_ATTRACTION_GROUPS.has(group)) return 'attraction'
    if (PLACE_CATEGORY_HINTS.has(c)) place = true
  }
  return place ? 'place' : null
}

/** Keys that say what an element is. A cadastro whose own tags carry none of them needs a match. */
export function hasDecisiveTag(t: OsmTags | null | undefined): boolean {
  if (!t) return false
  return !!(placeTag(t) || strongAttractionTag(t) || weakAttractionTag(t) || present(t.tourism) || present(t.amenity) || present(t.leisure))
}

/**
 * @param tags  OSM tags of the element matched to the cadastro (its own, or the nearest OSM
 *              element with a similar name), or null when nothing matched.
 * @param categories  category and primary_category of the cadastro: the second signal.
 */
export function classifyPlaceOrAttraction(tags: OsmTags | null, categories: Array<string | null | undefined>): PlaceVerdict {
  const hint = categoryHint(categories)
  if (!tags) {
    return hint === 'place'
      ? { decision: 'doubtful', kind: null, tag: null, reason: 'category says lugar, no OSM tag to confirm' }
      : { decision: 'poi', kind: null, tag: null, reason: 'no OSM tag, category is not lugar' }
  }
  const place = placeTag(tags)
  const strong = strongAttractionTag(tags)
  if (strong) {
    return { decision: 'poi', kind: place?.kind ?? null, tag: strong, reason: place ? `attraction with ${place.tag} inside` : 'attraction' }
  }
  if (!place) return { decision: 'poi', kind: null, tag: null, reason: 'no lodging or commerce tag' }
  const weak = weakAttractionTag(tags)
  if (weak) return { decision: 'doubtful', kind: place.kind, tag: `${place.tag};${weak}`, reason: 'lodging or commerce in a historic building' }
  if (hint === 'attraction') {
    return { decision: 'doubtful', kind: place.kind, tag: place.tag, reason: 'OSM tag says lugar, category says attraction' }
  }
  return { decision: 'place', kind: place.kind, tag: place.tag, reason: place.kind }
}

/** Merge the cadastro's raw osm_tags with the flattened OSM columns it also carries. */
export function catalogueTags(row: {
  osm_tags?: unknown
  amenity?: string | null
  shop?: string | null
  leisure?: string | null
  building?: string | null
}): OsmTags | null {
  const out: OsmTags = {}
  if (row.osm_tags && typeof row.osm_tags === 'object' && !Array.isArray(row.osm_tags)) {
    for (const [k, v] of Object.entries(row.osm_tags as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v
    }
  }
  const flat: Array<[string, string | null | undefined]> = [
    ['amenity', row.amenity], ['shop', row.shop], ['leisure', row.leisure], ['building', row.building],
  ]
  for (const [k, v] of flat) if (v && !out[k]) out[k] = v
  return hasDecisiveTag(out) ? out : null
}

// ─── Missing-POI search ─────────────────────────────────────────────────────────────────────

const CANDIDATE_TOURISM = new Set(['attraction', 'museum', 'viewpoint', 'artwork', 'gallery'])
const CANDIDATE_NATURAL = new Set(['peak', 'waterfall'])

/**
 * A park counts when it is large. OSM `out bb` gives the bounding box, not the area, so the
 * threshold is on the box: 10 ha of box is roughly 5 ha of park for a compact shape.
 */
export const PARK_MIN_BBOX_AREA_M2 = 100_000

export function hasReference(t: OsmTags): boolean {
  return present(t.wikidata) || present(t.wikipedia)
}

export function isAttractionCandidate(t: OsmTags, bboxAreaM2: number | null): boolean {
  if (!present(t.name)) return false
  if (present(t.tourism) && CANDIDATE_TOURISM.has(t.tourism)) return true
  if (present(t.historic)) return true
  if (present(t.natural) && CANDIDATE_NATURAL.has(t.natural)) return true
  if (t.leisure === 'park') return hasReference(t) || (bboxAreaM2 ?? 0) >= PARK_MIN_BBOX_AREA_M2
  return false
}
