/**
 * What `Abrir` on `/admin/clients` points at — the guarantee behind two defects the operator
 * reported on 2026-09-09 as separate complaints:
 *
 *   "o modo quadro e tabela é resetado quando se abre um cliente"
 *   "o filtro é resetado quando se abre um cliente e volta"
 *
 * Both were one line. `detailPath` returned `/admin/clients?clientId=X&tab=partnership`, a query
 * composed from nothing, and the anchor rendered it verbatim. Everything the operator had on
 * screen — the view and all ten filter keys — was dropped on the way in.
 *
 * These assertions are the reason that cannot come back: the composer is handed the list's own
 * query string and has to give it back, minus only what the record itself owns.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { recordHref } from '@/lib/clients/record-href'
import { EMPTY_FILTERS, applyFilters } from '@/lib/clients/directory-filter'
import { RETURN_TO_PARAM, parseReturnTo } from '@/lib/navigation/return-to'

const CLIENT_ID = '11111111-1111-4111-8111-111111111111'
const SUBMISSION_ID = '22222222-2222-4222-8222-222222222222'

const CLIENT_TARGET = { kind: 'client', clientId: CLIENT_ID, tab: 'partnership' } as const
const PROPOSAL_TARGET = { kind: 'proposal', submissionId: SUBMISSION_ID } as const

/** The query of an operator who has narrowed the list and switched to the table. */
function workingList(): URLSearchParams {
  const params = applyFilters(new URLSearchParams(), {
    ...EMPTY_FILTERS,
    search: 'cozi',
    country: 'Brazil',
    region: 'RJ',
    city: 'Cabo Frio',
    state: 'in_progress',
    onlyLate: true,
  })
  params.set('view', 'table')
  return params
}

test('opening a client keeps the view — the operator stays in Tabela', () => {
  const href = recordHref('pt', workingList(), CLIENT_TARGET)
  const query = new URLSearchParams(href.slice(href.indexOf('?') + 1))
  assert.equal(query.get('view'), 'table')
})

test('opening a client keeps every filter the operator applied', () => {
  const before = workingList()
  const href = recordHref('pt', before, CLIENT_TARGET)
  const after = new URLSearchParams(href.slice(href.indexOf('?') + 1))

  for (const [key, value] of before.entries()) {
    assert.equal(after.get(key), value, `${key} must survive opening the record`)
  }
})

test('the record owns clientId and tab, so they are set and not merely appended', () => {
  const open = new URLSearchParams({ clientId: 'somebody-else', tab: 'fiscal', view: 'table' })
  const href = recordHref('pt', open, CLIENT_TARGET)
  const query = new URLSearchParams(href.slice(href.indexOf('?') + 1))

  assert.deepEqual(query.getAll('clientId'), [CLIENT_ID], 'one clientId, and it is this one')
  assert.deepEqual(query.getAll('tab'), ['partnership'])
  assert.equal(query.get('view'), 'table', 'and the view is still not collateral damage')
})

test('the creation form does not travel into a link that opens an existing record', () => {
  // `mode=new` and `new=true` both open the editor on a blank client. Carrying either into a
  // link that names a `clientId` would render the drawer in two modes at once.
  for (const [key, value] of [['mode', 'new'], ['new', 'true']] as const) {
    const href = recordHref('pt', new URLSearchParams({ [key]: value }), CLIENT_TARGET)
    const query = new URLSearchParams(href.slice(href.indexOf('?') + 1))
    assert.equal(query.get(key), null, `${key} must not survive`)
  }
})

test('the locale prefix is the operator’s, so the link does not bounce through a redirect', () => {
  assert.equal(recordHref('en', new URLSearchParams(), CLIENT_TARGET).startsWith('/en/admin/clients?'), true)
  assert.equal(recordHref('pt', new URLSearchParams(), CLIENT_TARGET).startsWith('/pt/admin/clients?'), true)
})

test('a clean list opens a clean record — no empty parameters invented on the way', () => {
  assert.equal(
    recordHref('pt', new URLSearchParams(), CLIENT_TARGET),
    `/pt/admin/clients?clientId=${CLIENT_ID}&tab=partnership`
  )
})

test('a proposal is a page, so it declares the way back to the list it came from', () => {
  const href = recordHref('pt', workingList(), PROPOSAL_TARGET)
  assert.equal(href.startsWith(`/pt/admin/partnerships/proposals/${SUBMISSION_ID}?`), true)

  const back = new URLSearchParams(href.slice(href.indexOf('?') + 1)).get(RETURN_TO_PARAM)
  // It has to survive the rule that decides what may be trusted, or the control never renders.
  assert.equal(parseReturnTo(back), back)

  const query = new URLSearchParams(back!.slice(back!.indexOf('?') + 1))
  assert.equal(query.get('view'), 'table', 'and coming back is coming back to the same list')
  assert.equal(query.get('city'), 'Cabo Frio')
})

test('the way back is the list, not the list with somebody’s record open over it', () => {
  const withDrawer = workingList()
  withDrawer.set('clientId', 'other-client')
  withDrawer.set('tab', 'fiscal')

  const href = recordHref('pt', withDrawer, PROPOSAL_TARGET)
  const back = new URLSearchParams(href.slice(href.indexOf('?') + 1)).get(RETURN_TO_PARAM)!
  const query = new URLSearchParams(back.slice(back.indexOf('?') + 1))

  assert.equal(query.get('clientId'), null, 'returning must not reopen the drawer just left')
  assert.equal(query.get('tab'), null)
  assert.equal(query.get('view'), 'table', 'but the view the operator chose is still theirs')
})
