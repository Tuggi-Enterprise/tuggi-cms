/**
 * #950, #1016: the CMS reading of the tourists' votes on POI, event, place and route
 * (BR-CONTEUDO-009 items 5 and 7): `GET /api/admin/story-feedback`, over
 * `drive.cms_item_feedback_summary` (contract `banco-para-cms.md` Parte 18).
 *
 * Pinned here: admin only, before any RPC; the RPC runs on service_role (EXECUTE is service_role
 * only); the four kinds map, with the kind and language filters passed to the RPC; only items with
 * a down on the current text come back, worst "wrong info" first; `disliked_count` includes the
 * down without reason and the screen splits it; the editor link of each kind; the reason filter and
 * the sort; no author leaves the server; the function missing is 503 `not_available`.
 *
 * Run with: npm run test:api
 */

import { test, before, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import type { NextRequest } from 'next/server'

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
let route: any
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
  route = await import('@/app/api/admin/story-feedback/route')
  lib = await import('@/lib/story-feedback')
})

beforeEach(() => {
  calls = []
  role = 'admin'
  answers = {}
})

const get = (qs = '') => {
  const url = `http://localhost/api/admin/story-feedback${qs}`
  const req = new Request(url) as unknown as NextRequest & { nextUrl: URL }
  Object.defineProperty(req, 'nextUrl', { value: new URL(url) })
  return req
}

const row = (over: Record<string, unknown>) => ({
  item_kind: 'poi',
  item_id: 'p1',
  item_name: 'Igreja Matriz',
  language: 'pt',
  up_count: 3,
  down_count: 2,
  wrong_info_count: 1,
  disliked_count: 1,
  no_reason_count: 1,
  stale_count: 4,
  last_vote_at: '2026-10-18T12:00:00Z',
  recent_comments: [],
  ...over,
})

type Item = { kind: string; itemId: string; language: string | null; disliked: number; downNoReason: number }

test('#1016 BR-CONTEUDO-009 item 5: only an admin reaches the list, before any RPC', async () => {
  for (const r of ['editor', 'viewer', 'client']) {
    role = r
    assert.equal((await route.GET(get())).status, 403, r)
  }
  assert.deepEqual(calls, [], 'no RPC before the gate')
})

test('#1016 BR-CONTEUDO-009 item 5: the four kinds map from cms_item_feedback_summary, on service_role', async () => {
  answers = {
    cms_item_feedback_summary: {
      data: [
        row({ item_kind: 'poi', item_id: 'poi-1', item_name: 'Igreja Matriz', wrong_info_count: 4, down_count: 4, disliked_count: 0, no_reason_count: 0 }),
        row({ item_kind: 'event', item_id: 'ev-1', item_name: 'Festival', language: null, wrong_info_count: 3, down_count: 3, disliked_count: 0, no_reason_count: 0 }),
        row({ item_kind: 'place', item_id: 'pl-1', item_name: 'Bar do Zé', language: 'en', wrong_info_count: 2, down_count: 2, disliked_count: 0, no_reason_count: 0 }),
        row({ item_kind: 'route', item_id: 'rt-1', item_name: 'Orla', language: 'es', wrong_info_count: 1, down_count: 5, disliked_count: 4, no_reason_count: 3 }),
        row({ item_kind: 'museum', item_id: 'x-1', wrong_info_count: 9, down_count: 9 }),
      ],
    },
  }
  const r = await route.GET(get())
  assert.equal(r.status, 200)
  const body = await r.json()
  assert.deepEqual(calls, [
    { client: 'service', schema: 'drive', fn: 'cms_item_feedback_summary', args: { p_item_kind: null, p_language: null, p_limit: 1000 } },
  ])
  assert.deepEqual(
    body.items.map((i: Item) => [i.kind, i.itemId, i.language]),
    [
      ['poi', 'poi-1', 'pt'],
      ['event', 'ev-1', null],
      ['place', 'pl-1', 'en'],
      ['route', 'rt-1', 'es'],
    ],
    'an unknown kind is dropped; language NULL (base text) stays null'
  )
  const rt = body.items.find((i: Item) => i.kind === 'route')
  assert.equal(rt.disliked, 1, 'item 2: disliked_count 4 includes the 3 downs without reason')
  assert.equal(rt.downNoReason, 3)
  assert.equal(body.items[1].itemName, 'Festival')
})

test('#1016 BR-CONTEUDO-009 item 5: kind and language filters go to the RPC; an unknown value is no filter', async () => {
  answers = { cms_item_feedback_summary: { data: [] } }
  await route.GET(get('?kind=route&lang=fr'))
  await route.GET(get('?kind=hotel&lang=zz'))
  assert.deepEqual(
    calls.map((c) => c.args),
    [
      { p_item_kind: 'route', p_language: 'fr', p_limit: 1000 },
      { p_item_kind: null, p_language: null, p_limit: 1000 },
    ]
  )
})

test('#1016 BR-CONTEUDO-009 item 5: only items with a down, most "wrong info" first', async () => {
  answers = {
    cms_item_feedback_summary: {
      data: [
        row({ item_id: 'only-up', down_count: 0, wrong_info_count: 0, disliked_count: 0, no_reason_count: 0, up_count: 9 }),
        row({ item_kind: 'event', item_id: 'disliked', down_count: 3, wrong_info_count: 0, disliked_count: 3, no_reason_count: 2 }),
        row({ item_kind: 'place', item_id: 'wrong', down_count: 4, wrong_info_count: 3, disliked_count: 1, no_reason_count: 0 }),
      ],
    },
  }
  const body = await (await route.GET(get())).json()
  assert.deepEqual(body.items.map((i: Item) => i.itemId), ['wrong', 'disliked'])
  assert.deepEqual([body.items[1].disliked, body.items[1].downNoReason], [1, 2], 'down 3 = disliked 1 + no reason 2 (item 2)')
  assert.deepEqual(body.pagination, { page: 1, limit: 50, total: 2, pages: 1 })
})

test('#1016 BR-CONTEUDO-009 item 7: no author leaves the server, even if the RPC grows a column', async () => {
  answers = {
    cms_item_feedback_summary: {
      data: [
        row({
          user_id: 'u-1',
          email: 'turista@example.com',
          recent_comments: [
            { comment: '<b>A data</b> está errada', reason: 'wrong_info', gender: 'female', at: '2026-10-18T11:00:00Z', user_id: 'u-1', email: 'turista@example.com' },
          ],
        }),
      ],
    },
  }
  const body = await (await route.GET(get())).json()
  assert.deepEqual(body.items[0], {
    kind: 'poi',
    itemId: 'p1',
    itemName: 'Igreja Matriz',
    language: 'pt',
    up: 3,
    down: 2,
    wrong: 1,
    disliked: 0,
    downNoReason: 1,
    lastVoteAt: '2026-10-18T12:00:00Z',
    comments: [{ comment: '<b>A data</b> está errada', reason: 'wrong_info', gender: 'female', at: '2026-10-18T11:00:00Z' }],
  })
  assert.doesNotMatch(JSON.stringify(body), /@|user_id|u-1/)
})

test('#1016: the editor link of each kind; an event has no editor reachable by link', () => {
  const target = { locale: 'pt', returnTo: '/pt/admin/story-feedback?kind=poi', returnLabel: 'Voltar' }
  const href = (kind: string) => lib.feedbackEditHref({ kind, itemId: 'id-1' }, target)
  assert.match(href('poi'), /^\/pt\/pois\/id-1\?.*tab=description/)
  assert.match(href('place'), /^\/pt\/places\/id-1\?.*tab=description/)
  assert.match(href('poi'), /returnTo=%2Fpt%2Fadmin%2Fstory-feedback/)
  assert.equal(href('route'), '/pt/routes?editId=id-1')
  assert.equal(href('event'), null)
})

test('#950: reason filter and sort; an unknown value is no filter and the default order', async () => {
  answers = {
    cms_item_feedback_summary: {
      data: [
        row({ item_id: 'a', down_count: 1, wrong_info_count: 1, disliked_count: 0, no_reason_count: 0, up_count: 1 }),
        row({ item_id: 'b', down_count: 2, wrong_info_count: 0, disliked_count: 2, no_reason_count: 2, up_count: 7 }),
      ],
    },
  }
  const ids = async (qs: string) => (await (await route.GET(get(qs))).json()).items.map((s: Item) => s.itemId)
  assert.deepEqual(await ids('?reason=wrong'), ['a'])
  assert.deepEqual(await ids('?reason=dislike'), ['b'], 'a down without reason is "não gostei"')
  assert.deepEqual(await ids('?sort=up'), ['b', 'a'])
  assert.deepEqual(await ids('?reason=x&sort=y&lang=zz'), ['a', 'b'])
})

test('#950: the function missing is 503 not_available; another error is 500 with the code only', async () => {
  for (const [code, status, error] of [
    ['PGRST202', 503, 'not_available'],
    ['42883', 503, 'not_available'],
    ['XX000', 500, 'internal'],
  ] as const) {
    answers = { cms_item_feedback_summary: { error: { code, message: 'boom' } } }
    const r = await route.GET(get())
    assert.equal(r.status, status, code)
    assert.equal((await r.json()).code, error)
  }
})

test('#950: the page caps at 100 rows and pages past the end are empty', async () => {
  answers = { cms_item_feedback_summary: { data: Array.from({ length: 3 }, (_, i) => row({ item_id: `p${i}` })) } }
  const body = await (await route.GET(get('?limit=2&page=2'))).json()
  assert.equal(body.items.length, 1)
  assert.deepEqual(body.pagination, { page: 2, limit: 2, total: 3, pages: 2 })
  const capped = await (await route.GET(get('?limit=5000'))).json()
  assert.equal(capped.pagination.limit, 100)
})
