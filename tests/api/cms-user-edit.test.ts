/**
 * PATCH/DELETE /api/admin/users/[userId] — editing a CMS team member (#969).
 *
 * RLS on `core.cms_users` lets `authenticated` read and only `service_role` write. The route
 * wrote with the cookie client, so every edit hit 0 rows: the Edit User screen showed "Cannot
 * coerce the result to a single JSON object", the password field was dropped without a word,
 * and the active toggle said "desativado" while the person kept access. These tests pin the
 * fixed route: writes go through the service client behind the admin gate, 0 rows is an error,
 * and a new password reaches the Auth account found by e-mail, never the audit log.
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
  passwordError: { code: string; status: number; message: string } | null
  passwordCalls: Array<{ id: string; password: unknown }>
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
          return scenario.passwordError
            ? { data: { user: null }, error: scenario.passwordError }
            : { data: { user: { id } }, error: null }
        },
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
    passwordError: null,
    passwordCalls: [],
    audits: [],
  }
})

function call(handler: Handler, userId: string, body?: unknown) {
  return handler(
    new NextRequest(`http://localhost/api/admin/users/${userId}`, {
      method: handler === DELETE ? 'DELETE' : 'PATCH',
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

test('#969: admin sets a password, updateUserById gets the Auth id found by e-mail, not the CMS id', async () => {
  const res = await call(PATCH, 'cms-legacy', { password: 'segredo-123' })
  assert.equal(res.status, 200)
  assert.deepEqual(scenario.passwordCalls, [{ id: 'auth-legacy', password: 'segredo-123' }])
})

test('#969: when the CMS id is the Auth id, the shortcut is used', async () => {
  const res = await call(PATCH, 'u-same', { full_name: 'Editor', password: 'segredo-123' })
  assert.equal(res.status, 200)
  assert.deepEqual(scenario.passwordCalls, [{ id: 'u-same', password: 'segredo-123' }])
})

test('#969: the password stays out of the audit and out of the response', async () => {
  const res = await call(PATCH, 'cms-legacy', { full_name: 'Legado Novo', password: 'segredo-123' })
  assert.equal(res.status, 200)
  const text = await res.text()
  assert.ok(!text.includes('segredo-123'), 'response must not echo the password')
  assert.equal(row('cms-legacy')?.password, undefined, 'the password is not a cms_users column')
  assert.deepEqual(scenario.audits.map((a) => a.action), ['UPDATE_PROFILE', 'PASSWORD_CHANGE'])
  for (const audit of scenario.audits) {
    assert.ok(!JSON.stringify(audit).includes('segredo-123'), `audit ${String(audit.action)} must not carry the password`)
  }
})

test('#969: a password shorter than the minimum is refused before anything is written', async () => {
  for (const password of ['12345', '', 123456, null]) {
    const res = await call(PATCH, 'cms-legacy', { full_name: 'X', password })
    assert.equal(res.status, 400, `${JSON.stringify(password)} must be refused`)
  }
  assert.equal(row('cms-legacy')?.full_name, 'Legado')
  assert.equal(scenario.passwordCalls.length, 0)
})

test('#969: no Auth account for the e-mail is a clear 404, and the other fields are not half saved', async () => {
  const res = await call(PATCH, 'cms-noauth', { full_name: 'Sem Conta', password: 'segredo-123' })
  assert.equal(res.status, 404)
  assert.match((await res.json()).error, /No login account/)
  assert.equal(row('cms-noauth')?.full_name, null)
  assert.equal(scenario.passwordCalls.length, 0)
})

test('#969: a GoTrue refusal of the password is an error that says the password did not change', async () => {
  scenario.passwordError = { code: 'weak_password', status: 422, message: 'Password should contain a digit' }
  const res = await call(PATCH, 'cms-legacy', { password: 'abcdefgh' })
  assert.equal(res.status, 422)
  assert.match((await res.json()).error, /password was not changed/)
  assert.ok(!scenario.audits.some((a) => a.action === 'PASSWORD_CHANGE'))
})

test('#969: someone who is not an admin gets 403 and nothing is written', async () => {
  for (const caller of [{ role: 'editor', is_active: true }, { role: 'viewer', is_active: true }, { role: 'client', is_active: true }, { role: 'admin', is_active: false }, null]) {
    scenario.caller = caller
    const patch = await call(PATCH, 'u-same', { full_name: 'Invasor', password: 'segredo-123' })
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
