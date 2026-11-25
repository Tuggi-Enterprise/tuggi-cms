/**
 * #1264 (epic #1250), BR-COMUNICACAO-026 items 4, 6 and 7: the CMS writes, approves, refuses,
 * schedules, unschedules and cancels a partner message, and reads the list, the detail and the
 * senders. Contract `docs/contracts/tuggi-do-parceiro.md` §11.2.
 *
 * Pinned here: admin only, and nothing touches the database before the gate; `p_actor` is the
 * session's user, never the body's; a refusal or a cancellation without a reason never reaches the
 * database; each TGB9x comes back as a precise code (and a status) the panel turns into a sentence
 * that says what to do, in pt, en and es; the guide of item 7 carries the 18 examples of the copy.
 * Nothing here calls production: every database call is a fake.
 *
 * Run with: npx tsx --import ./tests/api/setup/console-to-stderr.mjs --experimental-test-module-mocks --test tests/api/partner-messages-1264.test.ts
 */

import { test, before, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { NextRequest } from 'next/server'

const MESSAGE = 'aaaaaaaa-1111-4222-8333-444444444444'
const CLIENT_ID = 'cccccccc-1111-4222-8333-444444444444'
const SESSION_UID = 'dddddddd-1111-4222-8333-444444444444'
const BODY_ACTOR = 'eeeeeeee-1111-4222-8333-444444444444'

interface Op {
  schema: string
  table?: string
  rpc?: string
  payload?: unknown
}

interface Answer {
  data?: unknown
  error?: { code: string; message: string; details?: string | null } | null
}

let role: string | null
let ops: Op[]
let respond: (op: Op) => Answer

const MESSAGE_JSON = {
  id: MESSAGE,
  client_id: CLIENT_ID,
  partner_handle: 'viladomar',
  partner_name: 'Pousada Vila do Mar',
  status: 'draft',
  texts: { pt: { title: 'Pousada Vila do Mar: jazz no sábado' } },
  numbers: { reach: 0 },
  audience_yes_now: 12,
}

function defaultAnswer(op: Op): Answer {
  if (op.rpc === 'cms_list_partner_messages') return { data: [{ id: MESSAGE, status: 'sent', reach: 3 }] }
  if (op.rpc === 'cms_partner_message_senders') return { data: [{ client_id: CLIENT_ID, can_send: true, monthly_cap: 4 }] }
  if (op.rpc === 'cms_get_partner_message') return { data: MESSAGE_JSON }
  if (op.rpc?.startsWith('cms_')) return { data: MESSAGE_JSON }
  return { data: null }
}

function query(schema: string, table: string) {
  const finish = () => {
    if (table === 'cms_users') {
      return { data: role ? { id: 'cms-1', email: 'admin@tuggi.app', role, is_active: true } : null, error: null }
    }
    if (table !== 'audit_logs') ops.push({ schema, table })
    return { data: null, error: null }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q: any = {
    select: () => q,
    insert: () => q,
    update: () => q,
    eq: () => q,
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
    from: (table: string) => query('public', table),
    schema: (schema: string) => ({
      from: (table: string) => query(schema, table),
      rpc: async (name: string, args?: unknown) => {
        const op: Op = { schema, rpc: name, payload: args }
        ops.push(op)
        const a = respond(op)
        return { data: a.data ?? null, error: a.error ?? null }
      },
    }),
  }
  return c
}

/* eslint-disable @typescript-eslint/no-explicit-any */
let listRoute: any
let sendersRoute: any
let oneRoute: any
let decisionRoute: any
let lib: any
/* eslint-enable @typescript-eslint/no-explicit-any */

const root = resolve(import.meta.dirname, '../..')
const messages = Object.fromEntries(['pt', 'en', 'es'].map((l) => [l, JSON.parse(readFileSync(resolve(root, `messages/${l}.json`), 'utf8'))]))

before(async () => {
  mock.module('next/headers', { namedExports: { cookies: async () => ({ get: () => undefined, getAll: () => [] }) } })
  mock.module('@/lib/core/supabase-client', {
    namedExports: {
      getSupabaseRouteHandler: () => client(),
      getSupabaseService: () => client(),
      getSupabase: () => client(),
    },
  })
  listRoute = await import('@/app/api/admin/partner-messages/route')
  sendersRoute = await import('@/app/api/admin/partner-messages/senders/route')
  oneRoute = await import('@/app/api/admin/partner-messages/[messageId]/route')
  decisionRoute = await import('@/app/api/admin/partner-messages/[messageId]/decision/route')
  lib = await import('@/lib/partner-message/message')
})

beforeEach(() => {
  role = 'admin'
  ops = []
  respond = defaultAnswer
})

const req = (method: string, body?: unknown, url = 'http://localhost/api/admin/partner-messages') =>
  new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }) as unknown as NextRequest
const noCtx = { params: Promise.resolve({}) }
const ctx = (messageId = MESSAGE) => ({ params: Promise.resolve({ messageId }) })
const decide = (body: Record<string, unknown>, id = MESSAGE) => decisionRoute.POST(req('POST', body), ctx(id))
const rpcs = () => ops.filter((o) => o.rpc).map((o) => o.rpc)

const DRAFT = {
  client_id: CLIENT_ID,
  requested_by: 'Marina, gerente da pousada',
  requested_at: '2026-11-24T14:00:00Z',
  button_kind: 'website',
  texts: {
    pt: {
      title: 'Pousada Vila do Mar: jazz no sábado',
      summary: 'Música ao vivo no jardim, sábado, 28 de novembro, às 20h. A entrada é livre.',
      subject: 'Pousada Vila do Mar: jazz no jardim, sábado às 20h',
      body: 'Neste sábado, o Trio Maré toca no jardim.',
      button_label: 'Reservar o jantar',
    },
  },
  actor: BODY_ACTOR,
}

// ─── Gate ────────────────────────────────────────────────────────────────────────────────────

test('#1264: without a CMS admin session every door refuses, and nothing touches the database', async () => {
  for (const r of ['editor', 'viewer', 'client']) {
    role = r
    assert.equal((await listRoute.GET(req('GET'), noCtx)).status, 403, r)
    assert.equal((await listRoute.POST(req('POST', DRAFT), noCtx)).status, 403, r)
    assert.equal((await sendersRoute.GET(req('GET'), noCtx)).status, 403, r)
    assert.equal((await oneRoute.GET(req('GET'), ctx())).status, 403, r)
    assert.equal((await oneRoute.PUT(req('PUT', DRAFT), ctx())).status, 403, r)
    assert.equal((await decide({ action: 'approve' })).status, 403, r)
  }
  role = null
  assert.equal((await listRoute.GET(req('GET'), noCtx)).status, 401)
  assert.equal((await decide({ action: 'approve' })).status, 401)
  assert.deepEqual(ops, [])
})

// ─── Reads ───────────────────────────────────────────────────────────────────────────────────

test('BR-COMUNICACAO-026 item 6.e: the list, the senders and the detail read the partner functions with the exact numbers', async () => {
  const list = await listRoute.GET(req('GET', undefined, `http://localhost/api/admin/partner-messages?client_id=${CLIENT_ID}&status=sent`), noCtx)
  assert.equal(list.status, 200)
  assert.deepEqual((await list.json()).messages, [{ id: MESSAGE, status: 'sent', reach: 3 }])
  const listOp = ops.find((o) => o.rpc === 'cms_list_partner_messages')!
  assert.equal(listOp.schema, 'partner')
  assert.deepEqual(listOp.payload, { p_client_id: CLIENT_ID, p_status: 'sent', p_limit: 200, p_offset: 0 })

  const senders = await sendersRoute.GET(req('GET'), noCtx)
  assert.equal(senders.status, 200)
  assert.equal((await senders.json()).senders[0].monthly_cap, 4)

  const one = await oneRoute.GET(req('GET'), ctx())
  assert.equal(one.status, 200)
  assert.equal((await one.json()).message.audience_yes_now, 12)
  assert.deepEqual(ops.find((o) => o.rpc === 'cms_get_partner_message')!.payload, { p_message_id: MESSAGE })
})

test('#1264: a bad id or filter is refused before the database; a message that does not exist answers 404', async () => {
  assert.equal((await listRoute.GET(req('GET', undefined, 'http://localhost/api/admin/partner-messages?client_id=nope'), noCtx)).status, 400)
  assert.equal((await listRoute.GET(req('GET', undefined, 'http://localhost/api/admin/partner-messages?status=gone'), noCtx)).status, 400)
  assert.equal((await oneRoute.GET(req('GET'), ctx('nope'))).status, 400)
  assert.equal((await decide({ action: 'approve' }, 'nope')).status, 400)
  assert.deepEqual(rpcs(), [])
  respond = (op) => (op.rpc === 'cms_get_partner_message' ? { data: null } : defaultAnswer(op))
  const res = await oneRoute.GET(req('GET'), ctx())
  assert.equal(res.status, 404)
  assert.deepEqual((await res.json()).error, { code: 'not_found' })
})

// ─── Writes ──────────────────────────────────────────────────────────────────────────────────

test('BR-COMUNICACAO-026 item 6.a: a new draft goes to cms_save_partner_message with who asked, the button and the texts, and the session as p_actor', async () => {
  const res = await listRoute.POST(req('POST', DRAFT), noCtx)
  assert.equal(res.status, 201)
  const op = ops.find((o) => o.rpc === 'cms_save_partner_message')!
  assert.equal(op.schema, 'partner')
  assert.deepEqual(op.payload, {
    p_message_id: null,
    p_client_id: CLIENT_ID,
    p_requested_by: 'Marina, gerente da pousada',
    p_requested_at: '2026-11-24T14:00:00.000Z',
    p_button_kind: 'website',
    p_button_ref: null,
    p_image_path: null,
    p_texts: { pt: DRAFT.texts.pt },
    p_actor: SESSION_UID,
  })
})

test('#1264: editing a draft keeps the message id, never changes the partner, and refuses a broken shape before the database', async () => {
  const res = await oneRoute.PUT(req('PUT', { ...DRAFT, client_id: undefined, button_kind: 'poi', button_ref: CLIENT_ID.toUpperCase() }), ctx())
  assert.equal(res.status, 200)
  const op = ops.find((o) => o.rpc === 'cms_save_partner_message')!
  assert.equal((op.payload as Record<string, unknown>).p_message_id, MESSAGE)
  assert.equal((op.payload as Record<string, unknown>).p_client_id, null)
  assert.equal((op.payload as Record<string, unknown>).p_button_ref, CLIENT_ID)
  ops = []
  const broken = [
    { ...DRAFT, client_id: 'nope' },
    { ...DRAFT, requested_by: '' },
    { ...DRAFT, requested_at: 'ontem' },
    { ...DRAFT, button_kind: 'whatsapp' },
    { ...DRAFT, button_kind: 'poi' },
    { ...DRAFT, texts: {} },
    { ...DRAFT, texts: { fr: DRAFT.texts.pt } },
    { ...DRAFT, texts: { pt: { ...DRAFT.texts.pt, summary: '' } } },
  ]
  for (const body of broken) {
    const r = await listRoute.POST(req('POST', body), noCtx)
    assert.equal(r.status, 422, JSON.stringify(body).slice(0, 80))
    assert.equal((await r.json()).error.code, 'invalid_field')
  }
  assert.deepEqual(rpcs(), [])
})

test('BR-COMUNICACAO-026 item 6.b: each act calls its function with the session as p_actor', async () => {
  const cases: [Record<string, unknown>, string, Record<string, unknown>][] = [
    [{ action: 'approve', actor: BODY_ACTOR }, 'cms_approve_partner_message', { p_message_id: MESSAGE, p_actor: SESSION_UID }],
    [{ action: 'refuse', reason: ' Fala em nome do Tuggi (7.a). ' }, 'cms_refuse_partner_message', { p_message_id: MESSAGE, p_reason: 'Fala em nome do Tuggi (7.a).', p_actor: SESSION_UID }],
    [{ action: 'schedule', local_send_at: '2026-12-01T10:00' }, 'cms_schedule_partner_message', { p_message_id: MESSAGE, p_local_send_at: '2026-12-01T10:00:00', p_actor: SESSION_UID }],
    [{ action: 'unschedule' }, 'cms_unschedule_partner_message', { p_message_id: MESSAGE, p_actor: SESSION_UID }],
    [{ action: 'cancel', reason: 'O parceiro desistiu.' }, 'cms_cancel_partner_message', { p_message_id: MESSAGE, p_reason: 'O parceiro desistiu.', p_actor: SESSION_UID }],
  ]
  for (const [body, fn, payload] of cases) {
    ops = []
    const res = await decide(body)
    assert.equal(res.status, 200, fn)
    const op = ops.find((o) => o.rpc === fn)!
    assert.equal(op.schema, 'partner', fn)
    assert.deepEqual(op.payload, payload, fn)
  }
})

test('#1264: a refusal or a cancellation without a reason, or above 1,000 characters, and a schedule without a wall clock never reach the database', async () => {
  for (const body of [
    { action: 'refuse' },
    { action: 'refuse', reason: '   ' },
    { action: 'cancel', reason: 'x'.repeat(1001) },
    { action: 'schedule' },
    { action: 'schedule', local_send_at: '2026-12-01T10:00:00Z' },
    { action: 'schedule', local_send_at: 'amanhã às 10h' },
    { action: 'publish' },
  ]) {
    const res = await decide(body)
    assert.ok([400, 422].includes(res.status), JSON.stringify(body))
  }
  assert.deepEqual(rpcs(), [])
})

// ─── Errors ──────────────────────────────────────────────────────────────────────────────────

test('BR-COMUNICACAO-026 items 4.a and 4.d: each TGB9x comes back as a precise code and status', async () => {
  const cases: [Answer['error'], number, Record<string, unknown>][] = [
    [{ code: 'TGB96', message: 'off' }, 409, { code: 'sending_off' }],
    [{ code: 'TGB90', message: 's', details: 'approved' }, 409, { code: 'wrong_state', state: 'approved' }],
    [{ code: 'TGB90', message: 's', details: 'started' }, 409, { code: 'already_started' }],
    [{ code: 'TGB90', message: 's', details: 'missing' }, 404, { code: 'not_found' }],
    [{ code: 'TGB91', message: 'p' }, 409, { code: 'partner_cannot_send' }],
    [{ code: 'TGB92', message: 'cap', details: '4' }, 409, { code: 'monthly_cap', cap: 4 }],
    [{ code: 'TGB93', message: '24h' }, 409, { code: 'too_close' }],
    [{ code: 'TGB94', message: 'w', details: 'window' }, 422, { code: 'outside_window' }],
    [{ code: 'TGB94', message: 'w', details: 'past' }, 422, { code: 'in_the_past' }],
    [{ code: 'TGB95', message: 'b', details: 'button' }, 422, { code: 'invalid_field', field: { rule: 'button' } }],
    [{ code: '57014', message: 'timeout' }, 500, { code: 'write_failed' }],
  ]
  for (const [error, status, expected] of cases) {
    respond = (op) => (op.rpc === 'cms_schedule_partner_message' ? { error } : defaultAnswer(op))
    const res = await decide({ action: 'schedule', local_send_at: '2026-12-01T10:00' })
    assert.equal(res.status, status, error!.code)
    assert.deepEqual((await res.json()).error, expected, error!.code)
  }
})

test('BR-COMUNICACAO-026 item 7: the automatic refusals of a text name the version and the rule', () => {
  const field = lib.fieldOfDetail
  assert.deepEqual(field('pt:partner_message_texts_title_ck'), { lang: 'pt', key: 'title', rule: 'length' })
  assert.deepEqual(field('en:partner_message_texts_push_marks_ck'), { lang: 'en', rule: 'push_marks' })
  assert.deepEqual(field('es:partner_message_texts_no_link_ck'), { lang: 'es', rule: 'no_link' })
  assert.deepEqual(field('it.summary'), { lang: 'it', key: 'summary', rule: 'missing' })
  assert.deepEqual(field('pt.image_alt'), { lang: 'pt', key: 'image_alt', rule: 'image_alt' })
  assert.deepEqual(field('fr'), { lang: 'fr', rule: 'language' })
  assert.deepEqual(field('partner_messages_image_path_ck'), { rule: 'image_path' })
  assert.deepEqual(field('partner_messages_requested_by_ck'), { rule: 'requested_by' })
  assert.deepEqual(field('texts'), { rule: 'texts' })
})

test('#1264: every error code and every field rule has a sentence in pt, en and es, and the field ones name the version', () => {
  const codes = ['invalid_body', 'invalid_id', 'not_found', 'wrong_state', 'already_started', 'partner_cannot_send', 'monthly_cap',
    'monthly_cap_plain', 'too_close', 'outside_window', 'in_the_past', 'sending_off', 'reason_required', 'read_failed', 'write_failed']
  const rules = ['length', 'push_marks', 'no_link', 'missing', 'image_alt', 'language', 'button', 'image_path', 'requested_by', 'texts', 'client_id', 'unknown']
  for (const l of ['pt', 'en', 'es']) {
    const e = messages[l].PartnerMessages.errors
    for (const c of codes) assert.ok(typeof e[c] === 'string' && e[c].length > 10, `${l} errors.${c}`)
    for (const r of rules) assert.ok(typeof e.field[r] === 'string' && e.field[r].length > 10, `${l} errors.field.${r}`)
    for (const r of ['length', 'push_marks', 'no_link', 'missing', 'image_alt']) assert.ok(e.field[r].startsWith('{lang}:'), `${l} ${r}`)
    assert.ok(e.monthly_cap.includes('{cap}'), l)
    for (const s of lib.PARTNER_MESSAGE_STATUSES) assert.ok(messages[l].PartnerMessages.status[s], `${l} status.${s}`)
    for (const f of lib.PARTNER_MESSAGE_FIELDS) assert.ok(messages[l].PartnerMessages.editor.fields[f.key], `${l} field ${f.key}`)
  }
})

test('BR-COMUNICACAO-026 item 7: the curator sees the 18 refusal examples of the copy, the same in pt, en and es', () => {
  const copy = readFileSync(resolve(root, '../docs/design/copy/mensagem-do-parceiro-2026-11.md'), 'utf8')
  const section = copy.slice(copy.indexOf('## 4. O que o curador recusa'), copy.indexOf('## 5.'))
  const rows = section.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| pt') && !l.startsWith('| :--'))
  assert.equal(rows.length, 18)
  rows.forEach((row, i) => {
    const cells = row.replace(/^\| | \|$/g, '').split(' | ')
    ;['pt', 'en', 'es'].forEach((l, j) => assert.equal(messages[l].PartnerMessages.guide.examples[i], cells[j], `${l} #${i + 1}`))
  })
})

test('#1264: the field counters are the limits of the copy (title 40, summary 110, subject 50, preheader 110, text 500, button 24)', () => {
  const max = Object.fromEntries(lib.PARTNER_MESSAGE_FIELDS.map((f: { key: string; max: number }) => [f.key, f.max]))
  assert.deepEqual(max, { title: 40, summary: 110, subject: 50, preheader: 110, body: 500, button_label: 24, image_alt: 200 })
  assert.deepEqual(lib.ACTIONS_BY_STATUS.draft, ['approve', 'refuse', 'cancel'])
  assert.deepEqual(lib.ACTIONS_BY_STATUS.sent, [])
})
