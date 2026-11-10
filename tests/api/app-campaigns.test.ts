/**
 * #1192: the CMS screen of the campaigns of the app and its three API doors
 * (`/api/admin/app-campaigns`, `.../[id]`, `.../image`). Contract `docs/contracts/banco-para-cms.md`, Parte 29.
 *
 * Pinned here: admin only, nothing touches the database before the gate; the route writes
 * `drive.in_app_campaigns` on the service role with the parsed fields; a CHECK refusal comes back as
 * a code that reads as a sentence in the three CMS languages; the coupon of a gift campaign takes
 * the campaign's `ends_at` as `valid_until`, turns on with it and turns off with it (unless another
 * campaign that is on shares it); a coupon write that does not land is a 500, never a success; the
 * image door reads the type from the bytes.
 *
 * Run with: npm run test:api
 */

import { test, before, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createTranslator } from 'next-intl'
import type { NextRequest } from 'next/server'

const CAMPAIGN_ID = 'aaaaaaaa-1111-4222-8333-444444444444'
const COUPON_ID = 'bbbbbbbb-1111-4222-8333-444444444444'
const ENDS_AT = '2026-11-30T23:59:00.000Z'

interface Op {
  schema: string
  table: string
  op: 'select' | 'insert' | 'update'
  payload?: unknown
  filters: [string, string, unknown][]
}

interface Answer {
  data?: unknown
  error?: { code: string; message: string } | null
}

let role: string | null
let ops: Op[]
let uploads: { bucket: string; path: string; contentType: string }[]
/** Picks the answer of each database call; the default echoes a plausible row. */
let respond: (op: Op) => Answer

function campaignRow(over: Record<string, unknown> = {}) {
  return {
    id: CAMPAIGN_ID,
    internal_name: 'Black Friday',
    format: 'map_carousel',
    is_active: false,
    starts_at: null,
    ends_at: null,
    priority: 0,
    countries: [],
    content: { pt: { title: 'Black Friday no Tuggi', body: '', cta_label: 'Ver os descontos' } },
    image_url: null,
    action_type: 'open_path',
    action_path: '/plans',
    coupon_id: null,
    created_at: '2026-11-10T12:00:00.000Z',
    updated_at: '2026-11-10T12:00:00.000Z',
    ...over,
  }
}

function defaultAnswer(op: Op): Answer {
  if (op.table === 'in_app_campaigns' && op.op === 'select' && op.filters.some(([f]) => f === 'neq')) return { data: [] }
  if (op.table === 'in_app_campaigns' && op.op === 'select' && op.filters.length === 0) return { data: [campaignRow()] }
  if (op.table === 'in_app_campaigns' && op.op === 'select') return { data: { id: CAMPAIGN_ID, is_active: false } }
  if (op.table === 'in_app_campaigns') return { data: campaignRow(op.payload as Record<string, unknown>) }
  if (op.table === 'coupons') return { data: { id: COUPON_ID } }
  return { data: null }
}

function query(schema: string, table: string) {
  const op: Op = { schema, table, op: 'select', filters: [] }
  let recorded = false
  const finish = () => {
    if (table !== 'cms_users' && !recorded) {
      ops.push(op)
      recorded = true
    }
    if (table === 'cms_users') {
      return { data: role ? { id: 'cms-1', email: 'admin@tuggi.app', role, is_active: true } : null, error: null }
    }
    const a = respond(op)
    return { data: a.data ?? null, error: a.error ?? null }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q: any = {
    select: () => q,
    insert: (payload: unknown) => ((op.op = 'insert'), (op.payload = payload), q),
    update: (payload: unknown) => ((op.op = 'update'), (op.payload = payload), q),
    eq: (c: string, v: unknown) => (op.filters.push(['eq', c, v]), q),
    neq: (c: string, v: unknown) => (op.filters.push(['neq', c, v]), q),
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
          : { data: { user: { id: 'uid-1', email: 'admin@tuggi.app' } }, error: null },
    },
    schema: (schema: string) => ({ from: (table: string) => query(schema, table) }),
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, _bytes: unknown, opts: { contentType: string }) => {
          uploads.push({ bucket, path, contentType: opts.contentType })
          return { data: { path }, error: null }
        },
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://example.supabase.co/storage/v1/object/public/${bucket}/${path}` } }),
      }),
    },
  }
  return c
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let listRoute: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let itemRoute: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let imageRoute: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let lib: any

const root = resolve(import.meta.dirname, '../..')
const messages = Object.fromEntries(
  ['pt', 'en', 'es'].map((l) => [l, JSON.parse(readFileSync(resolve(root, `messages/${l}.json`), 'utf8'))])
)
const tPt = createTranslator({ locale: 'pt', messages: messages.pt, namespace: 'AppCampaigns' })

before(async () => {
  mock.module('next/headers', { namedExports: { cookies: async () => ({ get: () => undefined, getAll: () => [] }) } })
  mock.module('@/lib/core/supabase-client', {
    namedExports: {
      getSupabaseRouteHandler: () => client(),
      getSupabaseService: () => client(),
      getSupabase: () => client(),
    },
  })
  listRoute = await import('@/app/api/admin/app-campaigns/route')
  itemRoute = await import('@/app/api/admin/app-campaigns/[id]/route')
  imageRoute = await import('@/app/api/admin/app-campaigns/image/route')
  lib = await import('@/lib/campaigns/app-campaigns')
})

beforeEach(() => {
  role = 'admin'
  ops = []
  uploads = []
  respond = defaultAnswer
})

const json = (method: string, body: unknown, path = '') =>
  new Request(`http://localhost/api/admin/app-campaigns${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest
const noCtx = { params: Promise.resolve({}) }
const idCtx = { params: Promise.resolve({ id: CAMPAIGN_ID }) }

const OPEN_PATH = {
  internal_name: '  Black Friday planos ',
  format: 'map_carousel',
  priority: 10,
  countries: ['br', 'PT'],
  content: {
    pt: { title: 'Black Friday no Tuggi', body: 'Passes de horas com desconto até 30/11.', cta_label: 'Ver os descontos' },
    en: { title: 'Black Friday on Tuggi', body: '', cta_label: 'See the deals' },
    es: { title: '', body: '', cta_label: '' },
  },
  image_url: 'https://example.supabase.co/storage/v1/object/public/travel-app-images/in-app-campaigns/x.png',
  action_type: 'open_path',
  action_path: '/plans',
  starts_at: null,
  ends_at: null,
  is_active: true,
}

const GIFT = { ...OPEN_PATH, action_type: 'redeem_coupon', action_path: null, coupon_id: COUPON_ID, ends_at: ENDS_AT }

const writes = (table: string) => ops.filter((o) => o.table === table && o.op !== 'select')

// ─── Gate ────────────────────────────────────────────────────────────────────────────────────

test('#1192: only a platform admin reaches the campaign doors, and nothing touches the database before the gate', async () => {
  const png = new FormData()
  png.append('file', new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])]), 'a.png')
  for (const r of ['editor', 'viewer', 'client']) {
    role = r
    assert.equal((await listRoute.GET(json('GET', undefined), noCtx)).status, 403, r)
    assert.equal((await listRoute.POST(json('POST', OPEN_PATH), noCtx)).status, 403, r)
    assert.equal((await itemRoute.PATCH(json('PATCH', { is_active: true }, `/${CAMPAIGN_ID}`), idCtx)).status, 403, r)
    const upload = new Request('http://localhost/api/admin/app-campaigns/image', { method: 'POST', body: png })
    assert.equal((await imageRoute.POST(upload as unknown as NextRequest, noCtx)).status, 403, r)
  }
  role = null
  assert.equal((await listRoute.POST(json('POST', OPEN_PATH), noCtx)).status, 401)
  assert.equal((await itemRoute.PATCH(json('PATCH', { is_active: true }, `/${CAMPAIGN_ID}`), idCtx)).status, 401)
  assert.deepEqual(ops, [])
  assert.deepEqual(uploads, [])
})

// ─── Write ───────────────────────────────────────────────────────────────────────────────────

test('#1192: an admin creates a campaign on drive.in_app_campaigns with the parsed fields (trimmed name, uppercase countries, blank language left out)', async () => {
  const res = await listRoute.POST(json('POST', OPEN_PATH), noCtx)
  assert.equal(res.status, 201)
  const [insert] = writes('in_app_campaigns')
  assert.equal(insert.schema, 'drive')
  assert.equal(insert.op, 'insert')
  assert.deepEqual(insert.payload, {
    internal_name: 'Black Friday planos',
    format: 'map_carousel',
    priority: 10,
    countries: ['BR', 'PT'],
    content: {
      pt: { title: 'Black Friday no Tuggi', body: 'Passes de horas com desconto até 30/11.', cta_label: 'Ver os descontos' },
      en: { title: 'Black Friday on Tuggi', body: '', cta_label: 'See the deals' },
    },
    image_url: OPEN_PATH.image_url,
    action_type: 'open_path',
    action_path: '/plans',
    coupon_id: null,
    starts_at: null,
    ends_at: null,
    is_active: true,
  })
  // An open_path campaign has no coupon to follow it.
  assert.deepEqual(writes('coupons'), [])
})

test('#1192 BR-IDIOMA-001: a CHECK refusal comes back as a code, and the code reads as a sentence', async () => {
  const cases: [string, string, string][] = [
    ['23514', 'new row for relation "in_app_campaigns" violates check constraint "in_app_campaigns_image_url_ck"', 'invalid_image_url'],
    ['23514', 'new row for relation "in_app_campaigns" violates check constraint "in_app_campaigns_action_path_ck"', 'invalid_action_path'],
    ['23514', 'new row for relation "in_app_campaigns" violates check constraint "in_app_campaigns_countries_ck"', 'invalid_countries'],
    ['23514', 'new row for relation "in_app_campaigns" violates check constraint "in_app_campaigns_window_ck"', 'invalid_window'],
    ['23514', 'new row for relation "in_app_campaigns" violates check constraint "in_app_campaigns_content_ck"', 'invalid_content'],
    ['23503', 'insert or update on table "in_app_campaigns" violates foreign key constraint "in_app_campaigns_coupon_id_fkey"', 'coupon_not_found'],
  ]
  for (const [code, message, expected] of cases) {
    ops = []
    respond = (op) => (op.table === 'in_app_campaigns' && op.op === 'insert' ? { error: { code, message } } : defaultAnswer(op))
    const res = await listRoute.POST(json('POST', OPEN_PATH), noCtx)
    assert.equal(res.status, 400, expected)
    const { error } = await res.json()
    assert.deepEqual(error, { code: expected })
  }
  assert.equal(tPt('errors.invalid_image_url'), 'O endereço da imagem precisa começar com https://. Envie a imagem de novo.')
  assert.equal(tPt('errors.invalid_window'), 'O fim precisa vir depois do início.')
  assert.equal(
    tPt('errors.text_too_long', { lang: tPt('languages.en'), field: tPt('fields.cta_label'), max: lib.CAMPAIGN_TEXT_MAX.cta_label }),
    'Inglês: Botão passou do limite de 20 caracteres.'
  )
})

test('#1192 BR-IDIOMA-001: every refusal code has a sentence in pt, en and es, and the three namespaces have the same keys', () => {
  const codes = [
    'invalid_body', 'invalid_internal_name', 'invalid_format', 'invalid_priority', 'invalid_countries', 'invalid_content',
    'incomplete_language', 'text_too_long', 'invalid_image_url', 'invalid_action', 'invalid_action_path', 'missing_coupon',
    'coupon_not_found', 'invalid_date', 'invalid_window', 'not_found', 'coupon_sync_failed', 'write_failed',
    'invalid_image', 'image_too_large', 'upload_failed',
  ]
  const keys = (o: unknown, p = ''): string[] =>
    o && typeof o === 'object' ? Object.entries(o).flatMap(([k, v]) => keys(v, p ? `${p}.${k}` : k)) : [p]
  const pt = keys(messages.pt.AppCampaigns).sort()
  for (const l of ['en', 'es']) assert.deepEqual(keys(messages[l].AppCampaigns).sort(), pt, l)
  for (const c of codes) assert.ok(pt.includes(`errors.${c}`), c)
  for (const l of ['pt', 'en', 'es']) assert.ok(messages[l].Navigation.app_campaigns, l)
})

test('#1192: a malformed campaign never reaches the database', async () => {
  const bad: [Record<string, unknown>, Record<string, unknown>][] = [
    [{ ...OPEN_PATH, internal_name: '  ' }, { code: 'invalid_internal_name' }],
    [{ ...OPEN_PATH, format: 'banner' }, { code: 'invalid_format' }],
    [{ ...OPEN_PATH, countries: ['BRA'] }, { code: 'invalid_countries' }],
    [{ ...OPEN_PATH, content: { pt: { title: 'x'.repeat(41), body: '', cta_label: 'Ver' } } }, { code: 'text_too_long', lang: 'pt', field: 'title' }],
    [{ ...OPEN_PATH, content: { en: { title: 'Hi', body: 'x'.repeat(91), cta_label: 'Go' } } }, { code: 'text_too_long', lang: 'en', field: 'body' }],
    [{ ...OPEN_PATH, content: { fr: { title: 'Salut', body: '', cta_label: '' } } }, { code: 'incomplete_language', lang: 'fr' }],
    [{ ...OPEN_PATH, content: { de: { title: 'Hallo', body: '', cta_label: 'Los' } } }, { code: 'invalid_content' }],
    [{ ...OPEN_PATH, content: { pt: { title: '', body: '', cta_label: '' } } }, { code: 'invalid_content' }],
    [{ ...OPEN_PATH, image_url: 'http://example.com/a.png' }, { code: 'invalid_image_url' }],
    [{ ...OPEN_PATH, action_path: '/r/praia-do-forte' }, { code: 'invalid_action_path' }],
    [{ ...OPEN_PATH, action_path: '/redeem?code=BF' }, { code: 'invalid_action_path' }],
    [{ ...OPEN_PATH, action_path: '//evil.example' }, { code: 'invalid_action_path' }],
    [{ ...OPEN_PATH, action_path: '/poi' }, { code: 'invalid_action_path' }],
    [{ ...GIFT, coupon_id: null }, { code: 'missing_coupon' }],
    [{ ...OPEN_PATH, starts_at: '2026-12-01T00:00:00Z', ends_at: '2026-11-30T00:00:00Z' }, { code: 'invalid_window' }],
  ]
  for (const [body, expected] of bad) {
    const res = await listRoute.POST(json('POST', body), noCtx)
    assert.equal(res.status, 400, JSON.stringify(expected))
    assert.deepEqual((await res.json()).error, expected)
  }
  assert.deepEqual(ops, [])
})

test('#1192: the destinations the form offers are paths the app opens, and the detail ones carry the id', () => {
  const id = 'cccccccc-1111-4222-8333-444444444444'
  for (const d of lib.CAMPAIGN_DESTINATIONS) {
    const path = lib.buildActionPath(d.path, id)
    assert.ok(lib.isAllowedActionPath(path), path)
    assert.deepEqual(lib.parseActionPath(path), { destination: d.path, id: d.id ? id : '' })
    // The database CHECK in_app_campaigns_action_path_ck.
    assert.match(path, /^\/([^/\s]\S*)?$/)
  }
  assert.equal(lib.buildActionPath('/route', id), `/route/${id}`)
  assert.equal(lib.buildActionPath('/poi', id), `/poi?id=${id}`)
  // Aliases a row may carry stay accepted; the route-link funnel prefix does not.
  assert.equal(lib.isAllowedActionPath('/map'), true)
  assert.equal(lib.isAllowedActionPath('/ranking'), true)
  assert.equal(lib.isAllowedActionPath('/r/slug'), false)
})

test('#1192: the status is drive.in_app_campaign_is_running, and the other three say why not', () => {
  const now = new Date('2026-11-20T12:00:00Z')
  const s = (is_active: boolean, starts_at: string | null, ends_at: string | null) => lib.campaignStatus({ is_active, starts_at, ends_at }, now)
  assert.equal(s(true, null, null), 'running')
  assert.equal(s(true, '2026-11-20T12:00:00Z', '2026-11-20T12:00:01Z'), 'running')
  assert.equal(s(true, '2026-11-21T00:00:00Z', null), 'scheduled')
  assert.equal(s(true, null, '2026-11-20T12:00:00Z'), 'ended')
  assert.equal(s(false, null, null), 'off')
  assert.equal(s(false, null, '2026-11-01T00:00:00Z'), 'off')
})

// ─── The coupon follows the campaign ─────────────────────────────────────────────────────────

test('#1192 BR-MONETIZACAO-047: linking a coupon to a campaign sets the coupon valid_until to the campaign ends_at, and a campaign on turns its coupon on', async () => {
  const res = await listRoute.POST(json('POST', GIFT), noCtx)
  assert.equal(res.status, 201)
  const [coupon] = writes('coupons')
  assert.equal(coupon.schema, 'drive')
  assert.deepEqual(coupon.payload, { valid_until: ENDS_AT, is_active: true })
  assert.deepEqual(coupon.filters, [['eq', 'id', COUPON_ID]])
})

test('#1192 BR-MONETIZACAO-047: a gift campaign created off fills valid_until and leaves the coupon switch alone', async () => {
  const res = await listRoute.POST(json('POST', { ...GIFT, is_active: false }), noCtx)
  assert.equal(res.status, 201)
  assert.deepEqual(writes('coupons').map((o) => o.payload), [{ valid_until: ENDS_AT }])
})

test('#1192: turning a gift campaign off turns its coupon off, unless another campaign that is on shares it', async () => {
  const before = { id: CAMPAIGN_ID, is_active: true }
  const after = campaignRow({ is_active: false, action_type: 'redeem_coupon', action_path: null, coupon_id: COUPON_ID, ends_at: ENDS_AT })
  respond = (op) => {
    if (op.table === 'in_app_campaigns' && op.op === 'select' && !op.filters.some(([f]) => f === 'neq')) return { data: before }
    if (op.table === 'in_app_campaigns' && op.op === 'update') return { data: after }
    return defaultAnswer(op)
  }
  const res = await itemRoute.PATCH(json('PATCH', { is_active: false }, `/${CAMPAIGN_ID}`), idCtx)
  assert.equal(res.status, 200)
  assert.deepEqual(writes('in_app_campaigns').map((o) => o.payload), [{ is_active: false }])
  assert.deepEqual(writes('coupons').map((o) => o.payload), [{ valid_until: ENDS_AT, is_active: false }])

  ops = []
  const shared = respond
  respond = (op) =>
    op.table === 'in_app_campaigns' && op.filters.some(([f]) => f === 'neq') ? { data: [{ id: 'other' }] } : shared(op)
  assert.equal((await itemRoute.PATCH(json('PATCH', { is_active: false }, `/${CAMPAIGN_ID}`), idCtx)).status, 200)
  assert.deepEqual(writes('coupons').map((o) => o.payload), [{ valid_until: ENDS_AT }])
})

test('#1192: a coupon write that does not land is a 500 coupon_sync_failed, never a success', async () => {
  respond = (op) => (op.table === 'coupons' ? { data: null } : defaultAnswer(op))
  const res = await listRoute.POST(json('POST', GIFT), noCtx)
  assert.equal(res.status, 500)
  const body = await res.json()
  assert.deepEqual(body.error, { code: 'coupon_sync_failed' })
  assert.ok(body.campaign, 'the campaign that was written comes back, so the list shows it')
  assert.equal(tPt('errors.coupon_sync_failed'), 'A campanha foi salva, mas o cupom não foi atualizado. Salve de novo.')
})

test('#1192: PATCH of a campaign that does not exist is a 404, and a bad id never reaches the database', async () => {
  respond = (op) => (op.table === 'in_app_campaigns' && op.op === 'select' ? { data: null } : defaultAnswer(op))
  assert.equal((await itemRoute.PATCH(json('PATCH', { is_active: true }, `/${CAMPAIGN_ID}`), idCtx)).status, 404)
  assert.deepEqual(writes('in_app_campaigns'), [])
  ops = []
  const badCtx = { params: Promise.resolve({ id: 'not-a-uuid' }) }
  assert.equal((await itemRoute.PATCH(json('PATCH', { is_active: true }, '/not-a-uuid'), badCtx)).status, 404)
  assert.deepEqual(ops, [])
})

// ─── Image ───────────────────────────────────────────────────────────────────────────────────

test('#1192: the image door reads the type from the bytes and answers an https public URL under in-app-campaigns/', async () => {
  const upload = (bytes: number[], name: string) => {
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), name)
    return new Request('http://localhost/api/admin/app-campaigns/image', { method: 'POST', body: form }) as unknown as NextRequest
  }
  const fake = await imageRoute.POST(upload([0x3c, 0x73, 0x76, 0x67, 0x3e, 0, 0, 0], 'x.png'), noCtx)
  assert.equal(fake.status, 400)
  assert.deepEqual((await fake.json()).error, { code: 'invalid_image' })
  assert.equal(uploads.length, 0)

  const res = await imageRoute.POST(upload([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2], 'x.png'), noCtx)
  assert.equal(res.status, 201)
  const { url } = await res.json()
  assert.equal(uploads.length, 1)
  assert.equal(uploads[0].bucket, 'travel-app-images')
  assert.match(uploads[0].path, /^in-app-campaigns\/[0-9a-f-]{36}\.png$/)
  assert.equal(uploads[0].contentType, 'image/png')
  assert.ok(url.startsWith('https://'))
})
