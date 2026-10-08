/**
 * As duas rotas de leitura do #902: `GET /api/finance/pending` e `GET /api/finance/subscriptions`.
 *
 * O que se prova aqui é o pior erro desta tela: LEITURA QUE FALHA NÃO PODE VIRAR LISTA VAZIA.
 * "Nada pendente" por erro afirma que o financeiro está em ordem quando ninguém conseguiu olhar;
 * receita zero por erro é o gêmeo disso. Falhou a view, ou qualquer das três leituras → 503.
 *
 * Regras: BR-B2B-044 (repasse, só admin age; `viewerIsAdmin` sobe do servidor), BR-B2B-046 (nota).
 *
 * Mutations that turn this suite red:
 *  · `/pending` devolver 200 com `items: []` quando a view dá erro;
 *  · `/subscriptions` devolver 200 com totais zerados quando UMA das três leituras dá erro;
 *  · `/pending` devolver a lista sem ordenar (a mais nova ou "atenção" antes de "urgente");
 *  · `viewerIsAdmin` verdadeiro para o editor;
 *  · rota sem `withAuth`/`requireModule` (401 e 403 deixam de valer);
 *  · `month` inválido derrubar a rota em vez de cair no mês corrente;
 *  · uma nota ERROR vencer a reemitida autorizada na linha da cobrança.
 *
 * Run with: npm run test:api
 */

import { test, before, mock } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dirname, '../..')

type Result = { data: unknown; error: { message: string } | null }

interface Scenario {
  user: { id: string; email: string } | null
  cmsUser: { id: string; email: string; role: string; is_active: boolean; enabled_modules: string[] } | null
  /** Resposta por tabela; o que não está aqui responde vazio e sem erro. */
  tables: Record<string, Result>
}

let scenario: Scenario
const ok = (data: unknown): Result => ({ data, error: null })
const fail = (): Result => ({ data: null, error: { message: 'relation does not exist' } })

function table(name: string): any {
  const chain: any = {}
  for (const method of ['select', 'neq', 'eq', 'order', 'limit', 'in']) chain[method] = () => chain
  chain.then = (resolveFn: (r: Result) => unknown, rejectFn?: (e: unknown) => unknown) =>
    Promise.resolve(scenario.tables[name] ?? ok([])).then(resolveFn, rejectFn)
  return chain
}

function fakeClient() {
  const cms: any = {
    select: () => cms,
    eq: () => cms,
    maybeSingle: async () => ({ data: scenario.cmsUser, error: null }),
    single: async () => ({ data: scenario.cmsUser, error: null }),
  }
  return {
    auth: {
      getUser: async () => ({
        data: { user: scenario.user },
        error: scenario.user ? null : { message: 'Auth session missing!' },
      }),
    },
    schema: () => ({ from: (name: string) => (name === 'cms_users' ? cms : table(name)) }),
  }
}

const ADMIN = { id: 'u1', email: 'admin@tuggi.app' }
const asRole = (role: string, enabled: string[] = ['finance']) => {
  scenario = {
    user: ADMIN,
    cmsUser: { id: 'cms-1', email: ADMIN.email, role, is_active: true, enabled_modules: enabled },
    tables: {},
  }
}

type Handler = (req: any, ctx?: any) => Promise<Response>
let pending: Handler
let subscriptions: Handler

const PENDING_URL = 'http://localhost/api/finance/pending'
const SUBS_URL = 'http://localhost/api/finance/subscriptions?month=2026-08'

before(async () => {
  mock.module('next/headers', {
    namedExports: { cookies: async () => ({ get: () => undefined, getAll: () => [] }) },
  })
  mock.module('@/lib/core/supabase-client', {
    namedExports: {
      getSupabaseRouteHandler: () => fakeClient(),
      getSupabaseService: () => fakeClient(),
      getSupabaseClient: () => fakeClient(),
    },
  })
  pending = (await import(resolve(REPO_ROOT, 'app/api/finance/pending/route.ts'))).GET
  subscriptions = (await import(resolve(REPO_ROOT, 'app/api/finance/subscriptions/route.ts'))).GET
})

const viewRow = (over: Record<string, unknown>) => ({
  kind: 'charge_overdue',
  severity: 'warning',
  object_type: 'charge',
  object_id: 'x',
  subscription_id: null,
  client_id: null,
  period_month: null,
  amount_cents: 10_000,
  reference_date: '2026-08-01',
  detail: null,
  ...over,
})

// ── /pending ───────────────────────────────────────────────────────────────────────────────────

test('#902: /pending sem sessão responde 401; sem o módulo, 403', async () => {
  scenario = { user: null, cmsUser: null, tables: {} }
  assert.equal((await pending(new Request(PENDING_URL))).status, 401)

  asRole('editor', [])
  assert.equal((await pending(new Request(PENDING_URL))).status, 403, 'editor sem o módulo finance')

  asRole('viewer')
  assert.equal((await pending(new Request(PENDING_URL))).status, 403, 'viewer fora do papel da rota')
})

test('BR-B2B-044 #902: /pending com a view falhando responde 503 pending_unavailable — nunca lista vazia', async () => {
  asRole('admin')
  scenario.tables.finance_pending_items = fail()

  const response = await pending(new Request(PENDING_URL))
  assert.equal(response.status, 503)
  const body = await response.json()
  assert.deepEqual(body, { error: 'pending_unavailable' })
  assert.equal('items' in body, false, 'sem `items`: a tela não pode ter o que mostrar como "Nada pendente"')
})

test('#902: /pending com a view vazia mas saudável responde 200 e items []', async () => {
  asRole('admin')
  scenario.tables.finance_pending_items = ok([])

  const response = await pending(new Request(PENDING_URL))
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.deepEqual(body.items, [])
  assert.ok(!Number.isNaN(Date.parse(body.checkedAt)), 'checkedAt é o "Conferido às" da tela')
})

test('BR-B2B-044 #902: /pending devolve ordenado (urgente, depois a mais antiga) e descarta tipo desconhecido', async () => {
  asRole('admin')
  scenario.tables.finance_pending_items = ok([
    viewRow({ object_id: 'novo-atencao', severity: 'warning', reference_date: '2026-09-01' }),
    viewRow({ object_id: 'velho-atencao', severity: 'warning', reference_date: '2026-07-01' }),
    viewRow({ object_id: 'urgente', severity: 'critical', reference_date: '2026-09-15', kind: 'payout_failed' }),
    viewRow({ object_id: 'tipo-novo', kind: 'tipo_que_a_tela_nao_conhece' }),
  ])

  const body = await (await pending(new Request(PENDING_URL))).json()
  assert.deepEqual(body.items.map((i: any) => i.objectId), ['urgente', 'velho-atencao', 'novo-atencao'])
})

test('BR-B2B-044 #902: viewerIsAdmin é do servidor — admin true, editor false', async () => {
  asRole('admin')
  scenario.tables.finance_pending_items = ok([])
  assert.equal((await (await pending(new Request(PENDING_URL))).json()).viewerIsAdmin, true)

  asRole('editor')
  scenario.tables.finance_pending_items = ok([])
  const response = await pending(new Request(PENDING_URL))
  assert.equal(response.status, 200, 'editor com o módulo lê a lista')
  assert.equal((await response.json()).viewerIsAdmin, false, 'e o repasse vira "Só admin"')
})

// ── /subscriptions ─────────────────────────────────────────────────────────────────────────────

const SUB_ROW = {
  id: 'sub-1',
  acceptance_id: 'acc-1',
  status: 'paid',
  payment_method: 'credit_card',
  paid_at: '2026-08-05T15:00:00Z',
  paid_through: '2026-09-05T15:00:00Z',
  renews: true,
  renewal_amount_cents: 10_000,
  canceled_at: null,
  expired_at: null,
  early_termination_fee_cents: null,
  early_termination_paid_at: null,
  place_acceptances: { client_id: 'c1', legal_name: 'Bistrô', email: 'a@b.c', billing_period: 1, place_submissions: null },
}
const CHARGE_ROW = {
  subscription_id: 'sub-1',
  provider_payment_id: 'pay_1',
  kind: 'first',
  status: 'paid',
  amount_cents: 10_000,
  due_date: '2026-08-05',
  paid_on: '2026-08-05',
  refunded_at: null,
}
const INVOICE_ROW = (over: Record<string, unknown>) => ({
  provider_invoice_id: 'inv',
  provider_payment_id: 'pay_1',
  status: 'AUTHORIZED',
  number: '77',
  pdf_url: null,
  xml_url: null,
  status_description: null,
  updated_at: '2026-08-06T00:00:00Z',
  ...over,
})

function healthyBilling() {
  scenario.tables.place_subscriptions = ok([SUB_ROW])
  scenario.tables.place_subscription_charges = ok([CHARGE_ROW])
  scenario.tables.place_invoices = ok([])
  scenario.tables.place_payouts = ok([])
}

for (const broken of ['place_subscriptions', 'place_subscription_charges', 'place_invoices', 'place_payouts']) {
  test(`#902: /subscriptions com a leitura de ${broken} falhando responde 503 — nunca receita zero`, async () => {
    asRole('admin')
    healthyBilling()
    scenario.tables[broken] = fail()

    const response = await subscriptions(new Request(SUBS_URL))
    assert.equal(response.status, 503)
    const body = await response.json()
    assert.equal(body.error, 'subscriptions_unavailable')
    assert.equal('totals' in body, false, 'sem totais: zero por erro afirma que ninguém pagou')
  })
}

test('#902: /subscriptions saudável devolve a assinatura do mês, a cobrança e os totais', async () => {
  asRole('admin')
  healthyBilling()
  scenario.tables.place_payouts = ok([{ amount_cents: 2_000, paid_at: '2026-08-07T12:00:00Z' }])

  const response = await subscriptions(new Request(SUBS_URL))
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.month, '2026-08')
  assert.equal(body.subscriptions.length, 1)
  assert.equal(body.totals.receivedCents, 10_000)
  assert.equal(body.totals.recurringCents, 10_000)
  assert.equal(body.totals.outflowCents, 2_000, 'repasse pago entra em Saídas')
})

test('BR-B2B-046 #902: /subscriptions põe na cobrança a nota que vale — a autorizada vence a ERROR', async () => {
  asRole('admin')
  healthyBilling()
  scenario.tables.place_invoices = ok([
    INVOICE_ROW({ provider_invoice_id: 'err', status: 'ERROR', updated_at: '2026-08-20T00:00:00Z' }),
    INVOICE_ROW({ provider_invoice_id: 'ok', status: 'AUTHORIZED' }),
  ])

  const body = await (await subscriptions(new Request(SUBS_URL))).json()
  assert.equal(body.subscriptions[0].charges[0].invoice.providerInvoiceId, 'ok')
})

test('BR-B2B-046 #902: cobrança sem nota sai com invoice null (a tela escreve "Sem nota")', async () => {
  asRole('admin')
  healthyBilling()
  const body = await (await subscriptions(new Request(SUBS_URL))).json()
  assert.equal(body.subscriptions[0].charges[0].invoice, null)
})

test('#902: /subscriptions com month inválido cai no mês corrente, sem erro', async () => {
  asRole('admin')
  healthyBilling()
  for (const bad of ['2026-13', 'agosto', '2026-8', '']) {
    const response = await subscriptions(new Request(`http://localhost/api/finance/subscriptions?month=${bad}`))
    assert.equal(response.status, 200, `month=${bad}`)
    assert.match((await response.json()).month, /^\d{4}-(0[1-9]|1[0-2])$/)
  }
})

test('#902: /subscriptions — a tabela mostra só quem estava no mês; os totais olham todas', async () => {
  asRole('admin')
  healthyBilling()
  // Esta assinatura saiu em julho e foi estornada em agosto: fora da tabela, dentro de Saídas.
  scenario.tables.place_subscriptions = ok([
    SUB_ROW,
    { ...SUB_ROW, id: 'sub-2', status: 'refunded', paid_at: '2026-06-01T12:00:00Z', canceled_at: '2026-07-10T12:00:00Z' },
  ])
  scenario.tables.place_subscription_charges = ok([
    CHARGE_ROW,
    { ...CHARGE_ROW, subscription_id: 'sub-2', provider_payment_id: 'pay_2', status: 'refunded', paid_on: '2026-06-01', refunded_at: '2026-08-12T12:00:00Z' },
  ])

  const body = await (await subscriptions(new Request(SUBS_URL))).json()
  assert.deepEqual(body.subscriptions.map((s: any) => s.id), ['sub-1'])
  assert.equal(body.totals.outflowCents, 10_000, 'o estorno de agosto de quem saiu em julho é saída de agosto')
})

test('#902: /subscriptions sem sessão responde 401', async () => {
  scenario = { user: null, cmsUser: null, tables: {} }
  assert.equal((await subscriptions(new Request(SUBS_URL))).status, 401)
})

test('#918 §3.8: /subscriptions shows the CMS contract row (no acceptance) with the client name, the POI of the mirror, and sums it; a portal checkout draft stays out', async () => {
  asRole('admin')
  healthyBilling()
  scenario.tables.place_subscriptions = ok([
    SUB_ROW,
    {
      ...SUB_ROW,
      id: 'sub-k',
      origin: 'cms_contract',
      acceptance_id: null,
      legacy_client_id: 'client-k',
      legacy_submission_id: 'mirror-k',
      status: 'paid',
      payment_method: 'bank_slip_or_pix',
      created_at: '2026-08-01T12:00:00Z',
      paid_at: '2026-08-20T12:00:00Z',
      place_acceptances: null,
      contract_submission: { attraction_id: 'poi-k' },
    },
    {
      ...SUB_ROW,
      id: 'sub-k2',
      origin: 'cms_contract',
      acceptance_id: null,
      legacy_client_id: 'client-k2',
      legacy_submission_id: 'mirror-k2',
      status: 'pending_payment',
      payment_method: 'bank_slip_or_pix',
      created_at: '2026-08-02T12:00:00Z',
      paid_at: null,
      renewal_amount_cents: 10_000,
      place_acceptances: null,
      contract_submission: { attraction_id: 'poi-k2' },
    },
    { ...SUB_ROW, id: 'sub-draft', status: 'pending_payment', paid_at: null },
  ])
  scenario.tables.place_subscription_charges = ok([
    CHARGE_ROW,
    { ...CHARGE_ROW, subscription_id: 'sub-k', provider_payment_id: 'pay_k', kind: 'first', amount_cents: 10_000, due_date: '2026-08-20', paid_on: '2026-08-20' },
  ])
  scenario.tables.attractions = ok([
    { id: 'poi-k', name: 'Pousada Antiga', partner_client_id: 'client-k', entity_kind: 'place' },
    { id: 'poi-k2', name: 'Bar Antigo', partner_client_id: 'client-k2', entity_kind: 'place' },
  ])
  scenario.tables.clients = ok([
    { id: 'client-k', name: 'Pousada Antiga Ltda', company_name: null },
    { id: 'client-k2', name: 'Bar Antigo ME', company_name: null },
  ])

  const body = await (await subscriptions(new Request(SUBS_URL))).json()
  const byId = new Map(body.subscriptions.map((s: any) => [s.id, s]))
  assert.deepEqual([...byId.keys()].sort(), ['sub-1', 'sub-k', 'sub-k2'], 'the portal draft stays out')
  const k: any = byId.get('sub-k')
  assert.equal(k.origin, 'cms_contract')
  assert.equal(k.acceptanceId, null)
  assert.equal(k.placeName, 'Pousada Antiga')
  assert.equal(k.clientName, 'Pousada Antiga Ltda')
  assert.equal(k.clientId, 'client-k')
  assert.equal(k.paymentMethod, 'bank_slip_or_pix')
  assert.equal((byId.get('sub-k2') as any).placeName, 'Bar Antigo')
  assert.equal(body.totals.receivedCents, 20_000, 'the portal charge and the CMS contract charge')
  assert.equal(body.totals.recurringCents, 30_000, 'portal + paid contract + contract running before its first payment')
})
