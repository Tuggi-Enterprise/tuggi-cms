/**
 * Issuing the acceptance link (#872) — BR-B2B-056, items 2, 3 and 7. Contract
 * `docs/contracts/aceite-por-link.md` §2 and §5.
 *
 * `client_acceptance_link_issue` is a stand-in here: the suite proves what the Studio sends it
 * (only the sha256 of a token it drew), which plan it asks for, what each refusal becomes, and
 * that the link it hands the operator is the same address the e-mail composes.
 *
 * Run with: npm run test:api
 */

import { test, before, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  ACCEPTANCE_PATH,
  DEFAULT_PLACES_PORTAL_ORIGIN,
  acceptanceUrl,
  placesPortalOrigin,
} from '@/lib/partnerships/acceptance-link'

const CLIENT = '33333333-3333-4333-8333-333333333333'

interface World {
  client: Record<string, unknown> | null
  tier: 'free' | 'paid' | null
  rpcError: { code: string; details?: string } | null
  rpcArgs: Record<string, unknown> | null
  emails: Record<string, unknown>[]
}
let w: World

function reset(over: Partial<World> = {}) {
  w = {
    client: { name: 'Bar do Zé', legal_representative_name: 'Ana', monthly_fee_cents: 0, is_courtesy: false, courtesy_reason: null },
    tier: null,
    rpcError: null,
    rpcArgs: null,
    emails: [],
    ...over,
  }
}

const service = {
  schema: () => ({
    from: () => {
      const q: any = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({ data: w.client, error: null }),
      }
      return q
    },
    rpc: async (_name: string, args: Record<string, unknown>) => {
      w.rpcArgs = args
      return w.rpcError
        ? { data: null, error: w.rpcError }
        : { data: [{ link_id: 'l1', expires_at: '2026-11-05T15:00:00Z', sent_to_email: 'dono@bardoze.com.br' }], error: null }
    },
  }),
}

let mod: typeof import('@/lib/services/acceptance-link-service')

before(async () => {
  mock.module('@/lib/core/supabase-client', { namedExports: { getSupabaseService: () => service } })
  mock.module('@/lib/services/partner-contract-tier', {
    namedExports: { loadLiveContractTiers: async () => new Map(w.tier ? [[CLIENT, w.tier]] : []) },
  })
  mock.module('@/lib/services/transactional-email', {
    namedExports: {
      sendTransactionalEmail: async (input: Record<string, unknown>) => {
        w.emails.push(input)
        return true
      },
    },
  })
  mod = await import('@/lib/services/acceptance-link-service')
})

beforeEach(() => reset())

test('BR-B2B-056 item 7: the database receives only the sha256 of a token the Studio drew', async () => {
  const out = await mod.issueAcceptanceLink(CLIENT, 'cms-op', false)
  assert.equal(out.ok, true)
  if (!out.ok) return
  const token = out.url.slice(`${DEFAULT_PLACES_PORTAL_ORIGIN}${ACCEPTANCE_PATH}`.length)
  assert.match(token, /^[A-Za-z0-9_-]{43}$/, '256 bits in base64url')
  assert.equal(w.rpcArgs?.p_token_sha256, createHash('sha256').update(token, 'utf8').digest('hex'))
  assert.ok(!JSON.stringify(w.rpcArgs).includes(token), 'the raw token reached the database')
  assert.deepEqual(
    { client: w.rpcArgs?.p_client_id, plan: w.rpcArgs?.p_plan_choice, by: w.rpcArgs?.p_issued_by },
    { client: CLIENT, plan: 'map_only', by: 'cms-op' }
  )
  assert.equal(out.sentTo, 'dono@bardoze.com.br')
  assert.equal(out.emailSent, null, 'copying sends nothing')
  assert.equal(w.emails.length, 0)
})

test('BR-B2B-056: sending hands the raw token to the e-mail, and to nobody else', async () => {
  const out = await mod.issueAcceptanceLink(CLIENT, 'cms-op', true)
  assert.equal(out.ok && out.emailSent, true)
  assert.equal(w.emails.length, 1)
  const email = w.emails[0] as { type: string; to: string; data: Record<string, unknown> }
  assert.equal(email.type, 'partner_acceptance_link')
  assert.equal(email.to, 'dono@bardoze.com.br')
  assert.ok(out.ok && out.url.endsWith(String(email.data.token)))
  assert.equal(email.data.trade_name, 'Bar do Zé')
  assert.equal(email.data.expires_at, '2026-11-05T15:00:00Z')
  assert.equal('url' in email.data, false, 'the e-mail composes its own href')
})

test('BR-B2B-056 item 3: the plan is the operator\'s — a fee or courtesy is the paid plan, and the live contract outranks the record', async () => {
  reset({ client: { name: 'X', monthly_fee_cents: 14900, is_courtesy: false, courtesy_reason: null } })
  await mod.issueAcceptanceLink(CLIENT, 'cms-op', false)
  assert.equal(w.rpcArgs?.p_plan_choice, 'map_and_description', 'a fee on the record is the paid plan (and TGP32 today)')

  reset({ client: { name: 'X', monthly_fee_cents: 14900, is_courtesy: false, courtesy_reason: null }, tier: 'free' })
  await mod.issueAcceptanceLink(CLIENT, 'cms-op', false)
  assert.equal(w.rpcArgs?.p_plan_choice, 'map_only', 'the legacy free contract decides')

  assert.equal(mod.planOfLink('paid'), 'map_and_description')
  assert.equal(mod.planOfLink('courtesy'), 'map_and_description')
  assert.equal(mod.planOfLink('free'), 'map_only')
  assert.equal(mod.planOfLink('undeclared'), 'map_only', 'nobody priced it: no link charges it')
})

test('contract §5: each refusal of the database becomes the screen\'s own code', async () => {
  assert.deepEqual(mod.issueErrorOf('TGP22', 'tax_id'), { httpStatus: 422, error: 'record_incomplete', field: 'tax_id' })
  assert.deepEqual(mod.issueErrorOf('TGP22', 'token'), { httpStatus: 503, error: 'issue_failed' })
  assert.deepEqual(mod.issueErrorOf('TGP30', undefined), { httpStatus: 404, error: 'client_not_found' })
  assert.deepEqual(mod.issueErrorOf('TGP31', undefined), { httpStatus: 409, error: 'already_accepted' })
  assert.deepEqual(mod.issueErrorOf('TGP32', undefined), { httpStatus: 409, error: 'paid_plan_unavailable' })
  assert.deepEqual(mod.issueErrorOf('TGP33', 'influencer'), { httpStatus: 409, error: 'no_terms' })
  assert.deepEqual(mod.issueErrorOf('XX000', undefined), { httpStatus: 503, error: 'issue_failed' })

  reset({ rpcError: { code: 'TGP22', details: 'address' } })
  const out = await mod.issueAcceptanceLink(CLIENT, 'cms-op', true)
  assert.deepEqual(out, { ok: false, httpStatus: 422, error: 'record_incomplete', field: 'address' })
  assert.equal(w.emails.length, 0, 'a link that was not issued is not sent')
})

test('#872: the link the operator copies is the address the e-mail composes (twin of the Edge Function)', () => {
  assert.equal(acceptanceUrl(placesPortalOrigin(undefined), 'T'), 'https://partner.tuggi.app/aceite/T')
  assert.equal(placesPortalOrigin('https://partner.staging.tuggi.app/'), 'https://partner.staging.tuggi.app')
  assert.equal(placesPortalOrigin('javascript:alert(1)'), DEFAULT_PLACES_PORTAL_ORIGIN)

  const ef = readFileSync(resolve(__dirname, '../../supabase/functions/send-transactional/index.ts'), 'utf8')
  assert.ok(ef.includes(`const DEFAULT_PLACES_PORTAL_ORIGIN = '${DEFAULT_PLACES_PORTAL_ORIGIN}';`))
  assert.ok(ef.includes(`const ACCEPTANCE_PATH = '${ACCEPTANCE_PATH}';`))
})
