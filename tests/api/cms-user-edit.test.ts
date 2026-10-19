/**
 * PATCH/DELETE /api/admin/users/[userId] and POST .../password-link: editing a CMS team member
 * (#969).
 *
 * RLS on `core.cms_users` lets `authenticated` read and only `service_role` write. The route
 * wrote with the cookie client, so every edit hit 0 rows. These tests pin the fixed route: writes
 * go through the service client behind the admin gate, 0 rows is an error.
 *
 * Security review of the first fix: setting the password of the Auth account found by the row's
 * e-mail, plus editing that e-mail, let an admin take over any account, a tourist's included. The
 * PATCH now refuses `password` and `email`, `updateUserById` is never reached, and the password
 * goes by link to the address on the row. Deactivating or deleting yourself or the last active
 * admin is refused.
 *
 * Run with: npm run test:api
 */

import { test, before, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'

type Row = Record<string, unknown> & { id: string; email: string; role: string }
type AuthUser = { id: string; email: string }

interface Scenario {
  caller: { role: string; is_active: boolean } | null
  rows: Row[]
  authUsers: AuthUser[]
  /** Simulates the RLS refusal the bug was about: the update reports no error and no row. */
  updateHitsNothing: boolean
  linkError: { code: string; status: number } | null
  passwordCalls: Array<{ id: string; password: unknown }>
  passwordLinks: Array<{ email: string; redirectTo?: string }>
  audits: Array<Record<string, unknown>>
}

let scenario: Scenario

function gateClient() {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({
      data: scenario.caller && scenario.caller.is_active
        ? { id: 'cms-admin-1', email: 'admin@tuggi.app', ...scenario.caller }
        : null,
      error: null,
    }),
  }
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'auth-admin-1', email: 'admin@tuggi.app' } }, error: null }) },
    schema: () => ({ from: () => chain }),
  }
}

/** Service-role client over `scenario.rows` and `scenario.authUsers`. */
function serviceClient() {
  const table = () => {
    const filters: Array<[string, unknown]> = []
    let op: 'select' | 'update' | 'delete' = 'select'
    let patch: Record<string, unknown> = {}
    let counting = false
    const matching = () => scenario.rows.filter((r) => filters.every(([k, v]) => r[k] === v))

    const run = () => {
      if (op === 'update') {
        if (scenario.updateHitsNothing) return { data: [], error: null }
        const hit = matching()
        hit.forEach((r) => Object.assign(r, patch))
        return { data: hit.map((r) => ({ ...r })), error: null }
      }
      if (op === 'delete') {
        const hit = matching()
        scenario.rows = scenario.rows.filter((r) => !hit.includes(r))
        return { data: hit.map((r) => ({ id: r.id })), error: null }
      }
      const hit = matching()
      return counting ? { data: hit, count: hit.length, error: null } : { data: hit, error: null }
    }

    const chain: any = {
      select: (_cols?: string, opts?: { count?: string }) => {
        if (opts?.count) counting = true
        return chain
      },
      eq: (k: string, v: unknown) => {
        filters.push([k, v])
        return chain
      },
      update: (p: Record<string, unknown>) => {
        op = 'update'
        patch = p
        return chain
      },
      delete: () => {
        op = 'delete'
        return chain
      },
      maybeSingle: async () => {
        const hit = matching()
        return { data: hit[0] ? { ...hit[0] } : null, error: null }
      },
      then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
        Promise.resolve(run()).then(resolve, reject),
    }
    return chain
  }

  return {
    schema: () => ({ from: table }),
    auth: {
      admin: {
        getUserById: async (id: string) => {
          const u = scenario.authUsers.find((a) => a.id === id)
          return u ? { data: { user: u }, error: null } : { data: { user: null }, error: { code: 'user_not_found', status: 404 } }
        },
        listUsers: async ({ page, perPage }: { page: number; perPage: number }) => ({
          data: { users: scenario.authUsers.slice((page - 1) * perPage, page * perPage) },
          error: null,
        }),
        updateUserById: async (id: string, attrs: { password?: unknown }) => {
          scenario.passwordCalls.push({ id, password: attrs.password })
          return { data: { user: { id } }, error: null }
        },
      },
      resetPasswordForEmail: async (email: string, options?: { redirectTo?: string }) => {
        scenario.passwordLinks.push({ email, redirectTo: options?.redirectTo })
        return scenario.linkError ? { data: null, error: scenario.linkError } : { data: {}, error: null }
      },
    },
  }
}

function auditClient() {
  return {
    schema: () => ({
      from: () => ({
        insert: async (row: Record<string, unknown>) => {
          scenario.audits.push(row)
          return { error: null }
        },
      }),
    }),
  }
}

type Handler = (req: NextRequest, ctx: { params: Promise<{ userId: string }> }) => Promise<Response>
let PATCH: Handler
let DELETE: Handler
let PASSWORD_LINK: Handler

before(async () => {
  mock.module('next/headers', {
    namedExports: { cookies: async () => ({ get: () => undefined, getAll: () => [] }) },
  })
  mock.module('@/lib/core/supabase-client', {
    namedExports: {
      getSupabaseRouteHandler: () => gateClient(),
      getSupabaseService: () => serviceClient(),
      getSupabase: () => auditClient(),
    },
  })
  const route = await import('@/app/api/admin/users/[userId]/route')
  PATCH = route.PATCH as unknown as Handler
  DELETE = route.DELETE as unknown as Handler
  const linkRoute = await import('@/app/api/admin/users/[userId]/password-link/route')
  PASSWORD_LINK = linkRoute.POST as unknown as Handler
})

beforeEach(() => {
  scenario = {
    caller: { role: 'admin', is_active: true },
    rows: [
      // Same id in Auth and in the CMS: the row created through POST /api/admin/users.
      { id: 'u-same', email: 'editor@tuggi.app', full_name: 'Editor', role: 'editor', is_active: true, enabled_modules: [] },
      // Born by SQL with gen_random_uuid: the CMS id is not the Auth id (the case of the card).
      { id: 'cms-legacy', email: 'legado@gmail.com', full_name: 'Legado', role: 'admin', is_active: true, enabled_modules: [] },
      // A row with no Auth account at all.
      { id: 'cms-noauth', email: 'sem-conta@tuggi.app', full_name: null, role: 'viewer', is_active: true, enabled_modules: [] },
    ],
    authUsers: [
      { id: 'u-same', email: 'editor@tuggi.app' },
      { id: 'auth-legacy', email: 'legado@gmail.com' },
      { id: 'auth-tourist', email: 'turista@gmail.com' },
    ],
    updateHitsNothing: false,
    linkError: null,
    passwordCalls: [],
    passwordLinks: [],
    audits: [],
  }
})

function call(handler: Handler, userId: string, body?: unknown) {
  return handler(
    new NextRequest(`http://localhost/api/admin/users/${userId}`, {
      method: handler === DELETE ? 'DELETE' : handler === PASSWORD_LINK ? 'POST' : 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { params: Promise.resolve({ userId }) }
  )
}

const row = (id: string) => scenario.rows.find((r) => r.id === id)

test('#969: admin edits the name and the modules and the change persists', async () => {
  const res = await call(PATCH, 'u-same', { full_name: 'Editora Nova', enabled_modules: ['events', 'events'] })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.user.full_name, 'Editora Nova', 'the response carries the row as written')
  assert.equal(row('u-same')?.full_name, 'Editora Nova', 'the row itself changed')
  assert.deepEqual(row('u-same')?.enabled_modules, ['events'])
  assert.equal(scenario.audits[0]?.action, 'UPDATE_PROFILE')
})

test('#969: deactivating persists is_active=false, which is what the login gate reads', async () => {
  const res = await call(PATCH, 'u-same', { is_active: false })
  assert.equal(res.status, 200)
  assert.equal(row('u-same')?.is_active, false)
  assert.equal((await res.json()).user.is_active, false)
})

test('#969: is_active must be a boolean', async () => {
  const res = await call(PATCH, 'u-same', { is_active: 'false' })
  assert.equal(res.status, 400)
  assert.equal(row('u-same')?.is_active, true)
})

test('#969: an update that writes 0 rows is an error, not a "saved"', async () => {
  scenario.updateHitsNothing = true
  const res = await call(PATCH, 'u-same', { full_name: 'Não Gravou' })
  assert.equal(res.status, 500)
  assert.match((await res.json()).error, /no row was updated/)
  assert.equal(scenario.audits.length, 0, 'nothing happened, so nothing is audited')
})

test('#969: password in the PATCH is refused and updateUserById is never called', async () => {
  for (const id of ['cms-legacy', 'u-same']) {
    const res = await call(PATCH, id, { full_name: 'Tomada', password: 'segredo-123' })
    assert.equal(res.status, 400)
    const text = await res.text()
    assert.ok(!text.includes('segredo-123'), 'the response must not echo the password')
  }
  assert.equal(row('cms-legacy')?.full_name, 'Legado', 'nothing is half saved')
  assert.equal(scenario.passwordCalls.length, 0)
  assert.equal(scenario.audits.length, 0)
})

test('#969: email in the PATCH gets 400, so a row cannot be pointed at a tourist account', async () => {
  const res = await call(PATCH, 'u-same', { email: 'turista@gmail.com' })
  assert.equal(res.status, 400)
  assert.equal(row('u-same')?.email, 'editor@tuggi.app')

  const same = await call(PATCH, 'u-same', { email: 'editor@tuggi.app', full_name: 'X' })
  assert.equal(same.status, 400, 'even the unchanged e-mail is refused: the field is not editable')
})

test('#969: password-link sends the reset e-mail to the address on the row, to /pt/set-password', async () => {
  const res = await call(PASSWORD_LINK, 'cms-legacy')
  assert.equal(res.status, 200)
  assert.equal((await res.json()).email, 'legado@gmail.com')
  assert.equal(scenario.passwordLinks.length, 1)
  assert.equal(scenario.passwordLinks[0].email, 'legado@gmail.com')
  assert.match(scenario.passwordLinks[0].redirectTo ?? '', /\/pt\/set-password$/)
  assert.equal(scenario.passwordCalls.length, 0)
  assert.deepEqual(scenario.audits.map((a) => a.action), ['PASSWORD_RESET_REQUEST'])
  assert.ok(!JSON.stringify(scenario.audits[0]).includes('legado@gmail.com'), 'the audit carries no e-mail of the target')
})

test('#969: password-link for a missing row is 404 and sends nothing', async () => {
  const res = await call(PASSWORD_LINK, 'nobody')
  assert.equal(res.status, 404)
  assert.equal(scenario.passwordLinks.length, 0)
})

test('#969: password-link failure at GoTrue is an error, not a "sent"', async () => {
  scenario.linkError = { code: 'over_email_send_rate_limit', status: 429 }
  const res = await call(PASSWORD_LINK, 'cms-legacy')
  assert.equal(res.status, 502)
  assert.equal(scenario.audits.length, 0)
})

test('#969: password-link by someone who is not an admin gets 403 and sends nothing', async () => {
  for (const caller of [{ role: 'editor', is_active: true }, { role: 'viewer', is_active: true }, { role: 'client', is_active: true }, { role: 'admin', is_active: false }, null]) {
    scenario.caller = caller
    const res = await call(PASSWORD_LINK, 'cms-legacy')
    assert.equal(res.status, 403, `password-link by ${JSON.stringify(caller)} must be refused`)
  }
  assert.equal(scenario.passwordLinks.length, 0)
})

test('#969: an admin cannot deactivate or delete their own account (409)', async () => {
  scenario.rows.push({ id: 'cms-admin-1', email: 'Admin@Tuggi.app', full_name: 'Eu', role: 'admin', is_active: true, enabled_modules: [] })
  const patch = await call(PATCH, 'cms-admin-1', { is_active: false })
  assert.equal(patch.status, 409)
  assert.equal(row('cms-admin-1')?.is_active, true)
  const del = await call(DELETE, 'cms-admin-1')
  assert.equal(del.status, 409)
  assert.ok(row('cms-admin-1'), 'the row is still there')
})

test('#969: deactivating or deleting the last active admin is refused (409)', async () => {
  const patch = await call(PATCH, 'cms-legacy', { is_active: false })
  assert.equal(patch.status, 409)
  assert.equal(row('cms-legacy')?.is_active, true)
  const del = await call(DELETE, 'cms-legacy')
  assert.equal(del.status, 409)
  assert.ok(row('cms-legacy'))
})

test('#969: with another active admin left, deactivating an admin goes through', async () => {
  scenario.rows.push({ id: 'cms-admin-2', email: 'outro@tuggi.app', full_name: 'Outro', role: 'admin', is_active: true, enabled_modules: [] })
  const res = await call(PATCH, 'cms-legacy', { is_active: false })
  assert.equal(res.status, 200)
  assert.equal(row('cms-legacy')?.is_active, false)
})

test('#969: someone who is not an admin gets 403 and nothing is written', async () => {
  for (const caller of [{ role: 'editor', is_active: true }, { role: 'viewer', is_active: true }, { role: 'client', is_active: true }, { role: 'admin', is_active: false }, null]) {
    scenario.caller = caller
    const patch = await call(PATCH, 'u-same', { full_name: 'Invasor' })
    assert.equal(patch.status, 403, `PATCH by ${JSON.stringify(caller)} must be refused`)
    const del = await call(DELETE, 'u-same')
    assert.equal(del.status, 403, `DELETE by ${JSON.stringify(caller)} must be refused`)
  }
  assert.equal(row('u-same')?.full_name, 'Editor')
  assert.equal(scenario.passwordCalls.length, 0)
})

test('#969: role and client_id stay immutable', async () => {
  const res = await call(PATCH, 'u-same', { role: 'admin' })
  assert.equal(res.status, 400)
  assert.equal(row('u-same')?.role, 'editor')
})

test('#969: DELETE removes the row through the service client, and a missing row is 404', async () => {
  const res = await call(DELETE, 'u-same')
  assert.equal(res.status, 200)
  assert.equal(row('u-same'), undefined)

  const again = await call(DELETE, 'u-same')
  assert.equal(again.status, 404, 'deleting nothing must not answer "deleted"')
})
