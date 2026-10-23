/**
 * THE CONTRACT OF SEARCHING BY NAME, and the parity between its two implementations.
 *
 * Every screen where an operator types a name asks the same question, and until 2026-08-23 each
 * one asked it with `ILIKE '%term%'`. `ILIKE` compares bytes, and bytes are not what somebody
 * types: `Faella Bistrô` is stored decomposed — `o` plus a combining circumflex, 14 characters —
 * so neither `Faella Bistro` nor `Faella Bistrô` found it. The operator who cannot find the
 * establishment creates it again, and that is where three of three partner duplicates came from.
 *
 * The rule now lives in `lib/shared/name-search` for everything that queries through PostgREST,
 * and in `core.name_search_pattern` for the searches that run inside an RPC — the POI list, the
 * place list, the event list and the three facet functions, which have to agree with the list
 * they count. Two implementations of one decision is what §6 of the protocol calls a defect
 * unless there is a contract and a parity test. This file is that test.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { nameKey, namePattern, nameMatchFilter } from '@/lib/shared/name-search'
import { APP_SCHEMA_SKIP, appSchema, functionDef } from './setup/app-schema'

const root = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

/**
 * The SQL half of the contract lives in the app schema, read from `db-tuggiApp` by
 * `tests/api/setup/app-schema.ts` (baseline `20261006120000` plus the migrations after it). The
 * dated migration files this test used to open were folded into that baseline, so the old path
 * check skipped the parity on every machine, in silence (#894). Without the sibling repository
 * (CI checks out only this one) these assertions skip with `APP_SCHEMA_SKIP`.
 */
const nameSearchKey = () => functionDef('core.name_search_key')

const asRegExp = (term: string) => new RegExp(namePattern(term), 'i')

test('the accent is optional in BOTH directions', () => {
  // The row as it is stored today (`dc93ef2f…`, Cabo Frio): NFD, 14 characters.
  const decomposed = 'Faella Bistrô'
  const composed = 'Faella Bistrô'.normalize('NFC')
  assert.notEqual(decomposed, composed, 'the two spellings are different strings')
  assert.equal(decomposed.length, 14)
  assert.equal(composed.length, 13)

  for (const typed of ['Faella Bistro', 'faella bistrô', 'FAELLA BISTRÔ', 'Faella  Bistro']) {
    assert.ok(asRegExp(typed).test(decomposed), `typing "${typed}" must find the NFD row`)
    assert.ok(asRegExp(typed).test(composed), `typing "${typed}" must find the NFC row`)
  }

  // Cedilla and tilde are the same case, and they are the Portuguese ones that matter.
  assert.ok(asRegExp('Acai da Praca').test('Açaí da Praça'))
  assert.ok(asRegExp('Açaí da Praça').test('Acai da Praca'))
  assert.ok(asRegExp('Sao Joao').test('São João'))
})

test('punctuation and spacing are what four people disagree about', () => {
  assert.ok(asRegExp('Bar do Ze').test('Bar do Zé'))
  assert.ok(asRegExp('Bar-do-Zé').test('Bar do Ze'))
  assert.ok(asRegExp("O'Malley").test('O Malley'))
  assert.ok(asRegExp('Cafe  Encontros').test('Cafeteria'.replace('teria', ' Encontros')))
})

test('the hole is bounded, because a wrong candidate is worse than none', () => {
  // `.*` here would let a two-word search swallow an establishment nobody asked about, and the
  // operator picks from this list without a second source to check it against.
  assert.equal(asRegExp('Bar Ze').test('Barbearia do Zé'), false)
  assert.match(namePattern('Bar Ze'), /\.\?\.\?\.\?/)
  assert.equal(namePattern('Bar Ze').indexOf('.*'), -1)
})

test('the pattern carries nothing that has to be escaped', () => {
  // PostgREST separates `or` conditions with COMMAS and groups with PARENTHESES, so a value
  // carrying either would be read as syntax. That is why the bounded hole is `.?.?.?` and not
  // `.{0,3}`, and why every non-alphanumeric character becomes a hole instead of an escape.
  const dirty = namePattern("O'Malley, Bar & Grill (2) 100%")
  for (const forbidden of [',', '(', ')', '&', '{', '}', "'", '%', '\\']) {
    assert.equal(dirty.indexOf(forbidden), -1, `the pattern must not carry ${forbidden}`)
  }
  assert.ok(new RegExp(dirty, 'i').test("O'Malley Bar e Grill 2 100"))

  const filter = nameMatchFilter(['name', 'city'], 'Búzios')
  assert.equal(filter.split(',').length, 2, 'one condition per column, and no stray comma')
  assert.match(filter, /^name\.imatch\./)
  assert.match(filter, /,city\.imatch\./)
})

test('every operator-facing search in the CMS goes through it', () => {
  // The list is the point: a screen that still writes `ilike` by hand is a screen where the
  // operator will not find what is there.
  const surfaces: [string, string][] = [
    ['app/api/routes/route.ts', 'rotas'],
    ['app/api/clients/pois/route.ts', 'POIs do cliente'],
    ['app/api/admin/clients/route.ts', 'clientes'],
    ['app/api/admin/users/route.ts', 'usuários do CMS'],
    ['app/api/pois/stats/route.ts', 'POIs'],
    ['lib/services/poi-map-service.ts', 'mapa de POIs'],
    ['lib/services/dashboard-service.ts', 'perfis'],
    ['app/api/admin/partnerships/clients/[clientId]/places/candidates/route.ts', 'candidatos a local'],
  ]

  for (const [path, what] of surfaces) {
    const source = read(path)
    assert.match(source, /from '@\/lib\/shared\/name-search'/, `${what} must share the rule`)
    assert.equal(source.indexOf('.ilike.%'), -1, `${what} still builds an ILIKE filter by hand`)
    assert.equal(source.indexOf(".ilike('name'"), -1, `${what} still matches the name with ILIKE`)
  }
})

test('what is deliberately NOT a name search stays `ilike`', () => {
  // A coupon code and an e-mail address are identifiers, not names: nobody writes `PROMO10`
  // four ways, and making `a` match `á` in an e-mail widens a lookup that has to be exact.
  assert.match(read('app/api/admin/coupons/route.ts'), /\.ilike\('code'/)
  assert.match(read('app/api/admin/audit-logs/route.ts'), /\.ilike\('user_email'/)

  // And the boundary/city matching of the import pipeline is machine-to-machine — it compares a
  // catalogue name against OSM, with its own tolerances, and widening it silently would change
  // which polygon a POI lands in.
  assert.match(read('lib/services/location-resolver.ts'), /name\.ilike/)
})

test('the SQL half exists, and it folds the same characters', { skip: APP_SCHEMA_SKIP }, () => {
  // PARITY, and it is asserted on the FOLDING and not on the shape, because the two halves
  // deliberately use different mechanisms:
  //
  //   TypeScript  builds a regex from the TERM (`~*`), because PostgREST cannot call a function
  //               on a column — and those queries run under RLS, where no name index is
  //               reachable anyway (`texticlike` is not leakproof);
  //   SQL         normalises the DATA (`core.name_search_key`) and compares with a plain `LIKE`
  //               against a trigram index on that expression. Measured on 2026-08-23: the regex
  //               with character classes cost 15.809 ms over 2,6 M rows because pg_trgm can
  //               extract almost nothing from it, against 102 ms for a literal.
  //
  // What must NOT diverge is which characters are treated as the same letter. A rule that
  // changes in one and not the other is the `kRetryDelayMs` defect the protocol names: one
  // fact, two homes, and no alarm.
  const key = nameSearchKey()
  const ts = read('lib/shared/name-search.ts')

  assert.match(key, /IMMUTABLE/, 'IMMUTABLE, or the expression index cannot exist')
  // The index the SQL half exists for: a trigram index on the folded name.
  assert.match(
    appSchema(),
    /CREATE INDEX idx_attractions_name_search_key_trgm ON core\.attractions USING gin \(core\.name_search_key\(name\) public\.gin_trgm_ops\)/
  )

  // The `translate` source string is the SQL half's folding table.
  const folded = key.match(/translate\(\s*[\s\S]*?'([^']+)',\s*\n\s*'([^']+)'/)
  assert.ok(folded, 'the function must carry a translate() folding table')
  const [, accented, plain] = folded!
  assert.equal(accented.length, plain.length, 'translate() needs both sides the same length')

  for (const character of accented) {
    assert.ok(
      ts.indexOf(character) >= 0,
      `TypeScript must fold ${character} the same way SQL does`
    )
  }

  // And every search RPC compares through the indexed key; the old pattern helper is gone.
  assert.equal(appSchema().search(/FUNCTION core\.name_search_pattern\(/), -1, 'name_search_pattern must not come back')
  for (const fn of [
    'cms_list_pois',
    'cms_list_places',
    'cms_list_events',
    'cms_poi_facets',
    'cms_place_facets',
    'cms_event_facets',
    'cms_search_pois',
    'cms_search_pois_internal',
    'cms_search_pois_map',
  ]) {
    assert.ok(functionDef(`core.${fn}`).includes('core.name_search_key('), `${fn} must compare through the indexed key`)
  }
})

// ── `nameKey`, e a paridade dele com `core.name_search_key` ──────────────────────────────────
//
// `namePattern` responde "esta linha casa com o que foi digitado?". `nameKey` responde outra
// pergunta que o CMS também faz: "estas duas grafias são o mesmo nome?" — que é o que uma faceta
// precisa antes de oferecer UMA opção por lugar em vez de uma por grafia. Medido na esteira em
// 2026-09-09: 41 propostas, todas de Cabo Frio, oferecidas como quatro opções.

test('nameKey folds case, accent and punctuation the way a facet needs', () => {
  // As quatro grafias medidas em `partner.partner_form_submissions`.
  for (const spelling of ['Cabo Frio', 'CABO FRIO', 'Cabo frio', 'Cabo  Frio']) {
    assert.equal(nameKey(spelling), 'cabo frio', `${spelling} is the same city`)
  }
  assert.equal(nameKey('São Paulo'), nameKey('Sao Paulo'))
  assert.equal(nameKey('Búzios'), 'buzios')
  // Decomposed, exactly as `Faella Bistrô` is stored.
  assert.equal(nameKey('Faella Bistro\u0302'), 'faella bistro')
  assert.equal(nameKey("Bar do Zé"), 'bar do ze')
  assert.equal(nameKey('  Cabo-Frio!  '), 'cabo frio', 'punctuation runs collapse, edges trim')
})

test('nameKey does NOT merge names that are genuinely different', () => {
  // The omission is the point, and it is the same one `namePattern` makes: no stemming, no fuzzy
  // matching, no reordering. A facet that merged two towns would be worse than four spellings.
  assert.notEqual(nameKey('Cabo Frio'), nameKey('Cabo'))
  assert.notEqual(nameKey('São Paulo'), nameKey('São Pedro'))
  assert.notEqual(nameKey('Cabo FrioCabo Frio'), nameKey('Cabo Frio'))
})

test('nameKey is the same folding `core.name_search_key` applies', { skip: APP_SCHEMA_SKIP }, () => {
  // The parity that keeps a facet grouped in the browser agreeing with anything grouped in the
  // database — including the RPC the `data` may serve these options from later.
  const sql = nameSearchKey()
  const table = /translate\([\s\S]*?'([^']+)',\s*\n\s*'([^']+)'/.exec(sql)
  assert.ok(table, 'the fold table is still readable from the function')

  const [, accented, plain] = table!
  assert.equal(accented.length, plain.length, 'the SQL table has to be aligned')
  // Every character the SQL folds, the TypeScript folds the same way. This is the exact defect
  // the migration itself documents: an earlier table shipped with the destination MISALIGNED and
  // turned `josé café` into `josc cafc`.
  for (let index = 0; index < accented.length; index += 1) {
    assert.equal(
      nameKey(accented[index]),
      plain[index],
      `\`${accented[index]}\` must fold to \`${plain[index]}\``
    )
  }

  // And the two other steps, in the same order the SQL runs them.
  assert.match(sql, /regexp_replace\(lower\(term\)/)
  assert.match(sql, /'\[\^a-z0-9\]\+', ' ', 'g'/)
  assert.match(sql, /btrim\(/)
})
