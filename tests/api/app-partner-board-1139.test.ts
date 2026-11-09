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
 *  · letting a creator WITH a place out of the place path.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { columnOf, nextAct, planTransition } from '@/lib/clients/board-transitions'
import { derivePipelineState } from '@/lib/partnerships/pipeline'
import { isApprovedAppPartnerWithoutPlace } from '@/lib/partnerships/partner-kind'
import type { ClientDirectoryRow } from '@/lib/services/partnership-service'

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

test('BR-B2B-066 item 1: creator, influencer and driver approved without a place are app partners', () => {
  for (const clientType of ['creator', 'influencer', 'driver']) {
    assert.equal(isApprovedAppPartnerWithoutPlace({ clientType, status: 'approved' }, 0), true, clientType)
  }
  assert.equal(isApprovedAppPartnerWithoutPlace({ clientType: 'venue', status: 'approved' }, 0), false)
  assert.equal(isApprovedAppPartnerWithoutPlace({ clientType: 'tour_guide', status: 'approved' }, 0), false)
})

test('a pending record (the old app signup) keeps the ordinary path, where approving is work', () => {
  assert.equal(isApprovedAppPartnerWithoutPlace({ clientType: 'driver', status: 'pending' }, 0), false)
})

test('a creator with a place stays on the place path', () => {
  assert.equal(isApprovedAppPartnerWithoutPlace({ clientType: 'creator', status: 'approved' }, 1), false)
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
