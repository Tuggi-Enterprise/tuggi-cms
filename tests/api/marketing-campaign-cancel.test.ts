/**
 * `PATCH /api/admin/marketing/campaigns/[id]` — cancelling a campaign that has not gone out.
 *
 * Why this file exists: until 2026-09-10 the handler copied a fixed list of fields
 * (`name`, `default_language`, `content`, `audience_filters`) and `status` was not on it. A
 * cancel request was dropped in silence and the route answered 200 — the screen said the
 * campaign was cancelled and the campaign stayed scheduled. Scheduling is the only undo window
 * this module has, so a cancel that lies is worse than a cancel that is missing.
 *
 * The rule the handler now enforces: the lifecycle belongs to the server, not to the request
 * body. `cancelled` is the one status an operator drives, and only from `draft` or `scheduled`.
 * `sending` is deliberately excluded — the Edge Function is already in the loop and the batch in
 * flight does not come back.
 *
 * Run with: npm run test:api
 */

import { test, before, mock } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dirname, '../..')
const ROUTE = 'app/api/admin/marketing/campaigns/[id]/route.ts'

interface Scenario {
  session: { user: { email: string } } | null
  cmsUser: { email: string; role: string; is_active: boolean } | null
  campaign: Record<string, unknown> | null
  /** Every `.update()` payload the handler sent, in order. */
  updates: Record<string, unknown>[]
  /** Set when the handler reaches `.delete()` — it must never do so here. */
  deleted: boolean
}

let scenario: Scenario

function queryOn<T extends Record<string, any>>(rows: T[], onUpdate?: (patch: any) => void) {
  let current = rows.slice()

  const chain: any = {
    select: () => chain,
    eq: (col: string, val: unknown) => {
      current = current.filter((r) => r[col] === val)
      return chain
    },
    update: (patch: Record<string, unknown>) => {
      onUpdate?.(patch)
      current = current.map((r) => ({ ...r, ...patch }))
      return chain
    },
    delete: () => {
      scenario.deleted = true
      return chain
    },
    single: async () => ({
      data: current[0] ?? null,
      error: current[0] ? null : { message: 'not found' },
    }),
    then: (onFulfilled: (v: any) => unknown) =>
      Promise.resolve({ data: current, error: null }).then(onFulfilled),
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
        if (table === 'newsletter_campaigns') {
          return queryOn(scenario.campaign ? [scenario.campaign as any] : [], (patch) =>
            scenario.updates.push(patch)
          )
        }
        throw new Error(`unexpected table: ${table}`)
      },
    }),
  }
}

function asAdmin(campaign: Record<string, unknown> | null): void {
  scenario = {
    session: { user: { email: 'admin@tuggi.app' } },
    cmsUser: { email: 'admin@tuggi.app', role: 'admin', is_active: true },
    campaign,
    updates: [],
    deleted: false,
  }
}

let PATCH: (req: any, ctx: any) => Promise<Response>

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
  PATCH = mod.PATCH
})

async function patch(body: unknown) {
  return PATCH(
    new Request('http://localhost/api/admin/marketing/campaigns/c-1', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: 'c-1' }) }
  )
}

// --- The measured defect -----------------------------------------------------

test('the regression: cancelling a scheduled campaign writes the status', async () => {
  asAdmin({ id: 'c-1', name: 'We are in Iceland', status: 'scheduled' })
  const res = await patch({ status: 'cancelled' })

  assert.equal(res.status, 200)
  assert.equal(scenario.updates.length, 1, 'exactly one write')
  assert.equal(
    scenario.updates[0].status,
    'cancelled',
    'the old handler answered 200 with no status in the payload at all'
  )
})

test('cancelling never deletes the row — §3, history survives the cancel', async () => {
  asAdmin({ id: 'c-1', status: 'scheduled' })
  await patch({ status: 'cancelled' })
  assert.equal(scenario.deleted, false)
})

test('a draft can be cancelled too', async () => {
  asAdmin({ id: 'c-1', status: 'draft' })
  const res = await patch({ status: 'cancelled' })
  assert.equal(res.status, 200)
})

// --- What the handler must refuse -------------------------------------------

test('a campaign already sent cannot be cancelled, and the refusal is loud', async () => {
  asAdmin({ id: 'c-1', status: 'sent' })
  const res = await patch({ status: 'cancelled' })

  assert.equal(res.status, 409)
  assert.equal(scenario.updates.length, 0, 'nothing was written')
})

test('a campaign mid-flight cannot be cancelled — the batch in flight does not come back', async () => {
  asAdmin({ id: 'c-1', status: 'sending' })
  const res = await patch({ status: 'cancelled' })
  assert.equal(res.status, 409)
  assert.equal(scenario.updates.length, 0)
})

test('no other status is assignable through the body', async () => {
  for (const status of ['sent', 'sending', 'draft', 'scheduled', 'partial']) {
    asAdmin({ id: 'c-1', status: 'draft' })
    const res = await patch({ status })
    assert.equal(res.status, 422, `status '${status}' must not be settable by the client`)
    assert.equal(scenario.updates.length, 0, `status '${status}' wrote something`)
  }
})

test('cancelling a campaign that is not there answers 404, not 200', async () => {
  asAdmin(null)
  const res = await patch({ status: 'cancelled' })
  assert.equal(res.status, 404)
})

// --- The fields that were already editable stay editable ---------------------

test('editing content still works and does not touch the status', async () => {
  asAdmin({ id: 'c-1', status: 'draft' })
  const res = await patch({ name: 'Estamos na Islândia', default_language: 'pt' })

  assert.equal(res.status, 200)
  assert.equal(scenario.updates[0].name, 'Estamos na Islândia')
  assert.ok(!('status' in scenario.updates[0]), 'an edit must not carry a lifecycle change')
})

test('a non-admin gets nowhere near the write', async () => {
  asAdmin({ id: 'c-1', status: 'scheduled' })
  scenario.cmsUser = { email: 'someone@tuggi.app', role: 'client', is_active: true }

  const res = await patch({ status: 'cancelled' })
  assert.equal(res.status, 403)
  assert.equal(scenario.updates.length, 0)
})
