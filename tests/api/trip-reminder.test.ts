/**
 * #1233: the CMS screen of the planned trip and the trip reminder, its seven API doors under
 * `/api/admin/trip-reminder/` and the pieces the screen derives. Contract:
 * `docs/contracts/viagem-marcada-e-lembrete.md` (Parte 1, "CMS", "#1233 CMS").
 *
 * Pinned here: admin only, nothing reaches the database or the Edge Function before the gate; every
 * write passes `p_actor` = the session's `auth.users.id`, never the body's; a provider secret goes
 * to the database only as a bound argument of a POST `rpc()` and never comes back, never in a log
 * and never in an error (BR-COMUNICACAO-024 item 10, condition of the security-reviewer in #1230);
 * the test send speaks the interface fixed with #1231 and shows the failure code without a phone
 * number (item 9); the send log and the panel read with the documented arguments.
 *
 * Run with: npm run test:api
 */

import { test, before, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { NextRequest } from 'next/server'

const OPERATOR_UID = 'cccccccc-2222-4333-8444-555555555555'
const SESSION_TOKEN = 'session-access-token-of-the-admin'
const SECRET = 'EAAG-provider-token-9f8e7d6c5b4a-WXYZ'

type RpcCall = { schema: string; fn: string; args: unknown; options: unknown }
let calls: RpcCall[]
let role: string
let token: string | null
let answers: Record<string, { data?: unknown; error?: { code: string; message: string } }>
let fetchCalls: { url: string; init: RequestInit }[]
let fetchReply: () => Promise<Response>
let logged: string[]
const realFetch = globalThis.fetch
const realConsole = { error: console.error, warn: console.warn, log: console.log, info: console.info }

function client() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = {
    auth: {
      getUser: async () => ({ data: { user: { id: OPERATOR_UID, email: 'admin@tuggi.app' } }, error: null }),
      getSession: async () => ({ data: { session: token ? { access_token: token } : null }, error: null }),
    },
    schema: (schema: string) => ({
      from: () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const q: any = {
          select: () => q,
          eq: () => q,
          maybeSingle: async () => ({ data: { id: 'cms-1', email: 'admin@tuggi.app', role, is_active: true }, error: null }),
        }
        return q
      },
      rpc: async (fn: string, args?: unknown, options?: unknown) => {
        calls.push({ schema, fn, args, options })
        const a = answers[fn]
        return { data: a?.data ?? null, error: a?.error ?? null }
      },
    }),
  }
  return c
}

/* eslint-disable @typescript-eslint/no-explicit-any */
let settingsRoute: any
let switchesRoute: any
let templatesRoute: any
let secretsRoute: any
let testSendRoute: any
let sendsRoute: any
let panelRoute: any
let lib: any
let rewards: any
/* eslint-enable @typescript-eslint/no-explicit-any */

const root = resolve(import.meta.dirname, '../..')

before(async () => {
  mock.module('next/headers', { namedExports: { cookies: async () => ({ get: () => undefined, getAll: () => [] }) } })
  mock.module('@/lib/core/supabase-client', {
    namedExports: {
      getSupabaseRouteHandler: () => client(),
      getSupabaseService: () => client(),
      getSupabase: () => client(),
    },
  })
  settingsRoute = await import('@/app/api/admin/trip-reminder/settings/route')
  switchesRoute = await import('@/app/api/admin/trip-reminder/switches/route')
  templatesRoute = await import('@/app/api/admin/trip-reminder/templates/route')
  secretsRoute = await import('@/app/api/admin/trip-reminder/secrets/route')
  testSendRoute = await import('@/app/api/admin/trip-reminder/test-send/route')
  sendsRoute = await import('@/app/api/admin/trip-reminder/sends/route')
  panelRoute = await import('@/app/api/admin/trip-reminder/panel/route')
  lib = await import('@/lib/trip-reminder/settings')
  rewards = await import('@/lib/rewards/settings')
})

beforeEach(() => {
  calls = []
  role = 'admin'
  token = SESSION_TOKEN
  answers = {}
  fetchCalls = []
  fetchReply = async () => Response.json({ ok: true, channel: 'email' })
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    fetchCalls.push({ url: String(url), init: init ?? {} })
    return fetchReply()
  }) as typeof fetch
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co'
  process.env.CMS_JOB_SECRET = 'cms-job-secret'
  logged = []
  const capture =
    (sink: (...args: unknown[]) => void) =>
    (...args: unknown[]) => {
      logged.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))
      void sink
    }
  console.error = capture(realConsole.error)
  console.warn = capture(realConsole.warn)
  console.log = capture(realConsole.log)
  console.info = capture(realConsole.info)
})

afterEach(() => {
  globalThis.fetch = realFetch
  Object.assign(console, realConsole)
})

let seq = 0
const req = (method: string, path: string, body?: unknown) =>
  new Request(`http://localhost/api/admin/trip-reminder${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `10.9.1.${(seq += 1) % 250}` },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  }) as unknown as NextRequest
const nextReq = (path: string) => {
  const r = req('GET', path)
  // Route handlers read `req.nextUrl`; a plain Request has only `url`.
  Object.defineProperty(r, 'nextUrl', { value: new URL(r.url) })
  return r
}
const ctx = { params: Promise.resolve({}) }

const TEMPLATE = {
  channel: 'whatsapp',
  piece: 'trip_reminder_before',
  language: 'pt',
  template_name: 'tuggi_trip_reminder_before_v1',
  provider_language: 'pt_BR',
}

test('#1233 BR-COMUNICACAO-024 items 9 and 10: only an admin reaches the seven doors, and nothing runs before the gate', async () => {
  for (const r of ['editor', 'viewer', 'client']) {
    role = r
    const statuses = [
      (await settingsRoute.GET(req('GET', '/settings'), ctx)).status,
      (await switchesRoute.PATCH(req('PATCH', '/switches', { key: 'channel.sms', is_on: true }), ctx)).status,
      (await templatesRoute.PUT(req('PUT', '/templates', TEMPLATE), ctx)).status,
      (await secretsRoute.PUT(req('PUT', '/secrets', { name: 'whatsapp.access_token', value: SECRET }), ctx)).status,
      (await testSendRoute.POST(req('POST', '/test-send', { piece: 'trip_reminder_day', channel: 'email' }), ctx)).status,
      (await sendsRoute.GET(nextReq('/sends'), ctx)).status,
      (await panelRoute.GET(req('GET', '/panel'), ctx)).status,
    ]
    assert.deepEqual(statuses, [403, 403, 403, 403, 403, 403, 403], r)
  }
  assert.deepEqual(calls, [])
  assert.deepEqual(fetchCalls, [])
})

test('#1233 BR-COMUNICACAO-023 item 5: every write passes p_actor = the session uid, whatever the body says', async () => {
  answers.cms_set_feature_switch = { data: { key: 'channel.sms', is_on: true, updated_at: '2026-11-23T18:00:00Z', ask_phone_effective: false } }
  answers.cms_set_provider_secret = { data: { name: 'email.api_key', channel: 'email', configured_at: '2026-11-23T18:00:00Z', last4: 'WXYZ' } }
  const sw =await switchesRoute.PATCH(req('PATCH', '/switches', { key: 'channel.sms', is_on: true, p_actor: 'someone-else' }), ctx)
  assert.equal(sw.status, 200)
  assert.equal((await sw.json()).ask_phone_effective, false)
  assert.equal((await templatesRoute.PUT(req('PUT', '/templates', { ...TEMPLATE, actor: 'x' }), ctx)).status, 200)
  assert.equal(
    (await templatesRoute.PUT(req('PUT', '/templates', { channel: 'whatsapp', piece: 'phone_confirmation', language: 'fr', template_name: null }), ctx)).status,
    200
  )
  assert.equal((await secretsRoute.PUT(req('PUT', '/secrets', { name: 'email.api_key', value: SECRET, p_actor: 'x' }), ctx)).status, 200)

  assert.deepEqual(
    calls.map(({ schema, fn, args }) => ({ schema, fn, args })),
    [
      { schema: 'drive', fn: 'cms_set_feature_switch', args: { p_key: 'channel.sms', p_is_on: true, p_actor: OPERATOR_UID } },
      {
        schema: 'drive',
        fn: 'cms_set_message_template',
        args: {
          p_channel: 'whatsapp',
          p_piece: 'trip_reminder_before',
          p_language: 'pt',
          p_template_name: 'tuggi_trip_reminder_before_v1',
          p_provider_language: 'pt_BR',
          p_actor: OPERATOR_UID,
        },
      },
      {
        schema: 'drive',
        fn: 'cms_set_message_template',
        args: { p_channel: 'whatsapp', p_piece: 'phone_confirmation', p_language: 'fr', p_template_name: null, p_provider_language: null, p_actor: OPERATOR_UID },
      },
      { schema: 'drive', fn: 'cms_set_provider_secret', args: { p_name: 'email.api_key', p_value: SECRET, p_actor: OPERATOR_UID } },
    ]
  )
})

test('#1233 BR-COMUNICACAO-024 item 10: the secret goes as a bound argument of a POST rpc and never comes back, not even in a log', async () => {
  // An answer that (wrongly) carried the value: the route must still drop it.
  answers.cms_set_provider_secret = {
    data: { name: 'whatsapp.access_token', channel: 'whatsapp', configured_at: '2026-11-23T18:00:00Z', last4: 'WXYZ', value: SECRET },
  }
  const res = await secretsRoute.PUT(req('PUT', '/secrets', { name: 'whatsapp.access_token', value: SECRET }), ctx)
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('cache-control'), 'no-store')
  const text = await res.text()
  assert.deepEqual(JSON.parse(text), { name: 'whatsapp.access_token', channel: 'whatsapp', configured_at: '2026-11-23T18:00:00Z', last4: 'WXYZ' })
  assert.equal(text.includes(SECRET), false)

  // supabase-js sends `rpc()` as POST unless `{ get: true }` (or `head`) is passed: no options at all.
  assert.equal(calls.length, 1)
  assert.equal(calls[0].options, undefined)

  // Refusals: the value is in no reply and in no log line.
  for (const code of ['TGJ20', 'TGJ21', '42501', 'XX000']) {
    answers.cms_set_provider_secret = { error: { code, message: `refused ${SECRET}` } }
    const refused = await secretsRoute.PUT(req('PUT', '/secrets', { name: 'whatsapp.access_token', value: SECRET }), ctx)
    const body = await refused.text()
    assert.equal(body.includes(SECRET), false, code)
    assert.equal(body.includes('refused'), false, `${code}: the database message never travels`)
  }
  assert.equal(logged.some((line) => line.includes(SECRET)), false)
  assert.ok(logged.some((line) => line.includes('TGJ21')), 'the SQLSTATE is what the log keeps')
})

test('#1233 BR-COMUNICACAO-024 item 10: the refusals of a secret write are named, with their status', async () => {
  const cases: [string, number, string][] = [
    ['TGJ20', 404, 'unknown_slot'],
    ['TGJ21', 400, 'invalid_secret'],
    ['42501', 403, 'forbidden'],
  ]
  for (const [code, status, name] of cases) {
    answers.cms_set_provider_secret = { error: { code, message: '' } }
    const res = await secretsRoute.PUT(req('PUT', '/secrets', { name: 'sms.auth_token', value: SECRET }), ctx)
    assert.equal(res.status, status, code)
    assert.equal((await res.json()).error.code, name, code)
  }
  answers.cms_set_feature_switch = { error: { code: 'TGJ22', message: '' } }
  assert.equal((await switchesRoute.PATCH(req('PATCH', '/switches', { key: 'channel.fax', is_on: true }), ctx)).status, 404)
  answers.cms_set_message_template = { error: { code: 'TGJ23', message: '' } }
  const tgj23 = await templatesRoute.PUT(req('PUT', '/templates', TEMPLATE), ctx)
  assert.equal(tgj23.status, 400)
  assert.equal((await tgj23.json()).error.code, 'not_a_message_channel')
})

test('#1233: a malformed body never reaches the database', async () => {
  const badSwitches = [{ key: 'channel.sms' }, { key: 'channel.sms', is_on: 'yes' }, { key: 'Channel SMS', is_on: true }, { key: 'x'.repeat(130) + '.a', is_on: true }]
  for (const body of badSwitches) assert.equal((await switchesRoute.PATCH(req('PATCH', '/switches', body), ctx)).status, 400, JSON.stringify(body))

  const badTemplates = [
    { ...TEMPLATE, channel: 'email' },
    { ...TEMPLATE, piece: 'test' },
    { ...TEMPLATE, language: 'pt-BR' },
    { ...TEMPLATE, template_name: 'Tuggi Reminder' },
    { ...TEMPLATE, template_name: 'a'.repeat(513) },
    { ...TEMPLATE, provider_language: 'pt-BR' },
  ]
  for (const body of badTemplates) assert.equal((await templatesRoute.PUT(req('PUT', '/templates', body), ctx)).status, 400, JSON.stringify(body))

  const badSecrets = [
    { name: 'whatsapp.access_token', value: '   ' },
    { name: 'whatsapp.access_token', value: 'x'.repeat(4097) },
    { name: 'whatsapp', value: SECRET },
    { name: 'whatsapp.access_token', value: 42 },
  ]
  for (const body of badSecrets) {
    const res = await secretsRoute.PUT(req('PUT', '/secrets', body), ctx)
    assert.equal(res.status, 400)
    assert.equal((await res.text()).includes(SECRET), false)
  }
  assert.equal((await secretsRoute.PUT(req('PUT', '/secrets', '{not json'), ctx)).status, 400)
  assert.deepEqual(calls, [])
})

test('#1233 BR-COMUNICACAO-024 item 10: the settings read hands a slot as configured_at and last4 only', async () => {
  answers.cms_get_trip_settings = {
    data: {
      switches: [{ key: 'channel.push', is_on: true, channel_kind: 'device', channel_order: 1, rule_id: 'BR-COMUNICACAO-023', updated_at: null }],
      numbers: { 'welcome.validity_days': { value: 5, unit: 'days', rule_id: 'BR-MONETIZACAO-086', updated_at: null } },
      ask_phone_effective: false,
      templates: [],
      secrets: [{ name: 'email.api_key', channel: 'email', description: 'E-mail provider API key.', configured_at: '2026-11-23T18:00:00Z', last4: 'WXYZ', value: SECRET }],
      secret_changes: [{ name: 'email.api_key', changed_at: '2026-11-23T18:00:00Z', changed_by: OPERATOR_UID, changed_by_email: 'admin@tuggi.app' }],
    },
  }
  const res = await settingsRoute.GET(req('GET', '/settings'), ctx)
  assert.equal(res.status, 200)
  const text = await res.text()
  assert.equal(text.includes(SECRET), false)
  const body = JSON.parse(text)
  assert.deepEqual(body.secrets, [{ name: 'email.api_key', channel: 'email', description: 'E-mail provider API key.', configured_at: '2026-11-23T18:00:00Z', last4: 'WXYZ' }])
  assert.equal(body.secret_changes.length, 1)
  assert.deepEqual(calls, [{ schema: 'drive', fn: 'cms_get_trip_settings', args: undefined, options: undefined }])
})

test('#1233 BR-COMUNICACAO-024 item 9: the test send calls trip-message-test as the admin and shows its verdict', async () => {
  const ok = await testSendRoute.POST(req('POST', '/test-send', { piece: 'trip_reminder_day', channel: 'email' }), ctx)
  assert.equal(ok.status, 200)
  assert.deepEqual(await ok.json(), { ok: true, channel: 'email' })
  assert.equal(fetchCalls.length, 1)
  const call = fetchCalls[0]
  assert.equal(call.url, 'https://project.supabase.co/functions/v1/trip-message-test')
  assert.equal(call.init.method, 'POST')
  assert.deepEqual(JSON.parse(String(call.init.body)), { piece: 'trip_reminder_day', channel: 'email' })
  const headers = call.init.headers as Record<string, string>
  assert.equal(headers['x-cms-job-secret'], 'cms-job-secret')
  assert.equal(headers.Authorization, `Bearer ${SESSION_TOKEN}`)

  // A failure is shown with its code; a provider text that carries a number is not.
  fetchReply = async () => Response.json({ ok: false, channel: 'whatsapp', error_code: '131026' })
  const failed = await testSendRoute.POST(req('POST', '/test-send', { piece: 'phone_confirmation', channel: 'whatsapp' }), ctx)
  assert.equal(failed.status, 200)
  assert.deepEqual(await failed.json(), { ok: false, channel: 'whatsapp', error_code: '131026' })

  fetchReply = async () => Response.json({ ok: false, channel: 'sms', error_code: 'The number +5511987654321 is invalid' })
  assert.deepEqual(await (await testSendRoute.POST(req('POST', '/test-send', { piece: 'trip_reminder_day', channel: 'sms' }), ctx)).json(), {
    ok: false,
    channel: 'sms',
    error_code: 'unknown',
  })
  fetchReply = async () => Response.json({ ok: false, channel: 'sms', error_code: '5511987654321' })
  assert.equal((await (await testSendRoute.POST(req('POST', '/test-send', { piece: 'trip_reminder_day', channel: 'sms' }), ctx)).json()).error_code, 'unknown')

  // The function did not answer in the interface: the screen still gets a code.
  fetchReply = async () => new Response('Internal Server Error', { status: 500 })
  const down = await testSendRoute.POST(req('POST', '/test-send', { piece: 'trip_reminder_day', channel: 'push' }), ctx)
  assert.equal(down.status, 500)
  assert.deepEqual(await down.json(), { ok: false, channel: 'push', error_code: 'http_500' })
  fetchReply = async () => Response.json({ error: 'forbidden' }, { status: 403 })
  assert.deepEqual(await (await testSendRoute.POST(req('POST', '/test-send', { piece: 'trip_reminder_day', channel: 'push' }), ctx)).json(), {
    ok: false,
    channel: 'push',
    error_code: 'forbidden',
  })
})

test('#1233: the test send refuses a bad body and a session without token before calling the function', async () => {
  for (const body of [{ piece: 'test', channel: 'email' }, { piece: 'trip_reminder_day', channel: 'fax' }, { channel: 'email' }]) {
    assert.equal((await testSendRoute.POST(req('POST', '/test-send', body), ctx)).status, 400, JSON.stringify(body))
  }
  token = null
  const relogin = await testSendRoute.POST(req('POST', '/test-send', { piece: 'trip_reminder_day', channel: 'email' }), ctx)
  assert.equal(relogin.status, 401)
  assert.equal((await relogin.json()).error_code, 'relogin')
  delete process.env.CMS_JOB_SECRET
  token = SESSION_TOKEN
  const unavailable = await testSendRoute.POST(req('POST', '/test-send', { piece: 'trip_reminder_day', channel: 'email' }), ctx)
  assert.equal(unavailable.status, 503)
  assert.equal((await unavailable.json()).error_code, 'unavailable')
  assert.deepEqual(fetchCalls, [])
})

test('#1233 BR-COMUNICACAO-024 item 9 and BR-USUARIO-055 item 6.c: the send log and the panel read with the documented arguments', async () => {
  answers.cms_get_message_sends = {
    data: [{ id: 's1', created_at: '2026-11-23T18:00:00Z', updated_at: '2026-11-23T18:00:05Z', piece: 'test', channel: 'email', outcome: 'sent', reason: null, phone_last4: null }],
  }
  const all = await sendsRoute.GET(nextReq('/sends'), ctx)
  assert.equal(all.status, 200)
  assert.equal((await all.json()).sends.length, 1)
  assert.equal((await sendsRoute.GET(nextReq('/sends?channel=whatsapp&limit=200'), ctx)).status, 200)
  for (const bad of ['/sends?limit=201', '/sends?limit=0', '/sends?limit=abc', '/sends?channel=Whats%20App']) {
    assert.equal((await sendsRoute.GET(nextReq(bad), ctx)).status, 400, bad)
  }
  assert.equal((await panelRoute.GET(req('GET', '/panel'), ctx)).status, 200)
  assert.deepEqual(
    calls.map(({ fn, args }) => ({ fn, args })),
    [
      { fn: 'cms_get_message_sends', args: { p_channel: null, p_limit: 50 } },
      { fn: 'cms_get_message_sends', args: { p_channel: 'whatsapp', p_limit: 200 } },
      { fn: 'cms_get_planned_trips_panel', args: undefined },
    ]
  )
})

test('#1233 BR-MONETIZACAO-086 2.d and BR-MONETIZACAO-091: the numbers go to the shared reward editor, with the eve warning on the welcome validity', () => {
  const settings = lib.numbersAsRewardSettings({
    'welcome.minutes': { value: 60, unit: 'minutes', rule_id: 'BR-MONETIZACAO-058', updated_at: null },
    'welcome.validity_days': { value: 5, unit: 'days', rule_id: 'BR-MONETIZACAO-086', updated_at: null },
    'planned_trip.interval_months': { value: 6, unit: 'months', rule_id: 'BR-MONETIZACAO-091', updated_at: null },
  })
  assert.deepEqual(
    settings.map((s: { key: string; unit: string | null; rule_id: string | null }) => [s.key, s.unit, s.rule_id]),
    [
      ['planned_trip.interval_months', 'months', 'BR-MONETIZACAO-091'],
      ['welcome.minutes', 'minutes', 'BR-MONETIZACAO-058'],
      ['welcome.validity_days', 'days', 'BR-MONETIZACAO-086'],
    ]
  )
  assert.equal(rewards.hintOf('welcome.validity_days'), 'Acima de 5 dias, as boas-vindas perdem o aviso da véspera.')
  assert.equal(rewards.hintOf('welcome.minutes'), null)
  assert.equal(rewards.programOf('planned_trip.lead_days'), 'planned_trip')
  assert.equal(rewards.validateRewardValue(6, 'months'), null)
  assert.equal(rewards.validateRewardValue(1.5, 'months'), 'not_integer')
  // The welcome grant stopped reading earned_credit.validity_days in #1230: its label may not say otherwise.
  assert.equal(rewards.labelOf('earned_credit.validity_days').includes('boas-vindas'), false)
})

test('#1233 BR-COMUNICACAO-024 item 5: the confirmation of the number is tested only on a phone channel', () => {
  assert.equal(lib.canTest('phone_confirmation', 'phone'), true)
  assert.equal(lib.canTest('phone_confirmation', 'email'), false)
  assert.equal(lib.canTest('phone_confirmation', 'device'), false)
  assert.equal(lib.canTest('trip_reminder_day', 'device'), true)
  const channels = lib.reminderChannels([
    { key: 'trip_reminder.enabled', is_on: true, channel_kind: null, channel_order: null },
    { key: 'channel.sms', is_on: false, channel_kind: 'phone', channel_order: 4 },
    { key: 'channel.push', is_on: true, channel_kind: 'device', channel_order: 1 },
  ])
  assert.deepEqual(channels, [
    { name: 'push', kind: 'device', is_on: true },
    { name: 'sms', kind: 'phone', is_on: false },
  ])
})

test('#1233: the screen is Portuguese only and its page names the namespace it reads', () => {
  const page = readFileSync(resolve(root, 'app/[locale]/admin/trip-reminder/page.tsx'), 'utf8')
  assert.match(page, /locale="pt"/)
  assert.match(page, /TripReminder: ptMessages\.TripReminder/)
  const secrets = readFileSync(resolve(root, 'components/admin/trip-reminder/ProviderSecrets.tsx'), 'utf8')
  // The new value lives in an uncontrolled field: no React state may hold it.
  assert.equal(/type="password"[\s\S]{0,200}value=\{/.test(secrets), false)
  assert.match(secrets, /field\.value = ''/)
})
