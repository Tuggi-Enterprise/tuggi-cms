/**
 * LINKING A PLACE THAT ALREADY EXISTS — the path that should have been the default, and the
 * absence that produced three duplicates out of three.
 *
 * WHAT WAS MEASURED, on 2026-08-23, on the three clients that went through `Criar o local a
 * partir da proposta`: every one of them already had its establishment in the catalogue,
 * approved and with a pin, and the button created a SECOND row beside it — no coordinate, no
 * trigger point, unable to publish. `partner.clients.welcome_poi_id` pointed at the real one and
 * `core.attractions.partner_client_id` at the empty one, so the pipeline read the empty one and
 * reported pendencies about a place nobody was ever going to fix.
 *
 *   BAIRES BISTRO       welcome → `Baires Bistrô`      (aprovado, com pin)
 *                       link    → `BAIRES BISTRO`      (sem pin, 0 TP, nunca publicou)
 *   Tucas               welcome → `Tucas Empório Bistrô` (aprovado, com pin, 1 TP)
 *                       link    → `Tucas`              (sem pin, 0 TP)
 *   CAFETERIA ENCONTROS welcome → `Cafeteria Encontros` (aprovado, com pin)
 *                       link    → `CAFETERIA ENCONTROS` (sem pin, 0 TP)
 *
 * So creating is the EXCEPTION — for an establishment the catalogue does not carry yet — and
 * linking is the ordinary case. This module is the gate on the linking.
 *
 * THE THREE REFUSALS ARE EACH A MEASURED DEFECT, not a preference:
 *  · `event` — one client's welcome POI is a FESTIVAL, and `core.app_get_nearby_places` does not
 *    carry events at all. It was linked, it never served anybody, and nothing said so;
 *  · no coordinate — `buildPlaceReadiness` classes it `blocks_app`, so linking one is choosing
 *    the same dead end the create path already falls into;
 *  · another client's place — BR-B2B-033, item 3, is 1 client : N places, NOT N clients : 1
 *    place. Two partners pointing at one POI is two revenue shares on one address.
 *
 * Pure: no fetch, no Supabase, no React. Proven by `tests/api/partner-place-link.test.ts`.
 */

/** What the catalogue says about one candidate. Exactly the columns the search reads. */
export interface LinkCandidate {
  attractionId: string
  name: string
  city: string | null
  state: string | null
  country: string | null
  entityKind: string
  approved: boolean
  hasCoordinate: boolean
  /** `core.attractions.partner_client_id` — null when nobody owns it. */
  partnerClientId: string | null
}

export type LinkRefusal =
  /** Not a `place` and not a `poi` — an `event` is the measured case. */
  | 'wrong_kind'
  /** No row in `core.attraction_coordinate`: invisible to the app, and blocking. */
  | 'no_coordinate'
  /** Already the place of a DIFFERENT client. */
  | 'other_owner'

export type LinkVerdict =
  | { kind: 'ok' }
  /** Already this client's place. Not an error — the act simply has nothing to do. */
  | { kind: 'already_linked' }
  | { kind: 'refused'; reason: LinkRefusal }

/**
 * The kinds the app can actually serve as a partner's place.
 *
 * `poi` is in on purpose, and it is the common case: a restaurant catalogued years before it
 * became a partner is a `poi`, and refusing it would send the operator back to creating the
 * duplicate this module exists to stop. What decides is whether the app serves it, and both
 * kinds are served — `core.app_get_nearby_places` for `place`, `core.app_poi_read` for `poi`.
 */
export const LINKABLE_KINDS = ['place', 'poi']

export function verdictFor(candidate: LinkCandidate, clientId: string): LinkVerdict {
  // Ownership first: a place already linked to THIS client is a no-op whatever else is true of
  // it, and reporting `no_coordinate` for a row the operator linked last week would read as a
  // refusal of something that already happened.
  if (candidate.partnerClientId === clientId) return { kind: 'already_linked' }
  if (candidate.partnerClientId !== null) return { kind: 'refused', reason: 'other_owner' }

  if (LINKABLE_KINDS.indexOf(candidate.entityKind) < 0) {
    return { kind: 'refused', reason: 'wrong_kind' }
  }
  if (!candidate.hasCoordinate) return { kind: 'refused', reason: 'no_coordinate' }

  return { kind: 'ok' }
}

export function canLink(candidate: LinkCandidate, clientId: string): boolean {
  return verdictFor(candidate, clientId).kind === 'ok'
}

/**
 * The shortest search that is worth running.
 *
 * `core.attractions` holds 2.2 million rows and the search is `name ILIKE '%q%'`, answered by
 * `idx_attractions_name_trgm` (GIN trigram). Measured at 128 ms / 704 buffers for a 9-character
 * term; a one or two-character term degenerates the trigram index into a scan, which is the
 * shape that produced the 57014 timeouts on `cms_search_pois`.
 */
export const MIN_SEARCH_LENGTH = 3

export function isSearchable(term: string): boolean {
  return term.trim().length >= MIN_SEARCH_LENGTH
}

/**
 * THE SEARCH IS BLIND TO ACCENT, TO CASE AND TO PUNCTUATION, and each of the three is a measured
 * way the operator failed to find an establishment that was sitting in the catalogue.
 *
 * WHAT `ILIKE` COULD NOT DO. Measured on 2026-08-23 against `Faella Bistrô` (Cabo Frio,
 * `dc93ef2f…`):
 *
 *   length(name)                  = 14    ← stored NFD: `o` plus combining circumflex (U+0302)
 *   name ilike '%Faella Bistrô%'  = false ← the typed term is NFC, 13 characters
 *   name ilike '%Faella Bistro%'  = false ← for the same row written NFC it fails too
 *
 * Case `ILIKE` already handled. The other two it cannot: the catalogue carries names in both
 * Unicode normalisations — importer, paste and keyboard produce different ones — and somebody
 * typing `Faella Bistro` on a hurried keyboard is looking for `Faella Bistrô` and knows it. A
 * search that answers "nothing found" to a name that IS there sends the operator to
 * `Criar um local novo`, which is the duplicate this whole module exists to stop.
 *
 * SO THE TERM BECOMES A REGULAR EXPRESSION (`~*`, PostgREST `imatch`), built letter by letter:
 *
 *  · a letter that has accented forms becomes the class of ALL of them, followed by an optional
 *    combining mark — `o` becomes `[oóòôõöøº][̀-ͯ]?`, which matches `o`, `ó`, and the
 *    decomposed `o`+U+0302 alike, in either direction: typing the accent finds the row without
 *    it, and typing without finds the row with it;
 *  · a letter or digit with no variants stays itself;
 *  · a RUN of anything else — space, hyphen, apostrophe, ampersand, comma, double space —
 *    becomes `.?.?.?`. That is not laziness about escaping, it is the third failure:
 *    `Bar do Zé`, `Bar do Ze'`, `Bar-do-Ze` and `Bar  do Ze` are one establishment written by
 *    four people. The bound is three characters and not `*` on purpose: `.*` would let `Bar Zé`
 *    match `Barbearia do Zé`, and a candidate list that answers with the wrong establishment is
 *    worse than one that answers with none. It is spelled `.?.?.?` and not `.{0,3}` for one
 *    reason: a comma is PostgREST's filter separator, and the only way to be sure the grammar
 *    never sees one is not to emit one. The pattern carries no comma, no parenthesis, no
 *    backslash — nothing to escape, for the regex engine or for the filter.
 *
 * Case is `~*`'s job and is not encoded here.
 *
 * THE INDEX IS NOT WHAT MAKES THIS FAST, and it is worth saying so: under RLS the trigram index
 * is unreachable for `ILIKE` and for `~*` alike (`texticlike` and `textregexeq` are not
 * leakproof, and a non-leakproof qual cannot be evaluated below the security quals). What keeps
 * the search at 10 ms is `idx_attractions_geo_search (country, state, city)` reducing the table
 * to the client's city first — see `place-scope`. The name predicate then runs over dozens of
 * rows, where the difference between a regex and an `ILIKE` is noise.
 */
const LETTER_VARIANTS: Record<string, string> = {
  a: 'aáàâãäåāª',
  c: 'cç',
  e: 'eéèêëē',
  i: 'iíìîïī',
  n: 'nñ',
  o: 'oóòôõöøōº',
  u: 'uúùûüū',
  y: 'yýÿ',
}

/** The combining diacritics block, for names stored decomposed (NFD). */
const COMBINING_MARKS = '[̀-ͯ]?'

export function namePattern(term: string): string {
  // NFD first, then the marks dropped: `ô` typed by the operator and `o`+U+0302 pasted from the
  // catalogue both reduce to the same `o`, and the pattern below puts the accent back as an
  // option instead of a requirement.
  const skeleton = term.trim().normalize('NFD').replace(/[̀-ͯ]/g, '')

  let pattern = ''
  let separatorOpen = false
  for (const character of skeleton) {
    const lower = character.toLowerCase()
    const variants = LETTER_VARIANTS[lower]

    if (!variants && !/[a-z0-9]/.test(lower)) {
      // A run of separators is ONE hole, not one per character: `Faella  Bistro` and
      // `Faella Bistro` are the same name typed twice.
      if (!separatorOpen) {
        pattern += '.?.?.?'
        separatorOpen = true
      }
      continue
    }

    separatorOpen = false
    pattern += variants ? `[${variants}]${COMBINING_MARKS}` : lower
  }
  return pattern
}
