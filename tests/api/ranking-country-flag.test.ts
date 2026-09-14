/**
 * THE COLUMN OF COUNTRY, WITHOUT A DOM — #741 · `DS-COMPONENTE-086`, spec §4.7.
 *
 * Three of the four claims of the new column are arithmetic and can be proved here; the fourth
 * (the name reaches the `sr-only` node, the expanded row, and the width budget) needs a browser
 * and lives in `tests/ct/ranking-scoreboard.spec.tsx`.
 *
 * THE `Intl.DisplayNames` COUNTER IS THE POINT OF THIS FILE, and it is installed before any test
 * runs. `of()` throws `RangeError` on a structurally invalid argument, so "the guard runs BEFORE
 * the call" is not a style preference — it is the difference between an em dash and a table of
 * 13 rows that does not render. Asserting "it printed the em dash" would go green with the
 * guard AFTER the call and a `try/catch` around it; asserting the constructor and `of()` were
 * never reached is what pins the order.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { countryName, flagOf, isRegionCode } from '@/components/ui/CountryFlag'
import { UNKNOWN_VALUE } from '@/lib/format/unknown'

const REPO_ROOT = resolve(import.meta.dirname, '../..')
const source = (path: string) => readFileSync(resolve(REPO_ROOT, path), 'utf8')

/**
 * The file with its prose removed.
 *
 * Both modules below EXPLAIN, at length, why they do not read `core.countries.flag_emoji` and
 * why they do not call `getCountryName` — so a scan over the raw text fails on the very comment
 * that documents the rule. What is being asserted is that the identifiers are not CALLED.
 */
const code = (path: string) =>
  source(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n')

/** The 15 codes the screen sees today — contract `banco-para-cms.md`, Parte 7, measured 2026-09-13. */
const CODES_IN_PRODUCTION = [
  'AR', 'AT', 'BR', 'CA', 'CH', 'CL', 'DE', 'ES', 'FR', 'GB', 'IS', 'IT', 'PE', 'PT', 'US',
]

const calls: string[] = []
const RealDisplayNames = Intl.DisplayNames

class CountingDisplayNames extends RealDisplayNames {
  constructor(locales?: string | string[], options?: Intl.DisplayNamesOptions) {
    super(locales as never, options as never)
    calls.push(`new(${String(locales)})`)
  }

  of(code: string): string | undefined {
    calls.push(`of(${code})`)
    return super.of(code)
  }
}

// Installed at module scope, so every call made by this file goes through it.
;(Intl as unknown as { DisplayNames: unknown }).DisplayNames = CountingDisplayNames

// ── The flag is arithmetic ────────────────────────────────────────────────────────────────

test('#741 · DS-COMPONENTE-086 item 1: an alpha-2 becomes the pair of regional indicators', () => {
  // `B` is 66 and `R` is 82: 0x1F1E6 + 1 and 0x1F1E6 + 17. Written as code points and not as a
  // pasted emoji, because a pasted one proves the editor, not the arithmetic.
  assert.deepEqual([...(flagOf('BR') ?? '')].map((char) => char.codePointAt(0)), [0x1f1e7, 0x1f1f7])
  assert.deepEqual([...(flagOf('US') ?? '')].map((char) => char.codePointAt(0)), [0x1f1fa, 0x1f1f8])
  assert.deepEqual([...(flagOf('AA') ?? '')].map((char) => char.codePointAt(0)), [0x1f1e6, 0x1f1e6])

  for (const code of CODES_IN_PRODUCTION) {
    const flag = flagOf(code)
    assert.ok(flag, `${code}: the fifteen codes in production all convert`)
    // TWO code points, never four: `String.fromCodePoint` of a surrogate pair read back as
    // `length` is 4, and `[...flag]` is the only reading that counts characters.
    assert.equal([...flag].length, 2, `${code}: a flag is exactly two regional indicators`)
    // And the pair carries the code itself — which is what makes the Windows degradation
    // readable instead of wrong (`DS-COMPONENTE-086` item 2).
    assert.equal(
      [...flag].map((char) => String.fromCharCode(char.codePointAt(0)! - 0x1f1e6 + 65)).join(''),
      code
    )
  }
})

test('#741 · DS-COMPONENTE-086 item 6: anything that is not alpha-2 has no flag and no name', () => {
  const before = calls.length

  // `null` is the view's "does not resolve"; the rest are the shapes a broken contract would
  // send — lowercase is NOT folded, because folding it here would hide the break.
  for (const value of [null, undefined, '', 'B', 'br', 'Br', 'BRA', 'B1', '12', ' BR', 'BR ']) {
    assert.equal(isRegionCode(value), false, `${JSON.stringify(value)} is not a region code`)
    assert.equal(flagOf(value), null, `${JSON.stringify(value)} has no flag`)
    assert.equal(countryName(value, 'pt'), null, `${JSON.stringify(value)} has no name`)
  }

  assert.deepEqual(
    calls.slice(before),
    [],
    'the `^[A-Z]{2}$` guard runs BEFORE `Intl.DisplayNames`: `of()` throws on these'
  )
})

test('#741 · DS-COMPONENTE-086 item 6: the cell of a null code is the em dash of the screen', () => {
  // Not a hard-coded `—`: the character is owned by `lib/format/unknown.ts`, and the component
  // is what routes `null` to it — a sibling cell printing a hyphen is the defect that file exists
  // to prevent.
  const component = code('components/ui/CountryFlag.tsx')
  assert.match(component, /from '@\/lib\/format\/unknown'/)
  assert.match(component, /\{UNKNOWN_VALUE\}/)
  assert.equal(component.includes(`'${UNKNOWN_VALUE}'`), false, 'the em dash is never re-typed here')
})

// ── The name is the runtime's ─────────────────────────────────────────────────────────────

test('#741 · DS-COMPONENTE-086 item 4: the name is `Intl.DisplayNames`, one instance per locale', () => {
  const before = calls.length

  assert.equal(countryName('BR', 'pt'), 'Brasil')
  assert.equal(countryName('BR', 'en'), 'Brazil')
  assert.equal(countryName('ES', 'es'), 'España')
  assert.equal(countryName('GB', 'pt'), 'Reino Unido')

  const made = calls.slice(before).filter((entry) => entry.startsWith('new('))
  assert.deepEqual(
    made.sort(),
    ['new(en)', 'new(es)', 'new(pt)'],
    'one instance per locale, memoized in the module — not one per cell'
  )

  // Thirteen rows on screen, and the fourteenth call builds nothing new.
  const again = calls.length
  for (const code of CODES_IN_PRODUCTION) countryName(code, 'pt')
  assert.deepEqual(
    calls.slice(again).filter((entry) => entry.startsWith('new(')),
    [],
    'a whole table of cells reuses the instance the first cell built'
  )
})

test('#741 · DS-COMPONENTE-086 item 4: a region the runtime does not know prints its own code', () => {
  // `QZ` is structurally valid and unassigned: `fallback: 'code'` is what keeps it a worse name
  // instead of `undefined` on screen. It is the shape a new country takes the day
  // `core.country_aliases` learns it before the ICU of some browser does. (`ZZ` is NOT the test:
  // ICU knows it, and answers `Região desconhecida` — a name, and a misleading one.)
  assert.equal(countryName('QZ', 'pt'), 'QZ')
  assert.notEqual(
    countryName('ZZ', 'pt'),
    'ZZ',
    'ICU HAS a name for ZZ — so ZZ would test the dictionary, not the fallback'
  )
  assert.equal([...(flagOf('QZ') ?? '')].length, 2, 'and it still has a flag: the conversion is arithmetic')
})

// ── The two owners it must not become a third of ──────────────────────────────────────────

test('#741 · DS-COMPONENTE-086 items 1 and 4: no stored flag, no hand-written country name', () => {
  const component = code('components/ui/CountryFlag.tsx')
  const scoreboard = code('components/dashboard/reports/RankingScoreboard.tsx')

  for (const [file, text] of [
    ['CountryFlag', component],
    ['RankingScoreboard', scoreboard],
  ] as const) {
    // A stored flag is a second place it can come back empty, and `core.countries` is editable
    // from the CMS (contract, Parte 7).
    assert.equal(
      /flag_emoji/.test(text),
      false,
      `${file}: the flag is derived from the code, never read from a column`
    )
    // `lib/utils.ts` · `getCountryName` is fixed English AND a writer of the raw data this
    // column reads: reusing it for display would close the loop of the error.
    assert.equal(
      /getCountryName|COUNTRY_NAMES/.test(text),
      false,
      `${file}: the name comes from the runtime, not from the map that dirtied the origin`
    )
  }

  // And the derivation lives in ONE module: the screen mounts the component, it does not repeat
  // the arithmetic (CLAUDE.md §6).
  assert.match(scoreboard, /import \{ CountryFlag \} from '@\/components\/ui\/CountryFlag'/)
  assert.equal(/0x1[fF]1[eE]6/.test(scoreboard), false, 'the scoreboard does not convert anything')
})

test('#741 · DS-COMPONENTE-086 item 3: the cell adds no tab stop, and the flag is out of the tree', () => {
  const component = code('components/ui/CountryFlag.tsx')

  assert.match(component, /aria-hidden="true"/, 'the glyph is not announced next to the name')
  assert.match(component, /className="sr-only"/, 'the name reaches the screen reader as text')
  assert.match(component, /title=\{name\}/, 'the pointer gets the name — that was the ask')
  assert.equal(
    /tabIndex|tabindex/.test(component),
    false,
    'thirteen new tab stops in a dense table cost the operator every day (item 3)'
  )
  assert.equal(/<button|onClick/.test(component), false, 'and it is not a control either')
})

// ── The column, and the two ends it travels between ───────────────────────────────────────

test('#741: the route names the 27th column, and the row type says what `null` means', () => {
  const route = source('app/api/dashboard/ranking/route.ts')
  const scoreboard = source('lib/ranking/scoreboard.ts')

  // `select('*')` is what this list exists to avoid; a column added by `data` arrives only when
  // the screen names it.
  assert.match(route, /'top_country_code',/, 'the route asks for the column by name')
  assert.match(scoreboard, /top_country_code: string \| null/, 'and the row type pins its shape')
  assert.match(
    scoreboard,
    /does not resolve/,
    '`null` is "does not resolve", never "explored nothing" — the comment is the contract'
  )
})

test('#741 · DS-COMPONENTE-086 item 5: the label never says `País`, and the denial is in the caption', () => {
  const expected = {
    pt: 'País explorado',
    es: 'País explorado',
    en: 'Explored country',
  }

  for (const [locale, label] of Object.entries(expected)) {
    const file = JSON.parse(source(`messages/${locale}.json`)) as Record<string, any>
    const ranking = file.Pages.Dashboard.ranking
    assert.equal(ranking.table.country, label, `${locale}: the qualifier is part of the label`)

    // The question the operator asked out loud was NATIONALITY, and it is the half the rule bars
    // (BR-USUARIO-043 item 9). The two words may appear on this screen in exactly one place: the
    // sentence that refuses them (spec §9, critério 24).
    const strings = JSON.stringify(ranking)
    const denial = JSON.stringify(ranking.caption.country)
    const rest = strings.replace(denial, '""')
    for (const word of ['nacionalidad', 'nationalit', 'residênc', 'residenc']) {
      assert.equal(
        rest.toLowerCase().includes(word),
        false,
        `${locale}: "${word}" appears outside the sentence that denies it`
      )
    }
    assert.match(
      denial.toLowerCase(),
      /nacionalidad|nationalit/,
      `${locale}: the caption has to name what the column is NOT`
    )
  }
})
