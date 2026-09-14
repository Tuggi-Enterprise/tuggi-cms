'use client'

/**
 * ONE CODE IN, A FLAG AND A NAME OUT — `DS-COMPONENTE-086`, spec §4.7 (#741).
 *
 * This module is the single owner of three decisions, and the reason it exists as a module
 * instead of three lines inside a table cell is that all three have a wrong answer that looks
 * right:
 *
 * 1. **The flag is DERIVED, never stored.** Two regional indicators, `0x1F1E6 + charCodeAt − 65`
 *    per letter: zero bytes of image, zero new dependency, no request. `core.countries` does
 *    carry a `flag_emoji` column and the screen must not read it — a stored flag is a second
 *    place the flag can come back empty or disagreeing with the code next to it (CLAUDE.md §6,
 *    SSOT before DRY), and the operator can edit that table from the CMS.
 * 2. **The NAME never depends on the glyph.** Where the system font has no flag sequence
 *    (Windows/Chrome), what the browser paints is the pair of letters — which IS the alpha-2, so
 *    the operator reads the same fact — and the name keeps arriving as plain text: `title` for
 *    the pointer, an `sr-only` node for the screen reader, with the flag `aria-hidden`. A flag
 *    concatenated into the label makes the reader announce the country twice.
 * 3. **No code is `UNKNOWN_VALUE`, never a generic flag.** `top_country_code` is `NULL` for "does
 *    not resolve", which on this screen is not "explored nothing": the same 265 of 582 rows that
 *    have no `platform` have no country, because they entered the period only by charge or by
 *    trail (contract `banco-para-cms.md`, Parte 7). A screen that spells absence `—` everywhere
 *    else may not spell it with a flag here (`DS-COMPONENTE-084` item 1).
 *
 * THE NAME COMES FROM THE RUNTIME. `Intl.DisplayNames(locale, { type: 'region' })`, one instance
 * per locale memoized in the module — not one per cell, and 13 cells per render is exactly the
 * shape that makes that matter. Two traps of that API are handled here and nowhere else:
 * `of()` THROWS `RangeError` on a structurally invalid argument, which is why the `^[A-Z]{2}$`
 * guard runs BEFORE the call and not after it; and `fallback: 'code'` (the default, stated here
 * on purpose) returns the code itself for a region the runtime does not know — a worse name, not
 * a lie, and it prints.
 *
 * DO NOT REACH FOR `lib/utils.ts` · `getCountryName`. It is fixed English, ~50 hand-written
 * entries, and it is a WRITER of the raw data this column reads (`extractLocationFromAddress
 * Components` stores its output in `core.attractions.country`): using it for display would
 * translate the screen with the same crooked map that dirtied the origin, and would make a
 * second owner of "the name of a country" in a repo that already has one too many.
 */

import { useLocale } from 'next-intl'
import { UNKNOWN_VALUE } from '@/lib/format/unknown'

/**
 * ISO 3166-1 alpha-2, UPPERCASE — the shape the view guarantees (contract, Parte 7: the
 * migration aborts if a non-null value escapes it). Lowercase is not folded on purpose: a
 * lowercase value would mean the contract broke upstream, and quietly repairing it here would
 * hide that from the one screen that could notice.
 */
const ALPHA_2 = /^[A-Z]{2}$/

/** `🇦` — the first regional indicator. `A` is 65, and the pair of them is what a font renders as a flag. */
const REGIONAL_INDICATOR_A = 0x1f1e6
const LATIN_A = 65

/** One `Intl.DisplayNames` per locale, built on first use. Thirteen cells share one instance. */
const NAMES = new Map<string, Intl.DisplayNames>()

/** `true` for a value this module will convert; `false` for everything else, including `null`. */
export function isRegionCode(code: string | null | undefined): code is string {
  return typeof code === 'string' && ALPHA_2.test(code)
}

/**
 * `BR` → `🇧🇷`. Returns `null` for anything that is not alpha-2 — the caller prints the em dash.
 *
 * The conversion is arithmetic, so a code the fonts of the world have never seen still produces
 * a well-formed pair of indicators; what varies is whether the platform paints it as a flag or
 * as two boxed letters, and both readings carry the same two letters.
 */
export function flagOf(code: string | null | undefined): string | null {
  if (!isRegionCode(code)) return null
  return String.fromCodePoint(
    REGIONAL_INDICATOR_A + code.charCodeAt(0) - LATIN_A,
    REGIONAL_INDICATOR_A + code.charCodeAt(1) - LATIN_A
  )
}

/**
 * `BR` in `pt` → `Brasil`. Returns `null` for anything that is not alpha-2, WITHOUT touching
 * `Intl.DisplayNames` — `of('')` and `of('BRA')` throw `RangeError`, and a table of 13 rows is
 * not the place to find that out.
 *
 * A structurally valid region the runtime does not know comes back as the code itself
 * (`fallback: 'code'`), and `of()` may still return `undefined` under an implementation that
 * ignores the fallback: both end at the code, never at `undefined` on screen.
 */
export function countryName(code: string | null | undefined, locale: string): string | null {
  if (!isRegionCode(code)) return null

  let names = NAMES.get(locale)
  if (!names) {
    names = new Intl.DisplayNames(locale, { type: 'region', fallback: 'code' })
    NAMES.set(locale, names)
  }

  return names.of(code) ?? code
}

/**
 * The cell of the `País explorado` column, and the value of the same pair in the expanded row.
 *
 * `withName` prints the name next to the flag — that is the expanded row, where the name is how
 * somebody navigating by keyboard without a screen reader reaches it (`DS-COMPONENTE-086` item
 * 3). In the dense table the name is `sr-only` plus `title`: making 13 cells focusable to show a
 * tooltip would put 13 tab stops in a table an operator walks all day, against the gain of one
 * consultation.
 */
export function CountryFlag({ code, withName = false }: { code: string | null; withName?: boolean }) {
  const locale = useLocale()
  const flag = flagOf(code)
  const name = countryName(code, locale)

  if (!flag || !name) return <span className="text-gray-500 dark:text-gray-400">{UNKNOWN_VALUE}</span>

  return (
    <span className="inline-flex items-center gap-1.5" title={name}>
      {/* OUT OF THE ACCESSIBILITY TREE, ALWAYS. Concatenated to the name, a screen reader says
          "flag of Brazil, Brazil" — `DS-COMPONENTE-086` item 2. */}
      <span aria-hidden="true" className="text-base leading-none">
        {flag}
      </span>
      {withName ? <span>{name}</span> : <span className="sr-only">{name}</span>}
    </span>
  )
}

export default CountryFlag
