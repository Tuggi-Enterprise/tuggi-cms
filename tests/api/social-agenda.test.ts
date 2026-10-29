/**
 * #1058: the social agenda of the CMS. No BR-* governs these posts (internal tool); the limits are
 * the Meta's (`ig-user/media`, Graph API v26.0, spike #1057) and the schema `social` of
 * `db-tuggiApp/supabase/migrations/20261029140000_the_cms_schedules_social_posts.sql`.
 *
 * Pinned here: the Brasília month and week (Monday first, BR-COMUNICACAO-019 item 4.1); the title
 * derived from the caption; the UTM of the download link; every refusal of the form, each with its
 * copy sentence in `messages/pt.json`; the post status and lock derived from the targets; and the
 * month read, admin only and on the operator's session (never `service_role`).
 *
 * Run with: npm run test:api
 */

import { test, before, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { NextRequest } from 'next/server'
import {
  calendarWeeks,
  minScheduleWallTime,
  monthBounds,
  parseInputValue,
  wallTimeAt,
  wallTimeToInstant,
  formatDateTime,
} from '@/lib/social/time'
import {
  downloadLink,
  lockReasonOf,
  postFilterOf,
  titleFromCaption,
  validatePost,
  fileTypeError,
  imageRatioOk,
  videoDurationOk,
  isOwnStoragePath,
  mediaStoragePath,
  type PostDraft,
} from '@/lib/social/post'

const root = resolve(import.meta.dirname, '../..')
const pt = JSON.parse(readFileSync(resolve(root, 'messages/pt.json'), 'utf8'))
const social = pt.Pages.Social

const POST_ID = '3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f'
const NOW = new Date('2026-10-29T15:00:00.000Z') // 12:00 in Brasília

// ── Time ──────────────────────────────────────────────────────────────────────────────────

test('#1058: the month is read between Brasília midnights, not UTC ones', () => {
  assert.deepEqual(monthBounds({ year: 2026, month: 11 }), {
    start: '2026-11-01T03:00:00.000Z',
    end: '2026-12-01T03:00:00.000Z',
  })
  // December wraps to January of the next year.
  assert.deepEqual(monthBounds({ year: 2026, month: 12 }), {
    start: '2026-12-01T03:00:00.000Z',
    end: '2027-01-01T03:00:00.000Z',
  })
  // 23:30 in Brasília on the 31st is already the 1st in UTC, and belongs to October.
  const lastNight = wallTimeAt(new Date('2026-11-01T02:30:00.000Z'))
  assert.deepEqual([lastNight.month, lastNight.day, lastNight.hour], [10, 31, 23])
})

test('#1058 BR-COMUNICACAO-019 4.1: the calendar week starts on Monday', () => {
  const weeks = calendarWeeks({ year: 2026, month: 11 })
  // 2026-11-01 is a Sunday: the first row starts on Monday, October 26.
  assert.equal(weeks[0][0], '2026-10-26')
  assert.equal(weeks[0][6], '2026-11-01')
  assert.ok(weeks.every((w) => w.length === 7))
  assert.equal(weeks[weeks.length - 1][6], '2026-12-06')
})

test('#1058: the editor value is Brasília time, whatever the browser zone', () => {
  const w = parseInputValue('2026-10-31T18:00')
  assert.ok(w)
  assert.equal(wallTimeToInstant(w).toISOString(), '2026-10-31T21:00:00.000Z')
  assert.match(formatDateTime('2026-10-31T21:00:00.000Z'), /^31\/10\/2026,? 18:00$/)
  assert.equal(parseInputValue('2026-02-30T10:00'), null)
})

test('#1058: the earliest schedule is now plus 10 minutes, rounded up to the 5 minute step', () => {
  // 12:00 + 10 = 12:10, already on the step.
  assert.deepEqual(minScheduleWallTime(NOW), { year: 2026, month: 10, day: 29, hour: 12, minute: 10 })
  // 12:01 + 10 = 12:11, rounded up to 12:15.
  const later = minScheduleWallTime(new Date(NOW.getTime() + 60000))
  assert.equal(later.minute, 15)
})

// ── Title and link ────────────────────────────────────────────────────────────────────────

test('#1058: the title is the first caption line, at most 60 characters', () => {
  assert.equal(titleFromCaption('\n  Búzios ao pôr do sol  \nEN: Sunset', POST_ID), 'Búzios ao pôr do sol')
  const long = 'á'.repeat(80)
  const title = titleFromCaption(long, POST_ID)
  assert.equal(Array.from(title).length, 60)
  assert.ok(title.endsWith('…'))
  assert.equal(titleFromCaption('   \n ', POST_ID), 'Post 3f2a9c1e')
})

test('#1058: one download link per post, utm_source meta, medium social, campaign post_<code>', () => {
  assert.equal(
    downloadLink(POST_ID),
    'https://www.tuggi.app/download?utm_source=meta&utm_medium=social&utm_campaign=post_3f2a9c1e'
  )
})

test('#1058: the storage path is the post folder, position and a uuid; nothing else passes', () => {
  const path = mediaStoragePath(POST_ID, 2, '0b9c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d', 'image/jpeg')
  assert.equal(path, `${POST_ID}/2-0b9c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d.jpg`)
  assert.ok(isOwnStoragePath(POST_ID, path))
  assert.ok(!isOwnStoragePath(POST_ID, `other/${path}`))
  assert.ok(!isOwnStoragePath(POST_ID, `${POST_ID}/../x.jpg`))
})

// ── Validation ────────────────────────────────────────────────────────────────────────────

const MIN = new Date(NOW.getTime() + 10 * 60000)
const jpeg = { mime_type: 'image/jpeg' }
const mp4 = { mime_type: 'video/mp4' }
const draft = (over: Partial<PostDraft> = {}): PostDraft => ({
  networks: ['instagram', 'facebook'],
  media_type: 'IMAGE',
  caption: 'Búzios',
  scheduled_at: MIN.toISOString(),
  media: [jpeg],
  ...over,
})
const codes = (d: PostDraft) => validatePost(d, MIN).map((e) => e.code)

test('#1058: a complete draft passes, and every refusal has its sentence in pt.json', () => {
  assert.deepEqual(codes(draft()), [])
  for (const code of [
    'no_network', 'no_media', 'image_many', 'image_is_video', 'carousel_too_few', 'carousel_too_many',
    'carousel_is_video', 'reels_no_video', 'reels_many', 'caption_too_long', 'too_many_hashtags',
    'too_many_mentions', 'time_missing', 'time_past', 'file_type', 'file_too_big', 'image_ratio',
    'video_duration', 'fix_first', 'media_pending',
  ]) {
    assert.equal(typeof social.errors[code], 'string', `errors.${code} missing in pt.json`)
  }
})

test('#1058: networks, media count and kind per type', () => {
  assert.deepEqual(codes(draft({ networks: [] })), ['no_network'])
  assert.deepEqual(codes(draft({ media: [] })), ['no_media'])
  assert.deepEqual(codes(draft({ media: [jpeg, jpeg] })), ['image_many'])
  assert.deepEqual(codes(draft({ media: [mp4] })), ['image_is_video'])
  assert.deepEqual(codes(draft({ media_type: 'CAROUSEL', media: [jpeg] })), ['carousel_too_few'])
  assert.deepEqual(codes(draft({ media_type: 'CAROUSEL', media: Array(20).fill(jpeg) })), [])
  const over = validatePost(draft({ media_type: 'CAROUSEL', media: Array(21).fill(jpeg) }), MIN)
  assert.deepEqual(over.map((e) => [e.code, e.values]), [['carousel_too_many', { max: 20, over: 1 }]])
  assert.deepEqual(codes(draft({ media_type: 'CAROUSEL', media: [jpeg, mp4] })), ['carousel_is_video'])
  assert.deepEqual(codes(draft({ media_type: 'REELS', media: [] })), ['reels_no_video'])
  assert.deepEqual(codes(draft({ media_type: 'REELS', media: [jpeg] })), ['reels_no_video'])
  assert.deepEqual(codes(draft({ media_type: 'REELS', media: [mp4, mp4] })), ['reels_many'])
  assert.deepEqual(codes(draft({ media_type: 'REELS', media: [mp4] })), [])
})

test('#1058: caption over 2200 is refused for any network; hashtags and mentions only with Instagram', () => {
  assert.deepEqual(codes(draft({ caption: 'a'.repeat(2200) })), [])
  const long = validatePost(draft({ caption: 'a'.repeat(2201), networks: ['facebook'] }), MIN)
  assert.deepEqual(long.map((e) => [e.code, e.values]), [['caption_too_long', { over: 1, max: 2200 }]])
  // An emoji is one character, as the Meta and char_length count it.
  assert.deepEqual(codes(draft({ caption: '🌅'.repeat(2200) })), [])

  const tags = Array.from({ length: 31 }, (_, i) => `#tag${i}`).join(' ')
  assert.deepEqual(codes(draft({ caption: tags })), ['too_many_hashtags'])
  assert.deepEqual(codes(draft({ caption: tags, networks: ['facebook'] })), [])
  assert.deepEqual(codes(draft({ caption: Array.from({ length: 30 }, (_, i) => `#t${i}`).join(' ') })), [])

  const mentions = Array.from({ length: 21 }, (_, i) => `@user${i}`).join(' ')
  assert.deepEqual(codes(draft({ caption: mentions })), ['too_many_mentions'])
  assert.deepEqual(codes(draft({ caption: mentions, networks: ['facebook'] })), [])
  // An e-mail address is not a mention, and a URL fragment is not a hashtag.
  assert.deepEqual(codes(draft({ caption: `${'a@b.com '.repeat(25)} https://x.com/#a` })), [])
})

test('#1058: time missing, 9 minutes ahead refused, 10 minutes ahead accepted', () => {
  assert.deepEqual(codes(draft({ scheduled_at: null })), ['time_missing'])
  assert.deepEqual(codes(draft({ scheduled_at: new Date(NOW.getTime() + 9 * 60000).toISOString() })), ['time_past'])
  assert.deepEqual(codes(draft({ scheduled_at: new Date(NOW.getTime() + 10 * 60000).toISOString() })), [])
})

test('#1058: per file, JPEG up to 8 MB, MP4 or MOV up to 300 MB, ratio 4:5 to 1.91:1, 3 s to 15 min', () => {
  assert.deepEqual(fileTypeError({ type: 'image/png', size: 10 }), { code: 'file_type' })
  assert.equal(fileTypeError({ type: 'image/jpeg', size: 8 * 1024 * 1024 }), null)
  assert.deepEqual(fileTypeError({ type: 'image/jpeg', size: 9 * 1024 * 1024 }), { code: 'file_too_big', max: '8 MB' })
  assert.equal(fileTypeError({ type: 'video/quicktime', size: 300 * 1024 * 1024 }), null)
  assert.deepEqual(fileTypeError({ type: 'video/mp4', size: 301 * 1024 * 1024 }), { code: 'file_too_big', max: '300 MB' })
  assert.ok(imageRatioOk(1080, 1350)) // 4:5
  assert.ok(imageRatioOk(1910, 1000)) // 1.91:1
  assert.ok(!imageRatioOk(2000, 1000)) // 2:1
  assert.ok(!imageRatioOk(1000, 1300))
  assert.ok(videoDurationOk(3) && videoDurationOk(900))
  assert.ok(!videoDurationOk(2.9) && !videoDurationOk(901) && !videoDurationOk(NaN))
})

// ── Status and lock ───────────────────────────────────────────────────────────────────────

test('#1058: post status for the filter comes from the targets', () => {
  const s = (...statuses: string[]) => statuses.map((status) => ({ status })) as { status: never }[]
  assert.equal(postFilterOf(s('published', 'failed')), 'failed')
  assert.equal(postFilterOf(s('scheduled', 'published')), 'scheduled')
  assert.equal(postFilterOf(s('publishing')), 'scheduled')
  assert.equal(postFilterOf(s('published', 'published')), 'published')
  assert.equal(postFilterOf(s('canceled', 'canceled')), 'canceled')
})

test('#1058: publishing or published locks the content; canceled on every network is final', () => {
  const s = (...statuses: string[]) => statuses.map((status) => ({ status })) as { status: never }[]
  assert.equal(lockReasonOf(s('scheduled', 'failed')), null)
  assert.equal(lockReasonOf(s('publishing', 'scheduled')), 'publishing')
  assert.equal(lockReasonOf(s('published', 'failed')), 'published')
  assert.equal(lockReasonOf(s('canceled', 'canceled')), 'canceled')
  assert.equal(lockReasonOf(s('canceled', 'published')), 'published')
  for (const key of ['publishing', 'published', 'canceled']) assert.equal(typeof social.locked[key], 'string')
})

// ── The month read ────────────────────────────────────────────────────────────────────────

type Call = { client: 'session' | 'service'; schema: string; table: string; ops: [string, ...unknown[]][] }
let calls: Call[]
let role: string
let rows: unknown[]
let readError: { code: string } | null

function client(kind: 'session' | 'service') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = {
    auth: { getUser: async () => ({ data: { user: { id: 'u-1', email: 'admin@tuggi.app' } }, error: null }) },
    storage: {
      from: (bucket: string) => ({
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.test/${bucket}/${path}` } }),
      }),
    },
    schema: (schema: string) => ({
      from: (table: string) => {
        if (schema === 'core') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { id: 'cms-1', email: 'admin@tuggi.app', role, is_active: true }, error: null }) }
          return q
        }
        const call: Call = { client: kind, schema, table, ops: [] }
        calls.push(call)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const q: any = new Proxy(
          {},
          {
            get: (_t, op: string) => {
              if (op === 'then') return (resolveFn: (v: unknown) => void) => resolveFn({ data: readError ? null : rows, error: readError })
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let postsRoute: any

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
})

beforeEach(() => {
  calls = []
  role = 'admin'
  rows = []
  readError = null
})

const get = (query: string) => {
  const url = new URL(`http://localhost/api/admin/social/posts${query}`)
  return Object.assign(new Request(url), { nextUrl: url }) as unknown as NextRequest
}
const ctx = { params: Promise.resolve({}) }

test('#1058: only an admin reads the agenda, and nothing is read before the gate', async () => {
  for (const r of ['editor', 'viewer', 'client']) {
    role = r
    assert.equal((await postsRoute.GET(get('?month=2026-11'), ctx)).status, 403, r)
  }
  assert.deepEqual(calls, [])
})

test('#1058: the month read runs on the session client, between Brasília midnights, with public URLs', async () => {
  rows = [
    {
      id: POST_ID,
      caption: 'x',
      post_media: [
        { position: 2, storage_path: `${POST_ID}/2-b.jpg`, mime_type: 'image/jpeg' },
        { position: 1, storage_path: `${POST_ID}/1-a.jpg`, mime_type: 'image/jpeg' },
      ],
      post_targets: [],
    },
  ]
  const res = await postsRoute.GET(get('?month=2026-11'), ctx)
  assert.equal(res.status, 200)
  assert.deepEqual(
    calls.map((c) => [c.client, c.schema, c.table]),
    [['session', 'social', 'posts']]
  )
  const ops = Object.fromEntries(calls[0].ops.map(([op, ...args]) => [op, args]))
  assert.deepEqual(ops.gte, ['scheduled_at', '2026-11-01T03:00:00.000Z'])
  assert.deepEqual(ops.lt, ['scheduled_at', '2026-12-01T03:00:00.000Z'])
  const body = await res.json()
  assert.deepEqual(
    body.posts[0].post_media.map((m: { position: number; url: string }) => [m.position, m.url]),
    [
      [1, `https://cdn.test/social-media/${POST_ID}/1-a.jpg`],
      [2, `https://cdn.test/social-media/${POST_ID}/2-b.jpg`],
    ]
  )
})

test('#1058: a bad month is 400, and a database error is 500 without detail', async () => {
  assert.equal((await postsRoute.GET(get('?month=2026-13'), ctx)).status, 400)
  assert.equal((await postsRoute.GET(get(''), ctx)).status, 400)
  readError = { code: 'PGRST106' }
  const res = await postsRoute.GET(get('?month=2026-11'), ctx)
  assert.equal(res.status, 500)
  assert.deepEqual(await res.json(), { error: { code: 'server_error' } })
})

test('#1058: the social routes never reach service_role', () => {
  for (const file of ['app/api/admin/social/posts/route.ts', 'lib/social/repository.ts']) {
    const source = readFileSync(resolve(root, file), 'utf8')
    assert.ok(!/getSupabaseService\s*\(/.test(source), `${file} calls the service client`)
  }
})
