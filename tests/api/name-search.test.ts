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

import { namePattern, nameMatchFilter } from '@/lib/shared/name-search'

const root = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

/** The migration that carries the SQL half of the contract. */
const MIGRATION =
  '../db-tuggiApp/supabase/migrations/' +
  '20260823150000_name_search_is_blind_to_accent_case_and_punctuation.sql'

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

test('the SQL half exists, and it is the same rule', () => {
  // PARITY, and it is asserted on the shape because the two engines cannot be run side by side
  // here: the migration has to carry the same variant classes, the same optional combining
  // mark, and the same bounded hole. A rule that changes in one and not the other is exactly
  // the `kRetryDelayMs` defect the protocol names — one fact, two homes, and no alarm.
  const migration = read(MIGRATION)

  assert.match(migration, /CREATE OR REPLACE FUNCTION core\.name_search_pattern/)
  assert.match(migration, /IMMUTABLE/)

  for (const variants of ['aáàâãäåāª', 'cç', 'eéèêëē', 'iíìîïī', 'nñ', 'oóòôõöøōº', 'uúùûüū', 'yýÿ']) {
    assert.ok(
      migration.indexOf(variants) >= 0,
      `the SQL pattern must carry the same class as the TypeScript one: ${variants}`
    )
    assert.ok(
      read('lib/shared/name-search.ts').indexOf(variants) >= 0,
      `and the TypeScript one must carry it too: ${variants}`
    )
  }

  assert.ok(migration.indexOf('.?.?.?') >= 0, 'the same bounded hole, and not `.{0,3}`')
  assert.equal(migration.indexOf('.{0,3}'), -1)

  // The six functions that answer the operator's typing, and they change together: a facet that
  // counted with `ILIKE` while its list matched with `~*` would report a number the list cannot
  // show.
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
    assert.ok(migration.indexOf(fn) >= 0, `${fn} must be migrated with the others`)
  }
})
