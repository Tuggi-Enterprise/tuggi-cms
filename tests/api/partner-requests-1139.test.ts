/**
 * #1139 — the queue of requests of partners without a place from the app, in the CMS.
 * BR-B2B-066 items 2, 5.a and 5.b, BR-USUARIO-052 item 4.d, BR-MONETIZACAO-039 item 6.c.
 * Contract `docs/contracts/parceiro-sem-local.md` §4.
 *
 * The routes run for real; the gate, the service client and the audit are stand-ins. The RPCs
 * answer what the contract says they answer, and the suite pins what the CMS sends to them and
 * what it makes of the answer.
 *
 * Mutations that turn this suite red:
 *  · approving with a rate declared in the CMS (the number lives only in the database function);
 *  · refusing a repeated document before the curator sees it (the row must arrive marked);
 *  · calling the refusal RPC without a reason, or logging the reason;
 *  · answering `document_in_use` as a success, or as a 503;
 *  · the queue route opened to a non-admin role or cached.
 *
 * Run with: npm run test:api
 */

import { before, beforeEach, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import type { NextRequest } from 'next/server'

import { RPC_ROWS } from '../ct/partner-requests-fixtures'

const ROOT = resolve(import.meta.dirname, '../..')
const ACTOR = '99999999-9999-4999-8999-999999999999'
const CLIENT = '33333333-3333-4333-8333-333333333333'

interface RpcCall {
  schema: string
  fn: string
  args: unknown
}

let calls: RpcCall[] = []
let answers: Record<string, { data: unknown; error: { code: string; message?: string } | null }> = {}
let audits: Record<string, unknown>[] = []
let policies: unknown[] = []

const fakeService = {
  schema: (schema: string) => ({
    rpc: async (fn: string, args?: unknown) => {
      calls.push({ schema, fn, args })
      return answers[fn] ?? { data: null, error: { code: 'XX000' } }
    },
  }),
}

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }, auth: unknown) => Promise<Response>
let listGET: Handler
let approvePOST: Handler
let refusePOST: Handler
let queue: typeof import('@/lib/partner-requests/queue')
let PartnerRequestsQueue: typeof import('@/components/admin/clients/board/PartnerRequests')['PartnerRequestsQueue']

before(async () => {
  mock.module('@/lib/auth-middleware', {
    namedExports: {
      withAuth: (policy: unknown, handler: unknown) => {
        policies.push(policy)
        return handler
      },
      withRateLimit: () => (handler: unknown) => handler,
    },
  })
  mock.module('@/lib/core/supabase-client', {
    namedExports: {
      getSupabaseService: () => fakeService,
      getSupabase: () => fakeService,
      getSupabaseRouteHandler: () => fakeService,
      getSupabaseClient: () => ({}),
    },
  })
  mock.module('@/lib/services/audit-service', {
    namedExports: {
      logAuditEvent: async (input: Record<string, unknown>) => {
        audits.push(input)
        return true
      },
    },
  })
  ;({ GET: listGET } = (await import('@/app/api/admin/partner-requests/route')) as unknown as { GET: Handler })
  ;({ POST: approvePOST } = (await import('@/app/api/admin/partner-requests/[requestId]/approve/route')) as unknown as {
    POST: Handler
  })
  ;({ POST: refusePOST } = (await import('@/app/api/admin/partner-requests/[requestId]/refuse/route')) as unknown as {
    POST: Handler
  })
  queue = await import('@/lib/partner-requests/queue')
  ;({ PartnerRequestsQueue } = await import('@/components/admin/clients/board/PartnerRequests'))
})

beforeEach(() => {
  calls = []
  answers = {}
  audits = []
})

const AUTH = { user: { id: ACTOR, email: 'curadoria@tuggi.app' }, cmsUser: { role: 'admin' } }

function post(body: unknown): NextRequest {
  return new Request('http://cms.test/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest
}

const params = (requestId: string) => ({ params: Promise.resolve({ requestId }) })

// ── The queue ───────────────────────────────────────────────────────────────────────────────

test('BR-B2B-066 5.b: the queue is admin only and never cached', () => {
  assert.ok(policies.length >= 3)
  for (const policy of policies) assert.deepEqual(policy, { roles: ['admin'] })
})

test('BR-USUARIO-052 4.d: the queue reads drive.list_partner_requests_as and keeps the document mark', async () => {
  answers.list_partner_requests_as = { data: RPC_ROWS, error: null }
  const res = await listGET(new Request('http://cms.test/api') as unknown as NextRequest, params(''), AUTH)
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('Cache-Control'), 'no-store')
  assert.deepEqual(calls, [{ schema: 'drive', fn: 'list_partner_requests_as', args: undefined }])

  const { requests } = (await res.json()) as { requests: { requestId: number; documentInUse: boolean; documentType: string; document: string }[] }
  assert.deepEqual(requests.map((r) => r.requestId), [12, 13, 14], 'oldest acceptance first, as the database ordered')
  assert.equal(requests[1].documentInUse, true, 'BR-B2B-066 5.a: the repeated document arrives marked, not refused')
  assert.equal(requests[0].documentType, 'cpf')
  assert.equal(requests[0].document, '52998224725')
})

test('a failed queue read is a 503, never an empty queue', async () => {
  answers.list_partner_requests_as = { data: null, error: { code: '42501' } }
  const res = await listGET(new Request('http://cms.test/api') as unknown as NextRequest, params(''), AUTH)
  assert.equal(res.status, 503)
})

test('a malformed row is dropped instead of drawn', () => {
  const rows = queue.parsePartnerRequestRows([{ ...RPC_ROWS[0], partner_type: 'tour_guide' }, { ...RPC_ROWS[0], document: '' }, RPC_ROWS[2]])
  assert.deepEqual(rows?.map((r) => r.requestId), [14])
  assert.equal(queue.parsePartnerRequestRows({}), null)
})

// ── Approve ─────────────────────────────────────────────────────────────────────────────────

test('BR-B2B-066 item 2: approving calls the RPC with the request and the curator, and the rate comes back from the database', async () => {
  answers.approve_partner_request_as = {
    data: { request_id: 12, status: 'approved', changed: true, reason: null, client_id: CLIENT, partner_code: 'ANA123', commission_rate: 0.2 },
    error: null,
  }
  const res = await approvePOST(post({}), params('12'), AUTH)
  assert.equal(res.status, 200)
  assert.deepEqual(calls, [{ schema: 'drive', fn: 'approve_partner_request_as', args: { p_request_id: 12, p_actor: ACTOR } }])
  const { outcome } = (await res.json()) as { outcome: Record<string, unknown> }
  assert.deepEqual(outcome, { kind: 'approved', clientId: CLIENT, partnerCode: 'ANA123', commissionRate: 0.2 })
  assert.equal(audits.length, 1)
  assert.equal(audits[0].action, 'APPROVE_PARTNER_REQUEST')
  assert.ok(!String(audits[0].description).includes('Ana'), 'no name in the trail')
})

test('BR-MONETIZACAO-039 6: the CNPJ request reads 30 % back from the database', async () => {
  answers.approve_partner_request_as = {
    data: { request_id: 13, status: 'approved', changed: true, reason: null, client_id: CLIENT, partner_code: 'VIA9', commission_rate: 0.3 },
    error: null,
  }
  const res = await approvePOST(post({}), params('13'), AUTH)
  const { outcome } = (await res.json()) as { outcome: { commissionRate: number } }
  assert.equal(outcome.commissionRate, 0.3)
})

test('BR-B2B-066 5.a: document_in_use is an answer (200), nothing is audited, and the request stays', async () => {
  answers.approve_partner_request_as = {
    data: { request_id: 13, status: 'in_review', changed: false, reason: 'document_in_use', client_id: null, partner_code: null, commission_rate: null },
    error: null,
  }
  const res = await approvePOST(post({}), params('13'), AUTH)
  assert.equal(res.status, 200)
  assert.deepEqual(((await res.json()) as { outcome: unknown }).outcome, { kind: 'document_in_use' })
  assert.equal(audits.length, 0)
})

test('an already decided request answers not_in_review; an unknown one is 404; a bad id never reaches the RPC', async () => {
  answers.approve_partner_request_as = {
    data: { request_id: 12, status: 'approved', changed: false, reason: 'not_in_review', client_id: CLIENT, partner_code: null, commission_rate: null },
    error: null,
  }
  assert.deepEqual(((await (await approvePOST(post({}), params('12'), AUTH)).json()) as { outcome: unknown }).outcome, {
    kind: 'not_in_review',
  })

  answers.approve_partner_request_as = { data: null, error: { code: 'P0002' } }
  assert.equal((await approvePOST(post({}), params('999'), AUTH)).status, 404)

  calls = []
  assert.equal((await approvePOST(post({}), params('12;drop'), AUTH)).status, 400)
  assert.equal((await approvePOST(post({}), params('0'), AUTH)).status, 400)
  assert.deepEqual(calls, [])
})

// ── Refuse ──────────────────────────────────────────────────────────────────────────────────

test('BR-USUARIO-052 4.d: refusing sends the trimmed reason and the curator; the reason is not logged', async () => {
  answers.refuse_partner_request_as = { data: { request_id: 14, status: 'refused', changed: true }, error: null }
  const reason = 'O CPF informado não é de quem pediu. Envie o seu.'
  const res = await refusePOST(post({ reason: `  ${reason}  ` }), params('14'), AUTH)
  assert.equal(res.status, 200)
  assert.deepEqual(calls, [
    { schema: 'drive', fn: 'refuse_partner_request_as', args: { p_request_id: 14, p_reason: reason, p_actor: ACTOR } },
  ])
  assert.deepEqual(((await res.json()) as { outcome: unknown }).outcome, { kind: 'refused' })
  assert.equal(audits[0].action, 'REFUSE_PARTNER_REQUEST')
  assert.ok(!String(audits[0].description).includes('CPF informado'))
})

test('a refusal without a reason, or over 500 characters, never reaches the RPC', async () => {
  for (const reason of ['', '   ', 'x'.repeat(501), 42]) {
    const res = await refusePOST(post({ reason }), params('14'), AUTH)
    assert.equal(res.status, 400)
    assert.equal(((await res.json()) as { error: string }).error, 'invalid_reason')
  }
  assert.deepEqual(calls, [])
})

test('the database bound (22023) is a 400 with the same sentence', async () => {
  answers.refuse_partner_request_as = { data: null, error: { code: '22023' } }
  const res = await refusePOST(post({ reason: 'ok' }), params('14'), AUTH)
  assert.equal(res.status, 400)
})

// ── The screen ──────────────────────────────────────────────────────────────────────────────

function render(props: Partial<Parameters<typeof PartnerRequestsQueue>[0]> = {}): string {
  const messages = JSON.parse(readFileSync(resolve(ROOT, 'messages/pt.json'), 'utf8'))
  return renderToStaticMarkup(
    // eslint-disable-next-line react/no-children-prop
    createElement(NextIntlClientProvider, {
      locale: 'pt',
      messages: { Clients: { board: { requests: messages.Clients.board.requests } } },
      timeZone: 'America/Sao_Paulo',
      children: createElement(PartnerRequestsQueue, {
        requests: queue.parsePartnerRequestRows(RPC_ROWS) ?? [],
        status: 'ready',
        busyId: null,
        notice: null,
        onApprove: () => {},
        onRefuse: () => {},
        ...props,
      }),
    })
  )
}

test('BR-B2B-066 5.a: the queue shows the type, the document and the mark of the repeated document', () => {
  const html = render()
  assert.ok(html.includes('Criador') && html.includes('Influencer') && html.includes('Motorista'))
  assert.ok(html.includes('CPF 529.982.247-25'))
  assert.ok(html.includes('CNPJ 11.222.333/0001-81'))
  assert.ok(html.includes('Viaja Rio Conteúdo LTDA'), 'with CNPJ the party is the company')
  assert.ok(html.includes('Representante: Bruno Lima, CPF 111.444.777-35'))
  assert.equal(html.split('Documento já está em outro parceiro').length - 1, 1, 'only the repeated one is marked')
  assert.ok(html.includes('Completa o cadastro que a conta já tem'))
  assert.ok(html.includes('https://wa.me/5524999998888'))
  assert.ok(html.includes('parceiros-sem-local-2026-11-v2'))
  assert.ok(html.includes('08/11/2026'))
  assert.equal(html.split('>Aprovar<').length - 1, 3)
})

test('an empty or failed queue says so', () => {
  assert.ok(render({ requests: [] }).includes('Nenhum pedido esperando decisão.'))
  assert.ok(render({ status: 'failed' }).includes('Não deu para ler os pedidos.'))
})

test('BR-MONETIZACAO-039 6.c: no file of the queue declares a commission rate', () => {
  for (const file of [
    'lib/partner-requests/queue.ts',
    'lib/services/partner-request-service.ts',
    'components/admin/clients/board/PartnerRequests.tsx',
    'app/api/admin/partner-requests/[requestId]/approve/route.ts',
  ]) {
    const source = readFileSync(resolve(ROOT, file), 'utf8')
    assert.ok(!/\b0\.[23]0*\b|DEFAULT_COMMISSION_RATE|\b[23]0 ?%/.test(source), file)
  }
})

test('the document formats keep any other shape as it came', () => {
  assert.equal(queue.formatDocument('cnpj', '12ABC34501DE35'), '12.ABC.345/01DE-35')
  assert.equal(queue.formatDocument('cpf', '123'), '123')
  assert.equal(queue.publishesHref('javascript:alert(1)'), null)
  assert.equal(queue.publishesHref('@ana.souza'), null)
  assert.equal(queue.whatsappHref('12'), null)
})
