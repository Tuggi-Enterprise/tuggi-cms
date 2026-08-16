/**
 * The public half of the CMS — who gets a page without a session, and who gets /login.
 *
 * This exists because of a defect that cost the whole external delivery of #341 and #342:
 * both features are FOR people who have no account here, and neither `/parceria/<token>`
 * nor `/contrato/<token>` was in the middleware's list of public paths. The failure was
 * closed (307 to /login, nothing leaked) and therefore silent — the partner simply could
 * not open the form or the contract, and no test said so.
 *
 * The list is the kind of line somebody tidies up six months later. So this suite runs the
 * REAL middleware (`proxy.ts`) with no session and asserts both directions:
 *   · a token page answers the page, not a redirect to login;
 *   · a CMS page still answers 307 to login;
 *   · and the prefix is exact — `/parceria-interna` is not `/parceria`.
 *
 * Public here means "no CMS session", never "no credential": the credential is the 256-bit
 * single-use token in the next segment, stored only as a SHA-256 (BR-B2B-026, item 2).
 *
 * Run with: npm run test:api
 */

import { test, before, mock } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { NextRequest } from 'next/server'

import { PUBLIC_EXACT_PATHS, PUBLIC_PATH_PREFIXES, isPublicPath } from '@/lib/roles'

const REPO_ROOT = resolve(import.meta.dirname, '../..')

const TOKEN = 'a'.repeat(43)

/** What the middleware sees when nobody is signed in. */
let signedInUser: { id: string; email: string } | null = null

let proxy: (req: NextRequest) => Promise<Response>

before(async () => {
  mock.module('@supabase/ssr', {
    namedExports: {
      createServerClient: () => ({
        auth: { getUser: async () => ({ data: { user: signedInUser }, error: null }) },
        // Reached only for a signed-in user on a NON-public path; answering "no CMS row"
        // is what /unauthorized is for, and it keeps the public assertions honest.
        schema: () => ({
          from: () => ({
            select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }) }) }),
          }),
        }),
      }),
    },
  })

  const middleware = await import('@/proxy')
  proxy = middleware.proxy as unknown as typeof proxy
})

async function visit(path: string): Promise<{ status: number; location: string | null }> {
  const res = await proxy(new NextRequest(`http://localhost${path}`))
  return { status: res.status, location: res.headers.get('location') }
}

// ── The two token pages of #341 and #342 open without an account ───────────────────────

test('BR-B2B-026: the signing page opens with no session — the failure that made #342 unreachable', async () => {
  const answer = await visit(`/pt/contrato/${TOKEN}`)
  assert.equal(answer.status, 200, 'a partner without a CMS account has to reach the contract')
  assert.equal(answer.location, null, 'no redirect at all — not to login, not anywhere')
})

test('BR-B2B-026: the partner form opens with no session — the same failure in #341', async () => {
  const answer = await visit(`/pt/parceria/${TOKEN}`)
  assert.equal(answer.status, 200)
  assert.equal(answer.location, null)
})

test('the token pages are public under every locale the routing declares', async () => {
  // Literals, not the constant: a loop over a list somebody shortened passes by being
  // empty, which is the same silence this suite exists to break.
  assert.deepEqual([...PUBLIC_PATH_PREFIXES], ['/parceria', '/contrato'])

  for (const locale of ['en', 'pt', 'es']) {
    for (const prefix of ['/parceria', '/contrato']) {
      const answer = await visit(`/${locale}${prefix}/${TOKEN}`)
      assert.equal(answer.status, 200, `${locale}${prefix} must not be gated`)
    }
  }
})

test('a CMS operator holding a session opens the same link, and no role lookup gates it', async () => {
  signedInUser = { id: 'auth-1', email: 'admin@tuggi.app' }
  try {
    const answer = await visit(`/pt/contrato/${TOKEN}`)
    // Without this, a signed-in user with no `core.cms_users` row would land on
    // /unauthorized while reading a public document.
    assert.equal(answer.status, 200)
    assert.equal(answer.location, null)
  } finally {
    signedInUser = null
  }
})

// ── And the gate did not get wider ──────────────────────────────────────────────────────

test('every CMS page still refuses an anonymous visitor with 307 to login', async () => {
  for (const path of ['/dashboard', '/clients', '/pois', '/admin/audit-logs', '/events', '/users/cms']) {
    const answer = await visit(`/pt${path}`)
    assert.equal(answer.status, 307, `${path} must stay behind the session`)
    assert.equal(answer.location, 'http://localhost/pt/login')
  }
})

test('the public prefix is a whole segment — a lookalike path is not public', async () => {
  for (const lookalike of ['/parceria-interna', '/contratos', '/contrato-modelo']) {
    assert.equal(isPublicPath(lookalike), false, `${lookalike} is not the public surface`)
    const answer = await visit(`/pt${lookalike}`)
    assert.equal(answer.status, 307, `${lookalike} must stay behind the session`)
  }
})

test('the four pages that were already public stay public', async () => {
  assert.deepEqual([...PUBLIC_EXACT_PATHS], ['/login', '/client-signup', '/debug', '/unauthorized'])
  for (const path of PUBLIC_EXACT_PATHS) {
    if (path === '/login') continue // handled below: an anonymous visitor is already there
    const answer = await visit(`/pt${path}`)
    assert.notEqual(answer.location, 'http://localhost/pt/login', `${path} must not bounce to login`)
  }
  const login = await visit('/pt/login')
  assert.equal(login.status, 200)
})

// ── The list points at pages that exist ─────────────────────────────────────────────────

test('every public prefix names a real page — a renamed route cannot leave the list stale', () => {
  // The two prefixes are no longer the same shape: `/contrato/<token>` is reached by a
  // credential and `/parceria` is one address for everybody (#341, 2026-08-16). Either page
  // satisfies the list; NEITHER existing is a prefix that bypasses the session for nothing.
  for (const prefix of PUBLIC_PATH_PREFIXES) {
    assert.ok(
      existsSync(resolve(REPO_ROOT, `app/[locale]${prefix}/page.tsx`)) ||
        existsSync(resolve(REPO_ROOT, `app/[locale]${prefix}/[token]/page.tsx`)),
      `${prefix} is declared public but has no page`
    )
  }
})

test('the middleware states no list of its own — the decision lives in lib/roles.ts', async () => {
  const { readFileSync } = await import('node:fs')
  const source = readFileSync(resolve(REPO_ROOT, 'proxy.ts'), 'utf8')
  assert.match(source, /isPublicPath\(pathWithoutLocale\)/)
  // A second inline list is how the first one drifted out of date. (`'/login'` still
  // appears here, and legitimately: it is where a signed-in visitor is bounced FROM.)
  for (const literal of ["'/client-signup'", "'/debug'", "'/unauthorized'", "'/parceria'", "'/contrato'"]) {
    assert.ok(!source.includes(literal), `${literal} restated in the middleware is a second list`)
  }
})
