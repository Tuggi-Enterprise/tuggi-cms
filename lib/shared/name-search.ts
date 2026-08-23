/**
 * SEARCHING BY NAME, THE ONE WAY THE WHOLE CMS DOES IT.
 *
 * Every screen that lets an operator type a name — POIs, places, events, routes, clients, CMS
 * users — asks the same question, and until 2026-08-23 each one asked it with `ILIKE '%term%'`,
 * which compares bytes. Bytes are not what the operator typed.
 *
 * THE THREE WAYS THAT FAILED, all measured, all on real rows:
 *
 *  · ACCENT. `Faella Bistrô` is stored decomposed — `o` plus a combining circumflex, 14
 *    characters — so `name ILIKE '%Faella Bistrô%'` with the typed NFC term is FALSE, and so is
 *    `%Faella Bistro%`. The operator searched for an establishment that was in the catalogue,
 *    found nothing, and the only button left was `Criar um local novo`. That is where three of
 *    three partner duplicates came from.
 *  · CASE. `ILIKE` already handled this one, and `LIKE` did not — both spellings existed.
 *  · PUNCTUATION. `Bar do Zé`, `Bar do Ze\'`, `Bar-do-Ze` and `Bar  do Ze` are one
 *    establishment written by four people.
 *
 * THE ANSWER IS A REGULAR EXPRESSION built from the term — `~*` in Postgres, `imatch` in
 * PostgREST — and this module is where it is built. There is a SECOND implementation, in SQL:
 * `core.name_search_pattern`, because the POI, place and event searches run inside RPCs and the
 * pattern has to exist where the query is. The two are one contract and
 * `tests/api/name-search.test.ts` is the parity test — a rule that changes here changes there,
 * in the same commit.
 *
 * WHAT IT DOES NOT DO, and the omissions are the point: it does not stem, it does not fuzzy-
 * match, it does not reorder words. `Bar Zé` finding `Barbearia do Zé` is a candidate list that
 * answers with the wrong establishment, which is worse than one that answers with none.
 */

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

/**
 * The `or(...)` filter for a search that spans more than one column — `name` and `city`, or
 * `full_name` and `email`.
 *
 * PostgREST's `or` grammar separates conditions with COMMAS and groups with PARENTHESES, so a
 * value carrying either would be read as syntax. `namePattern` emits neither — that is why the
 * bounded hole is spelled `.?.?.?` and not `.{0,3}` — and this helper is the only place that
 * knows the two facts belong together.
 *
 * The columns are names of columns, never operator input: passing user text here would be an
 * injection into the filter grammar.
 */
export function nameMatchFilter(columns: string[], term: string): string {
  const pattern = namePattern(term)
  return columns.map((column) => `${column}.imatch.${pattern}`).join(',')
}
