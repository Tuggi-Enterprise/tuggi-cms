/**
 * #741 — the two ranking reads, and WHICH CLIENT issues them.
 *
 * Four things are pinned here, and each one is a way the card could regress:
 *
 * 1. the read reaches PostgREST with the SERVICE client, never with the operator's session
 *    client. `core.ranking_scoreboard` and `core.ranking_session_metering` grant `SELECT` to
 *    `service_role` alone; `auth.supabase` arrives as `authenticated`, which in `drive` is every
 *    logged-in tourist, and the answer is `42501` (`docs/contracts/banco-para-cms.md`, Parte 7).
 *    The views carry the nominal scoreboard of 538 people — BR-USUARIO-042 item 5;
 * 2. the gate still runs first: anonymous is 401, a non-admin CMS user is 403, and in both cases
 *    NO query leaves the server;
 * 3. the rows that leave the route belong to exactly one period. Mixing `week` with a rolling
 *    window counts the same visit several times, and the contract names it as the number-one
 *    suspect when the screen disagrees with the reference measurement;
 * 4. a caller cannot turn the drill-down into an arbitrary filter: `?userId=` is a uuid or a 400.
 *
 * Run with: npm run test:api
 */

import { test, before, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dirname, '../..')

interface Query {
  /** `service` or `session` — the whole point of the file. */
  client: 'service' | 'session'
  relation: string
  eq: { column: string; value: unknown }[]
}

interface Scenario {
  user: { id: string; email: string } | null
  cmsUser: { email: string; role: string; is_active: boolean } | null
  queries: Query[]
  rows: unknown[]
  /** What PostgREST says the total is, so a truncated read can be simulated. */
  count: number | null
  /** What PostgREST refused with. A `PostgrestError` keeps the SQLSTATE in `code` (#755). */
  error: { message: string; code?: string } | null
}

let scenario: Scenario

const ADMIN = { id: 'auth-user-1', email: 'admin@tuggi.app' }

/**
 * A row of `core.ranking_scoreboard` with every column the route names.
 *
 * The score is the one of **BR-RANKING-004** since `20260916130000`: `points_from_minutes` is `0`
 * constant and the parcel that closes `points_official` is `points_from_km` — 39 entitled km at
 * 0,11 is the 4,29 the 143 charged minutes used to be worth, so `45 + 4,29 = 49,29` still holds
 * with the axis underneath it replaced.
 */
function scoreboardRow(overrides: Record<string, unknown> = {}) {
  return {
    period_kind: 'rolling_30d',
    period_start: '2026-08-14T00:00:00+00:00',
    period_end: '2026-09-13T00:00:00+00:00',
    user_id: '11111111-1111-4111-8111-111111111111',
    nickname: 'hoppy-otter',
    platform: 'ios',
    excluded_from_metrics: false,
    trigger_points_fired: 45,
    trigger_points_notable: 12,
    visits_indeterminate: 3,
    visits_manual: 0,
    charged_minutes: 143,
    story_days: 4,
    has_full_week_streak: false,
    streak_multiplier: 1,
    points_from_triggers: 45,
    points_from_minutes: 0,
    points_official: 49.29,
    rank_official: 1,
    rank_excluding_internal: 1,
    points_notable_weighted: 57,
    rank_notable_weighted: 1,
    trail_span_minutes: 4022,
    metering_gap_minutes: 3879,
    sessions_with_trail: 6,
    sessions_charged: 2,
    km_with_entitlement: 39,
    points_from_km: 4.29,
    ...overrides,
  }
}

/**
 * A client that records the relation it was asked for and answers the scenario's rows.
 *
 * `cms_users` is the gate's own lookup and is served by the session client, as it must be: the
 * gate proves WHO is asking with the operator's JWT. Any other relation reached through the
 * session client is the defect this file exists to catch.
 */
function createClient(kind: 'service' | 'session') {
  const cmsUsers: any = {
    select: () => cmsUsers,
    eq: () => cmsUsers,
    maybeSingle: async () => ({ data: scenario.cmsUser, error: null }),
  }

  return {
    auth: {
      getUser: async () => ({
        data: { user: scenario.user },
        error: scenario.user ? null : { message: 'Auth session missing!' },
      }),
    },
    schema: () => ({
      from: (relation: string) => {
        if (relation === 'cms_users' && kind === 'session') return cmsUsers

        const query: Query = { client: kind, relation, eq: [] }
        scenario.queries.push(query)

        const chain: any = {
          select: () => chain,
          order: () => chain,
          limit: () => chain,
          eq: (column: string, value: unknown) => {
            query.eq.push({ column, value })
            return chain
          },
          then: (onFulfilled: (result: unknown) => unknown) =>
            Promise.resolve({
              data: scenario.error ? null : scenario.rows,
              error: scenario.error,
              count: scenario.count ?? scenario.rows.length,
            }).then(onFulfilled),
        }
        return chain
      },
    }),
  }
}

const handlers = new Map<string, (req: any, ctx?: any) => Promise<Response>>()

const SCOREBOARD = 'app/api/dashboard/ranking/route.ts'
const SESSIONS = 'app/api/dashboard/ranking/sessions/route.ts'

before(async () => {
  mock.module('next/headers', {
    namedExports: { cookies: async () => ({ get: () => undefined, getAll: () => [] }) },
  })

  mock.module('@/lib/core/supabase-client', {
    namedExports: {
      getSupabaseRouteHandler: () => createClient('session'),
      getSupabaseService: () => createClient('service'),
      getSupabaseClient: () => createClient('session'),
    },
  })

  // Not `module`: Next's lint forbids assigning that identifier anywhere in the repo.
  for (const routeModule of [SCOREBOARD, SESSIONS]) {
    const loaded = await import(resolve(REPO_ROOT, routeModule))
    handlers.set(routeModule, loaded.GET)
  }
})

beforeEach(() => {
  scenario = { user: null, cmsUser: null, queries: [], rows: [], count: null, error: null }
})

function asAdmin(): void {
  scenario.user = ADMIN
  scenario.cmsUser = { email: ADMIN.email, role: 'admin', is_active: true }
}

function request(url: string): any {
  return new Request(url)
}

for (const [routeModule, url] of [
  [SCOREBOARD, 'http://localhost/api/dashboard/ranking?period=rolling_30d'],
  [SESSIONS, 'http://localhost/api/dashboard/ranking/sessions'],
] as const) {
  test(`#741: ${routeModule} refuses an anonymous caller with 401`, async () => {
    const response = await handlers.get(routeModule)!(request(url))

    assert.equal(response.status, 401)
    assert.deepEqual(scenario.queries, [], 'no read may leave the server without a session')
  })

  test(`#741: ${routeModule} refuses a non-admin CMS user with 403`, async () => {
    scenario.user = ADMIN
    scenario.cmsUser = { email: ADMIN.email, role: 'editor', is_active: true }

    const response = await handlers.get(routeModule)!(request(url))

    assert.equal(response.status, 403)
    assert.deepEqual(scenario.queries, [], 'the handler must not run for an insufficient role')
  })

  test(`#741: ${routeModule} reads the view with the SERVICE client, never the session one`, async () => {
    asAdmin()
    scenario.rows = [scoreboardRow()]

    const response = await handlers.get(routeModule)!(request(url))

    assert.equal(response.status, 200)
    assert.equal(scenario.queries.length, 1)
    assert.equal(
      scenario.queries[0].client,
      'service',
      'the views answer service_role alone; the session client would come back 42501'
    )
    assert.match(scenario.queries[0].relation, /^ranking_/)
  })
}

test('#741: the scoreboard answers rows of EXACTLY one period', async () => {
  asAdmin()
  scenario.rows = [
    scoreboardRow({ period_kind: 'rolling_30d' }),
    scoreboardRow({ period_kind: 'rolling_90d', user_id: '22222222-2222-4222-8222-222222222222' }),
    scoreboardRow({
      period_kind: 'week',
      period_start: '2026-08-31T00:00:00+00:00',
      period_end: '2026-09-07T00:00:00+00:00',
      user_id: '33333333-3333-4333-8333-333333333333',
    }),
  ]

  const response = await handlers
    .get(SCOREBOARD)!(request(`http://localhost/api/dashboard/ranking?period=week&start=${encodeURIComponent('2026-08-31T00:00:00+00:00')}`))
  const body = await response.json()

  assert.equal(body.data.rows.length, 1)
  assert.equal(body.data.rows[0].period_kind, 'week')
  assert.equal(body.data.period.kind, 'week')
  // The `<select>` still knows about every period the view produced: it is built from the data,
  // never from a calendar in the browser.
  // #742 · DS-COMPONENTE-089: competition first, calibration last — the order of the two
  // `<optgroup>`s, and it is the list itself that carries it (spec §2.3).
  assert.deepEqual(
    body.data.periods.map((option: { kind: string }) => option.kind),
    ['week', 'rolling_30d', 'rolling_90d']
  )
})

test('#741: an unusable period parameter falls back to the 30-day window, never to "all"', async () => {
  asAdmin()
  scenario.rows = [scoreboardRow()]

  // `week` with no `start`: guessing which week the operator meant is the answer that looks
  // right and is not. Summing periods is not an option that exists (`DS-COMPONENTE-082` item 1).
  const response = await handlers
    .get(SCOREBOARD)!(request('http://localhost/api/dashboard/ranking?period=week'))
  const body = await response.json()

  assert.equal(body.data.period.kind, 'rolling_30d')
  assert.equal(body.data.rows.length, 1)
})

test('#741: the count of marked accounts is taken over the whole view, not over the served period', async () => {
  asAdmin()
  scenario.rows = [
    scoreboardRow({ excluded_from_metrics: false }),
    scoreboardRow({
      period_kind: 'week',
      user_id: '44444444-4444-4444-8444-444444444444',
      excluded_from_metrics: true,
    }),
  ]

  const response = await handlers
    .get(SCOREBOARD)!(request('http://localhost/api/dashboard/ranking?period=rolling_30d'))
  const body = await response.json()

  assert.equal(body.data.rows.length, 1, 'the served period still holds one row')
  assert.equal(
    body.data.internalAccounts,
    1,
    'the warning band answers "is the filter removing anybody", which must not flicker with the period'
  )
})

test('#741: a truncated read is refused, not served', async () => {
  asAdmin()
  scenario.rows = [scoreboardRow()]
  // PostgREST would cut the answer at its own `max-rows` without saying so, and a scoreboard
  // missing rows looks exactly like a scoreboard.
  scenario.count = 900

  const response = await handlers
    .get(SCOREBOARD)!(request('http://localhost/api/dashboard/ranking'))

  assert.equal(response.status, 502)
})

/**
 * #741 · BR-RANKING-001 — THE GHOST ROW OF `user_id` NULL NEVER LEAVES THE ROUTE.
 *
 * `core.ranking_scoreboard` emits one row per period with `user_id` null, `nickname` null and
 * every quantity at zero: two source tables carry rows whose `user_id` is nullable and null, and
 * the `LEFT JOIN … USING (user_id)` never match. The row always existed; `20260916120000` made it
 * VISIBLE, because in `week` it now receives `rank_official` and reaches the screen with a
 * position and no nickname. `docs/contracts/banco-para-cms.md`, Parte 7, "A linha fantasma de
 * `user_id` nulo", makes the filter an obligation of the screen — *"não é opcional"*.
 *
 * The three outputs of this route are pinned at once, because the row has to disappear from all
 * of them: the table, the `<select>` of periods — a period whose only row is the ghost is a period
 * with nobody in it — and the count of marked accounts.
 *
 * AND THE ANSWER IS STILL 200: PostgREST counted the ghost, so filtering it before the truncation
 * guard would make every request read as a truncated one.
 */
test('#741 · BR-RANKING-001: the ghost row of null user_id reaches neither the table, nor the periods, nor the count', async () => {
  asAdmin()
  const ghost = {
    user_id: null,
    nickname: null,
    trigger_points_fired: 0,
    trigger_points_notable: 0,
    visits_indeterminate: 0,
    visits_manual: 0,
    charged_minutes: 0,
    story_days: 0,
    points_from_triggers: 0,
    points_from_minutes: 0,
    km_with_entitlement: 0,
    points_from_km: 0,
    points_official: 0,
    rank_official: null,
    rank_excluding_internal: null,
    points_notable_weighted: 0,
    rank_notable_weighted: null,
    trail_span_minutes: 0,
    metering_gap_minutes: 0,
    sessions_with_trail: 0,
    sessions_charged: 0,
  }

  scenario.rows = [
    scoreboardRow(),
    scoreboardRow({ excluded_from_metrics: true, user_id: '44444444-4444-4444-8444-444444444444' }),
    // The ghost of the served period — the row the operator sees with no nickname.
    scoreboardRow({ period_kind: 'rolling_30d', ...ghost }),
    // The ghost of a week NOBODY played: the only row of that period, and the one that turns into
    // an option leading to an empty table.
    scoreboardRow({
      period_kind: 'week',
      period_start: '2026-08-31T00:00:00+00:00',
      period_end: '2026-09-07T00:00:00+00:00',
      // In `week` this is the row that now carries a position, tied at the end.
      ...ghost,
      rank_official: 537,
    }),
  ]

  const response = await handlers
    .get(SCOREBOARD)!(request('http://localhost/api/dashboard/ranking?period=rolling_30d'))
  const body = await response.json()

  assert.equal(response.status, 200, 'the guard compares the READ with the count, before our filter')
  assert.equal(body.data.rows.length, 2, 'the two accounts of the period, and nothing else')
  assert.equal(
    body.data.rows.every((row: { user_id: string | null }) => row.user_id != null),
    true,
    'a row with no account has no nickname to show'
  )
  assert.deepEqual(
    body.data.periods.map((option: { kind: string }) => option.kind),
    ['rolling_30d'],
    'the week whose only row is the ghost is a week with nobody in it, and offering it is the screen inventing a period'
  )
  assert.equal(
    body.data.internalAccounts,
    1,
    'the marked population is counted in ACCOUNTS; the ghost is not one'
  )
})

test('#741: the session drill-down takes a uuid or a 400, and filters by that user', async () => {
  asAdmin()
  scenario.rows = []

  const refused = await handlers
    .get(SESSIONS)!(request('http://localhost/api/dashboard/ranking/sessions?userId=1%20or%201=1'))
  assert.equal(refused.status, 400)
  assert.equal(scenario.queries.length, 0, 'a malformed filter never becomes a query')

  const accepted = await handlers
    .get(SESSIONS)!(
    request(
      'http://localhost/api/dashboard/ranking/sessions?userId=11111111-1111-4111-8111-111111111111'
    )
  )
  assert.equal(accepted.status, 200)
  assert.deepEqual(scenario.queries[0].eq, [
    { column: 'user_id', value: '11111111-1111-4111-8111-111111111111' },
  ])
})

/**
 * #755 — THE SQLSTATE LEAVES THE ROUTE, because it is what picks the sentence.
 *
 * `permission denied for view ranking_scoreboard` does not contain the number, and the screen
 * used to ask `message.includes('42501')` — a question that was never true, which left
 * `error.forbidden` unreachable in the three languages. The grant of Parte 7 is exactly what
 * `42501` reports, so this is the failure the screen most needs to name.
 */
for (const [routeModule, url] of [
  [SCOREBOARD, 'http://localhost/api/dashboard/ranking?period=rolling_30d'],
  [SESSIONS, 'http://localhost/api/dashboard/ranking/sessions'],
] as const) {
  test(`#755: ${routeModule} carries the SQLSTATE of a refused read, not only its message`, async () => {
    asAdmin()
    scenario.error = { message: 'permission denied for view ranking_scoreboard', code: '42501' }

    const response = await handlers.get(routeModule)!(request(url))
    const body = (await response.json()) as { error: string; code?: string }

    assert.equal(response.status, 502)
    assert.equal(body.code, '42501', 'the screen chooses its phrase by the code, never by the text')
    assert.equal(
      body.error.includes('42501'),
      false,
      'the message never carries the number — that is the whole reason `code` travels'
    )
  })
}
