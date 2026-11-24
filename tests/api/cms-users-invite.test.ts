/**
 * POST /api/admin/cms-users — the CMS team invite (#941).
 *
 * The button used to call `auth.admin.inviteUserByEmail` in the browser with the publishable
 * key, GoTrue refused it, and nobody was ever invited. These tests pin the server route that
 * replaced it: who may call it, what it validates, and the two "already exists" cases that are
 * not the same answer — already on the CMS team is 409, already in Auth is not an error.
 *
 * Run with: npm run test:api
 */

import { test, before, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'

interface Scenario {
  caller: { role: string; is_active: boolean } | null
  cmsRowExists: boolean
  inviteError: { code: string; status: number } | null
  insertError: { code: string } | null
  invites: Array<{ email: string; redirectTo?: string }>
  passwordLinks: Array<{ email: string; redirectTo?: string }>
  inserts: Array<Record<string, unknown>>
  audits: Array<Record<string, unknown>>
}

let scenario: Scenario

/** Cookie-bound client the gate uses: getUser + the caller's `core.cms_users` row. */
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

/** Service-role client: the lookup, the insert, and GoTrue admin. */
function serviceClient() {
  const table = () => {
    let pending: Record<string, unknown> | null = null
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => ({ data: scenario.cmsRowExists ? { id: 'cms-existing' } : null, error: null }),
      insert: (row: Record<string, unknown>) => {
        pending = row
        return chain
      },
      single: async () => {
        if (scenario.insertError) return { data: null, error: scenario.insertError }
        scenario.inserts.push(pending!)
        return { data: { id: pending!.id ?? 'generated-id', ...pending }, error: null }
      },
    }
    return chain
  }
  return {
    schema: () => ({ from: table }),
    auth: {
      admin: {
        inviteUserByEmail: async (email: string, options?: { redirectTo?: string }) => {
          scenario.invites.push({ email, redirectTo: options?.redirectTo })
          return scenario.inviteError
            ? { data: { user: null }, error: scenario.inviteError }
            : { data: { user: { id: 'auth-new-1', email } }, error: null }
        },
      },
      resetPasswordForEmail: async (email: string, options?: { redirectTo?: string }) => {
        scenario.passwordLinks.push({ email, redirectTo: options?.redirectTo })
        return { data: {}, error: null }
      },
    },
  }
}

/** What `logAuditEvent` reaches through `getSupabase('service')`. */
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

let POST: (req: NextRequest, ctx?: unknown) => Promise<Response>

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
  const route = await import('@/app/api/admin/cms-users/route')
  POST = route.POST as typeof POST
})

beforeEach(() => {
  scenario = {
    caller: { role: 'admin', is_active: true },
    cmsRowExists: false,
    inviteError: null,
    insertError: null,
    invites: [],
    passwordLinks: [],
    inserts: [],
    audits: [],
  }
})

function invite(body: unknown) {
  return POST(
    new NextRequest('http://localhost/api/admin/cms-users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  )
}

test('#941: an active admin invites a new e-mail, it gets the invite and a cms_users row', async () => {
  const res = await invite({ email: '  Nova.Pessoa@Tuggi.app ', full_name: 'Nova Pessoa', role: 'editor' })
  assert.equal(res.status, 200)
  assert.equal((await res.json()).mail, 'invite')

  assert.equal(scenario.invites.length, 1)
  assert.equal(scenario.invites[0].email, 'nova.pessoa@tuggi.app', 'GoTrue and the gate both match lower case')
  assert.match(scenario.invites[0].redirectTo ?? '', /\/pt\/set-password$/, 'the invite ends where the password is defined')

  assert.deepEqual(scenario.inserts, [
    { id: 'auth-new-1', email: 'nova.pessoa@tuggi.app', full_name: 'Nova Pessoa', role: 'editor', is_active: true },
  ])
  assert.equal(scenario.passwordLinks.length, 0)
  assert.equal(scenario.audits[0]?.action, 'INVITE_CMS_USER')
})

test('#941: someone who is not an admin gets 403 and nothing is sent or written', async () => {
  for (const caller of [{ role: 'editor', is_active: true }, { role: 'viewer', is_active: true }, { role: 'client', is_active: true }, null]) {
    scenario.caller = caller
    const res = await invite({ email: 'x@tuggi.app', role: 'admin' })
    assert.equal(res.status, 403, `caller ${JSON.stringify(caller)} must be refused`)
  }
  assert.equal(scenario.invites.length, 0)
  assert.equal(scenario.inserts.length, 0)
})

test('#941: an inactive admin is not an admin', async () => {
  scenario.caller = { role: 'admin', is_active: false }
  const res = await invite({ email: 'x@tuggi.app', role: 'viewer' })
  assert.equal(res.status, 403)
  assert.equal(scenario.invites.length, 0)
})

test('#941: an e-mail already on the CMS team gets 409, and no invite mail goes out', async () => {
  scenario.cmsRowExists = true
  const res = await invite({ email: 'ja@tuggi.app', role: 'viewer' })
  assert.equal(res.status, 409)
  assert.equal((await res.json()).error, 'Este email já está cadastrado no CMS')
  assert.equal(scenario.invites.length, 0, 'a person already on the team must not get a second invite')
})

test('#941: the unique e-mail constraint also answers 409 (two invites racing)', async () => {
  scenario.insertError = { code: '23505' }
  const res = await invite({ email: 'corrida@tuggi.app', role: 'viewer' })
  assert.equal(res.status, 409)
  assert.equal((await res.json()).error, 'Este email já está cadastrado no CMS')
})

test('#941: an e-mail that already exists in Auth becomes a cms_user without error, and gets a password link', async () => {
  scenario.inviteError = { code: 'email_exists', status: 422 }
  const res = await invite({ email: 'turista@gmail.com', role: 'admin' })
  assert.equal(res.status, 200)
  assert.equal((await res.json()).mail, 'password_link')

  assert.equal(scenario.inserts.length, 1)
  assert.equal(scenario.inserts[0].id, undefined, 'no Auth id came back, the column default decides')
  assert.equal(scenario.inserts[0].role, 'admin')
  assert.equal(scenario.passwordLinks.length, 1)
  assert.match(scenario.passwordLinks[0].redirectTo ?? '', /\/pt\/set-password$/)
})

test('#941: any other GoTrue refusal is an error and writes no row', async () => {
  scenario.inviteError = { code: 'over_email_send_rate_limit', status: 429 }
  const res = await invite({ email: 'x@tuggi.app', role: 'viewer' })
  assert.equal(res.status, 502)
  assert.equal(scenario.inserts.length, 0)
})

test('#941: the input is validated before anything leaves the server', async () => {
  const bad = [
    {},
    { email: 'sem-arroba', role: 'viewer' },
    { email: 'x@tuggi.app' },
    { email: 'x@tuggi.app', role: 'owner' },
    { email: 'x@tuggi.app', role: 'viewer', full_name: 42 },
    { email: 'x@tuggi.app', role: 'viewer', full_name: 'a'.repeat(201) },
  ]
  for (const body of bad) {
    const res = await invite(body)
    assert.equal(res.status, 400, `${JSON.stringify(body).slice(0, 60)} must be refused`)
  }
  assert.equal(scenario.invites.length, 0)
})

test('#941: every role of cms_users_role_check is accepted', async () => {
  for (const role of ['admin', 'editor', 'viewer', 'client']) {
    const res = await invite({ email: `${role}@tuggi.app`, role })
    assert.equal(res.status, 200, role)
  }
})
