/**
 * #913 — the CMS side of the portal cancellation survey (BR-B2B-060 item 7): the list
 * (`GET /api/admin/clients/cancellations`) and "Marcar que falamos" / "Desfazer"
 * (`POST|DELETE /api/admin/clients/cancellations/<id>/contacted`).
 *
 * Pinned here: admin only; every RPC runs on the admin's own session (the functions check
 * `core.is_caller_platform_admin()` and write `contacted_by = auth.uid()`, NULL under service_role);
 * the database refusals map to 403/409/404; the list filters, orders newest first and resolves the
 * operator's name; the contact state is the same function for list and record.
 *
 * Run with: npm run test:api
 */

import { test, before, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import type { NextRequest } from 'next/server'

const FEEDBACK = '11111111-2222-4333-8444-555555555555'
const CLIENT_A = 'aaaaaaaa-2222-4333-8444-555555555555'
const CLIENT_B = 'bbbbbbbb-2222-4333-8444-555555555555'
const OPERATOR_UID = 'cccccccc-2222-4333-8444-555555555555'

type RpcCall = { client: 'operator' | 'service'; schema: string; fn: string; args: unknown }
let calls: RpcCall[]
let role: string
let answers: Record<string, { data?: unknown; error?: { code: string; message: string } }>

function client(kind: 'operator' | 'service') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = {
    auth: { getUser: async () => ({ data: { user: { id: OPERATOR_UID, email: 'admin@tuggi.app' } }, error: null }) },
    schema: (schema: string) => ({
      from: () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { id: 'cms-1', email: 'admin@tuggi.app', role, is_active: true }, error: null }) }
        return q
      },
      rpc: async (fn: string, args?: unknown) => {
        calls.push({ client: kind, schema, fn, args })
        const a = answers[fn]
        return { data: a?.data ?? null, error: a?.error ?? null }
      },
    }),
  }
  return c
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let list: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let contacted: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let lib: any

before(async () => {
  mock.module('next/headers', { namedExports: { cookies: async () => ({ get: () => undefined, getAll: () => [] }) } })
  mock.module('@/lib/core/supabase-client', {
    namedExports: {
      getSupabaseRouteHandler: () => client('operator'),
      getSupabaseService: () => client('service'),
      getSupabase: () => client('service'),
    },
  })
  mock.module('@/lib/services/operator-label', {
    namedExports: { operatorLabel: async (id: string | null) => (id === OPERATOR_UID ? 'ana@tuggi.app' : null) },
  })
  list = await import('@/app/api/admin/clients/cancellations/route')
  contacted = await import('@/app/api/admin/clients/cancellations/[feedbackId]/contacted/route')
  lib = await import('@/lib/clients/cancellations')
})

beforeEach(() => {
  calls = []
  role = 'admin'
  answers = {}
})

const get = (qs = '') => {
  const url = `http://localhost/api/admin/clients/cancellations${qs}`
  const req = new Request(url) as unknown as NextRequest & { nextUrl: URL }
  Object.defineProperty(req, 'nextUrl', { value: new URL(url) })
  return req
}
const act = (method: 'POST' | 'DELETE') => new Request(`http://localhost/api/admin/clients/cancellations/${FEEDBACK}/contacted`, { method }) as unknown as NextRequest
const ctx = (feedbackId = FEEDBACK) => ({ params: Promise.resolve({ feedbackId }) })

const row = (over: Record<string, unknown>) => ({
  feedback_id: FEEDBACK,
  client_id: CLIENT_A,
  place_name: 'Bar do Zé',
  renewal_canceled_at: '2026-10-08T12:00:00Z',
  reason: 'too_expensive',
  comment: null,
  contact_consent: false,
  contacted_at: null,
  contacted_by: null,
  created_at: '2026-10-08T12:00:01Z',
  contact_email: 'ze@example.com',
  contact_consent_text: 'Aceito…',
  ...over,
})

test('#913 BR-B2B-060 item 7: only an admin reaches the list and the mark', async () => {
  for (const r of ['editor', 'viewer', 'client']) {
    role = r
    assert.equal((await list.GET(get())).status, 403, r)
    assert.equal((await contacted.POST(act('POST'), ctx())).status, 403, r)
    assert.equal((await contacted.DELETE(act('DELETE'), ctx())).status, 403, r)
  }
  assert.deepEqual(calls, [], 'no RPC before the gate')
})

test('#913 BR-B2B-060 item 7: mark and undo run on the admin session (contacted_by = auth.uid()), never on service_role', async () => {
  assert.equal((await contacted.POST(act('POST'), ctx())).status, 200)
  assert.equal((await contacted.DELETE(act('DELETE'), ctx())).status, 200)
  assert.deepEqual(calls, [
    { client: 'operator', schema: 'partner', fn: 'mark_place_cancellation_contacted', args: { p_feedback_id: FEEDBACK } },
    { client: 'operator', schema: 'partner', fn: 'unmark_place_cancellation_contacted', args: { p_feedback_id: FEEDBACK } },
  ])
})

test('#913: a non-uuid id is 400 before the database', async () => {
  assert.equal((await contacted.POST(act('POST'), ctx('1; drop'))).status, 400)
  assert.deepEqual(calls, [])
})

test('#913 BR-B2B-060 item 5: the database refusals of the mark — 42501 → 403, 22023 no_contact_consent → 409, P0002 → 404', async () => {
  const cases: [string, string, number, string][] = [
    ['42501', 'permission denied', 403, 'forbidden'],
    ['22023', 'no_contact_consent', 409, 'no_contact_consent'],
    ['P0002', 'feedback_not_found', 404, 'feedback_not_found'],
    ['PGRST202', 'not found', 503, 'not_available'],
    ['XX000', 'boom', 500, 'internal'],
  ]
  for (const [code, message, status, error] of cases) {
    answers = { mark_place_cancellation_contacted: { error: { code, message } } }
    const r = await contacted.POST(act('POST'), ctx())
    assert.equal(r.status, status, code)
    assert.deepEqual(await r.json(), { error })
  }
})

test('#913 BR-B2B-060 item 7: the list runs on the admin session, newest first, every cancel (unanswered too), with the operator name and no e-mail nor consent text', async () => {
  answers = {
    list_place_cancellation_feedback: {
      data: [
        row({ feedback_id: '1', reason: null, contact_consent: true, renewal_canceled_at: '2026-10-01T10:00:00Z' }),
        row({ feedback_id: '2', contact_consent: true, contacted_at: '2026-10-08T15:00:00Z', contacted_by: OPERATOR_UID, renewal_canceled_at: '2026-10-07T10:00:00Z' }),
        row({ feedback_id: '3', reason: 'cheaper', client_id: CLIENT_B, renewal_canceled_at: null, created_at: '2026-10-05T10:00:00Z' }),
      ],
    },
  }
  const r = await list.GET(get())
  assert.equal(r.status, 200)
  const body = await r.json()
  assert.deepEqual(calls.map((c) => `${c.client} ${c.schema}.${c.fn}`), ['operator partner.list_place_cancellation_feedback'])
  assert.deepEqual(body.cancellations.map((c: { feedbackId: string }) => c.feedbackId), ['2', '3', '1'])
  assert.deepEqual(body.cancellations[0], {
    feedbackId: '2',
    clientId: CLIENT_A,
    placeName: 'Bar do Zé',
    canceledAt: '2026-10-07T10:00:00Z',
    reason: 'too_expensive',
    comment: null,
    contact: 'done',
    contactedAt: '2026-10-08T15:00:00Z',
    contactedBy: 'ana@tuggi.app',
  })
  assert.equal(body.cancellations[1].reason, null, 'a code off the list reads as "Não respondeu"')
  assert.equal(body.cancellations[1].canceledAt, '2026-10-05T10:00:00Z')
  assert.equal(body.cancellations[2].contact, 'pending')
  assert.doesNotMatch(JSON.stringify(body), /ze@example\.com|Aceito/)
  assert.deepEqual(body.pagination, { page: 1, limit: 20, total: 3, pages: 1 })
})

test('#913: the list filters by contact, reason and client; an unknown value is no filter; a bad client id is 400', async () => {
  answers = {
    list_place_cancellation_feedback: {
      data: [
        row({ feedback_id: '1', contact_consent: true }),
        row({ feedback_id: '2', reason: 'other', client_id: CLIENT_B }),
        row({ feedback_id: '3', contact_consent: true, contacted_at: '2026-10-08T15:00:00Z' }),
      ],
    },
  }
  const ids = async (qs: string) => (await (await list.GET(get(qs))).json()).cancellations.map((c: { feedbackId: string }) => c.feedbackId).sort()
  assert.deepEqual(await ids('?contact=pending'), ['1'])
  assert.deepEqual(await ids('?contact=done'), ['3'])
  assert.deepEqual(await ids('?contact=declined'), ['2'])
  assert.deepEqual(await ids('?reason=other'), ['2'])
  assert.deepEqual(await ids(`?clientId=${CLIENT_B}`), ['2'])
  assert.deepEqual(await ids('?contact=whatever&reason=x'), ['1', '2', '3'])
  assert.equal((await list.GET(get('?clientId=nope'))).status, 400)
})

test('#913: the list before the migration is 503 not_available; a gate refusal is 403', async () => {
  answers = { list_place_cancellation_feedback: { error: { code: 'PGRST202', message: 'x' } } }
  assert.equal((await list.GET(get())).status, 503)
  answers = { list_place_cancellation_feedback: { error: { code: '42501', message: 'x' } } }
  assert.equal((await list.GET(get())).status, 403)
})

test('#913 BR-B2B-060 items 5 and 7: the contact state — no consent is "Não aceitou", consent without contact is pending, with contact is done', () => {
  assert.equal(lib.contactStateOf({ contact_consent: false, contacted_at: null }), 'declined')
  assert.equal(lib.contactStateOf({ contact_consent: true, contacted_at: null }), 'pending')
  assert.equal(lib.contactStateOf({ contact_consent: true, contacted_at: '2026-10-08T15:00:00Z' }), 'done')
})

test('#913 BR-B2B-060 item 3: the CMS reason list is the EF list (Deno source read as text, the boundary forbids an import)', async () => {
  const { readFile } = await import('node:fs/promises')
  const { resolve } = await import('node:path')
  const src = await readFile(resolve(import.meta.dirname, '../../supabase/functions/_shared/places-payment.ts'), 'utf8')
  const m = src.match(/export const CANCEL_REASONS = \[([^\]]+)\]/)
  assert.ok(m)
  assert.deepEqual(m[1].split(',').map((s) => s.trim().replace(/'/g, '')), [...lib.CANCEL_REASONS])
})
