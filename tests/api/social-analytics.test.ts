/**
 * #1059: the CMS side of the social analytics. The three API doors (`/api/admin/social/overview`,
 * `.../posts`, `.../accounts` and `.../accounts/{id}`), the pure helpers of `lib/social/`, and the
 * facts the CMS shares with the Edge Function `social-collect` (time zone, floor, theme definitions),
 * which live twice because one side is Deno and the other Next: this file fails when they drift.
 *
 * Pinned here: admin only, nothing read before the gate; the username is refused before the Meta
 * when it is malformed, our own account or an active duplicate; a removed account is reactivated,
 * never inserted twice; removing is `active = false` on a competitor and nothing else; the ranking
 * comes from `social.own_media_ranking` and is never recomputed.
 *
 * Run with: npx tsx --experimental-test-module-mocks --test tests/api/social-analytics.test.ts
 */

import { test, before, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { NextRequest } from 'next/server'

const root = resolve(import.meta.dirname, '../..')
const pt = JSON.parse(readFileSync(resolve(root, 'messages/pt.json'), 'utf8'))

type Call = { schema: string; table: string; chain: string[]; args: unknown[][] }
let calls: Call[]
let role: string
let answers: Record<string, (c: Call) => { data?: unknown; error?: { code: string } | null }>
let invokes: Array<{ fn: string; body: unknown }>
let lookupReply: { data: unknown; error: unknown }
let rpcArgs: Array<{ fn: string; args: unknown }>

function builder(schema: string, table: string) {
  const call: Call = { schema, table, chain: [], args: [] }
  const proxy: unknown = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'then') {
          return (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) => {
            if (schema === 'core') {
              return Promise.resolve({ data: { id: 'cms-1', email: 'admin@tuggi.app', role, is_active: true }, error: null }).then(ok, fail)
            }
            calls.push(call)
            const a = answers[`${table}:${call.chain.join('.')}`] ?? answers[table]
            const r = a ? a(call) : { data: null }
            return Promise.resolve({ data: r.data ?? null, error: r.error ?? null }).then(ok, fail)
          }
        }
        return (...args: unknown[]) => {
          call.chain.push(String(prop))
          call.args.push(args)
          return proxy
        }
      },
    }
  )
  return proxy
}

function client() {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'u-1', email: 'admin@tuggi.app' } }, error: null }) },
    schema: (schema: string) => ({
      from: (table: string) => builder(schema, table),
      rpc: (fn: string, args: unknown) => {
        rpcArgs.push({ fn, args })
        return builder(schema, `rpc:${fn}`)
      },
    }),
    functions: {
      invoke: async (fn: string, opts: { body: unknown }) => {
        invokes.push({ fn, body: opts.body })
        return lookupReply
      },
    },
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
let overviewRoute: any
let postsRoute: any
let accountsRoute: any
let accountRoute: any
let competitorPostsRoute: any
let storiesRoute: any
let time: any
let labels: any
let repo: any
let constants: any
let edge: any
/* eslint-enable @typescript-eslint/no-explicit-any */

before(async () => {
  mock.module('next/headers', { namedExports: { cookies: async () => ({ get: () => undefined, getAll: () => [] }) } })
  mock.module('@/lib/core/supabase-client', {
    namedExports: {
      getSupabaseRouteHandler: () => client(),
      getSupabaseService: () => client(),
      getSupabase: () => client(),
    },
  })
  overviewRoute = await import('@/app/api/admin/social/overview/route')
  postsRoute = await import('@/app/api/admin/social/posts/route')
  accountsRoute = await import('@/app/api/admin/social/accounts/route')
  accountRoute = await import('@/app/api/admin/social/accounts/[id]/route')
  competitorPostsRoute = await import('@/app/api/admin/social/competitor-posts/route')
  storiesRoute = await import('@/app/api/admin/social/stories/route')
  time = await import('@/lib/social/time')
  labels = await import('@/lib/social/labels')
  repo = await import('@/lib/social/repository')
  constants = await import('@/lib/social/constants')
  edge = await import(pathToFileURL(resolve(root, 'supabase/functions/_shared/social-collect.ts')).href)
})

beforeEach(() => {
  calls = []
  rpcArgs = []
  invokes = []
  role = 'admin'
  answers = {}
  lookupReply = { data: { ok: true, ig_user_id: '17841499999999999', followers_count: 51234 }, error: null }
})

const req = (method: string, path: string, body?: unknown) =>
  new Request(`http://localhost/api/admin/social${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as NextRequest
const ctx = { params: Promise.resolve({}) }
const idCtx = (id: string) => ({ params: Promise.resolve({ id }) })
const RIVAL_ID = 'b0000000-0000-4000-8000-000000000002'

test('#1059: only an admin reaches the social doors, and nothing of social is read before the gate', async () => {
  for (const r of ['editor', 'viewer', 'client']) {
    role = r
    assert.equal((await overviewRoute.GET(req('GET', '/overview'), ctx)).status, 403, r)
    assert.equal((await postsRoute.GET(req('GET', '/posts'), ctx)).status, 403, r)
    assert.equal((await accountsRoute.GET(req('GET', '/accounts'), ctx)).status, 403, r)
    assert.equal((await accountsRoute.POST(req('POST', '/accounts', { username: 'roadtrippers' }), ctx)).status, 403, r)
    assert.equal((await accountRoute.PATCH(req('PATCH', `/accounts/${RIVAL_ID}`, { active: false }), idCtx(RIVAL_ID))).status, 403, r)
  }
  assert.deepEqual([calls, invokes], [[], []])
})

test('#1059: there is no DELETE on the accounts: removing is PATCH active false', () => {
  assert.equal(accountsRoute.DELETE, undefined)
  assert.equal(accountRoute.DELETE, undefined)
})

test('#1059: the overview reads the ranking from social.own_media_ranking from Brasília midnight of the period start', async () => {
  answers['watched_accounts'] = () => ({ data: { id: 'own-1', username: 'tuggi_app' } })
  answers['rpc:own_media_ranking'] = () => ({
    data: [
      { dimension: 'format', bucket: 'REELS', posts: 5, rate: 0.051 },
      { dimension: 'theme', bucket: 'pending', posts: 2, rate: null },
    ],
  })
  const res = await overviewRoute.GET(req('GET', '/overview?period=12w'), ctx)
  assert.equal(res.status, 200)
  const body = await res.json()
  const call = rpcArgs.find((c) => c.fn === 'own_media_ranking')
  const since = repo.periodWindow(body.today, '12w').from
  assert.deepEqual(call?.args, { p_since: time.brasiliaMidnightIso(since) })
  assert.match(String((call?.args as { p_since: string }).p_since), /T03:00:00\.000Z$/)
  assert.deepEqual(body.ranking.rows[1], { dimension: 'theme', bucket: 'pending', posts: 2, rate: null })
  assert.equal(body.funnel.days.length, 84)
  assert.equal((await overviewRoute.GET(req('GET', '/overview?period=1y'), ctx)).status, 400)
})

test('#1059: a database refusal answers 500 with no detail', async () => {
  answers['watched_accounts'] = () => ({ error: { code: '42501' } })
  const res = await postsRoute.GET(req('GET', '/posts'), ctx)
  assert.equal(res.status, 500)
  assert.deepEqual(await res.json(), { error: { code: 'server_error' } })
})

test('#1059: a malformed username is refused before the database and before the Meta', async () => {
  for (const username of ['nome com espaço', 'tuggi-app', '', 'a'.repeat(31), 42, '@@x']) {
    const res = await accountsRoute.POST(req('POST', '/accounts', { username }), ctx)
    assert.equal(res.status, 400, String(username))
    assert.deepEqual(await res.json(), { error: { code: 'invalid' } })
  }
  assert.deepEqual([calls, invokes], [[], []])
})

test('#1059: "@Tuggi_App " is normalized and refused as our own account, without asking the Meta', async () => {
  answers['watched_accounts'] = (c) => {
    assert.deepEqual(c.args[c.chain.indexOf('eq')], ['username', 'tuggi_app'])
    return { data: { id: 'own-1', is_own: true, active: true } }
  }
  const res = await accountsRoute.POST(req('POST', '/accounts', { username: '@Tuggi_App ' }), ctx)
  assert.equal(res.status, 409)
  assert.deepEqual(await res.json(), { error: { code: 'own_account' } })
  assert.deepEqual(invokes, [])
})

test('#1059: an active duplicate is refused before the Meta and names the row to blink', async () => {
  answers['watched_accounts'] = () => ({ data: { id: RIVAL_ID, is_own: false, active: true } })
  const res = await accountsRoute.POST(req('POST', '/accounts', { username: 'izitravel' }), ctx)
  assert.equal(res.status, 409)
  assert.deepEqual(await res.json(), { error: { code: 'duplicate', id: RIVAL_ID } })
  assert.deepEqual(invokes, [])
})

test('#1059: a new account is checked on social-collect lookup and inserted with the ig user id', async () => {
  answers['watched_accounts:select.eq.maybeSingle'] = () => ({ data: null })
  answers['watched_accounts:insert.select.single'] = (c) => {
    assert.deepEqual(c.args[0], [{ username: 'roadtrippers', ig_user_id: '17841499999999999' }])
    return { data: { id: 'new-1', username: 'roadtrippers' } }
  }
  const res = await accountsRoute.POST(req('POST', '/accounts', { username: ' @RoadTrippers' }), ctx)
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { account: { id: 'new-1', username: 'roadtrippers', followers: 51234, reactivated: false } })
  assert.deepEqual(invokes, [{ fn: 'social-collect', body: { action: 'lookup', username: 'roadtrippers' } }])
})

test('#1059: a removed account comes back by UPDATE active true, never a second insert', async () => {
  answers['watched_accounts:select.eq.maybeSingle'] = () => ({ data: { id: RIVAL_ID, is_own: false, active: false } })
  answers['watched_accounts:update.eq.select.single'] = (c) => {
    assert.deepEqual(c.args[0], [{ active: true, ig_user_id: '17841499999999999' }])
    assert.deepEqual(c.args[1], ['id', RIVAL_ID])
    return { data: { id: RIVAL_ID, username: 'izitravel' } }
  }
  const res = await accountsRoute.POST(req('POST', '/accounts', { username: 'izitravel' }), ctx)
  assert.equal(res.status, 200)
  assert.equal((await res.json()).account.reactivated, true)
  assert.ok(!calls.some((c) => c.chain.includes('insert')))
})

test('#1059: not found on the Meta is 422, any other doubt is 502, and nothing is written', async () => {
  answers['watched_accounts:select.eq.maybeSingle'] = () => ({ data: null })
  lookupReply = { data: { ok: false, reason: 'not_found' }, error: null }
  const missing = await accountsRoute.POST(req('POST', '/accounts', { username: 'ghost' }), ctx)
  assert.deepEqual([missing.status, await missing.json()], [422, { error: { code: 'not_found' } }])
  for (const reply of [
    { data: { ok: false, reason: 'meta_error' }, error: null },
    { data: null, error: { name: 'FunctionsHttpError' } },
    { data: { error: 'meta_not_configured' }, error: null },
  ]) {
    lookupReply = reply
    const res = await accountsRoute.POST(req('POST', '/accounts', { username: 'ghost' }), ctx)
    assert.deepEqual([res.status, await res.json()], [502, { error: { code: 'meta_error' } }])
  }
  assert.ok(!calls.some((c) => c.chain.includes('insert') || c.chain.includes('update')))
})

test('#1059: removing takes exactly { active: false } on a competitor that is active', async () => {
  for (const body of [{ active: true }, { active: false, username: 'x' }, {}, { active: 'false' }]) {
    assert.equal((await accountRoute.PATCH(req('PATCH', `/accounts/${RIVAL_ID}`, body), idCtx(RIVAL_ID))).status, 400)
  }
  assert.equal((await accountRoute.PATCH(req('PATCH', '/accounts/not-a-uuid', { active: false }), idCtx('not-a-uuid'))).status, 400)
  assert.deepEqual(calls, [])

  answers['watched_accounts'] = (c) => {
    assert.deepEqual(c.chain, ['update', 'eq', 'eq', 'eq', 'select'])
    assert.deepEqual(c.args.slice(0, 4), [[{ active: false }], ['id', RIVAL_ID], ['is_own', false], ['active', true]])
    return { data: [{ id: RIVAL_ID }] }
  }
  assert.equal((await accountRoute.PATCH(req('PATCH', `/accounts/${RIVAL_ID}`, { active: false }), idCtx(RIVAL_ID))).status, 200)
  answers['watched_accounts'] = () => ({ data: [] })
  assert.equal((await accountRoute.PATCH(req('PATCH', `/accounts/${RIVAL_ID}`, { active: false }), idCtx(RIVAL_ID))).status, 404)
})

test('#1059: growth needs the day 7 or 30 days back, and says when it starts instead of printing zero', () => {
  const series = [
    { day: '2026-10-20', followers_count: 1000 },
    { day: '2026-10-27', followers_count: 1100 },
    { day: '2026-10-29', followers_count: 1150 },
  ]
  assert.deepEqual(repo.growthOver(series, 7), { delta: 150, ratio: 0.15 })
  assert.equal(repo.growthOver(series, 30), null)
  assert.equal(repo.growthOver([{ day: '2026-10-29', followers_count: 10 }], 7), null)
})

test('#1059 copy 2.2: format and theme map to the copy keys; an unknown value is not guessed', () => {
  const cases: Array<[string | null, string | null, string]> = [
    ['CAROUSEL_ALBUM', 'FEED', 'carousel'],
    ['IMAGE', 'FEED', 'image'],
    ['VIDEO', 'REELS', 'reels'],
    ['VIDEO', null, 'reels'],
    ['VIDEO', 'FEED', 'other'],
    ['STORY', 'STORY', 'other'],
  ]
  for (const [type, product, key] of cases) assert.equal(labels.formatKey(type, product), key, `${type}/${product}`)
  assert.deepEqual(['REELS', 'IMAGE', 'CAROUSEL_ALBUM', 'VIDEO', null].map(labels.formatBucketKey), ['reels', 'image', 'carousel', 'other', 'other'])
  assert.equal(labels.themeKey(null), 'pending')
  assert.equal(labels.themeKey('pending'), 'pending')
  assert.equal(labels.themeKey('bastidor'), 'bastidor')
  assert.equal(labels.themeKey('travel'), null)
  for (const k of ['carousel', 'reels', 'image', 'other']) assert.ok(pt.Pages.Social.format[k], k)
  for (const k of [...labels.THEME_KEYS, 'pending']) assert.ok(pt.Pages.Social.theme[k], k)
})

test('#1059 copy 5: the banner says none, failed after 6h30 without today, first day, or nothing', () => {
  const at = (iso: string) => new Date(iso)
  assert.equal(time.collectState({ first_day: null, last_day: null }, at('2026-11-02T12:00:00Z')), 'none')
  // 09:20 UTC is 06:20 in Brasília: yesterday is still the newest possible day.
  assert.equal(time.collectState({ first_day: '2026-10-01', last_day: '2026-11-01' }, at('2026-11-02T09:20:00Z')), 'ok')
  assert.equal(time.collectState({ first_day: '2026-10-01', last_day: '2026-11-01' }, at('2026-11-02T09:40:00Z')), 'failed')
  assert.equal(time.collectState({ first_day: '2026-11-02', last_day: '2026-11-02' }, at('2026-11-02T12:00:00Z')), 'first_day')
  assert.equal(time.collectState({ first_day: '2026-10-01', last_day: '2026-11-02' }, at('2026-11-02T12:00:00Z')), 'ok')
  // Late evening in Brasília is already the next UTC day; the day is Brasília's.
  assert.equal(time.brasiliaDay(at('2026-11-03T02:30:00Z')), '2026-11-02')
  assert.equal(time.mondayOf('2026-11-08'), '2026-11-02')
})

test('#1059: the facts the CMS and social-collect share are the same on both sides', () => {
  assert.equal(edge.SOCIAL_TIME_ZONE, time.SOCIAL_TIME_ZONE)
  assert.equal(edge.MIN_POSTS, constants.MIN_POSTS)
  assert.equal(String(edge.USERNAME_PATTERN), String(labels.USERNAME_PATTERN))
  for (const theme of labels.THEME_KEYS) {
    assert.equal(edge.THEME_HINTS[theme], pt.Pages.Social.theme[`${theme}_hint`], theme)
  }
  assert.deepEqual([...edge.THEMES], [...labels.THEME_KEYS])
  assert.equal(edge.formatWord('VIDEO', null), 'reels')
})

test('#1059: the screen is pt only, and the menu label exists in the three locales', () => {
  for (const locale of ['pt', 'en', 'es']) {
    const m = JSON.parse(readFileSync(resolve(root, `messages/${locale}.json`), 'utf8'))
    assert.ok(m.Navigation.social, locale)
    if (locale !== 'pt') assert.equal(m.Pages.Social, undefined, locale)
  }
})

test('#1059 DS-COMPONENTE-084: the overview counts measured days per series, and the previous period without data is null', async () => {
  const today = time.brasiliaDay(new Date())
  const { from, to } = repo.periodWindow(today, '4w')
  answers['watched_accounts'] = () => ({ data: { id: 'own-1', username: 'tuggi_app' } })
  answers['funnel_daily'] = () => ({
    data: [
      { day: time.addDays(to, -2), profile_views: null, website_clicks: null, ig_site_sessions: 0, installs_ios: 3, installs_android: 1 },
      { day: to, profile_views: 9, website_clicks: 0, ig_site_sessions: 0, installs_ios: null, installs_android: 3 },
    ],
  })
  answers['rpc:own_media_ranking'] = () => ({ data: [{ dimension: 'format', bucket: null, posts: 3, rate: 0.01 }] })
  const body = await (await overviewRoute.GET(req('GET', '/overview?period=4w'), ctx)).json()
  assert.equal(body.funnel.from, from)
  assert.deepEqual(body.funnel.measured, { profile_views: 1, website_clicks: 1, ig_site_sessions: 2, store_clicks: 0, installs_ios: 1, installs_android: 2, installs: 2 })
  assert.deepEqual(body.funnel.previous_measured, { profile_views: 0, website_clicks: 0, ig_site_sessions: 0, store_clicks: 0, installs_ios: 0, installs_android: 0, installs: 0 })
  // A 0 Meta answered is a 0; days nobody measured do not become zeros.
  assert.deepEqual([body.funnel.totals.website_clicks, body.funnel.previous.website_clicks], [0, null])
  assert.deepEqual(body.ranking.rows[0], { dimension: 'format', bucket: null, posts: 3, rate: 0.01 })
})

test('#1059 DS-COMPONENTE-084: a change prints only between two fully measured periods; each strip has its own top', async () => {
  const funnel = await import('@/lib/social/funnel')
  const full = { now: 'full', before: 'full' } as const
  assert.equal(funnel.changeRatio(23, 2, full), 10.5)
  assert.equal(funnel.changeRatio(9, null, full), null)
  assert.equal(funnel.changeRatio(9, 0, full), null)
  assert.equal(funnel.changeRatio(9, 4, { now: 'partial', before: 'full' }), null)
  assert.equal(funnel.changeRatio(9, 4, { now: 'full', before: 'none' }), null)
  assert.deepEqual([[0, 28], [1, 28], [28, 28]].map(([m, d]) => funnel.coverageOf(m, d)), ['none', 'partial', 'full'])
  assert.deepEqual(
    [[null, null], [0], [1], [9], [3, 4], [12], [140], [7.2]].map((v) => funnel.stripTop(v)),
    [1, 1, 1, 10, 4, 15, 150, 8]
  )
})

test('#1059: the post link opens only on Instagram\'s own host', async () => {
  const { safePermalink } = await import('@/lib/social/funnel')
  assert.equal(safePermalink('https://www.instagram.com/p/DfFMgQiEcuG/'), 'https://www.instagram.com/p/DfFMgQiEcuG/')
  for (const bad of ['javascript:alert(1)', 'https://www.instagram.com.evil.io/p/x', 'http://www.instagram.com/p/x', 'https://evil.io/?https://www.instagram.com/', null, undefined, '']) {
    assert.equal(safePermalink(bad), null, String(bad))
  }
})

test('#1059: the median of the competitors is said as a median', () => {
  assert.match(pt.Pages.Social.competitors.engagement_hint, /^Mediana/)
  assert.doesNotMatch(pt.Pages.Social.competitors.engagement_hint, /média/i)
})

test('#1061 R1.1: the four indicators come from social.overview_indicators of the period, as the database answered', async () => {
  answers['watched_accounts'] = () => ({ data: { id: 'own-1', username: 'tuggi_app' } })
  answers['account_daily'] = () => ({ data: [{ day: '2026-10-27' }] })
  answers['rpc:overview_indicators'] = () => ({
    data: [{ followers: 1520, followers_7d_delta: null, reach_sum: '24180', reach_posts: 11, engagement_median: '0.0412', engagement_posts: 11 }],
  })
  const body = await (await overviewRoute.GET(req('GET', '/overview?period=6m'), ctx)).json()
  const call = rpcArgs.find((c) => c.fn === 'overview_indicators')
  assert.deepEqual(call?.args, { p_since: time.brasiliaMidnightIso(repo.periodWindow(body.today, '6m').from) })
  // numeric arrives as a string and is read as a number; without 7 days the delta says when it starts.
  assert.deepEqual(body.indicators, {
    followers: 1520,
    followers_7d_delta: null,
    followers_since: '2026-11-03',
    reach_sum: 24180,
    reach_posts: 11,
    engagement_median: 0.0412,
    engagement_posts: 11,
  })
})

test('#1062: the two new doors are admin only, and nothing of social is read before the gate', async () => {
  for (const r of ['editor', 'viewer', 'client']) {
    role = r
    assert.equal((await competitorPostsRoute.GET(req('GET', '/competitor-posts'), ctx)).status, 403, r)
    assert.equal((await storiesRoute.GET(req('GET', '/stories?days=14'), ctx)).status, 403, r)
  }
  assert.deepEqual(calls, [])
})

test('#1062 R2.1: competitor-posts defaults to the last closed week, offers four closed weeks and the current one, refuses any other', async () => {
  answers['watched_accounts'] = () => ({ data: [{ id: 'c1' }, { id: 'c2' }] })
  answers['rpc:competitor_top_posts'] = () => ({
    data: [{ username: 'izitravel', posted_at: '2026-10-21T13:00:00+00:00', permalink: 'https://www.instagram.com/p/x/', media_type: 'VIDEO', media_product_type: 'REELS', theme: 'pending', caption_first_line: 'Roma', hashtags: ['viagem'], likes: 400, comments: 20, followers_on_day: 51234, rate: '0.0081976' }],
  })
  const body = await (await competitorPostsRoute.GET(req('GET', '/competitor-posts'), ctx)).json()
  const monday = time.mondayOf(body.today)
  assert.equal(body.week_start, time.addDays(monday, -7))
  assert.equal(body.week_end, time.addDays(monday, -1))
  assert.equal(body.partial, false)
  assert.deepEqual(body.weeks, [-7, -14, -21, -28].map((n) => time.addDays(monday, n)).concat(monday))
  assert.equal(body.tracked, 2)
  assert.deepEqual(rpcArgs.find((c) => c.fn === 'competitor_top_posts')?.args, { p_week_start: time.addDays(monday, -7) })
  assert.equal(body.rows[0].rate, 0.0081976)
  const current = await (await competitorPostsRoute.GET(req('GET', `/competitor-posts?week=${monday}`), ctx)).json()
  assert.equal(current.partial, true)
  for (const bad of [time.addDays(monday, -35), time.addDays(monday, 1), 'x', '2026-13-40']) {
    assert.equal((await competitorPostsRoute.GET(req('GET', `/competitor-posts?week=${bad}`), ctx)).status, 400, bad)
  }
})

test('#1062 R2.6: stories come from social.recent_stories with the hourly job\'s last run; days outside 1..30 is 400', async () => {
  answers['collector_runs'] = () => ({ data: [{ job: 'stories', last_run_at: '2026-10-29T19:05:07Z', status: 'ok', detail: null, covered_from: null }] })
  answers['rpc:recent_stories'] = () => ({
    data: [{ id: 's1', posted_at: '2026-10-29T16:39:13Z', media_type: 'IMAGE', permalink: null, reach: 10, views: 16, replies: 0, tap_forward: 11, tap_back: 1, tap_exit: 2, swipe_forward: 0, collected_at: '2026-10-29T19:05:07Z', exit_rate: '0.2' }],
  })
  const body = await (await storiesRoute.GET(req('GET', '/stories?days=14'), ctx)).json()
  assert.deepEqual(rpcArgs.find((c) => c.fn === 'recent_stories')?.args, { p_days: 14 })
  assert.equal(body.collection.last_run_at, '2026-10-29T19:05:07Z')
  assert.equal(body.stories[0].exit_rate, 0.2)
  assert.equal(body.stories[0].tap_forward, 11)
  for (const bad of ['0', '31', '1.5', 'x']) assert.equal((await storiesRoute.GET(req('GET', `/stories?days=${bad}`), ctx)).status, 400, bad)
  answers['collector_runs'] = () => ({ data: [] })
  const never = await (await storiesRoute.GET(req('GET', '/stories'), ctx)).json()
  assert.equal(never.collection.last_run_at, null)
})

test('#1062 R2.3 R2.5: the overview carries the campaigns, the Apple state, the clicks-by-store flag and the audience', async () => {
  answers['watched_accounts'] = () => ({ data: { id: 'own-1', username: 'tuggi_app' } })
  answers['rpc:campaign_totals'] = () => ({ data: [{ campaign: 'bio_novembro', clicks_app_store: 3, clicks_play_store: 5, downloads_ios: null }] })
  answers['collector_runs'] = () => ({
    data: [
      { job: 'daily', last_run_at: 'x', status: 'ok', detail: '{"funnel":{"store_clicks":"no_store_dimension"}}', covered_from: null },
      { job: 'apple', last_run_at: 'x', status: 'ok', detail: null, covered_from: '2026-10-27' },
    ],
  })
  answers['rpc:latest_audience'] = () => ({
    data: [
      ...['A', 'B', 'C', 'D', 'E', 'F'].map((c, i) => ({ week_start: '2026-10-26', followers: 1520, breakdown: 'city', label: c, follower_count: 60 - i, share: '0.03' })),
      { week_start: '2026-10-26', followers: 1520, breakdown: 'gender', label: 'F', follower_count: 820, share: '0.5394736842' },
    ],
  })
  const body = await (await overviewRoute.GET(req('GET', '/overview'), ctx)).json()
  const { from, to } = repo.periodWindow(body.today, '4w')
  assert.deepEqual(rpcArgs.find((c) => c.fn === 'campaign_totals')?.args, { p_from: from, p_to: to })
  assert.deepEqual(body.campaigns, [{ campaign: 'bio_novembro', clicks_app_store: 3, clicks_play_store: 5, downloads_ios: null }])
  assert.equal(body.clicks_by_store, false)
  assert.deepEqual(body.apple, { configured: true, first_day: '2026-10-27' })
  assert.equal(body.audience.day, '2026-10-26')
  assert.equal(body.audience.city.length, 5)
  assert.deepEqual(body.audience.gender, [{ label: 'F', count: 820, share: 0.5394736842 }])
  assert.equal(body.audience_reason, null)
  assert.ok(body.funnel.days.every((d: Record<string, unknown>) => 'store_clicks' in d))
})

test('#1062 R2.5: no audience row is "not collected", or "below 100" when our account has fewer followers; no Apple run is "not configured"', async () => {
  answers['watched_accounts'] = () => ({ data: { id: 'own-1', username: 'tuggi_app' } })
  answers['rpc:overview_indicators'] = () => ({ data: [{ followers: 87 }] })
  const small = await (await overviewRoute.GET(req('GET', '/overview'), ctx)).json()
  assert.deepEqual([small.audience, small.audience_reason], [null, 'below_100'])
  assert.deepEqual(small.apple, { configured: false, first_day: null })
  assert.equal(small.clicks_by_store, true)
  answers['rpc:overview_indicators'] = () => ({ data: [{ followers: 1520 }] })
  answers['collector_runs'] = () => ({ data: [{ job: 'apple', last_run_at: 'x', status: 'not_configured', detail: null, covered_from: null }] })
  const big = await (await overviewRoute.GET(req('GET', '/overview'), ctx)).json()
  assert.equal(big.audience_reason, 'not_collected')
  assert.deepEqual(big.apple, { configured: false, first_day: null })
})

test('#1062 R2.4: the posts carry views and the reel watch time, converted from milliseconds to whole seconds on the server', async () => {
  answers['watched_accounts'] = () => ({ data: { id: 'own-1', username: 'tuggi_app' } })
  answers['media'] = () => ({
    data: [{ id: 'm2', posted_at: '2026-10-28T15:00:00Z', caption: 'x', media_type: 'VIDEO', media_product_type: 'REELS', theme: null, permalink: null, media_metrics: [{ day: '2026-10-29', reach: 4000, views: 9000, reels_avg_watch_time_ms: 12_400, reels_total_watch_time_ms: 11_520_400 }] }],
  })
  const body = await (await postsRoute.GET(req('GET', '/posts'), ctx)).json()
  const m = body.posts[0].metrics
  assert.deepEqual([m.views, m.reels_avg_watch_time_s, m.reels_total_watch_time_s, m.profile_visits], [9000, 12, 11520, null])
  const media = calls.find((c) => c.table === 'media')
  assert.match(String(media?.args[0][0]), /reels_avg_watch_time_ms, reels_total_watch_time_ms/)
})

test('#1062 R2.4: the reel watch time reads 12 s, 1 min 05 s, 48 min and 3 h 12 min', async () => {
  const format = await import('@/lib/social/format')
  assert.deepEqual([12, 65, 9].map(format.fmtWatchAvg), ['12 s', '1 min 05 s', '9 s'])
  assert.deepEqual([2880, 11520, 40, 3600].map(format.fmtWatchTotal), ['48 min', '3 h 12 min', '40 s', '1 h 00 min'])
})
