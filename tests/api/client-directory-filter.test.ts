/**
 * The unified list — one spine for `/admin/clients` and `/admin/partnerships`, and a filter
 * rail that answers what neither could.
 *
 * THE QUESTION THAT WAS UNANSWERABLE: `quais parceiros de Minas ainda não assinaram o
 * contrato?`. The client list knew the state; the partnership queue knew the contract; nobody
 * knew both. The first test below is that question, asked of the module.
 *
 * THE DEFECT THIS DESIGN AVOIDS is the one the queue already shipped once: `{n} com a triagem
 * vencida` counted the whole set while the table rendered the filtered one, so clicking the
 * counter opened `Nenhuma parceria com esse filtro`. Every facet count here comes from the SAME
 * predicate the table applies, minus its own dimension — so a count of `3` opens three rows.
 *
 * Mutations that turn this suite red:
 *  · counting a facet with its own dimension applied (every option would read zero);
 *  · counting facets over the unfiltered set (a count would open fewer rows than it promised);
 *  · letting a row with no country be counted as an empty-string country;
 *  · making `overdueCount` respect the filters, which would hide the rows it exists to reach.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  EMPTY_FILTERS,
  activeFilterCount,
  pageWindow,
  buildDirectoryView,
  isFiltering,
  overdueCount,
  type DirectoryFilters,
} from '@/lib/clients/directory-filter'
import type { ClientDirectoryRow } from '@/lib/services/partnership-service'

const PLACES = { total: 0, published: 0, blocking: 0, silencing: 0, improving: 0 }

function row(overrides: Partial<ClientDirectoryRow>): ClientDirectoryRow {
  return {
    submissionId: null,
    clientId: 'c1',
    state: 'client_created',
    target: { kind: 'client', clientId: 'c1', tab: 'partnership' },
    name: 'Cliente',
    taxId: null,
    city: null,
    region: null,
    country: null,
    clientType: 'venue',
    status: 'approved',
    contract: 'none',
    fee: { monthlyFeeCents: null, isCourtesy: false, courtesyReason: null },
    contractTier: null,
    planChoice: null,
    duplicateCount: 0,
    since: '2026-08-01',
    places: PLACES as ClientDirectoryRow['places'],
    triage: { approvedAt: null, places: [] },
    discardReason: null,
    ...overrides,
  }
}

const ROWS: ClientDirectoryRow[] = [
  row({ clientId: 'mg-1', name: 'Pousada Ouro', country: 'Brazil', region: 'MG', city: 'Ouro Preto', contract: 'sent' }),
  row({ clientId: 'mg-2', name: 'Café Tiradentes', country: 'Brazil', region: 'MG', city: 'Tiradentes', contract: 'signed' }),
  row({ clientId: 'mg-3', name: 'Bar Mariana', country: 'Brazil', region: 'MG', city: 'Mariana', contract: 'none' }),
  row({ clientId: 'rj-1', name: 'Quiosque Búzios', country: 'Brazil', region: 'RJ', city: 'Búzios', contract: 'none', clientType: 'hotel' }),
  row({ clientId: 'pt-1', name: 'Taberna Porto', country: 'Portugal', region: 'Porto', city: 'Porto', contract: 'signed' }),
  // A registration nobody filled in: no country, no state, no city. It must never become an
  // empty-string option in the rail.
  row({ clientId: 'bare', name: 'Sem endereço', status: 'pending' }),
]

const withFilters = (overrides: Partial<DirectoryFilters>): DirectoryFilters => ({
  ...EMPTY_FILTERS,
  ...overrides,
})

test('the question neither list could answer: Minas, contract not signed', () => {
  const view = buildDirectoryView(ROWS, withFilters({ country: 'Brazil', region: 'MG' }))
  const unsigned = view.rows.filter((candidate) => candidate.contract !== 'signed')

  assert.deepEqual(
    unsigned.map((candidate) => candidate.clientId).sort(),
    ['mg-1', 'mg-3'],
    'the state came from the client list and the contract from the queue — now both are here'
  )
})

test('each facet counts what it would actually open', () => {
  // No filter: every country in the set, counted whole.
  const wide = buildDirectoryView(ROWS, EMPTY_FILTERS)
  assert.deepEqual(wide.facets.country, [
    { value: 'Brazil', count: 4 },
    { value: 'Portugal', count: 1 },
  ])

  // Narrowed to Brazil, the STATE facet counts only Brazilian rows.
  const brazil = buildDirectoryView(ROWS, withFilters({ country: 'Brazil' }))
  assert.deepEqual(brazil.facets.region, [
    { value: 'MG', count: 3 },
    { value: 'RJ', count: 1 },
  ])

  // And clicking that `3` opens exactly three rows — the guarantee the queue once broke.
  const minas = buildDirectoryView(ROWS, withFilters({ country: 'Brazil', region: 'MG' }))
  assert.equal(minas.rows.length, 3)
})

test('a facet never counts against itself', () => {
  // With Portugal applied, the country rail still offers Brazil: otherwise every option but
  // the current one reads zero and the rail looks broken.
  const view = buildDirectoryView(ROWS, withFilters({ country: 'Portugal' }))
  assert.deepEqual(view.facets.country, [
    { value: 'Brazil', count: 4 },
    { value: 'Portugal', count: 1 },
  ])
  assert.equal(view.rows.length, 1)
})

test('a row with nothing to say is not an option', () => {
  const view = buildDirectoryView(ROWS, EMPTY_FILTERS)
  for (const key of ['country', 'region', 'city'] as const) {
    for (const option of view.facets[key]) {
      assert.notEqual(option.value, '', `${key} must not offer an empty value`)
      assert.ok(option.count > 0)
    }
  }
  // Six rows, five with a country: the sixth is simply absent from that dimension.
  assert.equal(
    view.facets.country.reduce((total, option) => total + option.count, 0),
    5
  )
  assert.equal(view.rows.length, 6, 'and it is still in the table')
})

test('the dimensions compose, and the hidden count is what clearing them brings back', () => {
  const view = buildDirectoryView(
    ROWS,
    withFilters({ country: 'Brazil', contract: 'none', clientType: 'venue' })
  )
  assert.deepEqual(view.rows.map((candidate) => candidate.clientId), ['mg-3'])
  assert.equal(view.hiddenCount, 5)
  assert.equal(view.filtering, true)
})

test('search reads the name, the CNPJ and the place', () => {
  const byName = buildDirectoryView(ROWS, withFilters({ search: 'tiradentes' }))
  assert.deepEqual(byName.rows.map((candidate) => candidate.clientId), ['mg-2'])

  const byCity = buildDirectoryView(ROWS, withFilters({ search: 'Búzios' }))
  assert.deepEqual(byCity.rows.map((candidate) => candidate.clientId), ['rj-1'])

  const byTaxId = buildDirectoryView(
    [row({ clientId: 'x', taxId: '12.345.678/0001-99' })],
    withFilters({ search: '12.345' })
  )
  assert.equal(byTaxId.rows.length, 1)
})

test('an empty filter set is not filtering, and hides nothing', () => {
  const view = buildDirectoryView(ROWS, EMPTY_FILTERS)
  assert.equal(view.filtering, false)
  assert.equal(isFiltering(EMPTY_FILTERS), false)
  assert.equal(view.hiddenCount, 0)
  assert.equal(view.rows.length, ROWS.length)
})

test('the overdue counter reads the whole set, never the filtered one', () => {
  // Approved four days ago with a place nobody triaged: the 72-hour promise is broken.
  const late = row({
    clientId: 'late',
    country: 'Brazil',
    region: 'MG',
    triage: { approvedAt: '2020-01-01T00:00:00.000Z', places: [{ attractionId: 'place-1', published: false, refusal: null }] },
  })
  const set = ROWS.concat(late)

  assert.equal(overdueCount(set), 1)
  // Filtered to Portugal, the late row is out of the table — and the counter that exists to
  // REACH it still says one, or narrowing the list would hide the promise being broken.
  const view = buildDirectoryView(set, withFilters({ country: 'Portugal' }))
  assert.equal(view.rows.some((candidate) => candidate.clientId === 'late'), false)
  assert.equal(overdueCount(set), 1)
})

test('an overdue triage sorts above a longer idle row', () => {
  const idle = row({ clientId: 'idle', since: '2019-01-01' })
  const late = row({
    clientId: 'late',
    since: '2026-08-15',
    triage: { approvedAt: '2020-01-01T00:00:00.000Z', places: [{ attractionId: 'place-2', published: false, refusal: null }] },
  })
  const view = buildDirectoryView([idle, late], EMPTY_FILTERS)
  assert.deepEqual(view.rows.map((candidate) => candidate.clientId), ['late', 'idle'])
})

// ── The figure the phone's `Filtros` button wears ────────────────────────────────────────────

/**
 * ON A MONITOR NOTHING NEEDS TO COUNT THE FACETS: every active one is on screen, underlined, in
 * a rail that is always open. On a phone the same facets are behind a closed sheet, and the
 * button that opens it is the only thing left that can say a filter is on at all. A wrong count
 * there is the defect the rail could never have — an operator reading `21 de 36` and hunting for
 * a partner that a forgotten `país = Portugal` is hiding.
 *
 * THE INVARIANT IS AGREEMENT WITH `isFiltering`, and it is asserted over every dimension rather
 * than spot-checked: the two functions enumerate the same ten fields by hand, and a dimension
 * added to one and not the other is exactly the drift that produces `Filtros` with no number
 * over a filtered list.
 *
 * Mutations that turn this red:
 *  · forgetting a dimension (`plan`, `onlyLate`) as `activeFilterCount` grows;
 *  · counting `state: 'all'` or `search: ''` as narrowing, which would put a number on the
 *    button of an untouched list;
 *  · counting whitespace-only search text, which `applyFilters` deletes from the URL.
 */
const NARROWED: DirectoryFilters[] = [
  { ...EMPTY_FILTERS, search: 'padaria' },
  { ...EMPTY_FILTERS, country: 'Brazil' },
  { ...EMPTY_FILTERS, region: 'MG' },
  { ...EMPTY_FILTERS, city: 'Cabo Frio' },
  { ...EMPTY_FILTERS, clientType: 'restaurante' },
  { ...EMPTY_FILTERS, status: 'approved' },
  { ...EMPTY_FILTERS, contract: 'signed' },
  { ...EMPTY_FILTERS, plan: 'paid' },
  { ...EMPTY_FILTERS, state: 'in_progress' },
  { ...EMPTY_FILTERS, onlyLate: true },
]

test('an untouched list wears no number, and agrees with isFiltering', () => {
  assert.equal(activeFilterCount(EMPTY_FILTERS), 0)
  assert.equal(isFiltering(EMPTY_FILTERS), false)
})

test('every dimension counts exactly one, and every one of them is a narrowing', () => {
  for (const filters of NARROWED) {
    assert.equal(activeFilterCount(filters), 1, JSON.stringify(filters))
    // The two functions enumerate the same fields by hand. If one grows a dimension the other
    // does not, this is where it shows.
    assert.equal(isFiltering(filters), true, JSON.stringify(filters))
  }
})

test('the count is the number of dimensions narrowed, not of rows removed', () => {
  const three = { ...EMPTY_FILTERS, country: 'Brazil', contract: 'signed', onlyLate: true }
  assert.equal(activeFilterCount(three), 3)
})

test('whitespace-only search is not a filter — applyFilters deletes it from the URL', () => {
  const blank = { ...EMPTY_FILTERS, search: '   ' }
  assert.equal(activeFilterCount(blank), 0)
  assert.equal(isFiltering(blank), false)
})

// ── The pager's numbers ──────────────────────────────────────────────────────────────────────

/**
 * `pageWindow` EXISTS BECAUSE THE CAP IS 1000. At 25 rows a page that is forty buttons, and a
 * row of forty numbers is wider than the table it pages — the current one becomes impossible to
 * find, which is the opposite of what a pager is for.
 *
 * Mutations that turn this red:
 *  · printing a page number outside `1..pageCount`, which is a button that opens an empty table;
 *  · printing the same page twice, which is two buttons that open the same one;
 *  · replacing a gap of exactly ONE page with an ellipsis, which hides a page that was reachable
 *    in a click and costs the same width to print;
 *  · rendering a pager at all for a single page, where every button would be dead.
 */
test('a single page is just itself', () => {
  assert.deepEqual(pageWindow(1, 1), [1])
  assert.deepEqual(pageWindow(1, 0), [1])
})

test('a short list prints every page, with no gaps', () => {
  assert.deepEqual(pageWindow(1, 3), [1, 2, 3])
  assert.deepEqual(pageWindow(2, 4), [1, 2, 3, 4])
  assert.deepEqual(pageWindow(1, 5), [1, 2, 3, 4, 5])
})

test('a long list keeps the ends, the current page and two neighbours each side', () => {
  assert.deepEqual(pageWindow(20, 40), [1, null, 18, 19, 20, 21, 22, null, 40])
  assert.deepEqual(pageWindow(1, 40), [1, 2, 3, null, 40])
  assert.deepEqual(pageWindow(40, 40), [1, null, 38, 39, 40])
})

/**
 * A GAP OF EXACTLY ONE IS PRINTED. `1 … 3` and `1 2 3` are the same width, and the first hides a
 * page the operator could have reached without opening it first.
 */
test('a gap of one page is printed rather than elided', () => {
  assert.deepEqual(pageWindow(1, 6), [1, 2, 3, null, 6])
  assert.deepEqual(pageWindow(4, 7), [1, 2, 3, 4, 5, 6, 7])
})

test('every number is inside the range, and none repeats', () => {
  for (const pageCount of [1, 2, 5, 9, 40]) {
    for (let page = 1; page <= pageCount; page += 1) {
      const window = pageWindow(page, pageCount)
      const numbers = window.filter((value): value is number => value !== null)
      assert.ok(
        numbers.every((value) => value >= 1 && value <= pageCount),
        `page ${page} of ${pageCount} printed something out of range: ${JSON.stringify(window)}`
      )
      assert.equal(
        new Set(numbers).size,
        numbers.length,
        `page ${page} of ${pageCount} printed a duplicate: ${JSON.stringify(window)}`
      )
      // The current page is always one of them, or the pager cannot say where you are.
      assert.ok(numbers.indexOf(page) >= 0, `page ${page} of ${pageCount} lost the current page`)
    }
  }
})

// ── The search, and the three ways it used to miss a row sitting in front of the operator ────
//
// Reported on 2026-09-09: "a busca é lenta e não responde corretamente quando buscamos". The
// slowness was the URL being written once per keystroke and is fixed in `DirectoryFilterRail`;
// THIS is the other half. The predicate compared bytes — `toLowerCase()` plus `indexOf` — and
// the CMS already had one rule for searching by name, with the three failures measured on real
// rows on 2026-08-23 (`lib/shared/name-search`). Three of three partner duplicates came from the
// first of them.

function found(rows: ClientDirectoryRow[], search: string): string[] {
  return buildDirectoryView(rows, { ...EMPTY_FILTERS, search }).rows.map((r) => r.name ?? '')
}

test('the search is blind to accent — `buzios` finds `Búzios`', () => {
  const rows = [row({ name: 'Pousada Búzios' }), row({ name: 'Bar do Centro' })]
  assert.deepEqual(found(rows, 'buzios'), ['Pousada Búzios'])
  // And the other direction: typing the accent still finds it.
  assert.deepEqual(found(rows, 'búzios'), ['Pousada Búzios'])
})

test('the search finds a name stored DECOMPOSED, which is what `ILIKE` could not', () => {
  // `ô` as `o` + U+0302 — how `Faella Bistrô` is actually stored. Neither `%Bistrô%` (typed NFC)
  // nor `%Bistro%` matched it, and the only button left to the operator was `Criar um local novo`.
  const decomposed = 'Faella Bistro\u0302'
  const rows = [row({ name: decomposed })]
  assert.equal(found(rows, 'Bistro').length, 1, 'without the accent')
  assert.equal(found(rows, 'Bistrô').length, 1, 'and with it, typed NFC')
})

test('the search is blind to case', () => {
  const rows = [row({ name: 'CABO FRIO Turismo' })]
  assert.equal(found(rows, 'cabo frio').length, 1)
})

test('a CNPJ typed with punctuation finds one stored as digits, and the reverse', () => {
  const formatted = row({ name: 'Com pontuação', taxId: '12.345.678/0001-90' })
  const raw = row({ name: 'Sem pontuação', taxId: '98765432000155' })

  assert.deepEqual(found([formatted], '12345678000190'), ['Com pontuação'])
  assert.deepEqual(found([raw], '98.765.432/0001-55'), ['Sem pontuação'])
})

test('the search still spans name, place and tax id — and still narrows', () => {
  const rows = [
    row({ name: 'Cantina', city: 'Cabo Frio' }),
    row({ name: 'Padaria', city: 'Santos' }),
  ]
  assert.deepEqual(found(rows, 'cabo'), ['Cantina'])
  assert.equal(found(rows, 'nada disso').length, 0, 'a term nobody matches still empties the list')
})

test('the facet counts read the same search the table does', () => {
  // The defect this whole module exists to prevent, now reachable through the search too: a
  // count that ignored the term would promise rows the table would not show.
  const rows = [
    row({ name: 'Búzios A', country: 'Brazil' }),
    row({ name: 'Búzios B', country: 'Brazil' }),
    row({ name: 'Outro', country: 'Portugal' }),
  ]
  const view = buildDirectoryView(rows, { ...EMPTY_FILTERS, search: 'buzios' })
  assert.equal(view.rows.length, 2)
  assert.deepEqual(
    view.facets.country.map((option) => [option.value, option.count]),
    [['Brazil', 2]],
    'Portugal has nobody left once the term is applied, so it is not an option'
  )
})

// ── Uma opção por lugar, e não uma por grafia ────────────────────────────────────────────────
//
// Medido em 2026-09-09: 41 propostas, TODAS de Cabo Frio, oferecidas como quatro opções —
// `Cabo Frio` (36), `Cabo FrioCabo Frio` (3), `Cabo frio` (1) e `CABO FRIO` (1). O operador
// escolhe uma e conclui que as outras cinco linhas não existem, que é o mesmo desfecho que
// produziu 3 de 3 duplicatas de parceiro em 2026-08-23.

const CABO_FRIO_SPELLINGS = ['Cabo Frio', 'Cabo Frio', 'Cabo Frio', 'CABO FRIO', 'Cabo frio']

test('the city facet offers one option per place, with the whole count', () => {
  const rows = CABO_FRIO_SPELLINGS.map((city) => row({ city }))
  const { facets } = buildDirectoryView(rows, EMPTY_FILTERS)

  assert.equal(facets.city.length, 1, 'four spellings are one city')
  assert.equal(facets.city[0].count, 5, 'and the count is everybody, not the biggest group')
})

test('the option shows the spelling most rows used, never the folded key', () => {
  const rows = CABO_FRIO_SPELLINGS.map((city) => row({ city }))
  const { facets } = buildDirectoryView(rows, EMPTY_FILTERS)
  // Grouping by `cabo frio` must not print `cabo frio`: the count would be right and the option
  // unrecognisable.
  assert.equal(facets.city[0].value, 'Cabo Frio')
})

test('choosing the option opens every spelling it absorbed', () => {
  const rows = CABO_FRIO_SPELLINGS.map((city, index) => row({ city, name: `Row ${index}` }))
  const view = buildDirectoryView(rows, { ...EMPTY_FILTERS, city: 'Cabo Frio' })
  assert.equal(view.rows.length, 5, 'the option has to open exactly what it promised')
})

test('a link written with another spelling keeps working', () => {
  // The URL carries the SPELLING and not the folded key, so `?city=Cabo+Frio` stays readable —
  // and an older link somebody sent with a different casing still resolves.
  const rows = CABO_FRIO_SPELLINGS.map((city) => row({ city }))
  for (const typed of ['CABO FRIO', 'cabo frio', 'Cabo  Frio']) {
    assert.equal(
      buildDirectoryView(rows, { ...EMPTY_FILTERS, city: typed }).rows.length,
      5,
      `${typed} has to reach the same rows`
    )
  }
})

test('accents fold in the facet exactly as they do in the search', () => {
  const rows = [
    row({ city: 'São Paulo' }),
    row({ city: 'São Paulo' }),
    row({ city: 'Sao Paulo' }),
    row({ city: 'Santos' }),
  ]
  const { facets } = buildDirectoryView(rows, EMPTY_FILTERS)
  assert.deepEqual(
    facets.city.map((option) => [option.value, option.count]),
    [['São Paulo', 3], ['Santos', 1]],
    'the accent is not a different city, and the majority spelling is the one shown'
  )
})

test('a tie between two spellings resolves the same way on every read', () => {
  // With one row each there IS no majority, and the module does not pretend there is: the
  // tie breaks on the alphabet, so the panel does not reorder itself between two reads of the
  // same data. Which of the two wins is arbitrary; that it is STABLE is not.
  const rows = [row({ city: 'São Paulo' }), row({ city: 'Sao Paulo' })]
  const first = buildDirectoryView(rows, EMPTY_FILTERS).facets.city
  const again = buildDirectoryView(rows.slice().reverse(), EMPTY_FILTERS).facets.city

  assert.deepEqual(first, again, 'row order must not decide the label')
  assert.equal(first.length, 1)
  assert.equal(first[0].count, 2)
})

test('the closed vocabularies are NOT folded — hiding a bug is not consolidation', () => {
  // `status`, `contract`, `plan`, `clientType` and `state` come from unions, not from somebody
  // typing. Folding them would only ever merge two values that should never have coexisted.
  const rows = [row({ status: 'approved' }), row({ status: 'pending' })]
  const { facets } = buildDirectoryView(rows, EMPTY_FILTERS)
  assert.equal(facets.status.length, 2)
})

test('the facet count still excludes only its own dimension', () => {
  // The guarantee the whole module exists for, restated against the grouped options: a count is
  // the number of rows that option opens WITH the other filters applied.
  const rows = [
    row({ city: 'Cabo Frio', country: 'Brazil' }),
    row({ city: 'CABO FRIO', country: 'Brazil' }),
    row({ city: 'Cabo Frio', country: 'Portugal' }),
  ]
  const view = buildDirectoryView(rows, { ...EMPTY_FILTERS, country: 'Brazil' })
  assert.deepEqual(
    view.facets.city.map((option) => [option.value, option.count]),
    [['Cabo Frio', 2]],
    'the third row is Portugal and must not be counted'
  )
  // And the country dimension still counts both, because it is the one being excluded.
  assert.equal(view.facets.country.length, 2)
})
