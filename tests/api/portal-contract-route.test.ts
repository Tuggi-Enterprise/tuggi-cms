/**
 * #919 — the partner portal's Contract section, CMS side: `GET|POST /api/portal/contract` and
 * `GET /api/portal/contract/document` (`docs/contracts/portal-contrato.md` §4).
 *
 * The routes and `portal-contract-service.ts` run for real; the database is a stand-in. The RPCs
 * (`core.portal_get_contract`, `core.portal_accept_contract`) answer what the migration
 * `20261008150000` documents, and the service-role half (`getContract`, `getAcceptance`,
 * `archiveSignedDocument`, the e-mail, the bucket) records what it was asked. What these tests pin:
 * nothing runs without the Worker's secret, the owner is the database's answer (BR-B2B-062 item 2),
 * a `contract_id` in the body is never read, the evidence reaches the RPC (BR-B2B-047 item 2), and a
 * retry sends no second e-mail (BR-B2B-056 item 6, idempotent by contract).
 *
 * Run with: npm run test:api
 */

import { before, beforeEach, test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { ACTIVE_TEMPLATE_VERSION } from '@/lib/contract/template'

const SECRET = 'places-secret-919'
const JWT = 'user.jwt.919'
const SUBMISSION = '91991991-0919-4919-8919-919919919919'
const CONTRACT = 'c0c0c0c0-0919-4919-8919-000000000001'
const OTHER_CONTRACT = 'c0c0c0c0-0919-4919-8919-0000000000ff'
const HASH = 'a'.repeat(64)

type RpcError = { code: string; message?: string; details?: string }
let rpcCalls: { jwt: string; fn: string; args: Record<string, unknown> }[] = []
let rpcAnswers: Record<string, { data?: unknown; error?: RpcError }> = {}
let serviceCalls: string[] = []
let emails: Record<string, unknown>[] = []
let acceptanceRow: Record<string, unknown> | null = null
let signedUrlArgs: unknown[] = []
let claimLost = false

const snapshot = {
  templateVersion: ACTIVE_TEMPLATE_VERSION,
  tier: 'paid',
  provider: { legalName: 'Tuggi Ltda', taxId: '00000000000191', addressLine: 'Rua A, 1', representativeName: 'Ana', representativeRole: 'Sócia' },
  partner: { clientId: 'cl-1', legalName: 'Bar do Zé Ltda', tradeName: 'Bar do Zé', taxId: '11222333000181', addressLine: 'Rua B, 2', representativeName: 'José', representativeRole: 'Sócio' },
  monthlyFeeCents: 10_000,
  isCourtesy: false,
  courtesyReason: null,
  paymentMethod: 'pix',
  commissionRate: 0,
  qrDeliveryDays: 5,
  generatedAt: '2026-09-01T12:00:00.000Z',
}
const contractRow = (id: string) => ({ id, client_id: 'cl-1', template_version: ACTIVE_TEMPLATE_VERSION, document_hash: HASH, snapshot, status: 'sent' })
const signedAcceptance = (over: Record<string, unknown> = {}) => ({
  id: 'acc-1',
  contract_id: CONTRACT,
  signer_name: 'José da Silva',
  signer_role: 'Proprietário ou sócio',
  accepted_at: '2026-10-08T15:00:00.000Z',
  recipient_email: 'dono@bardoze.com.br',
  signed_document_hash: 'b'.repeat(64),
  signed_document_path: `cl-1/${CONTRACT}-assinado-bbbbbbbbbbbbbbbb.pdf`,
  ...over,
})

let GET: (req: NextRequest) => Promise<Response>
let POST: (req: NextRequest) => Promise<Response>
let DOC: (req: NextRequest) => Promise<Response>

before(async () => {
  mock.module('@/lib/auth-middleware', {
    namedExports: {
      withPublicRoute: (_p: unknown, handler: unknown) => handler,
      withRateLimit: () => (handler: unknown) => handler,
    },
  })
  mock.module('@/lib/core/supabase-user-rpc', {
    namedExports: {
      userRpc: (jwt: string) => async (fn: string, args: Record<string, unknown>) => {
        rpcCalls.push({ jwt, fn, args })
        const a = rpcAnswers[fn] ?? { error: { code: 'PGRST202' } }
        return { data: a.data ?? null, error: a.error ?? null }
      },
    },
  })
  mock.module('@/lib/core/supabase-client', {
    namedExports: {
      getSupabaseService: () => ({
        storage: {
          from: (bucket: string) => ({
            createSignedUrl: async (path: string, seconds: number) => {
              signedUrlArgs = [bucket, path, seconds]
              return { data: { signedUrl: `https://storage.example/${path}?token=t` }, error: null }
            },
          }),
        },
      }),
    },
  })
  mock.module('@/lib/services/partner-contract-service', {
    namedExports: {
      PARTNER_CONTRACTS_BUCKET: 'partner-contracts',
      getContract: async (id: string) => {
        serviceCalls.push(`getContract:${id}`)
        return contractRow(id)
      },
      getAcceptance: async (id: string) => {
        serviceCalls.push(`getAcceptance:${id}`)
        return acceptanceRow
      },
      // The claim of the real function: only the first archive of an acceptance is `archivedNow`.
      archiveSignedDocument: async (_c: unknown, a: Record<string, unknown>) => {
        serviceCalls.push('archive')
        if (claimLost || acceptanceRow?.signed_document_path) return { acceptance: { ...a, signed_document_path: 'cl-1/winner.pdf' }, archivedNow: false }
        acceptanceRow = { ...a, signed_document_hash: 'c'.repeat(64), signed_document_path: 'cl-1/archived.pdf' }
        return { acceptance: acceptanceRow, archivedNow: true }
      },
      sendSignedCopy: async (input: Record<string, unknown>) => {
        emails.push(input)
        return undefined
      },
    },
  })
  ;({ GET, POST } = await import('@/app/api/portal/contract/route'))
  ;({ GET: DOC } = await import('@/app/api/portal/contract/document/route'))
})

beforeEach(() => {
  process.env.PLACES_CMS_SECRET = SECRET
  rpcCalls = []
  rpcAnswers = {}
  serviceCalls = []
  emails = []
  acceptanceRow = null
  signedUrlArgs = []
  claimLost = false
})

const headers = (over: Record<string, string> = {}) => ({ 'x-places-secret': SECRET, authorization: `Bearer ${JWT}`, ...over })
const getReq = (path: string, h: Record<string, string> = headers()) => new NextRequest(`http://cms.local${path}?submission_id=${SUBMISSION}`, { headers: h })
const postReq = (body: Record<string, unknown>, h: Record<string, string> = headers()) =>
  new NextRequest('http://cms.local/api/portal/contract', { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify(body) })
const acceptBody = (over: Record<string, unknown> = {}) => ({
  submission_id: SUBMISSION,
  document_hash: HASH,
  signer_name: 'José da Silva',
  signer_role: 'Proprietário ou sócio',
  signer_cpf: '529.982.247-25',
  client_ip: '203.0.113.9',
  user_agent: 'Mozilla/5.0 (iPhone)',
  ...over,
})
const contractState = (state: string, contractId: string | null = CONTRACT, kind: string | null = 'cms_contract') => ({
  data: [{ contract_kind: kind, state, accepted_at: null, version: ACTIVE_TEMPLATE_VERSION, contract_id: contractId, document_ready: false }],
})

test('#919: without the Worker secret nothing runs, not even the ownership RPC', async () => {
  for (const h of [headers({ 'x-places-secret': 'wrong' }) as Record<string, string>, { authorization: `Bearer ${JWT}` }, { 'x-places-secret': SECRET }]) {
    assert.equal((await GET(getReq('/api/portal/contract', h))).status, 401)
    assert.equal((await POST(postReq(acceptBody(), h))).status, 401)
    assert.equal((await DOC(getReq('/api/portal/contract/document', h))).status, 401)
  }
  delete process.env.PLACES_CMS_SECRET
  assert.equal((await GET(getReq('/api/portal/contract'))).status, 401, 'an unset secret must not read as "no secret needed"')
  assert.equal(rpcCalls.length, 0)
  assert.equal(serviceCalls.length, 0)
})

test('#919 BR-B2B-062: no portal session (42501) asks for a new login; nothing reaches service_role', async () => {
  rpcAnswers.portal_get_contract = { error: { code: '42501', details: 'session' } }
  const r = await POST(postReq(acceptBody()))
  assert.equal(r.status, 401)
  assert.deepEqual(await r.json(), { error: 'relogin' })
  assert.equal(serviceCalls.length, 0)
})

test('#919 BR-B2B-062: not the owner (TGP01) is 404, and the contract is never read with service_role', async () => {
  rpcAnswers.portal_get_contract = { error: { code: 'TGP01' } }
  for (const r of [await GET(getReq('/api/portal/contract')), await POST(postReq(acceptBody())), await DOC(getReq('/api/portal/contract/document'))]) {
    assert.equal(r.status, 404)
    assert.deepEqual(await r.json(), { error: 'not_found' })
  }
  assert.equal(serviceCalls.length, 0)
  assert.ok(rpcCalls.every((c) => c.jwt === JWT && c.fn === 'portal_get_contract'), 'the ownership proof runs with the user JWT')
})

test('#919 BR-B2B-056 item 6: state C reads the summary, the clauses and the hash of the contract the RPC named', async () => {
  rpcAnswers.portal_get_contract = contractState('pending')
  const r = await GET(getReq('/api/portal/contract'))
  assert.equal(r.status, 200)
  const body = await r.json()
  assert.equal(body.contract_id, CONTRACT)
  assert.equal(body.document_hash, HASH)
  assert.ok(body.summary.length > 0 && body.clauses.length > 0)
  assert.ok(body.clauses.every((c: { paragraphs: string[] }) => c.paragraphs.length > 0))
  assert.deepEqual(serviceCalls, [`getContract:${CONTRACT}`])
})

test('#919: the text is served only in state C', async () => {
  for (const state of ['accepted', 'preparing', 'none']) {
    rpcAnswers.portal_get_contract = contractState(state)
    const r = await GET(getReq('/api/portal/contract'))
    assert.equal(r.status, 409)
    assert.deepEqual(await r.json(), { error: 'status', detail: state })
  }
})

test('#919 BR-B2B-047: the acceptance goes to the RPC with the contract id the RPC returned, never the body one, and with the evidence', async () => {
  rpcAnswers.portal_get_contract = contractState('pending')
  rpcAnswers.portal_accept_contract = { data: [{ acceptance_id: 'acc-1', contract_id: CONTRACT, accepted_at: '2026-10-08T15:00:00.000Z', created: true }] }
  acceptanceRow = signedAcceptance({ signed_document_hash: null, signed_document_path: null })

  const r = await POST(postReq(acceptBody({ contract_id: OTHER_CONTRACT })))
  assert.equal(r.status, 200)
  assert.deepEqual(await r.json(), { accepted_at: '2026-10-08T15:00:00.000Z', created: true, document_ready: true })

  const accept = rpcCalls.find((c) => c.fn === 'portal_accept_contract')
  assert.ok(accept)
  assert.equal(accept.jwt, JWT)
  assert.deepEqual(accept.args, {
    p_submission_id: SUBMISSION,
    p_contract_id: CONTRACT,
    p_document_hash: HASH,
    p_signer_name: 'José da Silva',
    p_signer_role: 'Proprietário ou sócio',
    p_signer_cpf: '529.982.247-25',
    p_ip: '203.0.113.9',
    p_user_agent: 'Mozilla/5.0 (iPhone)',
  })
  assert.ok(!serviceCalls.some((c) => c.includes(OTHER_CONTRACT)), 'the body contract_id reached service_role')
  assert.ok(serviceCalls.includes('archive'), 'the signed PDF is archived by the CMS (marks the contract signed)')
  assert.equal(emails.length, 1)
  assert.deepEqual(emails[0].link, { portal: true })
  assert.equal(emails[0].to, 'dono@bardoze.com.br')
})

test('#919 BR-B2B-056 item 6: a retry (created = false) sends no second e-mail and does not archive again', async () => {
  rpcAnswers.portal_get_contract = contractState('accepted')
  rpcAnswers.portal_accept_contract = { data: [{ acceptance_id: 'acc-1', contract_id: CONTRACT, accepted_at: '2026-10-08T15:00:00.000Z', created: false }] }
  acceptanceRow = signedAcceptance()

  const r = await POST(postReq(acceptBody()))
  assert.equal(r.status, 200)
  assert.deepEqual(await r.json(), { accepted_at: '2026-10-08T15:00:00.000Z', created: false, document_ready: true })
  assert.equal(emails.length, 0)
  assert.ok(!serviceCalls.includes('archive'))
})

test('#919 BR-B2B-056 item 6: a retry after a failed archive completes it and sends the copy once', async () => {
  rpcAnswers.portal_get_contract = contractState('accepted')
  rpcAnswers.portal_accept_contract = { data: [{ acceptance_id: 'acc-1', contract_id: CONTRACT, accepted_at: '2026-10-08T15:00:00.000Z', created: false }] }
  acceptanceRow = signedAcceptance({ signed_document_hash: null, signed_document_path: null })
  const r = await POST(postReq(acceptBody()))
  assert.equal((await r.json()).document_ready, true)
  assert.ok(serviceCalls.includes('archive'))
  assert.equal(emails.length, 1, 'the request that archived sends the copy')
  await POST(postReq(acceptBody()))
  assert.equal(emails.length, 1, 'a second retry sends nothing')
})

test('#919 BR-B2B-056 item 6: accepted straight through the RPC, the first GET of the PDF archives and sends the copy once', async () => {
  rpcAnswers.portal_get_contract = contractState('accepted')
  acceptanceRow = signedAcceptance({ signed_document_hash: null, signed_document_path: null })

  assert.equal((await DOC(getReq('/api/portal/contract/document'))).status, 200)
  assert.equal(serviceCalls.filter((c) => c === 'archive').length, 1)
  assert.equal(emails.length, 1)
  assert.deepEqual(emails[0].link, { portal: true })
  assert.equal(emails[0].to, 'dono@bardoze.com.br')

  assert.equal((await DOC(getReq('/api/portal/contract/document'))).status, 200)
  assert.equal(serviceCalls.filter((c) => c === 'archive').length, 1, 'already archived: the second GET does not archive')
  assert.equal(emails.length, 1, 'no second copy')
})

test('#919: a lost archive claim (another request archived first) sends no copy', async () => {
  rpcAnswers.portal_get_contract = contractState('accepted')
  acceptanceRow = signedAcceptance({ signed_document_hash: null, signed_document_path: null })
  claimLost = true
  const r = await DOC(getReq('/api/portal/contract/document'))
  assert.equal(r.status, 200)
  assert.equal(signedUrlArgs[1], 'cl-1/winner.pdf')
  assert.equal(emails.length, 0)
})

test('#919: the RPC refusals keep their meaning (TGP09, TGP10, TGP22 with the field)', async () => {
  rpcAnswers.portal_get_contract = contractState('pending')
  const cases: [RpcError, number, Record<string, unknown>][] = [
    [{ code: 'TGP09', message: 'document_hash' }, 409, { error: 'terms_changed' }],
    [{ code: 'TGP10', message: 'not_pending' }, 409, { error: 'status', detail: 'not_pending' }],
    [{ code: 'TGP22', message: 'invalid', details: 'signer_role' }, 422, { error: 'invalid', field: 'signer_role' }],
    [{ code: '42501', details: 'email' }, 403, { error: 'support' }],
  ]
  for (const [error, status, body] of cases) {
    rpcAnswers.portal_accept_contract = { error }
    const r = await POST(postReq(acceptBody()))
    assert.equal(r.status, status, error.code)
    assert.deepEqual(await r.json(), body)
  }
  assert.equal(emails.length, 0)
  assert.ok(!serviceCalls.includes('archive'))
})

test('#919: a body out of shape is refused before any RPC', async () => {
  for (const body of [acceptBody({ submission_id: 'x' }), acceptBody({ signer_cpf: 52998224725 }), acceptBody({ document_hash: undefined })]) {
    assert.equal((await POST(postReq(body))).status, 400)
  }
  assert.equal(rpcCalls.length, 0)
})

test('#919: the signed PDF is a 60-second signed URL of the private bucket, only in state B', async () => {
  rpcAnswers.portal_get_contract = contractState('accepted')
  acceptanceRow = signedAcceptance()
  const r = await DOC(getReq('/api/portal/contract/document'))
  assert.equal(r.status, 200)
  assert.match((await r.json()).url, /^https:\/\/storage\.example\//)
  assert.deepEqual(signedUrlArgs, ['partner-contracts', acceptanceRow!.signed_document_path, 60])

  rpcAnswers.portal_get_contract = contractState('accepted', 'x', 'portal_terms')
  assert.equal((await DOC(getReq('/api/portal/contract/document'))).status, 409)
  rpcAnswers.portal_get_contract = contractState('pending')
  assert.equal((await DOC(getReq('/api/portal/contract/document'))).status, 409)
})

test('#919: state B with the archive missing completes it before signing the URL', async () => {
  rpcAnswers.portal_get_contract = contractState('accepted')
  acceptanceRow = signedAcceptance({ signed_document_hash: null, signed_document_path: null })
  const r = await DOC(getReq('/api/portal/contract/document'))
  assert.equal(r.status, 200)
  assert.ok(serviceCalls.includes('archive'))
  assert.equal(signedUrlArgs[1], 'cl-1/archived.pdf')
})
