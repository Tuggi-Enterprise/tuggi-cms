/**
 * THE PORTAL SUBMISSION IN `Publicado` SAYS WHAT WAS PAID AND SINCE WHEN. #908.
 *
 * Reserve ON went live on 2026-10-07 (#906) and its card read `—` and `Sem plano declarado`, with
 * an acceptance of Com história, 3 months, R$ 375,00 on file. The portal writes no fee on the
 * registration and no contract — the acceptance IS the instrument (BR-B2B-047, item 1) — so
 * `derivePartnerPlan` fell to the registration branch and answered `undeclared`; and the step line
 * had nothing but `nextSteps.published`, which is `—`.
 *
 * Mutations that turn this suite red:
 *  · dropping `portalAcceptance` from `derivePartnerPlan`, which brings back `Sem plano declarado`;
 *  · printing the period's total as `/mês`, which triples the partner's fee on screen (BR-B2B-045);
 *  · losing the live date, or taking the last `live` transition instead of the first;
 *  · leaving a paying portal client under the rail's `undeclared` facet.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createTranslator } from 'next-intl'

import ptMessages from '@/messages/pt.json'
import { planLine, whatIsMissing } from '@/components/admin/clients/board/row-text'
import { derivePartnerPlan, paymentStance, planFacetValue } from '@/lib/clients/partner-plan'
import type { ClientDirectoryRow } from '@/lib/services/partnership-service'

const root = resolve(import.meta.dirname, '../..')
const code = (path: string) => readFileSync(resolve(root, path), 'utf8')

const p = createTranslator({ locale: 'pt', messages: ptMessages, namespace: 'Partnerships' }) as never
const t = createTranslator({ locale: 'pt', messages: ptMessages, namespace: 'Clients.board' }) as never
// `Intl` separates `R$` from the value with a no-break space.
const plain = (text: string) => text.replace(/\u00a0/g, ' ')

function portalLive(overrides: Partial<ClientDirectoryRow> = {}): ClientDirectoryRow {
  return {
    submissionId: 'sub-reserve-on',
    clientId: 'client-reserve-on',
    state: 'published',
    target: { kind: 'client', clientId: 'client-reserve-on', tab: 'partnership' },
    name: 'Reserve ON',
    taxId: null,
    city: 'Búzios',
    region: 'Rio de Janeiro',
    country: 'Brazil',
    clientType: null,
    status: 'approved',
    contract: 'none',
    // What the portal leaves on the registration: nothing.
    fee: { monthlyFeeCents: null, isCourtesy: false, courtesyReason: null },
    contractTier: null,
    planChoice: 'map_and_description',
    duplicateCount: 0,
    since: '2026-10-07T15:00:00.000Z',
    places: { total: 0, published: 0, blocking: 0, silencing: 0 } as ClientDirectoryRow['places'],
    triage: { approvedAt: null, places: [] },
    discardReason: null,
    origin: 'portal',
    attractionId: 'poi-reserve-on',
    portalAcceptance: { planChoice: 'map_and_description', billingPeriod: 3, totalCents: 37500 },
    liveAt: '2026-10-07T15:00:00.000Z',
    gateMissing: [],
    ...overrides,
  }
}

test('#908 · BR-B2B-047 item 1, BR-B2B-045: a live portal card reads the plan of its acceptance', () => {
  const row = portalLive()
  const plan = derivePartnerPlan(row)
  assert.equal(plan.source, 'acceptance')
  assert.equal(plan.kind, 'paid')
  assert.equal(plan.feeCents, 37500)
  assert.equal(plan.periodMonths, 3)
  assert.equal(paymentStance(plan.kind), 'paying')
  // The period's total, never `/mês`.
  assert.equal(plain(planLine(row, t)), 'Com história, 3 meses, R$ 375,00')
  assert.notEqual(planLine(row, t), 'Sem plano declarado')
})

test('#908 · a live portal card says since when it is in the app, not `—`', () => {
  assert.equal(whatIsMissing(portalLive(), p), 'No ar desde 07/10/2026')
  // Without the transition the old line stays — nothing is invented.
  assert.equal(whatIsMissing(portalLive({ liveAt: null }), p), ptMessages.Partnerships.nextSteps.published)
})

test('#908 · the free tier of the portal is free, and a paying one leaves the `undeclared` facet', () => {
  const free = portalLive({ portalAcceptance: { planChoice: 'map_only', billingPeriod: null, totalCents: 0 } })
  assert.equal(derivePartnerPlan(free).kind, 'free')
  assert.equal(planFacetValue(free), null)
  assert.equal(planFacetValue(portalLive()), 'paid')
  // A one-month acceptance takes the singular.
  assert.equal(
    plain(planLine(portalLive({ portalAcceptance: { planChoice: 'map_and_description', billingPeriod: 1, totalCents: 14900 } }), t)),
    'Com história, 1 mês, R$ 149,00'
  )
})

test('#908 · the directory reads the acceptance and the FIRST live transition of each portal row', () => {
  const service = code('lib/services/partnership-service.ts')
  assert.match(service, /from\('place_acceptances'\)\s*\.select\('submission_id, plan_choice, billing_period, total_cents'\)/)
  assert.match(service, /from\('place_submission_transitions'\)[\s\S]{0,200}\.eq\('to_status', 'live'\)\s*\.order\('created_at', \{ ascending: true \}\)/)
  assert.match(service, /if \(!facts\.liveAt\.has\(row\.submission_id\)\)/)
})
