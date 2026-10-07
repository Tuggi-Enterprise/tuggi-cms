/**
 * #903 — the payout's money-out half (`supabase/functions/_shared/places-payout.ts`): the release,
 * the Asaas Pix transfer, the transfer webhook and the partner's e-mails. BR-B2B-044 item 6, term
 * 5.4, contract `places-pagamento.md` §3.5 (B1, B2, "only applied authorizes the POST").
 *
 * Deno source loaded through a path built at run time (a static `.ts` import fails the repo's `tsc`).
 *
 * Run with: npm run test:api
 */

import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const SHARED = resolve(import.meta.dirname, '../../supabase/functions/_shared')

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mod: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pay: any
type Asaas = typeof import('../../supabase/functions/_shared/asaas')
let asaasMod: Asaas

before(async () => {
  mod = await import(pathToFileURL(resolve(SHARED, 'places-payout.ts')).href)
  pay = await import(pathToFileURL(resolve(SHARED, 'places-payment.ts')).href)
  asaasMod = await import(pathToFileURL(resolve(SHARED, 'asaas.ts')).href)
})

const PAYOUT = '33333333-3333-4333-8333-333333333333'
const ADMIN = '44444444-4444-4444-8444-444444444444'
const KEY = '12345678000195'

type Call = { method: string; path: string; body: Record<string, unknown> | undefined }

function fakeAsaas(answer: (c: Call) => { status: number; body: unknown } | undefined) {
  const calls: Call[] = []
  const fetch = async (url: string, init: RequestInit) => {
    const u = new URL(url)
    const call = { method: init.method ?? 'GET', path: u.pathname.replace(/^\/v3/, ''), body: init.body ? JSON.parse(String(init.body)) : undefined }
    calls.push(call)
    const hit = answer(call)
    if (hit?.status === 0) throw new TypeError('network') // AsaasError(0): timeout or no route
    return hit
      ? new Response(JSON.stringify(hit.body), { status: hit.status })
      : new Response(JSON.stringify({ errors: [{ code: 'not_found' }] }), { status: 404 })
  }
  return { client: asaasMod.asaasClient({ baseUrl: 'https://api-sandbox.asaas.com/v3', apiKey: 'k', fetch }), calls }
}

type Answers = Record<string, { data?: unknown; error?: { code?: string; details?: string } | null }>

function harness(answers: Answers, asaas: ReturnType<typeof fakeAsaas>, context: Record<string, unknown> = {}) {
  const rpc: { fn: string; args: Record<string, unknown> }[] = []
  const alerts: { what: string; fields: Record<string, unknown> }[] = []
  const mails: { to: string; subject: string; html: string; text: string }[] = []
  const ctx = {
    payoutId: PAYOUT,
    status: 'calculated',
    amountCents: 12340,
    periodMonth: '2026-09-01',
    payDeadline: '2026-10-30',
    placeName: 'Pousada do Sol',
    email: 'dono@pousada.example',
    signerName: 'Maria Souza',
    pixKey: KEY,
    purchases: 3,
    ...context,
  }
  const deps = {
    admin: async (_schema: string, fn: string, args: Record<string, unknown>) => {
      rpc.push({ fn, args })
      const a = answers[fn] ?? { data: null }
      return { data: a.data ?? null, error: a.error ?? null }
    },
    asaas: asaas.client,
    payoutContext: async () => ctx,
    periodPayouts: async () => [ctx],
    sendEmail: async (to: string, subject: string, html: string, text: string) => {
      mails.push({ to, subject, html, text })
      return true
    },
    alert: async (what: string, fields: Record<string, unknown>) => {
      alerts.push({ what, fields })
    },
  }
  return { deps, rpc, alerts, mails }
}

const applied = { data: [{ outcome: 'applied', status: 'released', amount_cents: 12340, pix_key: KEY }] }
const transferOk = (c: Call) => (c.method === 'POST' && c.path === '/transfers' ? { status: 200, body: { id: 'tra_1', status: 'PENDING' } } : undefined)

test('contract §3.5: only applied authorizes the POST — unchanged never calls Asaas (double click, retry)', async () => {
  const asaas = fakeAsaas(transferOk)
  const h = harness({ release_place_payout: { data: [{ outcome: 'unchanged', status: 'released', amount_cents: 12340, pix_key: null }] } }, asaas)
  const r = await mod.releasePayout(h.deps, { payoutId: PAYOUT, releasedBy: ADMIN })
  assert.equal(r.status, 200)
  assert.equal(r.body.result, 'unchanged')
  assert.equal(asaas.calls.length, 0)
  assert.deepEqual(h.rpc.map((c) => c.fn), ['release_place_payout'])
  assert.equal(h.mails.length, 0)
})

test('BR-B2B-044 item 6: applied sends ONE Pix by CNPJ key with externalReference = payout id, then records it', async () => {
  const asaas = fakeAsaas(transferOk)
  const h = harness({ release_place_payout: applied, record_place_payout_transfer: { data: [{ outcome: 'applied', status: 'sent' }] } }, asaas)
  const r = await mod.releasePayout(h.deps, { payoutId: PAYOUT, releasedBy: ADMIN })
  assert.equal(r.status, 200)
  assert.equal(r.body.result, 'sent')
  assert.equal(asaas.calls.length, 1)
  assert.deepEqual(asaas.calls[0].body, {
    value: 123.4,
    operationType: 'PIX',
    pixAddressKey: KEY,
    pixAddressKeyType: 'CNPJ',
    description: 'Comissão Tuggi 09/2026',
    externalReference: PAYOUT,
  })
  assert.deepEqual(h.rpc[0].args, { p_payout_id: PAYOUT, p_released_by: ADMIN })
  assert.deepEqual(h.rpc[1], { fn: 'record_place_payout_transfer', args: { p_payout_id: PAYOUT, p_provider_transfer_id: 'tra_1' } })
  assert.equal(h.mails.length, 1, 'the first release of the month e-mails the place once')
  assert.equal(h.mails[0].to, 'dono@pousada.example')
})

test('contract §3.5: TGP10 from record_place_payout_transfer is a critical alert, never a second POST', async () => {
  const asaas = fakeAsaas(transferOk)
  const h = harness({ release_place_payout: applied, record_place_payout_transfer: { error: { code: 'TGP10', details: 'paid' } } }, asaas)
  const r = await mod.releasePayout(h.deps, { payoutId: PAYOUT, releasedBy: ADMIN })
  assert.equal(r.status, 200)
  assert.equal(asaas.calls.filter((c) => c.method === 'POST').length, 1)
  const critical = h.alerts.find((a) => a.what.includes('payout_transfer_not_recorded'))
  assert.ok(critical, 'the operator is alerted')
  assert.equal(critical.fields.payout_id, PAYOUT)
  assert.equal(critical.fields.transfer_id, 'tra_1')
})

const rejected400 = { status: 400, body: { errors: [{ code: 'invalid_pixAddressKey', description: 'Chave inválida' }] } }
const transferList = (data: unknown[], hasMore = false) => ({ status: 200, body: { object: 'list', hasMore, data } })

for (const status of [0, 429, 500, 503]) {
  test(`contract §3.5: POST answered ${status || 'network/timeout'} leaves the payout released: no fail_place_payout_release, no re-read, no second POST`, async () => {
    const asaas = fakeAsaas((c) => (c.method === 'POST' ? { status, body: {} } : undefined))
    const h = harness({ release_place_payout: applied }, asaas)
    const r = await mod.releasePayout(h.deps, { payoutId: PAYOUT, releasedBy: ADMIN })
    assert.equal(r.status, 502)
    assert.equal(r.body.error, 'transfer_failed')
    assert.deepEqual(h.rpc.map((c) => c.fn), ['release_place_payout'])
    assert.equal(asaas.calls.length, 1, 'one POST and nothing else')
    assert.equal(h.alerts[0].what, 'payout_transfer_failed')
    assert.equal(h.alerts[0].fields.payout_status, 'released')
    assert.equal(h.mails.length, 0)
  })
}

test('contract §3.5: a 400 with no transfer at Asaas for the payout → fail_place_payout_release(asaas_rejected: …), one POST', async () => {
  const asaas = fakeAsaas((c) =>
    c.method === 'POST' ? rejected400 : c.path === '/transfers' ? transferList([{ id: 'tra_other', status: 'DONE', externalReference: 'outro' }]) : undefined,
  )
  const h = harness({ release_place_payout: applied, fail_place_payout_release: { data: [{ outcome: 'applied', status: 'failed' }] } }, asaas)
  const r = await mod.releasePayout(h.deps, { payoutId: PAYOUT, releasedBy: ADMIN })
  assert.equal(r.status, 502)
  assert.deepEqual(h.rpc.map((c) => c.fn), ['release_place_payout', 'fail_place_payout_release'])
  assert.deepEqual(h.rpc[1].args, { p_payout_id: PAYOUT, p_reason: 'asaas_rejected: invalid_pixAddressKey' })
  assert.deepEqual(asaas.calls.map((c) => `${c.method} ${c.path}`), ['POST /transfers', 'GET /transfers'])
  assert.equal(h.alerts[0].fields.payout_status, 'failed')
  assert.equal(h.mails.length, 0)
})

test('contract §3.5: a 400 whose payout IS at Asaas (externalReference) stays released, critical alert, no second POST', async () => {
  const asaas = fakeAsaas((c) =>
    c.method === 'POST' ? rejected400 : c.path === '/transfers' ? transferList([{ id: 'tra_9', status: 'PENDING', externalReference: PAYOUT }]) : undefined,
  )
  const h = harness({ release_place_payout: applied }, asaas)
  await mod.releasePayout(h.deps, { payoutId: PAYOUT, releasedBy: ADMIN })
  assert.deepEqual(h.rpc.map((c) => c.fn), ['release_place_payout'])
  assert.ok(h.alerts.some((a) => a.what === 'CRITICAL payout_rejected_but_transfer_found'))
  assert.equal(asaas.calls.filter((c) => c.method === 'POST').length, 1)
})

test('contract §3.5: a 400 whose re-read fails or runs out of pages stays released (unknown is not absent)', async () => {
  for (const list of [{ status: 500, body: {} }, transferList([], true)]) {
    const asaas = fakeAsaas((c) => (c.method === 'POST' ? rejected400 : c.path === '/transfers' ? list : undefined))
    const h = harness({ release_place_payout: applied }, asaas)
    await mod.releasePayout(h.deps, { payoutId: PAYOUT, releasedBy: ADMIN })
    assert.deepEqual(h.rpc.map((c) => c.fn), ['release_place_payout'])
    assert.equal(asaas.calls.filter((c) => c.method === 'POST').length, 1)
    assert.equal(h.alerts[h.alerts.length - 1]?.fields.payout_status, 'released')
  }
})

test('security #903: places-payout serves the CMS server only — an admin JWT is 403, the machine key (service_role) passes', () => {
  assert.deepEqual(mod.machineOnly({ role: 'admin' }), { status: 403, body: { error: 'forbidden' } })
  assert.deepEqual(mod.machineOnly({ role: 'super_admin' }), { status: 403, body: { error: 'forbidden' } })
  assert.deepEqual(mod.machineOnly({}), { status: 403, body: { error: 'forbidden' } })
  assert.equal(mod.machineOnly({ role: 'service_role' }), null)
  // `requireAdmin` imports esm.sh (Node cannot load the EF): the wiring is proved by position.
  const src = readFileSync(resolve(SHARED, '../places-payout/index.ts'), 'utf8')
  const gate = src.indexOf('requireAdmin(req)')
  const machine = src.indexOf('machineOnly(auth)')
  assert.ok(gate > 0 && machine > gate, 'machineOnly right after requireAdmin')
  assert.ok(machine < src.indexOf('req.json()'), 'before the body is read')
})

test('a failed payout released again transfers, but does not e-mail the place a second time', async () => {
  const asaas = fakeAsaas(transferOk)
  const h = harness({ release_place_payout: applied, record_place_payout_transfer: { data: [{ outcome: 'applied', status: 'sent' }] } }, asaas, { status: 'failed' })
  const r = await mod.releasePayout(h.deps, { payoutId: PAYOUT, releasedBy: ADMIN })
  assert.equal(r.body.result, 'sent')
  assert.equal(h.mails.length, 0)
})

test('TGP10 of the release (no key, not positive) is a 409 and Asaas is not touched', async () => {
  const asaas = fakeAsaas(transferOk)
  const h = harness({ release_place_payout: { error: { code: 'TGP10', details: 'no_pix_key' } } }, asaas)
  const r = await mod.releasePayout(h.deps, { payoutId: PAYOUT, releasedBy: ADMIN })
  assert.deepEqual(r, { status: 409, body: { error: 'not_releasable', reason: 'no_pix_key' } })
  assert.equal(asaas.calls.length, 0)
})

test('spec §8 item 7 (B2, term clause 13): the paid e-mail has the total and the count, never a gross value, price or product', () => {
  const mail = mod.payoutPaidEmail({
    payoutId: PAYOUT,
    status: 'calculated',
    amountCents: 12340,
    periodMonth: '2026-09-01',
    payDeadline: '2026-10-30',
    placeName: 'Pousada do Sol',
    email: 'dono@pousada.example',
    signerName: 'Maria Souza',
    pixKey: KEY,
    purchases: 3,
  })
  assert.equal(mail.subject, 'Sua comissão de outubro: R$ 123,40')
  assert.equal(
    mail.text,
    [
      'Olá, Maria.',
      '',
      'A comissão do Pousada do Sol sobre as compras que a Tuggi recebeu em setembro ficou em R$ 123,40.',
      '',
      'Vamos pagar por Pix na chave CNPJ 12.345.678/0001-95 até 30 de outubro.',
      '',
      '3 compras no app em setembro.',
      '',
      'Se algo não bater, é só responder este e-mail.',
      '',
      'Equipe Tuggi',
    ].join('\n')
  )
  assert.ok(!/com\.tuggi|hours|passe|R\$ 29,90|Compra no app\s+R\$/i.test(mail.text + mail.html))
})

test('decision 6 (term 5.4): the close e-mails a month at zero and a negative month, not a positive one', async () => {
  const sent: { subject: string; text: string }[] = []
  const base = {
    payoutId: PAYOUT,
    status: 'calculated',
    periodMonth: '2026-09-01',
    payDeadline: '2026-10-30',
    placeName: 'Pousada do Sol',
    email: 'dono@pousada.example',
    signerName: 'Maria Souza',
    pixKey: KEY,
    purchases: 0,
  }
  const deps = {
    periodPayouts: async () => [
      { ...base, amountCents: 0 },
      { ...base, payoutId: 'neg', amountCents: -250 },
      { ...base, payoutId: 'pos', amountCents: 900 },
    ],
    sendEmail: async (_to: string, subject: string, _html: string, text: string) => {
      sent.push({ subject, text })
      return true
    },
    alert: async () => {},
  }
  const r = await mod.notifyClosedPeriod(deps, '2026-09-01')
  assert.deepEqual(r, { sent: 2, failed: 0 })
  assert.equal(sent[0].subject, 'Sua comissão de outubro: R$ 0,00')
  assert.ok(sent[0].text.includes('ficou em R$ 0,00. Não houve compra atribuída ao local nesse mês.'))
  assert.ok(sent[1].text.includes('Um estorno de compra já paga deixou saldo de −R$ 2,50, que será descontado da próxima comissão.'))
  for (const m of sent) assert.ok(!/com\.tuggi|produto|preço/i.test(m.text))
})

test('TRANSFER_DONE is re-read from Asaas and settled; a still-pending transfer is not', async () => {
  const done = fakeAsaas((c) => (c.method === 'GET' && c.path === '/transfers/tra_1' ? { status: 200, body: { id: 'tra_1', status: 'DONE' } } : undefined))
  const h = harness({ settle_place_payout_transfer: { data: [{ outcome: 'applied', payout_id: PAYOUT, status: 'paid' }] } }, done)
  // the body says FAILED; the re-read says DONE — the re-read wins
  const r = await mod.handleTransferEvent(h.deps, { transfer: { id: 'tra_1', status: 'FAILED' } }, 'evt_1', 'TRANSFER_FAILED')
  assert.equal(r.body.outcome, 'applied')
  assert.deepEqual(h.rpc[0].args, { p_provider_transfer_id: 'tra_1', p_transfer_status: 'DONE', p_fail_reason: null })

  const pending = fakeAsaas((c) => (c.method === 'GET' ? { status: 200, body: { id: 'tra_1', status: 'PENDING', authorized: false } } : undefined))
  const p = harness({}, pending)
  const r2 = await mod.handleTransferEvent(p.deps, { transfer: { id: 'tra_1' } }, 'evt_2', 'TRANSFER_PENDING')
  assert.equal(r2.body.outcome, 'pending')
  assert.equal(p.rpc.length, 0)
})

test('the Asaas webhook routes TRANSFER_* to the payout (same token, same endpoint)', async () => {
  const asaas = fakeAsaas((c) => (c.method === 'GET' ? { status: 200, body: { id: 'tra_9', status: 'FAILED', failReason: 'Chave inválida' } } : undefined))
  const h = harness({ settle_place_payout_transfer: { data: [{ outcome: 'applied', payout_id: PAYOUT, status: 'failed' }] } }, asaas)
  const r = await pay.handleAsaasWebhook({ ...h.deps, asaas: asaas.client }, 'tok', 'tok', { id: 'evt_9', event: 'TRANSFER_FAILED', transfer: { id: 'tra_9' } })
  assert.equal(r.status, 200)
  assert.deepEqual(h.rpc[0].args, { p_provider_transfer_id: 'tra_9', p_transfer_status: 'FAILED', p_fail_reason: 'Chave inválida' })
  assert.equal(h.alerts[0].what, 'payout_failed')
})

test('the sweep settles a sent payout whose webhook was lost', async () => {
  const asaas = fakeAsaas((c) => (c.method === 'GET' ? { status: 200, body: { id: 'tra_1', status: 'DONE' } } : undefined))
  const h = harness({ settle_place_payout_transfer: { data: [{ outcome: 'applied', payout_id: PAYOUT, status: 'paid' }] } }, asaas)
  const r = await mod.reconcileSentPayouts(h.deps, [{ payout_id: PAYOUT, provider_transfer_id: 'tra_1' }])
  assert.deepEqual(r, { settled: 1, pending: 0, failed: 0 })
})

test('decision 7: the sweep asks the CMS to close the month with the job secret; unset secrets skip', async () => {
  const seen: { url: string; headers: Record<string, string> }[] = []
  const fetchImpl = async (url: string, init: RequestInit) => {
    seen.push({ url, headers: init.headers as Record<string, string> })
    return new Response(JSON.stringify({ result: 'already_calculated' }), { status: 200 })
  }
  assert.equal(await mod.triggerPayoutClose(fetchImpl, 'https://cms.example/', 's3cret'), 'already_calculated')
  assert.equal(seen[0].url, 'https://cms.example/api/finance/payouts/close')
  assert.equal(seen[0].headers['x-cms-job-secret'], 's3cret')
  assert.equal(await mod.triggerPayoutClose(fetchImpl, '', 's3cret'), 'skipped')
  assert.equal(seen.length, 1)
})
