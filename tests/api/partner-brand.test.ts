/**
 * #1257 (epic #1248): the CMS doors of the Tuggi do parceiro. Contract
 * `docs/contracts/tuggi-do-parceiro.md` §3 and §5.
 *
 * Pinned here: admin only, and nothing touches the database before the gate; the logo queue reads
 * the pending rows and signs them from the private bucket `partner-logos`; a refusal without a
 * reason never reaches the database; `TGB71` comes back as `logo_not_pending` (409) with a sentence
 * in the three CMS languages; the decision names the session's user as `p_actor`, never the body's;
 * the pilot is written as the two columns together, the end after the start; a price is the amount
 * and the currency together; the settings carry the term and only the three switches of this
 * product. Nothing here calls production: every database call is a fake.
 *
 * Run with: npx tsx --import ./tests/api/setup/console-to-stderr.mjs --experimental-test-module-mocks --test tests/api/partner-brand.test.ts
 */

import { test, before, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createTranslator } from 'next-intl'
import type { NextRequest } from 'next/server'

const CLIENT_ID = 'cccccccc-1111-4222-8333-444444444444'
const LOGO = `${CLIENT_ID}/dddddddd-1111-4222-8333-444444444444.png`
const APPROVED = `${CLIENT_ID}/eeeeeeee-1111-4222-8333-444444444444.png`
const SESSION_UID = 'uid-1'

interface Op {
  schema: string
  table?: string
  rpc?: string
  op: 'select' | 'insert' | 'update' | 'upsert' | 'rpc'
  payload?: unknown
  options?: unknown
  filters: [string, string, unknown][]
}

interface Answer {
  data?: unknown
  error?: { code: string; message: string } | null
}

let role: string | null
let ops: Op[]
let signed: { bucket: string; paths: string[]; ttl: number }[]
let respond: (op: Op) => Answer

function defaultAnswer(op: Op): Answer {
  if (op.table === 'partner_brands' && op.op === 'select' && op.filters.some(([, c]) => c === 'logo_status')) {
    return {
      data: [
        { client_id: CLIENT_ID, logo_path: LOGO, logo_submitted_at: '2026-11-24T12:00:00Z', approved_logo_path: APPROVED, client: { name: 'Hotel Mar' } },
      ],
    }
  }
  if (op.table === 'partner_brands' && op.op === 'upsert') {
    const p = op.payload as Record<string, unknown>
    return { data: { pilot_starts_at: p.pilot_starts_at, pilot_ends_at: p.pilot_ends_at } }
  }
  if (op.table === 'gift_day_packages' && op.op === 'update') return { data: { days: 7, ...(op.payload as object) } }
  if (op.table === 'gift_day_packages') return { data: [{ days: 1, price_cents: null, price_currency: null }] }
  if (op.rpc === 'cms_decide_partner_logo') return { data: { logo_path: LOGO, logo_status: 'approved' } }
  if (op.rpc === 'reward_settings_map') return { data: { 'partner_brand.days': 30, 'welcome.minutes': 60 } }
  if (op.rpc === 'cms_get_trip_settings') {
    return {
      data: {
        switches: [
          { key: 'trip_reminder.enabled', is_on: true },
          { key: 'partner.gift_android_enabled', is_on: true, updated_at: null },
          { key: 'partner.brand_color_enabled', is_on: false, updated_at: null },
          { key: 'partner.gift_ios_enabled', is_on: true, updated_at: null },
        ],
        secrets: [{ name: 'whatsapp_token', last4: '1234' }],
      },
    }
  }
  return { data: null }
}

function query(schema: string, table: string) {
  const op: Op = { schema, table, op: 'select', filters: [] }
  let recorded = false
  const finish = () => {
    if (table === 'cms_users') {
      return { data: role ? { id: 'cms-1', email: 'admin@tuggi.app', role, is_active: true } : null, error: null }
    }
    if (!recorded && table !== 'audit_logs') {
      ops.push(op)
      recorded = true
    }
    const a = respond(op)
    return { data: a.data ?? null, error: a.error ?? null }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q: any = {
    select: () => q,
    insert: (payload: unknown) => ((op.op = 'insert'), (op.payload = payload), q),
    update: (payload: unknown) => ((op.op = 'update'), (op.payload = payload), q),
    upsert: (payload: unknown, options: unknown) => ((op.op = 'upsert'), (op.payload = payload), (op.options = options), q),
    eq: (c: string, v: unknown) => (op.filters.push(['eq', c, v]), q),
    order: () => q,
    limit: () => q,
    single: async () => finish(),
    maybeSingle: async () => finish(),
    then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(finish()).then(ok, ko),
  }
  return q
}

function client() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = {
    auth: {
      getUser: async () =>
        role === null
          ? { data: { user: null }, error: { message: 'no session' } }
          : { data: { user: { id: SESSION_UID, email: 'admin@tuggi.app' } }, error: null },
    },
    schema: (schema: string) => ({
      from: (table: string) => query(schema, table),
      rpc: async (name: string, args?: unknown) => {
        const op: Op = { schema, rpc: name, op: 'rpc', payload: args, filters: [] }
        ops.push(op)
        const a = respond(op)
        return { data: a.data ?? null, error: a.error ?? null }
      },
    }),
    storage: {
      from: (bucket: string) => ({
        createSignedUrls: async (paths: string[], ttl: number) => {
          signed.push({ bucket, paths, ttl })
          return { data: paths.map((path) => ({ path, signedUrl: `https://example.supabase.co/sign/${path}?token=t` })), error: null }
        },
        getPublicUrl: () => {
          throw new Error('the partner-logos bucket is private: getPublicUrl must not be used')
        },
      }),
    },
  }
  return c
}

/* eslint-disable @typescript-eslint/no-explicit-any */
let logosRoute: any
let settingsRoute: any
let packagesRoute: any
let brandRoute: any
let lib: any
/* eslint-enable @typescript-eslint/no-explicit-any */

const root = resolve(import.meta.dirname, '../..')
const messages = Object.fromEntries(
  ['pt', 'en', 'es'].map((l) => [l, JSON.parse(readFileSync(resolve(root, `messages/${l}.json`), 'utf8'))])
)
const tPt = createTranslator({ locale: 'pt', messages: messages.pt, namespace: 'PartnerBrand' })

before(async () => {
  mock.module('next/headers', { namedExports: { cookies: async () => ({ get: () => undefined, getAll: () => [] }) } })
  mock.module('@/lib/core/supabase-client', {
    namedExports: {
      getSupabaseRouteHandler: () => client(),
      getSupabaseService: () => client(),
      getSupabase: () => client(),
    },
  })
  logosRoute = await import('@/app/api/admin/partner-brand/logos/route')
  settingsRoute = await import('@/app/api/admin/partner-brand/settings/route')
  packagesRoute = await import('@/app/api/admin/partner-brand/packages/route')
  brandRoute = await import('@/app/api/admin/clients/[clientId]/brand/route')
  lib = await import('@/lib/partner-brand/brand')
})

beforeEach(() => {
  role = 'admin'
  ops = []
  signed = []
  respond = defaultAnswer
})

const json = (method: string, body?: unknown) =>
  new Request('http://localhost/api/admin/partner-brand', {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }) as unknown as NextRequest
const noCtx = { params: Promise.resolve({}) }
const clientCtx = { params: Promise.resolve({ clientId: CLIENT_ID }) }

const APPROVE = { client_id: CLIENT_ID, logo_path: LOGO, approve: true }
const PILOT = { pilot_starts_at: '2026-12-01T03:00:00.000Z', pilot_ends_at: '2027-03-01T03:00:00.000Z' }

// ─── Gate ────────────────────────────────────────────────────────────────────────────────────

test('#1257: without a CMS admin session every partner brand door refuses, and nothing touches the database', async () => {
  const calls = async () => [
    await logosRoute.GET(json('GET'), noCtx),
    await logosRoute.POST(json('POST', APPROVE), noCtx),
    await settingsRoute.GET(json('GET'), noCtx),
    await packagesRoute.PATCH(json('PATCH', { days: 7, price_cents: 4990, price_currency: 'BRL' }), noCtx),
    await brandRoute.GET(json('GET'), clientCtx),
    await brandRoute.PATCH(json('PATCH', PILOT), clientCtx),
  ]
  for (const r of ['editor', 'viewer', 'client']) {
    role = r
    for (const res of await calls()) assert.equal(res.status, 403, r)
  }
  role = null
  for (const res of await calls()) assert.equal(res.status, 401)
  assert.deepEqual(ops, [])
  assert.deepEqual(signed, [])
})

// ─── Logo ────────────────────────────────────────────────────────────────────────────────────

test('#1257 BR-B2B-070: the queue reads the pending logos, oldest first, and signs each file from the private bucket', async () => {
  const res = await logosRoute.GET(json('GET'), noCtx)
  assert.equal(res.status, 200)
  const [read] = ops
  assert.equal(read.schema, 'partner')
  assert.equal(read.table, 'partner_brands')
  assert.deepEqual(read.filters, [['eq', 'logo_status', 'pending']])
  assert.equal(signed.length, 1)
  assert.equal(signed[0].bucket, 'partner-logos')
  assert.deepEqual(signed[0].paths.sort(), [APPROVED, LOGO].sort())
  assert.ok(signed[0].ttl > 0 && signed[0].ttl <= 3600)
  const { logos } = await res.json()
  assert.equal(logos[0].client_name, 'Hotel Mar')
  assert.match(logos[0].logo_url, /token=/)
  assert.match(logos[0].approved_logo_url, /token=/)
})

test('#1257 BR-B2B-070: a refusal without a reason never reaches the database, and the sentence says why', async () => {
  for (const reason of [undefined, null, '', '   ']) {
    const res = await logosRoute.POST(json('POST', { ...APPROVE, approve: false, reason }), noCtx)
    assert.equal(res.status, 400, String(reason))
    assert.deepEqual((await res.json()).error, { code: 'reason_required' })
  }
  const long = await logosRoute.POST(json('POST', { ...APPROVE, approve: false, reason: 'x'.repeat(lib.LOGO_REASON_MAX + 1) }), noCtx)
  assert.deepEqual((await long.json()).error, { code: 'reason_too_long' })
  assert.deepEqual(ops, [])
  assert.equal(tPt('errors.reason_required'), 'Escreva o motivo da recusa: o parceiro lê no portal.')
})

test('#1257: a decision on a file outside the partner folder, or with a bad client, never reaches the database', async () => {
  const bad = [
    { ...APPROVE, client_id: 'not-a-uuid' },
    { ...APPROVE, logo_path: 'ffffffff-1111-4222-8333-444444444444/dddddddd-1111-4222-8333-444444444444.png' },
    { ...APPROVE, logo_path: `${CLIENT_ID}/logo.svg` },
    { ...APPROVE, logo_path: `${CLIENT_ID}/../x/dddddddd-1111-4222-8333-444444444444.png` },
    { ...APPROVE, approve: 'yes' },
  ]
  for (const body of bad) assert.equal((await logosRoute.POST(json('POST', body), noCtx)).status, 400, JSON.stringify(body))
  assert.deepEqual(ops, [])
})

test('#1257 BR-B2B-070: approving calls cms_decide_partner_logo with the session user as p_actor, never the body actor', async () => {
  const res = await logosRoute.POST(json('POST', { ...APPROVE, p_actor: 'ffffffff-1111-4222-8333-444444444444' }), noCtx)
  assert.equal(res.status, 200)
  const [call] = ops
  assert.equal(call.schema, 'partner')
  assert.equal(call.rpc, 'cms_decide_partner_logo')
  assert.deepEqual(call.payload, { p_client_id: CLIENT_ID, p_logo_path: LOGO, p_approve: true, p_reason: null, p_actor: SESSION_UID })

  ops = []
  await logosRoute.POST(json('POST', { ...APPROVE, approve: false, reason: '  O logo está cortado.  ' }), noCtx)
  assert.deepEqual(ops[0].payload, { p_client_id: CLIENT_ID, p_logo_path: LOGO, p_approve: false, p_reason: 'O logo está cortado.', p_actor: SESSION_UID })
})

test('#1257 BR-B2B-070: TGB71 (the file is not the pending one any more) comes back as logo_not_pending, 409, in the three languages', async () => {
  respond = (op) => (op.rpc === 'cms_decide_partner_logo' ? { error: { code: 'TGB71', message: 'not pending' } } : defaultAnswer(op))
  const res = await logosRoute.POST(json('POST', APPROVE), noCtx)
  assert.equal(res.status, 409)
  assert.deepEqual((await res.json()).error, { code: 'logo_not_pending' })
  assert.match(tPt('errors.logo_not_pending'), /chegou outro, ou alguém já decidiu/)
  for (const l of ['en', 'es']) assert.ok(messages[l].PartnerBrand.errors.logo_not_pending, l)
})

// ─── Pilot ───────────────────────────────────────────────────────────────────────────────────

test('#1257 BR-B2B-070: a pilot whose end is not after its start, or with one date only, never reaches the database', async () => {
  const cases: [Record<string, unknown>, string][] = [
    [{ pilot_starts_at: PILOT.pilot_ends_at, pilot_ends_at: PILOT.pilot_starts_at }, 'pilot_window'],
    [{ pilot_starts_at: PILOT.pilot_starts_at, pilot_ends_at: PILOT.pilot_starts_at }, 'pilot_window'],
    [{ pilot_starts_at: PILOT.pilot_starts_at, pilot_ends_at: null }, 'pilot_incomplete'],
    [{ pilot_starts_at: '', pilot_ends_at: PILOT.pilot_ends_at }, 'pilot_incomplete'],
    [{ pilot_starts_at: 'amanhã', pilot_ends_at: PILOT.pilot_ends_at }, 'invalid_date'],
  ]
  for (const [body, code] of cases) {
    const res = await brandRoute.PATCH(json('PATCH', body), clientCtx)
    assert.equal(res.status, 400, code)
    assert.deepEqual((await res.json()).error, { code })
  }
  assert.deepEqual(ops, [])
  assert.equal(tPt('errors.pilot_window'), 'O fim do piloto precisa vir depois do início.')
})

test('#1257 BR-B2B-070: the pilot is an upsert on client_id that writes the two pilot columns only', async () => {
  const res = await brandRoute.PATCH(json('PATCH', { ...PILOT, wifi_password: 'x', logo_status: 'approved' }), clientCtx)
  assert.equal(res.status, 200)
  const [write] = ops
  assert.equal(write.schema, 'partner')
  assert.equal(write.table, 'partner_brands')
  assert.equal(write.op, 'upsert')
  assert.deepEqual(write.payload, { client_id: CLIENT_ID, ...PILOT })
  assert.deepEqual(write.options, { onConflict: 'client_id' })

  // Clearing both is the partner leaving the product (item 9), and is allowed.
  ops = []
  assert.equal((await brandRoute.PATCH(json('PATCH', { pilot_starts_at: null, pilot_ends_at: null }), clientCtx)).status, 200)
  assert.deepEqual(ops[0].payload, { client_id: CLIENT_ID, pilot_starts_at: null, pilot_ends_at: null })

  // A client that does not exist is the foreign key, a 404.
  respond = (op) => (op.op === 'upsert' ? { error: { code: '23503', message: 'fk' } } : defaultAnswer(op))
  const missing = await brandRoute.PATCH(json('PATCH', PILOT), clientCtx)
  assert.equal(missing.status, 404)
  assert.deepEqual((await missing.json()).error, { code: 'client_not_found' })
})

test('#1257: the brand of the record never selects the Wi-Fi, and an empty record answers an empty brand', async () => {
  const res = await brandRoute.GET(json('GET'), clientCtx)
  assert.equal(res.status, 200)
  const { brand } = await res.json()
  assert.equal(brand.client_id, CLIENT_ID)
  assert.equal(brand.pilot_starts_at, null)
  assert.equal(brand.logo_status, null)
  assert.equal('wifi_password' in brand, false)
  assert.equal((await brandRoute.GET(json('GET'), { params: Promise.resolve({ clientId: 'x' }) })).status, 400)
})

// ─── Packages ────────────────────────────────────────────────────────────────────────────────

test('#1257 BR-B2B-070: a currency without an amount, or an amount without a currency, never reaches the database', async () => {
  const cases: [Record<string, unknown>, string][] = [
    [{ days: 7, price_cents: null, price_currency: 'BRL' }, 'price_incomplete'],
    [{ days: 7, price_currency: 'BRL' }, 'price_incomplete'],
    [{ days: 7, price_cents: 4990, price_currency: null }, 'price_incomplete'],
    [{ days: 7, price_cents: 4990, price_currency: '  ' }, 'price_incomplete'],
    [{ days: 7, price_cents: -1, price_currency: 'BRL' }, 'invalid_price'],
    [{ days: 7, price_cents: 49.9, price_currency: 'BRL' }, 'invalid_price'],
    [{ days: 7, price_cents: 4990, price_currency: 'REAIS' }, 'invalid_currency'],
    [{ days: 0, price_cents: 4990, price_currency: 'BRL' }, 'invalid_package'],
  ]
  for (const [body, code] of cases) {
    const res = await packagesRoute.PATCH(json('PATCH', body), noCtx)
    assert.equal(res.status, 400, JSON.stringify(body))
    assert.deepEqual((await res.json()).error, { code }, JSON.stringify(body))
  }
  assert.deepEqual(ops, [])
  assert.match(tPt('errors.price_incomplete'), /Preço e moeda vão juntos/)
})

test('#1257 BR-B2B-070: a price is written to the package with the currency in uppercase, and clearing writes both empty', async () => {
  assert.equal((await packagesRoute.PATCH(json('PATCH', { days: 7, price_cents: 4990, price_currency: 'brl' }), noCtx)).status, 200)
  assert.equal(ops[0].table, 'gift_day_packages')
  assert.deepEqual(ops[0].payload, { price_cents: 4990, price_currency: 'BRL' })
  assert.deepEqual(ops[0].filters, [['eq', 'days', 7]])

  ops = []
  assert.equal((await packagesRoute.PATCH(json('PATCH', { days: 7, price_cents: null, price_currency: null }), noCtx)).status, 200)
  assert.deepEqual(ops[0].payload, { price_cents: null, price_currency: null })

  respond = (op) => (op.table === 'gift_day_packages' ? { data: null } : defaultAnswer(op))
  assert.equal((await packagesRoute.PATCH(json('PATCH', { days: 4, price_cents: null, price_currency: null }), noCtx)).status, 404)
})

test('#1257: the money field reads the pt-BR comma and the dot, and refuses more than two decimals', () => {
  assert.equal(lib.parseMoneyInput('49,90'), 4990)
  assert.equal(lib.parseMoneyInput('49.9'), 4990)
  assert.equal(lib.parseMoneyInput(' 49 '), 4900)
  assert.equal(lib.parseMoneyInput(''), null)
  assert.ok(Number.isNaN(lib.parseMoneyInput('49,999')))
  assert.ok(Number.isNaN(lib.parseMoneyInput('R$ 49')))
  assert.equal(lib.formatMoneyInput(4990), '49,90')
  assert.equal(lib.formatMoneyInput(5), '0,05')
  assert.equal(lib.formatMoneyInput(null), '')
})

// ─── Settings ────────────────────────────────────────────────────────────────────────────────

test('#1257 BR-B2B-070: the settings carry the brand term from the database and only the three switches of this product', async () => {
  const res = await settingsRoute.GET(json('GET'), noCtx)
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.term_days, 30)
  assert.deepEqual(
    body.switches.map((s: { key: string; is_on: boolean }) => [s.key, s.is_on]),
    [
      ['partner.brand_color_enabled', false],
      ['partner.gift_ios_enabled', true],
      ['partner.gift_android_enabled', true],
    ]
  )
  assert.equal('secrets' in body, false)
  assert.deepEqual(body.packages, [{ days: 1, price_cents: null, price_currency: null }])
  // The term is the database's (item 7: no literal number in the code).
  assert.equal(lib.BRAND_TERM_KEY, 'partner_brand.days')
})

test('#1257 BR-IDIOMA-001: every refusal code and every switch has a sentence in pt, en and es, and the three namespaces have the same keys', () => {
  const keys = (o: unknown, p = ''): string[] =>
    o && typeof o === 'object' ? Object.entries(o).flatMap(([k, v]) => keys(v, p ? `${p}.${k}` : k)) : [p]
  const pt = keys(messages.pt.PartnerBrand).sort()
  for (const l of ['en', 'es']) assert.deepEqual(keys(messages[l].PartnerBrand).sort(), pt, l)
  for (const c of lib.PARTNER_BRAND_ERROR_CODES) assert.ok(pt.includes(`errors.${c}`), c)
  for (const k of lib.PARTNER_SWITCH_KEYS) assert.ok(pt.includes(`switches.items.${lib.switchId(k)}.label`), k)
  for (const l of ['pt', 'en', 'es']) {
    assert.ok(messages[l].Navigation.partner_brand, l)
    assert.ok(messages[l].Clients.editor.tabs.brand, l)
  }
})
