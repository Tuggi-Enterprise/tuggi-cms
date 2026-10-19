/**
 * #950: the CMS reading of the tourists' votes on each story (BR-CONTEUDO-009 items 5 and 7):
 * `GET /api/admin/story-feedback`.
 *
 * Pinned here: admin only, before any RPC; the RPC runs on service_role (EXECUTE is service_role
 * only); only stories with a down on the current text come back, worst "wrong info" first; the
 * reason filter and the sort; no author leaves the server; the function missing (migration not
 * applied) is 503 `not_available`, which the screen shows as empty.
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
  poi_id: 'p1',
  poi_name: 'Igreja Matriz',
  language: 'pt',
  up_count: 3,
  down_count: 2,
  wrong_info_count: 1,
  disliked_count: 0,
  stale_count: 4,
  last_vote_at: '2026-10-18T12:00:00Z',
  recent_comments: [],
  ...over,
})

test('#950 BR-CONTEUDO-009 item 5: only an admin reaches the list, before any RPC', async () => {
  for (const r of ['editor', 'viewer', 'client']) {
    role = r
    assert.equal((await route.GET(get())).status, 403, r)
  }
  assert.deepEqual(calls, [], 'no RPC before the gate')
})

test('#950 BR-CONTEUDO-009 item 5: service_role, only stories with a down, most "wrong info" first, down without reason counted apart', async () => {
  answers = {
    cms_story_feedback_summary: {
      data: [
        row({ poi_id: 'only-up', down_count: 0, wrong_info_count: 0, up_count: 9 }),
        row({ poi_id: 'disliked', down_count: 3, wrong_info_count: 0, disliked_count: 1 }),
        row({ poi_id: 'wrong', down_count: 4, wrong_info_count: 3, disliked_count: 1 }),
      ],
    },
  }
  const r = await route.GET(get('?lang=fr'))
  assert.equal(r.status, 200)
  const body = await r.json()
  assert.deepEqual(calls, [
    { client: 'service', schema: 'drive', fn: 'cms_story_feedback_summary', args: { p_language: 'fr', p_limit: 1000 } },
  ])
  assert.deepEqual(body.stories.map((s: { poiId: string }) => s.poiId), ['wrong', 'disliked'])
  assert.equal(body.stories[1].downNoReason, 2, 'down 3 = disliked 1 + no reason 2 (item 2)')
  assert.deepEqual(body.pagination, { page: 1, limit: 50, total: 2, pages: 1 })
})

test('#950 BR-CONTEUDO-009 item 7: no author leaves the server, even if the RPC grows a column', async () => {
  answers = {
    cms_story_feedback_summary: {
      data: [
        row({
          user_id: 'u-1',
          email: 'turista@example.com',
          recent_comments: [
            { comment: 'A data está errada', reason: 'wrong_info', gender: 'female', at: '2026-10-18T11:00:00Z', user_id: 'u-1', email: 'turista@example.com' },
          ],
        }),
      ],
    },
  }
  const body = await (await route.GET(get())).json()
  assert.deepEqual(body.stories[0], {
    poiId: 'p1',
    poiName: 'Igreja Matriz',
    language: 'pt',
    up: 3,
    down: 2,
    wrong: 1,
    disliked: 0,
    downNoReason: 1,
    lastVoteAt: '2026-10-18T12:00:00Z',
    comments: [{ comment: 'A data está errada', reason: 'wrong_info', gender: 'female', at: '2026-10-18T11:00:00Z' }],
  })
  assert.doesNotMatch(JSON.stringify(body), /@|user_id|u-1/)
})

test('#950: reason filter and sort; an unknown value is no filter and the default order', async () => {
  answers = {
    cms_story_feedback_summary: {
      data: [
        row({ poi_id: 'a', down_count: 1, wrong_info_count: 1, disliked_count: 0, up_count: 1 }),
        row({ poi_id: 'b', down_count: 2, wrong_info_count: 0, disliked_count: 0, up_count: 7 }),
      ],
    },
  }
  const ids = async (qs: string) => (await (await route.GET(get(qs))).json()).stories.map((s: { poiId: string }) => s.poiId)
  assert.deepEqual(await ids('?reason=wrong'), ['a'])
  assert.deepEqual(await ids('?reason=dislike'), ['b'], 'a down without reason is "não gostei"')
  assert.deepEqual(await ids('?sort=up'), ['b', 'a'])
  assert.deepEqual(await ids('?reason=x&sort=y&lang=zz'), ['a', 'b'])
  assert.equal((calls[calls.length - 1]?.args as { p_language: unknown }).p_language, null, 'an unknown language is no filter')
})

test('#950: the function missing (migration not applied) is 503 not_available; another error is 500 with the code only', async () => {
  for (const [code, status, error] of [
    ['PGRST202', 503, 'not_available'],
    ['42883', 503, 'not_available'],
    ['XX000', 500, 'internal'],
  ] as const) {
    answers = { cms_story_feedback_summary: { error: { code, message: 'boom' } } }
    const r = await route.GET(get())
    assert.equal(r.status, status, code)
    assert.equal((await r.json()).code, error)
  }
})

test('#950: the page caps at 100 rows and pages past the end are empty', async () => {
  answers = { cms_story_feedback_summary: { data: Array.from({ length: 3 }, (_, i) => row({ poi_id: `p${i}` })) } }
  const body = await (await route.GET(get('?limit=2&page=2'))).json()
  assert.equal(body.stories.length, 1)
  assert.deepEqual(body.pagination, { page: 2, limit: 2, total: 3, pages: 2 })
  const capped = await (await route.GET(get('?limit=5000'))).json()
  assert.equal(capped.pagination.limit, 100)
})
