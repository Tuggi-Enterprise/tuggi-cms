/**
 * ONE ROW PER CLIENT IN THE DIRECTORY. #991.
 *
 * Measured on 2026-10-22: 34 old clients of Cabo Frio were on the list twice, once from their
 * proposal and once from the legacy mirror #916 seeded for `/status`. The second row read the
 * mirror's placeholder answers, and both rows shared a React key, so changing the search left rows
 * of the previous one on screen ("office" still showed Ancho&Faca; "pão do" drew 5 rows under
 * "3 de 89").
 *
 * Mutations that turn this suite red:
 *  · pushing every portal submission as a row again (the duplicate comes back);
 *  · folding a portal submission that has no client yet (the validation queue loses it);
 *  · folding a portal-native client into its record row (the board loses its portal state);
 *  · a `rowKey` that can repeat between a proposal row and a portal row.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { assembleDirectoryRows, type PortalDirectoryRow } from '@/lib/clients/directory-rows'
import { buildDirectoryView, EMPTY_FILTERS } from '@/lib/clients/directory-filter'
import { rowKey } from '@/components/admin/clients/board/row-text'
import type { ClientDirectoryRow } from '@/lib/services/partnership-service'

const root = resolve(import.meta.dirname, '../..')

function row(overrides: Partial<ClientDirectoryRow>): ClientDirectoryRow {
  return {
    submissionId: null,
    clientId: null,
    state: 'published',
    target: { kind: 'client', clientId: overrides.clientId ?? 'x', tab: 'partnership' },
    name: null,
    taxId: null,
    city: 'Cabo Frio',
    region: 'Rio de Janeiro',
    country: 'Brazil',
    clientType: 'venue',
    status: 'approved',
    contract: 'signed',
    fee: { monthlyFeeCents: null, isCourtesy: false, courtesyReason: null },
    contractTier: 'free',
    planChoice: null,
    duplicateCount: 0,
    since: '2026-08-31T12:00:00.000Z',
    places: { total: 1, published: 1, blocking: 0, silencing: 0 } as ClientDirectoryRow['places'],
    triage: { approvedAt: '2026-08-31T12:00:00.000Z', places: [] },
    discardReason: null,
    gateMissing: [],
    hasHeldPhoto: false,
    hasHeldStory: false,
    ...overrides,
  }
}

function proposal(clientId: string, name: string): ClientDirectoryRow {
  return row({ submissionId: `proposal-${clientId}`, clientId, name })
}

function clientOnly(clientId: string, name: string): ClientDirectoryRow {
  return row({ clientId, name })
}

/** What the directory built for a mirror before #991: the seed's answers, `Brazil` as the state. */
function portal(
  submissionId: string,
  clientId: string | null,
  name: string,
  extra: Partial<ClientDirectoryRow> = {},
  legacy = true
): PortalDirectoryRow {
  return {
    legacy,
    row: row({
      submissionId,
      clientId,
      name,
      origin: 'portal',
      region: 'Brazil',
      contract: 'none',
      contractTier: null,
      places: { total: 0, published: 0, blocking: 0, silencing: 0 } as ClientDirectoryRow['places'],
      since: '2026-10-08T12:00:00.000Z',
      liveAt: '2026-08-21T12:00:00.000Z',
      attractionId: `poi-${submissionId}`,
      ...extra,
    }),
  }
}

test('#991 · a client from a proposal and from a portal mirror is ONE row, the proposal one', () => {
  const rows = assembleDirectoryRows(
    [proposal('ancho', 'Ancho&Faca Parrilla e Fogos')],
    [],
    [portal('mirror-ancho', 'ancho', 'Ancho&Faca Parrilla e Fogos')]
  )
  assert.equal(rows.length, 1)
  const [only] = rows
  assert.equal(only.submissionId, 'proposal-ancho')
  assert.equal(only.origin, undefined)
  // The record's facts stay: not the mirror's `Brazil`, `Sem contrato` and 08/10.
  assert.equal(only.region, 'Rio de Janeiro')
  assert.equal(only.contract, 'signed')
  assert.equal(only.since, '2026-08-31T12:00:00.000Z')
  // The portal's fact comes along: since when it is live.
  assert.equal(only.liveAt, '2026-08-21T12:00:00.000Z')
})

test('#991 · the portal plan fills the row only when the row has none, and the earlier live date wins', () => {
  const asked = proposal('office', 'Office café')
  asked.planChoice = 'map_only'
  const acceptance = { planChoice: 'map_and_description', billingPeriod: 1, totalCents: 14900 }
  const [kept] = assembleDirectoryRows(
    [asked],
    [],
    [portal('mirror-office', 'office', 'Office café', { planChoice: 'map_and_description', portalAcceptance: acceptance })]
  )
  assert.equal(kept.planChoice, 'map_only')
  assert.deepEqual(kept.portalAcceptance, acceptance)

  const [filled] = assembleDirectoryRows(
    [proposal('edu', 'Pão do Edu')],
    [],
    [
      portal('mirror-edu', 'edu', 'Pão do Edu', { planChoice: 'map_and_description', liveAt: '2026-09-02T00:00:00.000Z' }),
      portal('mirror-edu-2', 'edu', 'Pão do Edu', { liveAt: '2026-08-10T00:00:00.000Z' }),
    ]
  )
  assert.equal(filled.planChoice, 'map_and_description')
  assert.equal(filled.liveAt, '2026-08-10T00:00:00.000Z')
})

test('#991 · a legacy mirror of a client nobody proposed folds into the client row', () => {
  const rows = assembleDirectoryRows([], [clientOnly('baires', 'Baires Bistrô')], [portal('mirror-baires', 'baires', 'Baires Bistrô')])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].submissionId, null)
  assert.equal(rows[0].clientId, 'baires')
  assert.equal(rows[0].liveAt, '2026-08-21T12:00:00.000Z')
})

test('#991 · a portal submission without a client yet keeps its own row, as before', () => {
  const inReview = portal('new-place', null, 'Quiosque Novo', { state: 'in_validation', liveAt: null }, false)
  const rows = assembleDirectoryRows([proposal('ancho', 'Ancho&Faca')], [], [inReview])
  assert.equal(rows.length, 2)
  assert.ok(rows.some((candidate) => candidate.submissionId === 'new-place' && candidate.origin === 'portal'))
})

test('#991 · a client that came only through the portal is still its portal row (#812, #906)', () => {
  const native = portal('reserve-on', 'reserve', 'Reserve ON', { attractionId: 'poi-reserve' }, false)
  const rows = assembleDirectoryRows([], [clientOnly('reserve', 'Reserve ON')], [native])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].origin, 'portal')
  // The board's `Publicado` publishes through it.
  assert.equal(rows[0].attractionId, 'poi-reserve')
})

test('#991 · two portal places of one portal client stay two cards, with two keys', () => {
  const rows = assembleDirectoryRows(
    [],
    [clientOnly('dupla', 'Dupla')],
    [portal('place-a', 'dupla', 'Dupla A', {}, false), portal('place-b', 'dupla', 'Dupla B', {}, false)]
  )
  assert.equal(rows.length, 2)
  assert.equal(new Set(rows.map(rowKey)).size, 2)
})

test('#991 · rowKey never repeats between a proposal row, a portal row and a client row of one client', () => {
  const same = 'client-1'
  const keys = [
    rowKey(proposal(same, 'A')),
    rowKey(portal('sub-1', same, 'A').row),
    rowKey(clientOnly(same, 'A')),
  ]
  assert.equal(new Set(keys).size, 3)
})

test('#991 · changing the search draws exactly the rows it counts, each once', () => {
  // The Cabo Frio shape of 2026-10-22: every old client from a proposal AND a mirror; Pão do Edu
  // is two clients (matriz and filial, two CNPJs), and stays two.
  const clients: [string, string][] = [
    ['ancho', 'Ancho&Faca Parrilla e Fogos'],
    ['office', 'Office café'],
    ['edu-matriz', 'Pão do Edu'],
    ['edu-filial', 'Pão do Edu Filial'],
  ]
  const rows = assembleDirectoryRows(
    clients.map(([id, name]) => proposal(id, name)),
    [],
    clients.map(([id, name]) => portal(`mirror-${id}`, id, name))
  )
  assert.equal(rows.length, clients.length)

  const expected: [string, string[]][] = [
    ['office', ['Office café']],
    ['ancho', ['Ancho&Faca Parrilla e Fogos']],
    ['pão do', ['Pão do Edu', 'Pão do Edu Filial']],
    ['office', ['Office café']],
  ]
  for (const [search, names] of expected) {
    const view = buildDirectoryView(rows, { ...EMPTY_FILTERS, search })
    assert.deepEqual(view.rows.map((r) => r.name).sort(), names.sort(), `search "${search}"`)
    assert.equal(new Set(view.rows.map(rowKey)).size, view.rows.length, `keys unique for "${search}"`)
  }
})

test('#991 · the directory hands its three sources to assembleDirectoryRows, and the record reads the portal', () => {
  const service = readFileSync(resolve(root, 'lib/services/partnership-service.ts'), 'utf8')
  const directory = service.slice(service.indexOf('export async function loadClientDirectory'))
  assert.match(directory, /rows: assembleDirectoryRows\(rows, clientRows, portalRows\)/)
  assert.doesNotMatch(directory.slice(0, directory.indexOf('async function loadNoPlaceSubmission')), /portalClaimed/)
  assert.match(service, /legacy_client_id\.eq\.\$\{clientId\}/)
  assert.match(service, /loadPortalAccount\(clientId, attractionIds\)/)
})
