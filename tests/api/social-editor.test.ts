/**
 * #1058: the write doors of the social agenda. No BR-* governs these posts (internal tool); the
 * schema is `social` of `db-tuggiApp/.../20261029140000_the_cms_schedules_social_posts.sql`.
 *
 * Pinned here: admin only and nothing written before the gate; every write on the operator's
 * session (the RLS is the second gate, never `service_role`); the server runs the form's own
 * validation; a post with a network publishing or published, or canceled on every network, is
 * refused with 409 and nothing is written; cancel and retry touch only the statuses they own, and
 * retry leaves `scheduled_at` alone.
 *
 * Run with: npm run test:api
 */

import { test, before, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import type { NextRequest } from 'next/server'
import { minScheduleInstant } from '@/lib/social/time'

const POST_ID = '3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f'
const TARGET_ID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'
const MEDIA = `${POST_ID}/1-0b9c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d.jpg`

type Op = [string, ...unknown[]]
type Call = { client: string; table: string; ops: Op[] }
let calls: Call[]
let role: string
let targets: { network: string; status: string }[]
let postExists: boolean
let affected: number
let failOn: string | null

function terminal(call: Call): { data: unknown; error: { code: string } | null } {
  const has = (op: string) => call.ops.some(([o]) => o === op)
  const kind = has('insert') ? 'insert' : has('update') ? 'update' : has('delete') ? 'delete' : 'select'
  if (failOn === `${call.table}.${kind}`) return { data: null, error: { code: '42501' } }
  if (kind === 'select' && call.table === 'post_targets') return { data: targets, error: null }
  if (kind === 'select' && call.table === 'posts') return { data: postExists ? { id: POST_ID } : null, error: null }
  if (kind === 'update' && has('select')) return { data: Array(affected).fill({ id: 'x' }), error: null }
  return { data: null, error: null }
}

function client(kind: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = {
    auth: { getUser: async () => ({ data: { user: { id: 'u-1', email: 'admin@tuggi.app' } }, error: null }) },
    storage: { from: () => ({ getPublicUrl: (p: string) => ({ data: { publicUrl: p } }) }) },
    schema: (schema: string) => ({
      from: (table: string) => {
        if (schema === 'core') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { id: 'cms-1', email: 'admin@tuggi.app', role, is_active: true }, error: null }) }
          return q
        }
        const call: Call = { client: kind, table: `${schema}.${table}`.replace('social.', ''), ops: [] }
        calls.push(call)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const q: any = new Proxy(
          {},
          {
            get: (_t, op: string) => {
              if (op === 'then') return (res: (v: unknown) => void) => res(terminal(call))
              return (...args: unknown[]) => {
                call.ops.push([op, ...args])
                return q
              }
            },
          }
        )
        return q
      },
    }),
  }
  return c
}

/* eslint-disable @typescript-eslint/no-explicit-any */
let postsRoute: any
let postRoute: any
let cancelRoute: any
let retryRoute: any
/* eslint-enable @typescript-eslint/no-explicit-any */

before(async () => {
  mock.module('next/headers', { namedExports: { cookies: async () => ({ get: () => undefined, getAll: () => [] }) } })
  mock.module('@/lib/core/supabase-client', {
    namedExports: {
      getSupabaseRouteHandler: () => client('session'),
      getSupabaseService: () => client('service'),
      getSupabase: () => client('service'),
    },
  })
  postsRoute = await import('@/app/api/admin/social/posts/route')
  postRoute = await import('@/app/api/admin/social/posts/[id]/route')
  cancelRoute = await import('@/app/api/admin/social/posts/[id]/cancel/route')
  retryRoute = await import('@/app/api/admin/social/targets/[id]/retry/route')
})

beforeEach(() => {
  calls = []
  role = 'admin'
  targets = [
    { network: 'instagram', status: 'scheduled' },
    { network: 'facebook', status: 'failed' },
  ]
  postExists = true
  affected = 1
  failOn = null
})

const req = (method: string, body?: unknown) =>
  new Request('http://localhost/api/admin/social/posts', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as NextRequest
const ctx = (id = POST_ID) => ({ params: Promise.resolve({ id }) })

const future = () => new Date(Date.now() + 60 * 60000).toISOString()
const body = (over: Record<string, unknown> = {}) => ({
  id: POST_ID,
  networks: ['instagram', 'facebook'],
  media_type: 'IMAGE',
  caption: 'Búzios ao pôr do sol\nEN: sunset',
  scheduled_at: future(),
  media: [{ storage_path: MEDIA, mime_type: 'image/jpeg' }],
  ...over,
})

const ops = (table: string) => calls.filter((c) => c.table === table).map((c) => c.ops)

test('#1058: only an admin writes, and nothing is touched before the gate', async () => {
  for (const r of ['editor', 'viewer', 'client']) {
    role = r
    assert.equal((await postsRoute.POST(req('POST', body()), ctx())).status, 403, r)
    assert.equal((await postRoute.PUT(req('PUT', body()), ctx())).status, 403, r)
    assert.equal((await cancelRoute.POST(req('POST'), ctx())).status, 403, r)
    assert.equal((await retryRoute.POST(req('POST'), ctx(TARGET_ID))).status, 403, r)
  }
  assert.deepEqual(calls, [])
})

test('#1058: creating writes the post, its media in order and one scheduled target per network, on the session', async () => {
  const res = await postsRoute.POST(req('POST', body()), ctx())
  assert.equal(res.status, 201)
  assert.ok(calls.every((c) => c.client === 'session'))
  const [post] = ops('posts')[0].filter(([op]) => op === 'insert').map(([, row]) => row) as Record<string, unknown>[]
  assert.equal(post.id, POST_ID)
  assert.equal(post.title, 'Búzios ao pôr do sol')
  assert.equal(post.media_type, 'IMAGE')
  assert.equal(post.link_url, 'https://www.tuggi.app/download?utm_source=meta&utm_medium=social&utm_campaign=post_3f2a9c1e')
  assert.equal(post.utm_campaign, 'post_3f2a9c1e')
  assert.deepEqual(ops('post_media')[0][0], ['insert', [{ post_id: POST_ID, position: 1, storage_path: MEDIA, mime_type: 'image/jpeg' }]])
  assert.deepEqual(ops('post_targets')[0][0], ['insert', [{ post_id: POST_ID, network: 'instagram' }, { post_id: POST_ID, network: 'facebook' }]])
})

test('#1058: the server runs the form validation and refuses media outside the post folder', async () => {
  const noNetwork = await postsRoute.POST(req('POST', body({ networks: [] })), ctx())
  assert.equal(noNetwork.status, 422)
  assert.deepEqual((await noNetwork.json()).error.errors.map((e: { code: string }) => e.code), ['no_network'])
  const past = await postsRoute.POST(req('POST', body({ scheduled_at: new Date(Date.now() - 60000).toISOString() })), ctx())
  assert.equal(past.status, 422)
  const foreign = await postsRoute.POST(
    req('POST', body({ media: [{ storage_path: `other/${MEDIA}`, mime_type: 'image/jpeg' }] })),
    ctx()
  )
  assert.equal(foreign.status, 400)
  assert.equal((await postsRoute.POST(req('POST', body({ media_type: 'image' })), ctx())).status, 400)
  assert.deepEqual(calls, [])
})

test('#1058: a create that fails after the post row deletes the post, so the cron never sees half of it', async () => {
  failOn = 'post_targets.insert'
  const res = await postsRoute.POST(req('POST', body()), ctx())
  assert.equal(res.status, 500)
  const postOps = ops('posts')
  assert.deepEqual(postOps[postOps.length - 1], [['delete'], ['eq', 'id', POST_ID]])
})

test('#1058: an update is refused with 409, and nothing written, when a network is publishing or published', async () => {
  for (const [statuses, reason] of [
    [['publishing', 'scheduled'], 'publishing'],
    [['published', 'failed'], 'published'],
    [['canceled', 'canceled'], 'canceled'],
  ] as const) {
    calls = []
    targets = statuses.map((status, i) => ({ network: i ? 'facebook' : 'instagram', status }))
    const res = await postRoute.PUT(req('PUT', body()), ctx())
    assert.equal(res.status, 409, reason)
    assert.deepEqual((await res.json()).error, { code: 'locked', reason })
    const writes = calls.filter((c) => c.ops.some(([op]) => op === 'insert' || op === 'update' || op === 'delete'))
    assert.deepEqual(writes, [], reason)
  }
})

test('#1058: an update rewrites the post and touches targets only where still scheduled or failed', async () => {
  const res = await postRoute.PUT(req('PUT', body({ networks: ['instagram'] })), ctx())
  assert.equal(res.status, 200)
  const t = ops('post_targets')
  // read, then drop facebook, then reset instagram.
  assert.deepEqual(t[1], [['delete'], ['eq', 'post_id', POST_ID], ['in', 'network', ['facebook']], ['in', 'status', ['scheduled', 'failed']]])
  assert.deepEqual(t[2], [
    ['update', { status: 'scheduled', error: null }],
    ['eq', 'post_id', POST_ID],
    ['in', 'network', ['instagram']],
    ['in', 'status', ['scheduled', 'failed']],
  ])
  postExists = false
  assert.equal((await postRoute.PUT(req('PUT', body()), ctx())).status, 404)
})

test('#1058: cancel moves only scheduled and failed networks to canceled', async () => {
  const res = await cancelRoute.POST(req('POST'), ctx())
  assert.equal(res.status, 200)
  assert.deepEqual(ops('post_targets')[0], [
    ['update', { status: 'canceled' }],
    ['eq', 'post_id', POST_ID],
    ['in', 'status', ['scheduled', 'failed']],
    ['select', 'id'],
  ])
  affected = 0
  assert.equal((await cancelRoute.POST(req('POST'), ctx())).status, 409)
})

test('#1058: retry puts a failed network back in scheduled and leaves scheduled_at alone', async () => {
  const res = await retryRoute.POST(req('POST'), ctx(TARGET_ID))
  assert.equal(res.status, 200)
  assert.deepEqual(calls.map((c) => c.table), ['post_targets'])
  assert.deepEqual(calls[0].ops, [
    ['update', { status: 'scheduled', error: null }],
    ['eq', 'id', TARGET_ID],
    ['eq', 'status', 'failed'],
    ['select', 'id'],
  ])
  affected = 0
  assert.equal((await retryRoute.POST(req('POST'), ctx(TARGET_ID))).status, 409)
  assert.equal((await retryRoute.POST(req('POST'), ctx('nope'))).status, 404)
})

test('#1058: the earliest schedule refuses 9 minutes ahead and accepts 10, ignoring the seconds', () => {
  const now = new Date('2026-10-29T15:00:42.000Z')
  assert.equal(minScheduleInstant(now).toISOString(), '2026-10-29T15:10:00.000Z')
})
