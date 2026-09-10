/**
 * `GET /api/admin/marketing/campaigns/[id]` — the numbers the campaign screen reads.
 *
 * Why this file exists: `computeStats` counted clicks with `status = 'clicked'`, and the status
 * is ONE field carrying a whole lifecycle. Resend emits `email.opened` on every reopen, so a
 * reader who clicked and came back was written down to `opened` and stopped being a click.
 * Measured 2026-09-10 in production: 11 rows say `clicked`, and 4 more carry `click_count > 0`
 * while saying `opened` — 27% of the clicks were invisible.
 *
 * The webhook stopped demoting the status on the same day
 * (`supabase/functions/_shared/newsletter-metrics.ts`, `highestStatus`), but the two fixes are
 * independent ON PURPOSE: the ladder protects rows written from now on, and counting by
 * `click_count` recovers the 6 campaigns ALREADY sent, without touching a single row.
 *
 * The fake below is a real little table with the PostgREST filters this route uses, not a
 * recorder: asserting that `.gt('click_count', 0)` was called proves the call, not the count.
 *
 * Run with: npm run test:api
 */

import { test, before, mock } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dirname, '../..')
const ROUTE = 'app/api/admin/marketing/campaigns/[id]/route.ts'

interface RecipientRow {
  id: string
  campaign_id: string
  email: string
  status: string
  delivered_at: string | null
  opened_at: string | null
  click_count: number
}

interface UnsubRow {
  email: string
  unsubscribed_at: string
}

interface Scenario {
  session: { user: { email: string } } | null
  cmsUser: { email: string; role: string; is_active: boolean } | null
  campaign: Record<string, unknown> | null
  recipients: RecipientRow[]
  unsubscribes: UnsubRow[]
}

let scenario: Scenario

/** A row builder, so each test states only the field it is about. */
function row(partial: Partial<RecipientRow> & { id: string }): RecipientRow {
  return {
    campaign_id: 'c-1',
    email: `${partial.id}@example.com`,
    status: 'sent',
    delivered_at: null,
    opened_at: null,
    click_count: 0,
    ...partial,
  }
}

/**
 * The slice of PostgREST this route actually uses. Anything it does not implement throws, so a
 * future filter cannot pass silently against a fake that ignored it.
 */
function queryOn<T extends Record<string, any>>(rows: T[]) {
  let current = rows.slice()
  let wantsCount = false

  const chain: any = {
    select: (_cols?: string, opts?: { count?: string; head?: boolean }) => {
      wantsCount = opts?.count === 'exact'
      return chain
    },
    eq: (col: string, val: unknown) => {
      current = current.filter((r) => r[col] === val)
      return chain
    },
    gt: (col: string, val: number) => {
      current = current.filter((r) => Number(r[col] ?? 0) > val)
      return chain
    },
    gte: (col: string, val: string) => {
      current = current.filter((r) => String(r[col] ?? '') >= val)
      return chain
    },
    in: (col: string, vals: unknown[]) => {
      current = current.filter((r) => vals.includes(r[col]))
      return chain
    },
    not: (col: string, op: string, val: unknown) => {
      assert.equal(op, 'is', 'the fake only knows `.not(col, "is", null)`')
      assert.equal(val, null)
      current = current.filter((r) => r[col] !== null && r[col] !== undefined)
      return chain
    },
    /** Only the `col.not.is.null,col.not.is.null` form this route builds. */
    or: (expr: string) => {
      const clauses = expr.split(',').map((c) => {
        const [col, ...rest] = c.split('.')
        assert.equal(rest.join('.'), 'not.is.null', `unsupported or() clause: ${c}`)
        return col
      })
      current = current.filter((r) => clauses.some((col) => r[col] !== null && r[col] !== undefined))
      return chain
    },
    single: async () => ({ data: current[0] ?? null, error: current[0] ? null : { message: 'not found' } }),
    maybeSingle: async () => ({ data: current[0] ?? null, error: null }),
    then: (onFulfilled: (v: any) => unknown) =>
      Promise.resolve(
        wantsCount ? { data: null, count: current.length, error: null } : { data: current, error: null }
      ).then(onFulfilled),
  }

  return chain
}

function createFakeClient() {
  return {
    auth: {
      getSession: async () => ({
        data: { session: scenario.session },
        error: scenario.session ? null : { message: 'Auth session missing!' },
      }),
    },
    schema: (_name: string) => ({
      from: (table: string) => {
        if (table === 'cms_users') return queryOn(scenario.cmsUser ? [scenario.cmsUser as any] : [])
        if (table === 'newsletter_campaigns') return queryOn(scenario.campaign ? [scenario.campaign as any] : [])
        if (table === 'newsletter_recipients') return queryOn(scenario.recipients as any[])
        if (table === 'email_unsubscribes') return queryOn(scenario.unsubscribes as any[])
        throw new Error(`unexpected table: ${table}`)
      },
    }),
  }
}

const SENT_AT = '2026-09-08T13:00:00.000Z'

function asAdmin(partial: Partial<Scenario> = {}): void {
  scenario = {
    session: { user: { email: 'admin@tuggi.app' } },
    cmsUser: { email: 'admin@tuggi.app', role: 'admin', is_active: true },
    campaign: { id: 'c-1', name: 'We are in Iceland', status: 'sent', sent_at: SENT_AT },
    recipients: [],
    unsubscribes: [],
    ...partial,
  }
}

let GET: (req: any, ctx: any) => Promise<Response>

before(async () => {
  mock.module('next/headers', {
    namedExports: { cookies: async () => ({ get: () => undefined, getAll: () => [] }) },
  })
  mock.module('@/lib/core/supabase-client', {
    namedExports: {
      getSupabaseRouteHandler: () => createFakeClient(),
      getSupabaseService: () => createFakeClient(),
      getSupabaseClient: () => createFakeClient(),
    },
  })
  const mod = await import(resolve(REPO_ROOT, ROUTE))
  GET = mod.GET
})

async function statsFor(recipients: RecipientRow[], unsubscribes: UnsubRow[] = []) {
  asAdmin({ recipients, unsubscribes })
  const res = await GET(new Request('http://localhost/api/admin/marketing/campaigns/c-1'), {
    params: Promise.resolve({ id: 'c-1' }),
  })
  assert.equal(res.status, 200)
  return (await res.json()).stats
}

// --- The measured defect -----------------------------------------------------

test('the regression: a row with status=opened and click_count=1 counts as a click', async () => {
  const stats = await statsFor([
    row({ id: 'r1', status: 'opened', opened_at: SENT_AT, click_count: 1 }),
  ])
  assert.equal(stats.clicked, 1, 'this row is one of the 4 the old count threw away')
})

test('the 15 real rows: 11 clicked + 4 demoted all count, and that is the 27%', async () => {
  const recipients = [
    ...Array.from({ length: 11 }, (_, i) =>
      row({ id: `clicked-${i}`, status: 'clicked', opened_at: SENT_AT, click_count: 1 })
    ),
    ...Array.from({ length: 4 }, (_, i) =>
      row({ id: `demoted-${i}`, status: 'opened', opened_at: SENT_AT, click_count: 2 })
    ),
  ]
  const stats = await statsFor(recipients)
  assert.equal(stats.clicked, 15, 'counting by status would answer 11')
})

test('a click is never counted twice, however many times click_count says', async () => {
  const stats = await statsFor([
    row({ id: 'r1', status: 'clicked', opened_at: SENT_AT, click_count: 9 }),
  ])
  assert.equal(stats.clicked, 1, 'clicked is people, not clicks')
})

test('someone who never clicked is not a click', async () => {
  const stats = await statsFor([
    row({ id: 'r1', status: 'opened', opened_at: SENT_AT, click_count: 0 }),
    row({ id: 'r2', status: 'delivered', delivered_at: SENT_AT }),
  ])
  assert.equal(stats.clicked, 0)
})

// --- Opens and deliveries rest on timestamps, not on the status --------------

test('opened is counted by opened_at, so a later bounce does not erase the open', async () => {
  const stats = await statsFor([
    row({ id: 'r1', status: 'bounced', delivered_at: SENT_AT, opened_at: SENT_AT }),
  ])
  assert.equal(stats.opened, 1)
  assert.equal(stats.bounced, 1, 'the bounce is still reported')
})

test('an open proves a delivery even when the delivered event never arrived', async () => {
  const stats = await statsFor([row({ id: 'r1', status: 'opened', opened_at: SENT_AT })])
  assert.equal(stats.delivered, 1)
})

test('open_rate divides opens by deliveries, and never divides by zero', async () => {
  const none = await statsFor([row({ id: 'r1', status: 'failed' })])
  assert.equal(none.delivered, 0)
  assert.equal(none.open_rate, 0)

  const half = await statsFor([
    row({ id: 'r1', status: 'opened', delivered_at: SENT_AT, opened_at: SENT_AT }),
    row({ id: 'r2', status: 'delivered', delivered_at: SENT_AT }),
  ])
  assert.equal(half.open_rate, 0.5)
})

// --- bounced and unsubscribed reach the screen -------------------------------

test('bounced and unsubscribed are in the payload — the UI had nothing to show', async () => {
  const stats = await statsFor(
    [
      row({ id: 'r1', email: 'gone@example.com', status: 'bounced' }),
      row({ id: 'r2', email: 'left@example.com', status: 'delivered', delivered_at: SENT_AT }),
    ],
    [{ email: 'left@example.com', unsubscribed_at: '2026-09-09T10:00:00.000Z' }]
  )
  assert.equal(stats.bounced, 1)
  assert.equal(stats.unsubscribed, 1)
})

test('an unsubscribe from BEFORE the campaign is not this campaign doing', async () => {
  const stats = await statsFor(
    [row({ id: 'r1', email: 'left@example.com', status: 'delivered', delivered_at: SENT_AT })],
    [{ email: 'left@example.com', unsubscribed_at: '2026-06-01T10:00:00.000Z' }]
  )
  assert.equal(stats.unsubscribed, 0)
})

test('an unsubscribe by someone who was not mailed here is not counted here', async () => {
  const stats = await statsFor(
    [row({ id: 'r1', email: 'stayed@example.com', status: 'delivered', delivered_at: SENT_AT })],
    [{ email: 'someone.else@example.com', unsubscribed_at: '2026-09-09T10:00:00.000Z' }]
  )
  assert.equal(stats.unsubscribed, 0)
})

test('a draft has no "after", so unsubscribed is zero and nothing is read', async () => {
  asAdmin({
    campaign: { id: 'c-1', name: 'Rascunho', status: 'draft', sent_at: null },
    recipients: [],
    unsubscribes: [{ email: 'left@example.com', unsubscribed_at: '2026-09-09T10:00:00.000Z' }],
  })
  const res = await GET(new Request('http://localhost/api/admin/marketing/campaigns/c-1'), {
    params: Promise.resolve({ id: 'c-1' }),
  })
  assert.equal((await res.json()).stats.unsubscribed, 0)
})

// --- The gate still gates ----------------------------------------------------

test('no session is 401, and a non-admin is 403', async () => {
  asAdmin({ session: null })
  let res = await GET(new Request('http://localhost/x'), { params: Promise.resolve({ id: 'c-1' }) })
  assert.equal(res.status, 401)

  asAdmin({ cmsUser: { email: 'admin@tuggi.app', role: 'editor', is_active: true } })
  res = await GET(new Request('http://localhost/x'), { params: Promise.resolve({ id: 'c-1' }) })
  assert.equal(res.status, 403)
})
