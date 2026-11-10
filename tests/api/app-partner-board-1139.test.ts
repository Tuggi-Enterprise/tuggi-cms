/**
 * #1139 — the approved creator, influencer and driver of the app request on the partners board.
 * BR-B2B-066 items 1 and 2, contract `docs/contracts/parceiro-sem-local.md` §4.2.
 *
 * Their record is born at the approval with the acceptance of the request, no place and (the
 * creator) no slug. Before this card the board read them as a place partner: `Aguardando aceite`
 * forever, a `Criar local` button, and the gate line asking for an acceptance they already gave.
 *
 * Mutations that turn this suite red:
 *  · dropping the `appPartnerWithoutPlace` branch of `derivePipelineState`;
 *  · dropping the guard of `planTransition` (the card offers `create_place` again);
 *  · counting a pending record (the old app signup) as approved;
 *  · letting a creator WITH a place out of the place path;
 *  · clearing the gate for a record approved by hand, without the `commission_starts_at` mark that
 *    only the approval of the request writes (security review of #1139: the missing acceptance
 *    of BR-B2B-057 item 3 vanished from the board);
 *  · the board not reading the mark (`cms_client_directory` does not return it), or guessing when
 *    the read fails.
 *
 * Run with: npm run test:api
 */

import { before, mock, test } from 'node:test'
import assert from 'node:assert/strict'

import { columnOf, nextAct, planTransition } from '@/lib/clients/board-transitions'
import { derivePipelineState } from '@/lib/partnerships/pipeline'
import { isApprovedAppPartnerWithoutPlace } from '@/lib/partnerships/partner-kind'
import type { ClientDirectoryRow } from '@/lib/services/partnership-service'

const MARK = '2026-11-09T12:00:00.000Z'

const PLACES = { total: 0, published: 0, blocking: 0, silencing: 0, improving: 0, allReady: false }

function row(overrides: Partial<ClientDirectoryRow> = {}): ClientDirectoryRow {
  return {
    submissionId: null,
    clientId: 'client-1',
    state: 'referral_only',
    target: { kind: 'client', clientId: 'client-1', tab: 'partnership' },
    name: 'Ana Souza',
    taxId: null,
    city: null,
    region: null,
    country: null,
    clientType: 'creator',
    status: 'approved',
    contract: 'none',
    fee: { monthlyFeeCents: null, isCourtesy: false, courtesyReason: null },
    contractTier: null,
    planChoice: null,
    duplicateCount: 0,
    since: '2026-11-09T12:00:00.000Z',
    places: { ...PLACES },
    triage: { approvedAt: null, places: [] },
    discardReason: null,
    gateMissing: [],
    partnerKind: 'referral_only',
    hasHeldPhoto: false,
    hasHeldStory: false,
    ...overrides,
  }
}

function derive(appPartnerWithoutPlace: boolean, gateMissing: ('acceptance' | 'slug' | 'partner_code')[] = []) {
  return derivePipelineState({
    proposalStatus: 'promoted',
    conference: { documentsSeen: [] } as never,
    clientId: 'client-1',
    gateMissing,
    placeCount: 0,
    publishedPlaceCount: 0,
    appPartnerWithoutPlace,
  })
}

test('BR-B2B-066 item 1: creator, influencer and driver approved by the request without a place are app partners', () => {
  for (const clientType of ['creator', 'influencer', 'driver']) {
    assert.equal(isApprovedAppPartnerWithoutPlace({ clientType, status: 'approved', commissionStartsAt: MARK }, 0), true, clientType)
  }
  assert.equal(isApprovedAppPartnerWithoutPlace({ clientType: 'venue', status: 'approved', commissionStartsAt: MARK }, 0), false)
  assert.equal(isApprovedAppPartnerWithoutPlace({ clientType: 'tour_guide', status: 'approved', commissionStartsAt: MARK }, 0), false)
})

test('BR-B2B-057 item 3: approved by hand, without the mark of the request, keeps the gate and its warning', () => {
  for (const clientType of ['creator', 'influencer', 'driver']) {
    assert.equal(isApprovedAppPartnerWithoutPlace({ clientType, status: 'approved', commissionStartsAt: null }, 0), false, clientType)
  }
  const hand = row({ clientType: 'influencer', state: 'awaiting_acceptance', partnerKind: undefined, gateMissing: ['acceptance'] })
  assert.equal(derive(false, ['acceptance']), 'awaiting_acceptance')
  assert.deepEqual(planTransition(hand, 'awaiting_acceptance', 'curation'), {
    kind: 'blocked',
    reason: 'gate_missing',
    missing: ['acceptance'],
    act: 'create_place',
  })
})

test('a pending record (the old app signup) keeps the ordinary path, where approving is work', () => {
  assert.equal(isApprovedAppPartnerWithoutPlace({ clientType: 'driver', status: 'pending', commissionStartsAt: null }, 0), false)
})

test('a creator with a place stays on the place path', () => {
  assert.equal(isApprovedAppPartnerWithoutPlace({ clientType: 'creator', status: 'approved', commissionStartsAt: MARK }, 1), false)
})

test('BR-B2B-066 item 2: the approved app partner lands in Publicado, not in Aguardando aceite', () => {
  assert.equal(derive(false), 'awaiting_acceptance', 'the place reading, as before #1139')
  const state = derive(true, ['acceptance', 'slug'])
  assert.equal(state, 'referral_only', 'the gate of BR-B2B-057 does not hold the app partner')
  assert.equal(columnOf(state), 'published')
})

test('BR-B2B-066 item 2: the no_place gate and create_place never apply to the app partner', () => {
  const app = row({ state: 'awaiting_acceptance' })
  for (const to of ['curation', 'published'] as const) {
    const plan = planTransition(app, 'awaiting_acceptance', to)
    assert.deepEqual(plan, { kind: 'blocked', reason: 'not_closable' }, to)
  }
  const fromCuration = planTransition(row({ state: 'place_in_curation' }), 'curation', 'published')
  assert.notDeepEqual(fromCuration, { kind: 'blocked', reason: 'no_place' })
  assert.equal(nextAct(app, 'awaiting_acceptance'), null, 'no Criar local button on the card')
})

test('the same row without the app partner kind still offers create_place (the place path is intact)', () => {
  const place = row({ clientType: 'venue', state: 'awaiting_acceptance', partnerKind: undefined })
  assert.deepEqual(planTransition(place, 'awaiting_acceptance', 'curation'), { kind: 'act', act: 'create_place' })
})

// ── The board reads the mark ────────────────────────────────────────────────────────────────

const BY_REQUEST = '55555555-5555-4555-8555-555555555555'
const BY_HAND = '66666666-6666-4666-8666-666666666666'

const fake = {
  markReads: [] as [string, unknown][][],
  markError: null as { code: string } | null,
}

function fakeTable(name: string) {
  const filters: [string, unknown][] = []
  const q = {
    select: () => q,
    eq: (column: string, value: unknown) => (filters.push([column, value]), q),
    in: (column: string, value: unknown) => (filters.push([column, value]), q),
    order: () => q,
    limit: () => q,
    then: (resolve: (value: unknown) => unknown) => {
      if (name !== 'clients') return resolve({ data: [], error: null })
      fake.markReads.push(filters)
      return resolve(
        fake.markError
          ? { data: null, error: fake.markError }
          : {
              data: [
                { id: BY_REQUEST, commission_starts_at: MARK },
                { id: BY_HAND, commission_starts_at: null },
              ],
              error: null,
            }
      )
    },
  }
  return q
}

const fakeService = {
  schema: () => ({
    rpc: async (name: string) => {
      if (name !== 'cms_client_directory') return { data: [], error: null }
      // The directory answers the client without `commission_starts_at`, as the RPC does.
      const client = (id: string, name: string) => ({ id, name, client_type: 'influencer', status: 'approved', country: 'Brazil' })
      return {
        data: {
          submissions: [],
          clients: [client(BY_REQUEST, 'Viaja Rio'), client(BY_HAND, 'Cadastro à mão')],
          contracts: [],
          conferences: [],
          refusals: [],
          truncated: false,
        },
        error: null,
      }
    },
    from: (name: string) => fakeTable(name),
  }),
}

let service: typeof import('@/lib/services/partnership-service')

before(async () => {
  mock.module('@/lib/core/supabase-client', { namedExports: { getSupabaseService: () => fakeService } })
  service = await import('@/lib/services/partnership-service')
})

test('BR-B2B-057 item 3 on the board: only the record approved by the request leaves the gate', async () => {
  fake.markReads = []
  fake.markError = null
  const { rows } = await service.loadClientDirectory({} as never)
  const byId = new Map(rows.map((r) => [r.clientId, r]))

  const request = byId.get(BY_REQUEST)
  assert.equal(request?.state, 'referral_only')
  assert.deepEqual(request?.gateMissing, [])
  assert.equal(request?.partnerKind, 'referral_only')

  const hand = byId.get(BY_HAND)
  assert.equal(hand?.state, 'awaiting_acceptance', 'the hand approval still owes the acceptance')
  assert.ok(hand?.gateMissing.includes('acceptance'))
  assert.equal(hand?.partnerKind, undefined)

  assert.deepEqual(fake.markReads, [[['client_type', ['creator', 'influencer', 'driver', 'tour_guide']], ['status', 'approved']]], 'one read, by type, never by ids')
})

test('a failed read of the mark fails the board instead of guessing a path', async () => {
  fake.markError = { code: '42501' }
  await assert.rejects(service.loadClientDirectory({} as never), /commission mark read failed/)
  fake.markError = null
})
