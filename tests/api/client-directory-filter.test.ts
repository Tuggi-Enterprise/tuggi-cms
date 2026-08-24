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
    href: '/admin/clients?clientId=c1',
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
