/**
 * #341/#342 — every link `send-transactional` puts in an e-mail is composed from an origin of
 * OURS, never taken from the request body.
 *
 * Why this file exists: until #346 the function had no authorization of its own, so the
 * publishable key reached the handler. A template that renders `data.url` turns it into a
 * phishing kit signed with our SPF/DKIM/DMARC, aimed at the very establishments this
 * feature then asks for a CNPJ, an alvará and a contrato social — a document that carries
 * the CPF, the RG and the address of the members. The blast radius also includes the Resend
 * account, which every transactional e-mail of the project shares.
 *
 * #346 closed the door; the composition rule STAYS, and so does this file. An authorized
 * caller is still not allowed to choose our links: the gate narrows who sends, not what a
 * template may be told to render.
 *
 * These tests are written to go RED if the composition is removed: each one feeds an
 * attacker-controlled URL in the body and asserts on the href that comes out. A test that
 * only exercised the happy path would stay green after the regression.
 *
 * The function is Deno source (`.ts` specifiers, `Deno.env`, `Deno.serve`), so it is
 * loaded through a path built at run time — a static import ending in `.ts` fails
 * `npm run type-check` for the whole repo.
 *
 * Run with: npm run test:api
 */

import { test, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const FUNCTION_PATH = resolve(
  import.meta.dirname,
  '../../supabase/functions/send-transactional/index.ts'
)

/**
 * The gate of #346 pulled `_shared/auth-middleware.ts` into this function's module graph, and
 * that file imports `https://esm.sh/@supabase/supabase-js@2`. Node cannot resolve a remote
 * specifier and `mock.module` does not intercept one — measured 2026-08-23
 * (`edge-push-deeplink.test.ts`) and again on 2026-09-10, which is why the sibling gate tests
 * gave up on execution and assert over the source instead.
 *
 * `module.registerHooks` (Node >= 22.15, synchronous, CJS and ESM alike) does intercept it. Only
 * the `resolve` half is used: tsx fills the source of everything else in later, and a `load`
 * hook that passes those through fails Node's own validation with `ERR_INVALID_RETURN_PROPERTY`.
 * The redirect therefore points at a real file, `marketing-ef-remote-module-stub.mjs`, and that
 * stub throws — every request below carries a MACHINE KEY, and `isOwnMachineKey` answers before
 * `validateAuthHeader` builds any client, so reaching it means the wrong path is being tested.
 */
const REMOTE_STUB = pathToFileURL(
  resolve(import.meta.dirname, './marketing-ef-remote-module-stub.mjs')
).href

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('https://esm.sh/')) {
      return { url: REMOTE_STUB, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})

/**
 * The `ef_secret_key` of this test run. The function is reached by the CMS's Next server and by
 * the database, both with a machine key (#346); the map below is the shape the Supabase runtime
 * injects, indexed BY NAME.
 */
const EF_SECRET_KEY = 'sb_secret_TEST_EDGE_FUNCTION_KEY'

/** 43 chars of base64url — the shape `generateSingleUseToken` mints. */
const TOKEN = 'Kk7Qw2Zt5Yx9Bv1Nm3Ld6Hs0Rp8Jf4Gc2Ae7Ui5Ot1'
const ATTACKER = 'https://atacante.exemplo/parceria/roubado'

type Handler = (req: Request) => Promise<Response>

let handler: Handler
let env: Record<string, string | undefined>
/** Everything the function sent to Resend, in order. */
let sent: { subject: string; html: string; to: string[] }[]

/** Installs the Deno globals the function reads, and captures the handler it registers. */
function installDeno(): void {
  ;(globalThis as { Deno?: unknown }).Deno = {
    env: { get: (name: string) => env[name] },
    serve: (fn: Handler) => {
      handler = fn
    },
  }
}

before(async () => {
  env = {}
  installDeno()
  await import(pathToFileURL(FUNCTION_PATH).href)
  assert.equal(typeof handler, 'function', 'the function never registered its handler')
})

beforeEach(() => {
  env = {
    RESEND_API_KEY: 'test-key',
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_SECRET_KEYS: JSON.stringify({ ef_secret_key: EF_SECRET_KEY }),
  }
  sent = []
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}'))
    sent.push({ subject: body.subject, html: body.html, to: body.to })
    return new Response(JSON.stringify({ id: 'resend-1' }), { status: 200 })
  }) as typeof fetch
})

function post(body: unknown, headers: Record<string, string>): Promise<Response> {
  return handler(
    new Request('http://localhost/send-transactional/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })
  )
}

/** A request from one of our own machines — the identity every real caller carries. */
function send(body: unknown): Promise<Response> {
  return post(body, { authorization: `Bearer ${EF_SECRET_KEY}` })
}

test('#346: a caller with no Authorization sends nothing, and never reaches a template', async () => {
  // The publishable key satisfies the gateway's `verify_jwt` and ships inside the app binary
  // and the site's JS, so before #346 this exact request produced an e-mail with our brand,
  // our SPF/DKIM/DMARC and our Resend quota, to any address the caller typed.
  const response = await post(
    { type: 'partner_contract_sign', to: 'vitima@exemplo.com', data: { token: TOKEN } },
    {}
  )

  assert.equal(response.status, 401)
  assert.equal(sent.length, 0, 'an unauthorized caller reached Resend')
})

test('#346: a bearer token that is not one of our keys is refused before Resend', async () => {
  const response = await post(
    { type: 'partner_new', data: { partner_name: 'quem quer que seja' } },
    { authorization: 'Bearer sb_publishable_IN_THE_APP_BINARY' }
  )

  // 401 and not 403: a publishable key is not an identity this function knows at all.
  assert.equal(response.status, 401)
  assert.equal(sent.length, 0, 'the publishable key still sends e-mail in our name')
})

test('#346: /health stays open, because it is the only thing that says nothing', async () => {
  const response = await handler(new Request('http://localhost/send-transactional/health'))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { status: 'ok' })
})

/** Every `href` the rendered e-mail carries. */
function hrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1])
}

test('#341: `partner_form_invite` is not a type any more, and nothing is sent for it', async () => {
  // The partner form has no invite: one address serves every establishment and it carries no
  // token, so the template that composed a link from one has nothing to compose. This is the
  // contract change — `docs/contracts/edge-functions.md` — and a caller still asking for it
  // has to get an error, never an e-mail built from whatever `data` it sent.
  const response = await send({
    type: 'partner_form_invite',
    to: 'antonio@cantina.com.br',
    data: { trade_name: 'Cantina do Antônio', token: TOKEN, url: ATTACKER },
  })

  assert.equal(response.status, 500)
  assert.equal(sent.length, 0, 'a removed type must not reach Resend')
  assert.match(await response.text(), /unknown type/)
})

test('#341: the approved CTA is our app, not the `app_url` the caller asked for', async () => {
  // Same class as the invite link, one template above: the only sender in the project
  // passes the constant `https://tuggi.app`, so nothing legitimate loses anything.
  await send({
    type: 'partner_approved',
    to: 'antonio@cantina.com.br',
    lang: 'pt',
    data: { partner_name: 'Antônio', app_url: ATTACKER },
  })

  assert.equal(sent.length, 1)
  assert.deepEqual(hrefs(sent[0].html), ['https://tuggi.app'])
})

test('#341: no template of this function can point outside tuggi.app', async () => {
  // The invariant, not the instance: a template added later that takes an href from the
  // body fails here even if nobody remembers this file.
  const bodies = [
    { type: 'partner_new', data: { partner_name: ATTACKER, email: ATTACKER, city: ATTACKER } },
    { type: 'partner_received', to: 'a@b.com', data: { name: ATTACKER, app_url: ATTACKER } },
    { type: 'partner_approved', to: 'a@b.com', data: { name: ATTACKER, app_url: ATTACKER } },
    { type: 'partner_rejected', to: 'a@b.com', data: { reason: ATTACKER, app_url: ATTACKER } },
  ]

  for (const body of bodies) {
    sent = []
    await send(body)
    assert.equal(sent.length, 1, `${body.type} did not send`)

    for (const href of hrefs(sent[0].html)) {
      assert.match(
        href,
        /^https:\/\/([a-z0-9-]+\.)*tuggi\.app(\/|$)/,
        `${body.type} rendered a link we do not own: ${href}`
      )
    }
  }
})
