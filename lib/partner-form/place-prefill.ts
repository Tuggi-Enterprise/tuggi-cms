/**
 * What the partner's form answers become on the PLACE — the second thing a proposal writes,
 * and the sibling of `promotion.ts`, which owns the first (`core.clients`).
 *
 * TWO WRITE PATHS OUT OF ONE FORM, AND EACH HAS ITS OWN ALLOWLIST. `promotion.ts` decides
 * what reaches `core.clients` and is an operator panel with one act per divergent column;
 * this module decides what reaches `core.attractions` / `core.place_details` and has no panel
 * at all, because there is nothing to overwrite: the place does not exist until the approval
 * creates it. What the two share is the property that matters — a column that is not on the
 * list below is unreachable from an answer typed by somebody outside the Tuggi.
 *
 * THE THREE THINGS CREATING THE PLACE DOES NOT MEAN, and they are rules, not preferences:
 *
 *  · it does NOT approve the place. BR-B2B-011 keeps the three triage gates as a human
 *    decision — `core.cms_create_place` inserts `approved = false`, and `approved` is on the
 *    never-written list here so that no prefill can ever hand that decision to a form;
 *  · it does NOT start the billing. BR-B2B-018, item 1: the monthly fee starts on the
 *    PUBLICATION of the POI with the description on air. Nothing here writes a description,
 *    and `attraction_descriptions` is not reachable from this module;
 *  · it does NOT give prominence. BR-B2B-010, item 6 — same treatment as any POI. Hence
 *    `priority_level`, `is_tuggi_partner` and `app_benefit` on the never-written list.
 *
 * WHAT IS DELIBERATELY LEFT EMPTY, because the honest prefill is the one that does not invent:
 *  · the coordinate. The form asks for no latitude/longitude (`PARTNER_FORM_FIELDS`), so the
 *    place is created without one and `cms_set_attraction_coordinate` is NOT called with a
 *    guess. A place with no coordinate is invisible to `core.app_get_nearby_places`, which is
 *    correct for the curation state, and putting the pin on the map is the curator's act;
 *  · `opening_hours`. The form answers it as free text and `core.attractions.opening_hours` is
 *    `jsonb`. Parsing prose into that structure is invention, and a wrong opening hour is worse
 *    than an empty one;
 *  · the representative's phone and e-mail. They are a PERSON's contact details (BR-B2B-030),
 *    collected to talk to whoever signs the contract — not the establishment's public number.
 *    They belong to `core.clients`, where the promotion already wrote them, and a POI column is
 *    read by the app;
 *  · the story fields (`story_*`). They are the insumo of gate 2 of BR-B2B-011 and of the paid
 *    tier's narration; turning them into a description is exactly what starts BR-B2B-018.
 */

import { PARTNER_CATEGORIES } from './fields'
import { joinAddress } from './promotion'
import type { PartnerAnswers } from './schema'
import { PLACE_TYPES, type PlaceType } from '@/lib/core/place-service'

export type PartnerCategory = (typeof PARTNER_CATEGORIES)[number]

/**
 * The form's category, in the catalogue's vocabulary.
 *
 * `null` means THE FORM DOES NOT ANSWER IT, and the curator picks — which is a better prefill
 * than a guess that reads as a decision somebody made:
 *  · `bar_cafe` is one option in the form and two types in the catalogue (`bar`, `cafe`).
 *    Picking either one is right half the time and looks deliberate every time;
 *  · `attraction` is not a place type — a place that is an attraction is what the curator is
 *    about to describe, not a kind of commerce.
 *
 * `inn` maps to `hotel` on purpose: a pousada is lodging, `inn` is not in the catalogue's
 * vocabulary, and writing a value the CMS select cannot show would leave the field looking
 * empty while holding something.
 */
export const PLACE_TYPE_BY_CATEGORY: Readonly<Record<PartnerCategory, PlaceType | null>> = {
  restaurant: 'restaurant',
  bar_cafe: null,
  hotel: 'hotel',
  inn: 'hotel',
  shop: 'shop',
  attraction: null,
  other: 'other',
}

/**
 * Columns of `core.attractions` this prefill may write, beyond the ones
 * `core.cms_create_place` takes as arguments (`name`, `city`, `state`, `country`).
 *
 * Each one is here because a curator needs it to do the next step and it is read by a screen:
 * the address and the postal code are how the pin gets found (`DetailsTab`, `GroupPoisTab`),
 * and the website is the establishment's own, public by definition.
 */
export const PLACE_PREFILL_COLUMNS = ['formatted_address', 'postal_code', 'website'] as const

export type PlacePrefillColumn = (typeof PLACE_PREFILL_COLUMNS)[number]

/**
 * What creating a place from a proposal never writes, listed so the guarantee is readable.
 *
 * `promotionAllowlistIsClosed`'s twin: the enforcement is the allowlist above, and
 * `placePrefillIsClosed()` is what keeps the two honest about each other. Every entry is a
 * rule, and the ID is in the module header.
 *
 * `partner_client_id` is NOT here — it is written, and it is the point of the card. It is not
 * on the allowlist either: it comes from the approved client's id, never from an answer.
 */
export const PLACE_PREFILL_NEVER_WRITES = [
  'approved',
  'is_active',
  'priority_level',
  'is_tuggi_partner',
  'app_benefit',
  'owner_id',
  'entity_kind',
] as const

/** True when no column the module promises never to write is reachable by the prefill. */
export function placePrefillIsClosed(): boolean {
  const writable = new Set<string>([
    ...PLACE_PREFILL_COLUMNS,
    'name',
    'city',
    'state',
    'country',
    'place_type',
  ])
  return PLACE_PREFILL_NEVER_WRITES.every((column) => !writable.has(column))
}

export interface PlacePrefill {
  /** Exactly the arguments of `core.cms_create_place`. The coordinate is not among them. */
  create: {
    name: string
    city: string
    country: string
    state: string | null
    place_type: PlaceType | null
  }
  /** Columns written on `core.attractions` right after, together with the link. */
  attraction: Partial<Record<PlacePrefillColumn, string>>
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * The place a proposal describes, or `null` when the answers cannot name one.
 *
 * `null` is not a failure: `core.attractions` has `name`, `city` and `country` NOT NULL, and a
 * proposal missing them would create a record with a placeholder in a catalogue of 2.2 million
 * rows. The approval carries on and says nothing was created — the operator creates the place
 * by hand, which is what happened before this existed.
 *
 * `country` is a constant for the same reason it is one in `PROMOTION_MAP`: the form only
 * exists in Brazil (CNPJ, alvará), so it is a fact of the surface and not an answer.
 */
export function buildPlacePrefill(answers: PartnerAnswers): PlacePrefill | null {
  const name = text(answers.trade_name)
  const city = text(answers.city)
  if (!name || !city) return null

  const category = text(answers.category) as PartnerCategory
  const placeType = PLACE_TYPE_BY_CATEGORY[category] ?? null

  const attraction: Partial<Record<PlacePrefillColumn, string>> = {}
  const address = joinAddress(answers)
  if (address) attraction.formatted_address = address
  const postalCode = text(answers.postal_code)
  if (postalCode) attraction.postal_code = postalCode
  const website = text(answers.website)
  if (website) attraction.website = website

  return {
    create: {
      name,
      city,
      country: 'BR',
      state: text(answers.state) || null,
      place_type: placeType && PLACE_TYPES.includes(placeType) ? placeType : null,
    },
    attraction,
  }
}
