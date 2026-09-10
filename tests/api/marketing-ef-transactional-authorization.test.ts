/**
 * #346, third function — `send-transactional` authorizes who calls it.
 *
 * Why this file exists. `POST /send` read no `Authorization` header at all, and the gateway's
 * `verify_jwt` is satisfied by the PUBLISHABLE key, which ships inside the app binary and is
 * served in the site's JS. Anyone holding it could POST an arbitrary `to` and `data` and get an
 * e-mail with our brand — "seu contrato de parceria Tuggi está pronto para assinar" — signed
 * with our SPF/DKIM/DMARC, on our sending reputation and our Resend quota. The renderers all go
 * through `esc()`, so there was never HTML injection here; the damage is the relay itself.
 *
 * WHAT IS PROVED WHERE. The refusal itself is EXECUTED, in
 * `edge-transactional-links.test.ts`: that file already drives the real handler, and a
 * `module.registerHooks` redirect gets `https://esm.sh/@supabase/supabase-js@2` past Node, so a
 * request with no header and a request bearing a publishable key both come back 401 with
 * nothing sent. This file covers the two things execution cannot see:
 *
 *  - POSITION — that no route, present or future, is answered in front of the gate. A seventh
 *    template or a second path would slip past an end-to-end test that never asks for it;
 *  - THE KEY SET — `isOwnSecretKey` in `_shared/secret-key.ts`, which imports nothing and reads
 *    only `Deno.env`, run against the four secret keys this project actually holds. It is
 *    loaded through a path built at run time, because a static import would end in `.ts` and
 *    fail `npm run type-check` for the whole repo.
 *
 * Run with: npm run test:api
 */

import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const FN = (name: string) =>
  readFileSync(resolve(import.meta.dirname, `../../supabase/functions/${name}`), 'utf8')

const transactional = FN('send-transactional/index.ts')
const middleware = FN('_shared/auth-middleware.ts')

/** Where a literal first appears, asserting it appears at all. */
function at(source: string, needle: string, label: string): number {
  const i = source.indexOf(needle)
  assert.notEqual(i, -1, `${label}: \`${needle}\` is gone from the source`)
  return i
}

// --- The gate is the one that already existed --------------------------------

test('#346: send-transactional does not invent a fourth authorization scheme', () => {
  // CLAUDE.md §6, procure antes de criar. `requireAdmin` is what the three Marketing functions
  // and ~15 content functions already use; a private spelling of "is this caller allowed" here
  // would be the defect, not the fix.
  assert.match(
    transactional,
    /import \{ requireAdmin \} from '\.\.\/_shared\/auth-middleware\.ts'/,
    'send-transactional does not import the shared gate'
  )
  assert.match(transactional, /await requireAdmin\(req/, 'send-transactional never calls the gate')
  assert.match(
    transactional,
    /if \(auth instanceof Response\)/,
    'send-transactional calls the gate but does not return its refusal'
  )
})

test('#346: everything but /health is gated, and the send is downstream of the gate', () => {
  const gate = at(transactional, 'await requireAdmin(req', 'send-transactional')

  // `/health` is the only thing answered before the gate, and it says nothing.
  const before = transactional.slice(0, gate)
  const routesBefore = [...before.matchAll(/path === '([^']+)'/g)].map((m) => m[1])
  assert.deepEqual(routesBefore, ['/health'], 'a route slipped in front of the gate')

  // The send route, the 404 and the Resend call are all after it. Gating above the 404 also
  // means an unauthorized caller cannot enumerate which paths exist.
  for (const marker of ["path !== '/send'", "error: 'not_found'", 'fetch(RESEND_URL', 'body: JSON.stringify({']) {
    assert.ok(
      at(transactional, marker, 'send-transactional') > gate,
      `\`${marker}\` is reached BEFORE the gate — it is still open to the publishable key`
    )
  }
})

test('#346: every template renderer sits after the gate, so a new type cannot skip it', () => {
  const gate = at(transactional, 'await requireAdmin(req', 'send-transactional')
  // The dispatch is one expression; the assertion is on the dispatch, not on a list of types,
  // so a seventh template added tomorrow is gated without anyone remembering this file.
  const dispatch = at(transactional, 'const { subject, html } =', 'send-transactional')
  assert.ok(dispatch > gate, 'a template is rendered before the caller is authorized')
  for (const renderer of ['renderTeamAlert(data)', 'renderContractSign(data)', 'renderContractSigned(data)']) {
    assert.ok(at(transactional, renderer, 'send-transactional') > gate, `${renderer} is not gated`)
  }
})

test('#346: no href still comes from the body after the gate (the #341 mitigation stays)', () => {
  // Authorizing the caller does not make a body-supplied link safe: the audience is the partner
  // whose contrato social carries the CPF and RG of the members. The mutation proof is in
  // `edge-transactional-links.test.ts`; this only pins that the composition stayed ours.
  assert.match(transactional, /function ownOrigin\(secret: string, fallback: string\)/)
  assert.match(transactional, /const SIGNING_TOKEN_PATTERN = /, 'the token shape is no longer verified')
  assert.doesNotMatch(transactional, /href.*data\.url/, 'a caller-supplied url reached an href')
})

// --- The callers that are not people keep working ----------------------------

test('#346: the machine bypass is a set of NAMED project keys, not a loosened comparison', () => {
  assert.match(middleware, /export function isOwnMachineKey\(/, 'isOwnMachineKey is gone')
  assert.match(middleware, /isOwnSecretKey\(token\)/, 'the middleware re-declared the comparison (SSOT)')
  assert.match(middleware, /if \(isOwnMachineKey\(token\)\)/, 'the bypass does not use the helper')
  // The legacy key that leaked (#155) is still not read here by name.
  assert.doesNotMatch(
    middleware,
    /Deno\.env\.get\(\s*["']SUPABASE_SERVICE_ROLE_KEY["']/,
    'the leaked legacy key is read again, and no caller in production needs it'
  )
})

interface SecretKeyModule {
  isOwnSecretKey: (token: string) => boolean
  SECRET_KEY_NAME: string
  CMS_SERVER_KEY_NAME: string
}

const HELPER_PATH = resolve(
  import.meta.dirname,
  '../../supabase/functions/_shared/secret-key.ts'
)

let helper: SecretKeyModule

/** Installs the Deno global the helper reads. Node has no `Deno.env`. */
function setDenoEnv(env: Record<string, string | undefined>): void {
  ;(globalThis as { Deno?: unknown }).Deno = {
    env: { get: (name: string) => env[name] },
  }
}

/** The four secret keys this project actually holds, as the runtime injects them. */
const EF_KEY = 'sb_secret_BELONGS_TO_THE_EDGE_FUNCTIONS'
const CMS_KEY = 'sb_secret_BELONGS_TO_THE_CMS'
const APP_KEY = 'sb_secret_BELONGS_TO_THE_APP'
const DEFAULT_KEY = 'sb_secret_THE_DEFAULT_ONE'
const PUBLISHABLE_KEY = 'sb_publishable_IN_THE_APP_BINARY_AND_THE_SITE_JS'
const LEGACY_KEY = 'eyJhbGciOiJIUzI1NiJ9.THIS_IS_THE_LEAKED_LEGACY_KEY'

function withProjectKeys(): void {
  setDenoEnv({
    SUPABASE_SECRET_KEYS: JSON.stringify({
      default: DEFAULT_KEY,
      cms_secret_key: CMS_KEY,
      app_secret_key: APP_KEY,
      ef_secret_key: EF_KEY,
    }),
    SUPABASE_SERVICE_ROLE_KEY: LEGACY_KEY,
  })
}

before(async () => {
  setDenoEnv({})
  helper = (await import(pathToFileURL(HELPER_PATH).href)) as SecretKeyModule
})

test('#346: the two names are the machine callers, and they are named, not positional', () => {
  assert.equal(helper.SECRET_KEY_NAME, 'ef_secret_key', 'the EF/database key changed name')
  assert.equal(
    helper.CMS_SERVER_KEY_NAME,
    'cms_secret_key',
    "the Next server's SUPABASE_SECRET_KEY is this entry — measured 2026-09-01 and 2026-09-10"
  )
})

test('#346: the database and EF-to-EF callers pass — they carry ef_secret_key', () => {
  // `core.dispatch_partner_user_notification` and the new-partner team alert post with the
  // Vault's `ef_secret_key`. The Vault holds no `SERVICE_ROLE_KEY` entry at all, so a database
  // function still reading that name resolves NULL and skips its own send.
  withProjectKeys()
  assert.equal(helper.isOwnSecretKey(EF_KEY), true)
  assert.equal(helper.isOwnSecretKey(` ${EF_KEY} `), true, 'a header with whitespace is refused')
})

test('#346: the Next server passes — this is the caller the other two functions do not have', () => {
  // `sendTransactionalEmail` goes through `getSupabaseService()`, whose key is the Next
  // environment's `SUPABASE_SECRET_KEY`. A gate that knew only `ef_secret_key` would answer 401
  // to the partner contract e-mail, and nobody would see it: that function never throws.
  withProjectKeys()
  assert.equal(helper.isOwnSecretKey(CMS_KEY), true)
})

test('#346: the publishable key does not pass — that is the whole point of the gate', () => {
  withProjectKeys()
  assert.equal(helper.isOwnSecretKey(PUBLISHABLE_KEY), false)
  assert.equal(helper.isOwnSecretKey(''), false)
  assert.equal(helper.isOwnSecretKey('   '), false)
})

test('#346: the other two project keys are outside the set, and so is the leaked legacy key', () => {
  // `default` and `app_secret_key` have no caller here, and the one named for the app is the
  // one that would sit closest to a binary. `SUPABASE_SERVICE_ROLE_KEY` is the key that leaked.
  withProjectKeys()
  assert.equal(helper.isOwnSecretKey(APP_KEY), false, 'the app key opens the gate')
  assert.equal(helper.isOwnSecretKey(DEFAULT_KEY), false, 'the default key opens the gate')
  assert.equal(helper.isOwnSecretKey(LEGACY_KEY), false, 'the leaked legacy key opens the gate')
})

test('#346: with no cms_secret_key configured the set narrows, it does not open', () => {
  // A project (or a branch environment) that never created the CMS key must not end up
  // accepting the empty string, which is what a naive `map[name] === token` would do.
  setDenoEnv({
    SUPABASE_SECRET_KEYS: JSON.stringify({ ef_secret_key: EF_KEY, cms_secret_key: '' }),
  })
  assert.equal(helper.isOwnSecretKey(EF_KEY), true)
  assert.equal(helper.isOwnSecretKey(''), false)
  assert.equal(helper.isOwnSecretKey(CMS_KEY), false)
})
