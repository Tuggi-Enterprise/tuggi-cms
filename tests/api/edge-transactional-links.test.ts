/**
 * #341 — every link `send-transactional` puts in an e-mail is composed from an origin of
 * OURS, never taken from the request body.
 *
 * Why this file exists: the function has no authorization of its own (that is #346), so
 * the publishable key reaches the handler. A template that renders `data.url` turns it
 * into a phishing kit signed with our SPF/DKIM/DMARC, aimed at the very establishments
 * this feature then asks for a CNPJ, an alvará and a contrato social — a document that
 * carries the CPF, the RG and the address of the members. The blast radius also includes
 * the Resend account, which every transactional e-mail of the project shares.
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
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const FUNCTION_PATH = resolve(
  import.meta.dirname,
  '../../supabase/functions/send-transactional/index.ts'
)

/** 43 chars of base64url — the shape `generateInviteToken` mints. */
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
  env = { RESEND_API_KEY: 'test-key' }
  sent = []
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}'))
    sent.push({ subject: body.subject, html: body.html, to: body.to })
    return new Response(JSON.stringify({ id: 'resend-1' }), { status: 200 })
  }) as typeof fetch
})

function send(body: unknown): Promise<Response> {
  return handler(
    new Request('http://localhost/send-transactional/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  )
}

/** Every `href` the rendered e-mail carries. */
function hrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1])
}

test('#341: the invite link is built from our origin, and `data.url` is ignored', async () => {
  const response = await send({
    type: 'partner_form_invite',
    to: 'antonio@cantina.com.br',
    data: { trade_name: 'Cantina do Antônio', token: TOKEN, url: ATTACKER },
  })

  assert.equal(response.status, 200)
  assert.equal(sent.length, 1, 'the e-mail must still go out')

  // The mutation this test exists for: put `data.url` back in the href and this fails.
  assert.deepEqual(hrefs(sent[0].html), [`https://cms.tuggi.app/pt/parceria/${TOKEN}`])
  assert.ok(
    !sent[0].html.includes('atacante.exemplo'),
    'the attacker host reached the e-mail body'
  )
})

test('#341: the origin comes from PARTNER_FORM_ORIGIN when it is set', async () => {
  env.PARTNER_FORM_ORIGIN = 'https://cms-staging.tuggi.app/'

  await send({
    type: 'partner_form_invite',
    to: 'antonio@cantina.com.br',
    data: { token: TOKEN },
  })

  assert.deepEqual(hrefs(sent[0].html), [`https://cms-staging.tuggi.app/pt/parceria/${TOKEN}`])
})

test('#341: a non-https PARTNER_FORM_ORIGIN falls back to ours instead of being trusted', async () => {
  env.PARTNER_FORM_ORIGIN = 'http://cms.tuggi.app'

  await send({ type: 'partner_form_invite', to: 'a@b.com', data: { token: TOKEN } })

  assert.deepEqual(hrefs(sent[0].html), [`https://cms.tuggi.app/pt/parceria/${TOKEN}`])
})

test('#341: the invite link always carries the /pt/ segment', async () => {
  // `i18n.ts` falls back to `en`, and a form in English asking a Brazilian owner for a
  // CNPJ and an alvará is the bug this segment prevents. Twin of `partnerFormPath`.
  await send({ type: 'partner_form_invite', to: 'a@b.com', data: { token: TOKEN } })

  assert.match(hrefs(sent[0].html)[0], /\/pt\/parceria\//)
})

test('#341: a token that is not a token sends no e-mail at all', async () => {
  for (const token of [
    ATTACKER,
    '../../evil',
    `${TOKEN}" onmouseover="x`,
    `${TOKEN}?next=https://atacante.exemplo`,
    'short',
    '',
    undefined,
  ]) {
    const response = await send({
      type: 'partner_form_invite',
      to: 'antonio@cantina.com.br',
      data: { token },
    })

    assert.equal(response.status, 500, `\`${token}\` should never render an e-mail`)
    assert.equal(sent.length, 0, `\`${token}\` reached Resend`)
  }
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
    { type: 'partner_form_invite', to: 'a@b.com', data: { token: TOKEN, url: ATTACKER } },
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
