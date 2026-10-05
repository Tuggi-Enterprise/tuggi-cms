/**
 * What the partner's form answers become on the PLACE — the second thing a proposal writes,
 * and the sibling of `promotion.ts`, which owns the first (`partner.clients`).
 *
 * TWO WRITE PATHS OUT OF ONE FORM, AND EACH HAS ITS OWN ALLOWLIST. `promotion.ts` decides
 * what reaches `partner.clients` and is an operator panel with one act per divergent column;
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
 *    `priority_level` and `is_tuggi_partner` on the never-written list.
 *
 * THE OFFERS ARE THE ONE EXCEPTION, and it is a rule too. BR-B2B-053 (item 10 revokes
 * BR-B2B-010, item 6, for the portal, within the offer to the tourist): `offer_free` →
 * `place_details.app_benefit`, `offer_subscriber` → `place_details.subscriber_benefit`, and only
 * when `offer_enabled` is `true` — a text the partner switched off is not an offer. The old form
 * has no offer keys, so its proposals still never write either column.
 *
 * WHAT IS DELIBERATELY LEFT EMPTY, because the honest prefill is the one that does not invent:
 *  · the coordinate, FROM THE OLD FORM. It asks for no latitude/longitude, so the place is
 *    created without one. The PORTAL sends `lat`/`lng` (contract §8.1), and the operator checks
 *    pin × address × façade before approving (#812): that pin is the coordinate, written by
 *    `cms_set_attraction_coordinate`. Out of range or not a number → no coordinate;
 *  · `opening_hours` as free text. The old form answers prose and the column is `jsonb`; parsing
 *    prose is invention. The portal sends the `core.is_poi_open_now` JSON, which is written only
 *    when it parses into that shape;
 *  · the representative's phone and e-mail. They are a PERSON's contact details (BR-B2B-030),
 *    collected to talk to whoever signs the contract — not the establishment's public number.
 *    They belong to `partner.clients`, where the promotion already wrote them, and a POI column is
 *    read by the app;
 *  · the story fields (`story_*`). They are the insumo of gate 2 of BR-B2B-011 and of the paid
 *    tier's narration; turning them into a description is exactly what starts BR-B2B-018.
 */

import { PARTNER_CATEGORIES } from './fields'
import { normalizeLocation } from '@/lib/shared/location-normalize'
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
  // A gym or studio is a service; the catalogue has no narrower type (`PLACE_TYPES`).
  fitness_center: 'service',
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
export const PLACE_PREFILL_COLUMNS = [
  'formatted_address',
  'postal_code',
  'website',
  // Portal only (contract §8.1 / §8.2). The OSM-shaped text columns take `yes`.
  'street_name',
  'house_number',
  'neighborhood',
  'opening_hours',
  'contact_whatsapp',
  'payment_credit_cards',
  'pet_friendly',
  'wheelchair_accessible',
  'air_conditioning',
] as const

export type PlacePrefillColumn = (typeof PLACE_PREFILL_COLUMNS)[number]

/** Columns of `core.place_details` this prefill may write. The offers are BR-B2B-053. */
export const PLACE_PREFILL_DETAIL_COLUMNS = [
  'app_benefit',
  'subscriber_benefit',
  'price_range',
  'has_wifi',
  'has_outdoor_seating',
  'accepts_reservations',
  'has_delivery',
  'tags',
] as const

export type PlacePrefillDetailColumn = (typeof PLACE_PREFILL_DETAIL_COLUMNS)[number]

export type PrefillValue = string | number | boolean | string[] | Record<string, unknown>

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
  'owner_id',
  'entity_kind',
] as const

/** True when no column the module promises never to write is reachable by the prefill. */
export function placePrefillIsClosed(): boolean {
  const writable = new Set<string>([
    ...PLACE_PREFILL_COLUMNS,
    ...PLACE_PREFILL_DETAIL_COLUMNS,
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
  attraction: Partial<Record<PlacePrefillColumn, PrefillValue>>
  /** Columns written on `core.place_details` (the row `cms_create_place` already inserted). */
  details: Partial<Record<PlacePrefillDetailColumn, PrefillValue>>
  /** The portal's pin, for `cms_set_attraction_coordinate`. `null` from the old form. */
  coordinate: { latitude: number; longitude: number } | null
}

/** Amenity id (contract §8.2) → where it lands. */
const AMENITY_TARGETS: Readonly<
  Record<string, { attraction: PlacePrefillColumn; value: PrefillValue } | { details: PlacePrefillDetailColumn } | { tag: string }>
> = {
  card_and_pix: { attraction: 'payment_credit_cards', value: 'yes' },
  pet_friendly: { attraction: 'pet_friendly', value: 'yes' },
  air_conditioning: { attraction: 'air_conditioning', value: 'yes' },
  wheelchair_accessible: { attraction: 'wheelchair_accessible', value: true },
  wifi: { details: 'has_wifi' },
  outdoor_seating: { details: 'has_outdoor_seating' },
  accepts_reservations: { details: 'accepts_reservations' },
  delivery: { details: 'has_delivery' },
  parking: { tag: 'parking' },
  live_music: { tag: 'live_music' },
  kids_area: { tag: 'kids_area' },
  sea_view: { tag: 'sea_view' },
}

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

/** A JSON array of strings, or `[]`. The portal serialises lists into one string (§8.1). */
function stringList(value: unknown): string[] {
  try {
    const parsed: unknown = JSON.parse(text(value))
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

/** The `core.is_poi_open_now` shape, or `null` — free text from the old form lands here. */
export function parseOpeningHours(value: unknown): Record<string, { open: string; close: string }[]> | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text(value))
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const entries = Object.entries(parsed as Record<string, unknown>)
  if (entries.length === 0) return null
  for (const [day, ranges] of entries) {
    if (!WEEKDAYS.includes(day) || !Array.isArray(ranges) || ranges.length === 0) return null
    for (const range of ranges) {
      const r = range as { open?: unknown; close?: unknown }
      if (typeof r?.open !== 'string' || typeof r?.close !== 'string') return null
      if (!HHMM.test(r.open) || !HHMM.test(r.close)) return null
    }
  }
  return parsed as Record<string, { open: string; close: string }[]>
}

function coordinateOf(answers: PartnerAnswers): PlacePrefill['coordinate'] {
  const lat = text(answers.lat)
  const lng = text(answers.lng)
  if (!lat || !lng) return null
  const latitude = Number(lat)
  const longitude = Number(lng)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null
  return { latitude, longitude }
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
 * `country` não é uma resposta: o formulário só existe no Brasil (CNPJ, alvará), então ele é um
 * fato da superfície — mas entra no PADRÃO DO CATÁLOGO (`Brazil`), não como a sigla.
 */
export function buildPlacePrefill(answers: PartnerAnswers): PlacePrefill | null {
  const name = text(answers.trade_name)
  const city = text(answers.city)
  if (!name || !city) return null

  const category = text(answers.category) as PartnerCategory
  const placeType = PLACE_TYPE_BY_CATEGORY[category] ?? null

  const attraction: PlacePrefill['attraction'] = {}
  const address = joinAddress(answers)
  if (address) attraction.formatted_address = address
  const postalCode = text(answers.postal_code)
  if (postalCode) attraction.postal_code = postalCode
  const website = text(answers.website)
  if (website) attraction.website = website

  // ── Portal keys (contract §8.1 / §8.2). The old form carries none of them. ──
  const street = text(answers.address)
  const number = text(answers.address_number)
  if (number) {
    // Only with the number: the old form's `address` is "street, number" in one answer, and
    // writing it to `street_name` would put a number in a street name.
    attraction.house_number = number
    if (street) attraction.street_name = street
  }
  const district = text(answers.district)
  if (district && number) attraction.neighborhood = district
  const hours = parseOpeningHours(answers.opening_hours)
  if (hours) attraction.opening_hours = hours
  const whatsapp = text(answers.whatsapp).replace(/\D/g, '')
  if (whatsapp.length >= 10 && whatsapp.length <= 15) attraction.contact_whatsapp = whatsapp

  const details: PlacePrefill['details'] = {}
  if (text(answers.offer_enabled) === 'true') {
    const offerFree = text(answers.offer_free)
    if (offerFree) details.app_benefit = offerFree
    const offerSubscriber = text(answers.offer_subscriber)
    if (offerSubscriber) details.subscriber_benefit = offerSubscriber
  }
  const price = Number(text(answers.price_range))
  if (Number.isInteger(price) && price >= 1 && price <= 4) details.price_range = price

  // `subtypes` has no column of its own (contract §8.1 names none): they go to `tags`, with the
  // amenities that are tags too.
  const tags = new Set<string>(stringList(answers.subtypes))
  for (const amenity of stringList(answers.amenities)) {
    const target = AMENITY_TARGETS[amenity]
    if (!target) continue
    if ('attraction' in target) attraction[target.attraction] = target.value
    else if ('details' in target) details[target.details] = true
    else tags.add(target.tag)
  }
  if (tags.size > 0) details.tags = [...tags]

  // O MESMO PADRÃO DO CATÁLOGO, e não o que o formulário escreveu. `core.attractions` guarda o
  // canônico de `lib/shared/location-normalize` — `Brazil`, `Rio de Janeiro` —, por onde passam a
  // ingestão do OSM, a importação do Google Places e a edição manual do POI. Gravar `BR` e `RJ`
  // aqui punha o local do parceiro num dialeto que os filtros do catálogo não alcançam: um POI
  // com `country = 'BR'` é invisível para toda faceta de país, e o registro parece existir só
  // até alguém procurá-lo por onde ele fica.
  const canonical = normalizeLocation('BR', text(answers.state))

  return {
    create: {
      name,
      city,
      country: canonical.country ?? 'Brazil',
      state: canonical.state ?? (text(answers.state) || null),
      place_type: placeType && PLACE_TYPES.includes(placeType) ? placeType : null,
    },
    attraction,
    details,
    coordinate: coordinateOf(answers),
  }
}
