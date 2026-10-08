/**
 * Legacy R$ 100/month partners registered as Asaas customers (`places-legacy-customers`).
 *
 * `_shared/places-legacy-customers.ts` and `_shared/asaas.ts` run under Node with Asaas mocked at the
 * `fetch` level, so the real client builds the real requests. Deno source, loaded through a path
 * built at run time: a static `.ts` import fails the repo's `tsc`.
 *
 * Run with: npm run test:api
 */

import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const FUNCTIONS = resolve(import.meta.dirname, '../../supabase/functions')

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let legacy: any
type Asaas = typeof import('../../supabase/functions/_shared/asaas')
let asaasMod: Asaas

before(async () => {
  legacy = await import(pathToFileURL(resolve(FUNCTIONS, '_shared/places-legacy-customers.ts')).href)
  asaasMod = await import(pathToFileURL(resolve(FUNCTIONS, '_shared/asaas.ts')).href)
})

type Call = { method: string; path: string; body: unknown }
type Route = (c: Call) => { status: number; body: unknown } | undefined

function fakeAsaas(routes: Route[]) {
  const calls: Call[] = []
  const fetch = async (url: string, init: RequestInit) => {
    const u = new URL(url)
    const call = { method: init.method ?? 'GET', path: u.pathname.replace(/^\/v3/, '') + u.search, body: init.body ? JSON.parse(String(init.body)) : undefined }
    calls.push(call)
    for (const r of routes) {
      const hit = r(call)
      if (hit) return new Response(JSON.stringify(hit.body), { status: hit.status })
    }
    if (call.method === 'GET' && call.path.startsWith('/customers?')) return new Response(JSON.stringify({ data: [] }), { status: 200 })
    return new Response(JSON.stringify({ errors: [{ code: 'not_found' }] }), { status: 404 })
  }
  return { client: asaasMod.asaasClient({ baseUrl: 'https://api.asaas.com/v3', apiKey: 'k', fetch }), calls }
}

const writes = (calls: Call[]) => calls.filter((c) => c.method !== 'GET')

const ROW = {
  id: 'aaaaaaaa-1111-4222-8333-444444444444',
  name: 'Pousada Mar',
  company_name: 'Pousada Mar Ltda',
  email: 'contato@pousadamar.com.br',
  billing_email: null,
  phone: '+55 (22) 99876-5432',
  tax_id: '12.345.678/0001-95',
  postal_code: '28950-000',
  address: 'Rua das Pedras, 359, Centro, Búzios',
}

const NOTIFICATIONS = {
  data: [
    { id: 'not_1', event: 'PAYMENT_CREATED', enabled: true, whatsappEnabledForCustomer: false },
    { id: 'not_2', event: 'PAYMENT_OVERDUE', enabled: true, whatsappEnabledForCustomer: true },
    { id: 'not_3', event: 'PAYMENT_UPDATED', enabled: false, whatsappEnabledForCustomer: false },
  ],
}

test('the customer is built from core.clients: company name, normalized CNPJ and mobile, number from the address', () => {
  const { customer, missing } = legacy.buildLegacyCustomer(ROW)
  assert.deepEqual(missing, [])
  assert.deepEqual(customer, {
    name: 'Pousada Mar Ltda',
    cpfCnpj: '12345678000195',
    email: 'contato@pousadamar.com.br',
    mobilePhone: '22998765432',
    postalCode: '28950000',
    addressNumber: '359',
    externalReference: ROW.id,
    notificationDisabled: false,
  })
  assert.equal(legacy.buildLegacyCustomer({ ...ROW, billing_email: 'fin@pousadamar.com.br' }).customer.email, 'fin@pousadamar.com.br')
})

test('the address number comes from the first part or the second part alone, never guessed', () => {
  assert.equal(legacy.extractAddressNumber('R. das Flores 359, Centro, Búzios'), '359')
  assert.equal(legacy.extractAddressNumber('Rua das Flores, 40, Centro'), '40')
  assert.equal(legacy.extractAddressNumber('Rua das Flores,169, Centro'), '169')
  assert.equal(legacy.extractAddressNumber('Rua das Flores 444, Loja 1, Centro'), '444')
  assert.equal(legacy.extractAddressNumber('Rua 7 de Setembro, nº 100'), '100')
  assert.equal(legacy.extractAddressNumber('Rua das Flores, Centro'), '')
  assert.equal(legacy.extractAddressNumber('Rua 7 de Setembro, Centro'), '')
  assert.equal(legacy.extractAddressNumber(null), '')
})

test('a landline is not a mobile: reported as missing, not sent', () => {
  const { customer, missing } = legacy.buildLegacyCustomer({ ...ROW, phone: '(22) 2623-1234', address: 'Rua das Flores, Centro' })
  assert.equal(customer.mobilePhone, '')
  assert.deepEqual(missing, ['mobilePhone', 'addressNumber'])
})

test('dry run: GETs only, payload masked, missing fields listed', async () => {
  const asaas = fakeAsaas([])
  const out = await legacy.registerLegacyCustomers(asaas.client, [ROW, { ...ROW, id: 'bbbbbbbb-1111-4222-8333-444444444444', address: 'Rua das Flores, Centro' }], true)
  assert.deepEqual(writes(asaas.calls), [])
  assert.equal(out[0].status, 'would_create')
  assert.equal(out[0].payload.cpfCnpj, '12**********95')
  assert.equal(out[0].payload.mobilePhone, '22*******32')
  assert.equal(out[0].payload.email, 'c******@pousadamar.com.br')
  assert.equal(out[0].payload.addressNumber, '359')
  assert.equal(out[0].missing, undefined)
  assert.deepEqual(out[1].missing, ['addressNumber'])
})

test('a body other than { dry_run: false } is a dry run', () => {
  assert.equal(legacy.isDryRun(null), true)
  assert.equal(legacy.isDryRun({}), true)
  assert.equal(legacy.isDryRun({ dry_run: 'false' }), true)
  assert.equal(legacy.isDryRun({ dry_run: false }), false)
})

test('real run, new customer: POST /customers with notifications on, then WhatsApp on the enabled notifications only', async () => {
  const asaas = fakeAsaas([
    (c) => (c.method === 'POST' && c.path === '/customers' ? { status: 200, body: { id: 'cus_1' } } : undefined),
    (c) => (c.method === 'GET' && c.path === '/customers/cus_1/notifications' ? { status: 200, body: NOTIFICATIONS } : undefined),
    (c) => (c.method === 'PUT' && c.path === '/notifications/not_1' ? { status: 200, body: { id: 'not_1' } } : undefined),
  ])
  const [out] = await legacy.registerLegacyCustomers(asaas.client, [ROW], false)
  assert.equal(out.status, 'created')
  assert.equal(out.asaas_id, 'cus_1')
  assert.deepEqual(out.whatsapp, { switched_on: ['PAYMENT_CREATED'], skipped: [] })
  const ws = writes(asaas.calls)
  assert.equal(ws.length, 2)
  const [post, put] = ws
  assert.equal((post.body as Record<string, unknown>).notificationDisabled, false)
  assert.equal((post.body as Record<string, unknown>).externalReference, ROW.id)
  assert.deepEqual(put.body, { whatsappEnabledForCustomer: true })
  // customer only: nothing that charges
  assert.ok(asaas.calls.every((c) => !/^\/(subscriptions|payments|pix|transfers)/.test(c.path)))
})

const REFUSED = { status: 400, body: { errors: [{ code: 'invalid_action', description: 'Falha na atualização da notificação not_9: Evento inválido para ativação da notificação por WhatsApp.' }] } }

test('WhatsApp goes one notification at a time: an event that refuses it is skipped and the others switch on', async () => {
  const asaas = fakeAsaas([
    (c) => (c.method === 'POST' && c.path === '/customers' ? { status: 200, body: { id: 'cus_1' } } : undefined),
    (c) =>
      c.method === 'GET' && c.path === '/customers/cus_1/notifications'
        ? { status: 200, body: { data: [
            { id: 'not_9', event: 'PAYMENT_UPDATED', enabled: true, whatsappEnabledForCustomer: false },
            { id: 'not_1', event: 'PAYMENT_CREATED', enabled: true, whatsappEnabledForCustomer: false },
            { id: 'not_2', event: 'PAYMENT_OVERDUE', enabled: true, whatsappEnabledForCustomer: false },
          ] } }
        : undefined,
    (c) => (c.method === 'PUT' && c.path === '/notifications/not_9' ? REFUSED : undefined),
    (c) => (c.method === 'PUT' && c.path.startsWith('/notifications/') ? { status: 200, body: {} } : undefined),
  ])
  const [out] = await legacy.registerLegacyCustomers(asaas.client, [ROW], false)
  assert.equal(out.status, 'created')
  assert.deepEqual(out.whatsapp, { switched_on: ['PAYMENT_CREATED', 'PAYMENT_OVERDUE'], skipped: ['PAYMENT_UPDATED'] })
  assert.ok(!asaas.calls.some((c) => c.path === '/notifications/batch'))
})

test('rerun on an existing complete customer switches WhatsApp on and reports updated; already on gets no PUT', async () => {
  const existing = { id: 'cus_1', externalReference: ROW.id, name: 'Pousada Mar Ltda', cpfCnpj: '12345678000195', email: 'contato@pousadamar.com.br', mobilePhone: '22998765432', postalCode: '28950-000', addressNumber: '359', notificationDisabled: false }
  const asaas = fakeAsaas([
    (c) => (c.method === 'GET' && c.path.startsWith('/customers?externalReference=') ? { status: 200, body: { data: [existing] } } : undefined),
    (c) => (c.method === 'GET' && c.path === '/customers/cus_1/notifications' ? { status: 200, body: NOTIFICATIONS } : undefined),
    (c) => (c.method === 'PUT' && c.path === '/notifications/not_1' ? { status: 200, body: {} } : undefined),
  ])
  const [out] = await legacy.registerLegacyCustomers(asaas.client, [ROW], false)
  assert.equal(out.status, 'updated')
  assert.deepEqual(out.whatsapp, { switched_on: ['PAYMENT_CREATED'], skipped: [] })
  // not_2 already on, not_3 disabled: no PUT for either
  assert.deepEqual(writes(asaas.calls).map((c) => c.path), ['/notifications/not_1'])
})

test('an Asaas error other than the refused event is reported per event, and the rest goes on', async () => {
  const asaas = fakeAsaas([
    (c) => (c.method === 'POST' && c.path === '/customers' ? { status: 200, body: { id: 'cus_1' } } : undefined),
    (c) =>
      c.method === 'GET' && c.path === '/customers/cus_1/notifications'
        ? { status: 200, body: { data: [
            { id: 'not_1', event: 'PAYMENT_CREATED', enabled: true },
            { id: 'not_2', event: 'PAYMENT_OVERDUE', enabled: true },
          ] } }
        : undefined,
    (c) => (c.method === 'PUT' && c.path === '/notifications/not_1' ? { status: 500, body: {} } : undefined),
    (c) => (c.method === 'PUT' && c.path === '/notifications/not_2' ? { status: 200, body: {} } : undefined),
  ])
  const [out] = await legacy.registerLegacyCustomers(asaas.client, [ROW], false)
  assert.deepEqual(out.whatsapp.switched_on, ['PAYMENT_OVERDUE'])
  assert.deepEqual(out.whatsapp.skipped, [])
  assert.equal(out.whatsapp.errors.length, 1)
  assert.equal(out.whatsapp.errors[0].event, 'PAYMENT_CREATED')
})

test('idempotent: found by externalReference and complete = unchanged, no write', async () => {
  const existing = { id: 'cus_1', externalReference: ROW.id, name: 'Pousada Mar Ltda', cpfCnpj: '12345678000195', email: 'contato@pousadamar.com.br', mobilePhone: '22998765432', postalCode: '28950-000', addressNumber: '359', notificationDisabled: false }
  const asaas = fakeAsaas([
    (c) => (c.method === 'GET' && c.path.startsWith('/customers?externalReference=') ? { status: 200, body: { data: [existing] } } : undefined),
    (c) => (c.method === 'GET' && c.path === '/customers/cus_1/notifications' ? { status: 200, body: { data: [{ id: 'not_1', enabled: true, whatsappEnabledForCustomer: true }] } } : undefined),
  ])
  const [out] = await legacy.registerLegacyCustomers(asaas.client, [ROW], false)
  assert.equal(out.status, 'unchanged')
  assert.deepEqual(writes(asaas.calls), [])
})

test('existing customer gets only what it lacks; a different value is reported, not overwritten', async () => {
  const existing = { id: 'cus_1', externalReference: ROW.id, name: 'Outro Nome', cpfCnpj: '12345678000195', email: 'contato@pousadamar.com.br', mobilePhone: '', postalCode: '', addressNumber: '', notificationDisabled: true }
  const asaas = fakeAsaas([
    (c) => (c.method === 'GET' && c.path.startsWith('/customers?externalReference=') ? { status: 200, body: { data: [existing] } } : undefined),
    (c) => (c.method === 'PUT' && c.path === '/customers/cus_1' ? { status: 200, body: { id: 'cus_1' } } : undefined),
    (c) => (c.method === 'GET' && c.path === '/customers/cus_1/notifications' ? { status: 200, body: { data: [] } } : undefined),
  ])
  const [out] = await legacy.registerLegacyCustomers(asaas.client, [ROW], false)
  assert.equal(out.status, 'updated')
  assert.deepEqual(out.differs, ['name'])
  assert.deepEqual(writes(asaas.calls)[0].body, { mobilePhone: '22998765432', postalCode: '28950000', addressNumber: '359', notificationDisabled: false })
})

test('a customer created by hand (same CNPJ, no externalReference) is adopted, not doubled', async () => {
  const asaas = fakeAsaas([
    (c) => (c.method === 'GET' && c.path.startsWith('/customers?cpfCnpj=12345678000195') ? { status: 200, body: { data: [{ id: 'cus_9', cpfCnpj: '12345678000195' }] } } : undefined),
    (c) => (c.method === 'PUT' && c.path === '/customers/cus_9' ? { status: 200, body: { id: 'cus_9' } } : undefined),
    (c) => (c.method === 'GET' && c.path === '/customers/cus_9/notifications' ? { status: 200, body: { data: [] } } : undefined),
  ])
  const [out] = await legacy.registerLegacyCustomers(asaas.client, [ROW], false)
  assert.equal(out.status, 'updated')
  assert.equal(out.asaas_id, 'cus_9')
  assert.ok(!asaas.calls.some((c) => c.method === 'POST'))
  assert.equal((writes(asaas.calls)[0].body as Record<string, unknown>).externalReference, ROW.id)
})

test('real run: a client with a missing field is not sent', async () => {
  const asaas = fakeAsaas([])
  const [out] = await legacy.registerLegacyCustomers(asaas.client, [{ ...ROW, address: 'Rua das Flores, Centro' }], false)
  assert.equal(out.status, 'failed')
  assert.match(out.description, /addressNumber/)
  assert.deepEqual(writes(asaas.calls), [])
})

test('an Asaas 400 on one client becomes its failed with the description, and the next one goes on', async () => {
  const second = { ...ROW, id: 'cccccccc-1111-4222-8333-444444444444', tax_id: '98.765.432/0001-10' }
  const asaas = fakeAsaas([
    (c) =>
      c.method === 'POST' && c.path === '/customers' && (c.body as Record<string, unknown>).externalReference === ROW.id
        ? { status: 400, body: { errors: [{ code: 'invalid_cpfCnpj', description: 'O CPF/CNPJ informado é inválido.' }] } }
        : undefined,
    (c) => (c.method === 'POST' && c.path === '/customers' ? { status: 200, body: { id: 'cus_2' } } : undefined),
    (c) => (c.method === 'GET' && c.path === '/customers/cus_2/notifications' ? { status: 200, body: { data: [] } } : undefined),
  ])
  const out = await legacy.registerLegacyCustomers(asaas.client, [ROW, second], false)
  assert.equal(out[0].status, 'failed')
  assert.equal(out[0].description, 'O CPF/CNPJ informado é inválido.')
  assert.equal(out[1].status, 'created')
  assert.equal(out[1].asaas_id, 'cus_2')
})

test('environment comes from ASAAS_BASE_URL', () => {
  assert.equal(legacy.asaasEnvironment('https://api.asaas.com/v3'), 'production')
  assert.equal(legacy.asaasEnvironment('https://api-sandbox.asaas.com/v3'), 'sandbox')
  assert.equal(legacy.asaasEnvironment(''), 'unknown')
})

test('index.ts: admin only, reads the legacy filter; the only subscription it creates is the legacy fee (#917)', () => {
  const src = readFileSync(resolve(FUNCTIONS, 'places-legacy-customers/index.ts'), 'utf8')
  assert.match(src, /requireAdmin\(req\)/)
  assert.match(src, /auth\.role !== 'service_role'/)
  for (const col of ['client_type', 'status', 'monthly_fee_cents', 'is_courtesy']) assert.match(src, new RegExp(`\\.eq\\('${col}', LEGACY_FILTER\\.${col}\\)`))
  assert.deepEqual(legacy.LEGACY_FILTER, { client_type: 'venue', status: 'approved', monthly_fee_cents: 10000, is_courtesy: false })
  const shared = readFileSync(resolve(FUNCTIONS, '_shared/places-legacy-customers.ts'), 'utf8')
  assert.doesNotMatch(src + shared, /createCardSubscription|createPixSubscription|createPixPayment|refundPayment|createPixTransfer/)
  assert.equal((shared.match(/createUndefinedSubscription\(/g) ?? []).length, 1)
})

// ─── action subscriptions (#917) ──────────────────────────────────────────────────────────────

const CUS = { id: 'cus_000001', externalReference: ROW.id, deleted: false }
const FEE_ROW = { id: ROW.id, monthly_fee_cents: 10000 }
const ROW_B = { id: 'bbbbbbbb-1111-4222-8333-444444444444', monthly_fee_cents: 10000 }
const refOf = (id: string) => `legacy:${id}`
const customerByRef = (id: string, cus: unknown) => (c: Call) =>
  c.method === 'GET' && c.path === `/customers?externalReference=${id}` ? { status: 200, body: { data: [cus] } } : undefined
const subsByRef = (id: string, data: unknown[]) => (c: Call) =>
  c.method === 'GET' && c.path === `/subscriptions?externalReference=${encodeURIComponent(refOf(id))}` ? { status: 200, body: { data } } : undefined
const noSubs = (c: Call) => (c.method === 'GET' && c.path.startsWith('/subscriptions?') ? { status: 200, body: { data: [] } } : undefined)
const created = (c: Call) => (c.method === 'POST' && c.path === '/subscriptions' ? { status: 200, body: { id: 'sub_new', status: 'ACTIVE', value: 100 } } : undefined)
const noSleep = { sleep: async () => {} }

test('#917: nextDueDate is the next day 20 strictly after today', () => {
  assert.equal(legacy.nextLegacyDueDate('2026-10-08'), '2026-10-20')
  assert.equal(legacy.nextLegacyDueDate('2026-10-19'), '2026-10-20')
  assert.equal(legacy.nextLegacyDueDate('2026-10-20'), '2026-11-20')
  assert.equal(legacy.nextLegacyDueDate('2026-12-25'), '2027-01-20')
})

test('#917: real run POSTs one monthly UNDEFINED subscription, legacy:<client_id>, value from monthly_fee_cents, due on the next day 20, no endDate', async () => {
  const { client, calls } = fakeAsaas([customerByRef(ROW.id, CUS), noSubs, created])
  const [r] = await legacy.createLegacySubscriptions(client, [{ ...FEE_ROW, monthly_fee_cents: 12345 }], false, '2026-10-08', noSleep)
  assert.deepEqual(r, { client_id: ROW.id, status: 'created', customer_id: 'cus_000001', subscription_id: 'sub_new' })
  const posts = writes(calls)
  assert.equal(posts.length, 1)
  assert.deepEqual(posts[0], {
    method: 'POST',
    path: '/subscriptions',
    body: {
      customer: 'cus_000001',
      value: 123.45,
      nextDueDate: '2026-10-20',
      cycle: 'MONTHLY',
      description: 'Tuggi: mensalidade do local no app',
      externalReference: `legacy:${ROW.id}`,
      billingType: 'UNDEFINED',
    },
  })
  assert.ok(!('endDate' in (posts[0].body as object)))
  assert.ok(legacy.isLegacySubscriptionReference((posts[0].body as { externalReference: string }).externalReference))
})

test('#917: idempotent: a live legacy:<client_id> subscription is already, no POST; a deleted or inactive one does not count', async () => {
  const live = { id: 'sub_live', status: 'ACTIVE', externalReference: refOf(ROW.id), deleted: false }
  const a = fakeAsaas([customerByRef(ROW.id, CUS), subsByRef(ROW.id, [live]), created])
  const [r] = await legacy.createLegacySubscriptions(a.client, [FEE_ROW], false, '2026-10-08', noSleep)
  assert.equal(r.status, 'already')
  assert.equal(r.subscription_id, 'sub_live')
  assert.equal(writes(a.calls).length, 0)

  const dead = [{ ...live, deleted: true }, { ...live, id: 'sub_off', status: 'INACTIVE' }, { ...live, id: 'sub_portal', externalReference: `com_historia_12m:${ROW.id}` }]
  const b = fakeAsaas([customerByRef(ROW.id, CUS), subsByRef(ROW.id, dead), created])
  const [s] = await legacy.createLegacySubscriptions(b.client, [FEE_ROW], false, '2026-10-08', noSleep)
  assert.equal(s.status, 'created')
})

test('#917: dry run never POSTs and answers the payload, with no name, e-mail or CPF/CNPJ', async () => {
  const { client, calls } = fakeAsaas([customerByRef(ROW.id, CUS), noSubs, created])
  const [r] = await legacy.createLegacySubscriptions(client, [FEE_ROW], true, '2026-10-08', noSleep)
  assert.equal(r.status, 'would_create')
  assert.equal(r.payload.externalReference, `legacy:${ROW.id}`)
  assert.equal(r.payload.nextDueDate, '2026-10-20')
  assert.equal(r.payload.value, 100)
  assert.equal(writes(calls).length, 0)
  assert.doesNotMatch(JSON.stringify(r), /Pousada|@|12345678/)
})

test('#917: a client without Asaas customer is no_customer, a bad fee is failed, an Asaas error is failed, and the next one goes on', async () => {
  const boom = (c: Call) => (c.method === 'POST' && c.path === '/subscriptions' && (c.body as { externalReference: string }).externalReference === refOf(ROW.id) ? { status: 400, body: { errors: [{ code: 'invalid_customer', description: 'Cliente inválido' }] } } : undefined)
  const { client } = fakeAsaas([customerByRef(ROW.id, CUS), customerByRef(ROW_B.id, { ...CUS, id: 'cus_b' }), noSubs, boom, created])
  const rows = [{ id: 'cccccccc-1111-4222-8333-444444444444', monthly_fee_cents: 10000 }, { ...ROW_B, monthly_fee_cents: null }, FEE_ROW, ROW_B]
  const out = await legacy.createLegacySubscriptions(client, rows, false, '2026-10-08', noSleep)
  assert.deepEqual(out.map((o: { status: string }) => o.status), ['no_customer', 'failed', 'failed', 'created'])
  assert.match(out[2].description, /Cliente inválido/)
})

test('#917: the calls to Asaas are spaced one second apart between clients, never before the first', async () => {
  const { client, calls } = fakeAsaas([customerByRef(ROW.id, CUS), customerByRef(ROW_B.id, CUS), noSubs, created])
  const log: string[] = []
  const sleep = async (ms: number) => {
    log.push(`sleep ${ms} after ${calls.length} calls`)
  }
  await legacy.createLegacySubscriptions(client, [FEE_ROW, ROW_B, FEE_ROW], true, '2026-10-08', { sleep })
  assert.equal(legacy.LEGACY_ASAAS_SPACING_MS, 1000)
  assert.deepEqual(log, ['sleep 1000 after 2 calls', 'sleep 1000 after 4 calls'])
})

test('#917/#918 index.ts: actions subscriptions and mirror, unknown action refused, today in São Paulo', () => {
  const src = readFileSync(resolve(FUNCTIONS, 'places-legacy-customers/index.ts'), 'utf8')
  assert.match(src, /ACTIONS = \['customers', 'subscriptions', 'mirror'\]/)
  assert.match(src, /error: 'unknown_action'/)
  assert.match(src, /const today = saoPauloDate\(new Date\(\)\)/)
  assert.match(src, /createLegacySubscriptions\(asaas,.*dryRun, today\)/)
  assert.match(src, /mirrorContractSubscriptions\(/)
})
