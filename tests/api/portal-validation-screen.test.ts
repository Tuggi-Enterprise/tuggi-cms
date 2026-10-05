/**
 * #812 — the Portal Locais validation screen and the commission of the client it creates.
 *
 * Spec: `docs/design/spec-validacao-portal-locais-2026-10.md` §6. The pure rules (checklist,
 * CPF mask, offer warnings) run directly; the read model and the client insert run against a
 * stand-in of the service client, because migration 20261004120000 is not in this suite.
 *
 * Run with: npm run test:api
 */

import { before, test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  STORY_WORD_LIMIT,
  areasNamedIn,
  conferenceItems,
  countWords,
  maskCpf,
  offerLooksLikeTuggiOrMoney,
  storyOfferExcerpt,
} from '@/lib/partnerships/portal-review'
import { DEFAULT_COMMISSION_RATE } from '@/types/clients'

const ROOT = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8')

// ── the stand-in ────────────────────────────────────────────────────────────────────────────

type Rows = Record<string, unknown[]>
let rows: Rows = {}
let inserts: { table: string; payload: Record<string, unknown> }[] = []

function builder(table: string) {
  let single = false
  const self: Record<string, unknown> = {}
  for (const name of ['select', 'eq', 'neq', 'order', 'limit', 'or', 'update', 'in']) {
    self[name] = () => self
  }
  self.insert = (payload: Record<string, unknown>) => {
    inserts.push({ table, payload })
    rows[table] = [{ id: 'new-client-id', ...payload }]
    return self
  }
  const result = () => {
    const data = rows[table] ?? []
    return { data: single ? (data[0] ?? null) : data, error: null }
  }
  self.maybeSingle = () => {
    single = true
    return Promise.resolve(result())
  }
  self.single = self.maybeSingle
  self.then = (resolve: (value: unknown) => unknown) => resolve(result())
  return self
}

const fakeService = {
  schema: () => ({ from: (table: string) => builder(table) }),
  from: (table: string) => builder(table),
  auth: {
    admin: {
      getUserById: async () => ({ data: { user: { email: 'curadoria@tuggi.app' } }, error: null }),
    },
  },
}

let createPromotedClient: typeof import('@/lib/services/partner-proposal-admin-service').createPromotedClient
let getPortalSubmissionReview: typeof import('@/lib/services/portal-submission-review-service').getPortalSubmissionReview

before(async () => {
  mock.module('@/lib/core/supabase-client', {
    namedExports: {
      getSupabaseService: () => fakeService,
      getSupabase: () => fakeService,
      getSupabaseRouteHandler: () => fakeService,
      getSupabaseClient: () => ({}),
    },
  })
  ;({ createPromotedClient } = await import('@/lib/services/partner-proposal-admin-service'))
  ;({ getPortalSubmissionReview } = await import('@/lib/services/portal-submission-review-service'))
})

// ── BR-B2B-044: commission by plan ───────────────────────────────────────────────────────────

test('BR-B2B-044: a client born from the paid plan ("Com história") starts at DEFAULT_COMMISSION_RATE', async () => {
  rows = {}
  inserts = []
  const outcome = await createPromotedClient({ name: 'Cantina' } as never, { plan_choice: 'map_and_description' })
  assert.equal(outcome.ok, true)
  const insert = inserts.find((entry) => entry.table === 'clients')
  assert.ok(insert, 'the client is inserted')
  assert.equal(insert.payload.commission_rate, DEFAULT_COMMISSION_RATE)
  assert.equal(DEFAULT_COMMISSION_RATE, 0.1)
})

test('BR-B2B-044: a client born from the free plan ("No mapa") has no commission', async () => {
  rows = {}
  inserts = []
  await createPromotedClient({ name: 'Cantina' } as never, { plan_choice: 'map_only' })
  const insert = inserts.find((entry) => entry.table === 'clients')
  assert.ok(insert)
  assert.equal(insert.payload.commission_rate, 0)
  assert.equal(insert.payload.monthly_fee_cents, null)
})

test('BR-B2B-044: the portal approval creates the client through createPromotedClient, and a client that already exists is NOT rewritten', () => {
  const source = read('lib/services/portal-validation-service.ts')
  const body = source.slice(source.indexOf('async function resolveApprovalClient'))
  const linked = body.indexOf('if (linked) return')
  const existing = body.indexOf('if (existing) return')
  const created = body.indexOf('createPromotedClient(')
  assert.ok(linked > 0 && existing > linked && created > existing, 'linked → by CNPJ → created, in this order')
  // No write to partner.clients happens on the existing-client paths: the rate it has stays.
  assert.doesNotMatch(body.slice(0, created), /\.update\(|commission_rate/)
})

// ── the read model: what leaves the server ──────────────────────────────────────────────────

const SUBMISSION = {
  id: '00000000-0000-4000-8000-000000000812',
  status: 'in_review',
  answers: { trade_name: 'Bar do Zé', representative_cpf: '529.982.247-25', plan_choice: 'map_only' },
  tax_id_normalized: '12345678000195',
  attraction_id: null,
  submitted_at: '2026-10-03T12:00:00Z',
  status_changed_at: '2026-10-03T12:00:00Z',
}

const ACCEPTANCE = {
  id: 'acc-1',
  terms_version: '2026-10',
  terms_sha256: 'abcdef0123456789abcdef',
  accepted_at: '2026-10-03T11:59:00Z',
  auth_method: 'otp',
  email: 'ze@bardoze.com.br',
  signer_cpf: '52998224725',
  signer_name: 'Zé',
  signer_role: 'Sócio',
  legal_status_declared: true,
  activation_commitment: { sticker: true },
  marketing_consent: false,
  plan_choice: 'map_only',
  billing_period: null,
  voucher_code: null,
  voucher_discount_cents: null,
  total_cents: 0,
}

test('#812 spec §6.2: the review carries the CPF only masked — the whole number is not in the payload', async () => {
  rows = {
    place_submissions: [SUBMISSION],
    place_acceptances: [ACCEPTANCE],
    place_submission_transitions: [],
    place_submission_messages: [],
    place_subscriptions: [],
  }
  const outcome = await getPortalSubmissionReview(SUBMISSION.id)
  assert.equal(outcome.ok, true)
  if (!outcome.ok) return
  const payload = JSON.stringify(outcome.review)
  assert.doesNotMatch(payload, /52998224725|529\.982\.247-25/)
  assert.equal(outcome.review.acceptance?.signerCpfMasked, '•••.•••.247-••')
  assert.equal(outcome.review.answers.representative_cpf, '•••.•••.247-••')
  assert.equal(outcome.review.acceptance?.cpfDiffers, false)
})

test('#812 spec §6.10: a draft reads as "does not exist"', async () => {
  rows = { place_submissions: [{ ...SUBMISSION, status: 'draft' }] }
  const outcome = await getPortalSubmissionReview(SUBMISSION.id)
  assert.deepEqual(outcome, { ok: false, httpStatus: 404, error: 'not_found' })
})

test('#812 spec §6.12: IP, user agent and session of the acceptance are never selected', () => {
  const source = read('lib/services/portal-submission-review-service.ts')
  const columns = source.slice(source.indexOf('const ACCEPTANCE_COLUMNS'), source.indexOf('interface AcceptanceRow'))
  for (const column of ['ip', 'user_agent', 'session_id', 'session_ip']) {
    assert.doesNotMatch(columns, new RegExp(`\\b${column}\\b`), column)
  }
})

test('#812: revealing the CPF leaves an audit row', () => {
  const route = read('app/api/admin/partnerships/validation/[submissionId]/route.ts')
  const reveal = route.slice(route.indexOf("get('reveal') === 'cpf'"), route.indexOf('getPortalSubmissionReview(submissionId)'))
  assert.match(reveal, /REVEAL_PORTAL_CPF/)
})

// ── the pure rules of the screen ────────────────────────────────────────────────────────────

test('#812 spec §6.3: "Aprovar" needs 2 ticks on No mapa without offers or photos, and 5 on Com história with both', () => {
  assert.equal(conferenceItems({ planChoice: 'map_only', hasOffers: false, photoCount: 0 }).length, 2)
  assert.equal(conferenceItems({ planChoice: 'map_and_description', hasOffers: true, photoCount: 3 }).length, 5)
})

test('#812 spec §6.5 (BR-B2B-044 item 3): 41 words passes the limit; R$ or an offer repeated in the script warns', () => {
  const script = Array.from({ length: 41 }, (_, i) => `palavra${i}`).join(' ')
  assert.equal(countWords(script), 41)
  assert.ok(countWords(script) > STORY_WORD_LIMIT)
  assert.ok(storyOfferExcerpt('Prato feito por R$ 30 desde 1980.', []))
  assert.ok(storyOfferExcerpt('Aqui você ganha um chope na chegada.', ['um chope na chegada']))
  assert.equal(storyOfferExcerpt('Fundado em 1952 por pescadores da vila.', []), null)
})

test('#812 spec §6.6 (BR-B2B-053): "1 hora grátis no Tuggi" warns, "10% na conta" does not, "horário" is not "hora"', () => {
  assert.equal(offerLooksLikeTuggiOrMoney('1 hora grátis no Tuggi'), true)
  assert.equal(offerLooksLikeTuggiOrMoney('10% na conta'), false)
  assert.equal(offerLooksLikeTuggiOrMoney('Desconto em qualquer horário'), false)
})

test('#812: the CPF mask shows only the third group, and a malformed CPF is masked whole', () => {
  assert.equal(maskCpf('529.982.247-25'), '•••.•••.247-••')
  assert.equal(maskCpf('123'), '•••.•••.•••-••')
})

test('#812: the "alterado" badge reads the areas back from the "Ajustar:" opening of the request', () => {
  const labels = {
    company: 'Empresa',
    place: 'Endereço ou pino',
    facade: 'Fachada',
    story: 'História',
    offers: 'Ofertas',
    photos: 'Fotos',
  }
  assert.deepEqual(areasNamedIn('Ajustar: endereço ou pino, fachada.\nO pino caiu na rua.', labels), ['place', 'facade'])
  assert.deepEqual(areasNamedIn('O pino caiu na rua.', labels), [])
})
