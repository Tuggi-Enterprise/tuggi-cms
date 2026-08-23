/**
 * What is missing for a partner's place, grouped by the OUTCOME each absence blocks —
 * DS-COMPONENTE-020.
 *
 * Pure, in the exact mould of `buildRegularityReport`, and for the same reason: the queue's
 * count, the detail's list and the publish confirmation all read THIS, so the three cannot
 * disagree (point 4 of the decision). A count computed in the table and a list computed in the
 * band is the defect that module exists to prevent.
 *
 * WHY THE THREE CLASSES ARE THESE THREE, AND WHERE THE LINE COMES FROM. It is not opinion, and
 * it is not one predicate either — THERE ARE TWO, and which one applies is decided by
 * `core.attractions.entity_kind`:
 *
 *  · `entity_kind = 'poi'` — `core.app_poi_read_build`, since `20260816170000` (#362):
 *      approved AND entity_kind = 'poi' AND is_active
 *      AND COALESCE(attraction_coordinate.show_in_map, true) AND location_geography IS NOT NULL
 *  · `entity_kind = 'place'` — `core.app_get_nearby_places` / `core.app_get_place_details`,
 *    in `supabase/migrations/20260709_02_places_narration_payload.sql`:
 *      entity_kind = 'place' AND approved AND is_active AND location_geography IS NOT NULL
 *
 * AND THE PARTNER'S PLACE IS A `place`. `core.cms_create_place` inserts `entity_kind = 'place'`
 * (`supabase/migrations/20260703_07_places_rpcs.sql`), so the place `provisionPartnerPlace`
 * creates NEVER enters `core.app_poi_read` — it travels the places path. Spec §3 and §4 quote
 * the POI read model at it, and reading `show_in_map` as a blocker for a `place`, or ignoring
 * `is_active`, would each produce a screen that lies. The divergence is reported on #359 and
 * the contract now writes both predicates down (`docs/contracts/cms-para-app.md`, §3.3).
 *
 * WHAT NEITHER PREDICATE CONTAINS is a trigger point or an audio. They are not conditions to
 * BE SEEN; they are conditions for the place to DO anything once it is. That is the whole
 * measured defect of #356: of the 6 clients with a `welcome_poi_id`, 3 have zero trigger
 * points — published, intact, and mute. A flat "3 pendências" list hides exactly that. And the
 * trigger point does reach a `place`: `core.get_guide_trigger_points` deliberately does not
 * filter `entity_kind` (#362, note 2.7).
 *
 * `location_geography` IS GENERATED FROM lat/lng (declared in
 * `supabase/migrations/20260706_06_backfill_event_coordinates.sql`), which is why this module
 * reads the pair and not the geography: the two are the same fact, and the pair is the one a
 * screen can show.
 */

/** The six absences this screen knows how to name. Ids are English (CLAUDE.md §6). */
export type PendencyId =
  | 'coordinate'
  | 'inactive'
  | 'hidden_from_map'
  | 'trigger_point'
  | 'audio_description'
  | 'boundary'

/**
 * The outcome each class blocks. Naming them by consequence and not by severity is the point:
 * `silences_app` is not "a warning", it is a different broken thing.
 */
export type PendencyClass = 'blocks_app' | 'silences_app' | 'improves'

export const PENDENCY_CLASS: Record<PendencyId, PendencyClass> = {
  coordinate: 'blocks_app',
  inactive: 'blocks_app',
  hidden_from_map: 'blocks_app',
  trigger_point: 'silences_app',
  audio_description: 'silences_app',
  boundary: 'improves',
}

/** The order the classes are shown in, everywhere. Worst outcome first. */
export const PENDENCY_CLASSES: PendencyClass[] = ['blocks_app', 'silences_app', 'improves']

/**
 * The facts one place carries, as the database has them. Everything here is read; nothing is
 * derived — the derivation is the function below, and keeping the two apart is what makes the
 * module testable without a database.
 */
export interface PartnerPlaceFacts {
  attractionId: string
  name: string
  city: string | null
  region: string | null
  /**
   * `core.attractions.entity_kind`, and it decides WHICH visibility predicate applies. A place
   * created by the partner approval is `'place'`; a POI the team catalogued by hand is
   * `'poi'`, and `show_in_map` only ever means anything for that one.
   */
  entityKind: string
  approved: boolean
  /** BR-POI-005: an inactive registration is out of the app, both kinds, since #362. */
  isActive: boolean
  latitude: number | null
  longitude: number | null
  /** `COALESCE(show_in_map, true)` already applied — an absent coordinate row reads `true`. */
  showInMap: boolean
  /** `core.attraction_trigger_points` with `is_active = true`. Inactive ones fire nothing. */
  activeTriggerPointCount: number
  /** `core.attraction_descriptions` with `audio_url IS NOT NULL` — `has_audio` of the read model. */
  audioDescriptionCount: number
  hasBoundary: boolean
}

export interface PlaceReadiness {
  place: PartnerPlaceFacts
  /** Every absence, in class order. */
  pending: PendencyId[]
  blocking: PendencyId[]
  silencing: PendencyId[]
  improving: PendencyId[]
  /** No absence at all — the one line that replaces an empty block. */
  ready: boolean
  /**
   * Whether the place is in front of tourists RIGHT NOW, by the predicate of its own
   * `entity_kind`. Mirrored, not queried: for a `poi`, `core.app_poi_read` is materialised by
   * a drain queue, so asking the table would make the screen say "not published yet" for as
   * long as the queue takes; for a `place` there is no table to ask at all, because
   * `core.app_get_nearby_places` reads `core.attractions` live.
   */
  published: boolean
  /**
   * Whether there is a description on air — the ONLY evidence in the database that the paid
   * tier's description exists, and therefore what decides whether publishing starts money
   * (BR-B2B-018, item 1). Nothing distinguishes a partner's description from curation
   * narration: `core.place_details.is_tuggi_partner` and `app_benefit` were measured null in
   * 210 of 210 rows (#358). This is a heuristic and the screen says so — spec §9, question 2,
   * open with `produto` and `data`.
   */
  hasDescriptionOnAir: boolean
}

export function buildPlaceReadiness(place: PartnerPlaceFacts): PlaceReadiness {
  const pending: PendencyId[] = []

  const hasCoordinate = place.latitude !== null && place.longitude !== null
  // `show_in_map` is only in the POI predicate. Reading it as a blocker for a `place` would
  // tell the operator to fix something that decides nothing for that kind.
  const mapVisible = place.entityKind === 'poi' ? place.showInMap : true

  if (!hasCoordinate) pending.push('coordinate')
  if (!place.isActive) pending.push('inactive')
  // Only worth saying when there IS a coordinate: without one, `show_in_map` decides nothing
  // and two lines would name the same missing outcome twice.
  if (hasCoordinate && !mapVisible) pending.push('hidden_from_map')
  if (place.activeTriggerPointCount === 0) pending.push('trigger_point')
  if (place.audioDescriptionCount === 0) pending.push('audio_description')
  if (!place.hasBoundary) pending.push('boundary')

  const inClass = (klass: PendencyClass) => pending.filter((id) => PENDENCY_CLASS[id] === klass)

  return {
    place,
    pending,
    blocking: inClass('blocks_app'),
    silencing: inClass('silences_app'),
    improving: inClass('improves'),
    ready: pending.length === 0,
    published: place.approved && place.isActive && mapVisible && hasCoordinate,
    hasDescriptionOnAir: place.audioDescriptionCount > 0,
  }
}

/**
 * The state of the LEAST advanced place, and the proportion — DS-COMPONENTE-020, 2nd edge case.
 *
 * A client has 1 : N places (BR-B2B-033, item 3), and summing the pendencies of three places
 * into one number hides WHICH of them is stuck. The queue shows the proportion and the worst
 * one; the detail shows each place with its own block.
 */
export interface PlacesSummary {
  total: number
  published: number
  /** The pendency counts OF THE LEAST ADVANCED PLACE, never the sum across places. */
  blocking: number
  silencing: number
  improving: number
  /** Every place published and with nothing pending. */
  allReady: boolean
}

export function summarizePlaces(readiness: PlaceReadiness[]): PlacesSummary {
  const published = readiness.filter((item) => item.published).length
  const worst = leastAdvanced(readiness)

  return {
    total: readiness.length,
    published,
    blocking: worst ? worst.blocking.length : 0,
    silencing: worst ? worst.silencing.length : 0,
    improving: worst ? worst.improving.length : 0,
    allReady: readiness.length > 0 && readiness.every((item) => item.published && item.ready),
  }
}

/**
 * The one place that holds the parceria back. Unpublished before published; among equals, the
 * one with the most blocking pendencies, then the most silencing ones.
 */
export function leastAdvanced(readiness: PlaceReadiness[]): PlaceReadiness | null {
  if (readiness.length === 0) return null

  const ranked = readiness.slice().sort((a, b) => {
    if (a.published !== b.published) return a.published ? 1 : -1
    if (a.blocking.length !== b.blocking.length) return b.blocking.length - a.blocking.length
    return b.silencing.length - a.silencing.length
  })

  return ranked[0]
}
