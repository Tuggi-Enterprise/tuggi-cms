/**
 * The bounce that is OURS does not remove anybody from the base — BR-COMUNICACAO-017 item 6.b.
 *
 * Apple requires every sending domain to be registered and validated with SPF and/or DKIM in the
 * Developer Account, with an exact match against the envelope domain. Official documentation,
 * verbatim: *"If you don't register all the source domains or emails that you use, email sent to
 * the private relay service will result in a bounce message."* That bounce arrives as
 * `Permanent`, indistinguishable from a dead mailbox — and **70 of our accounts are on
 * `@privaterelay.appleid.com`** (measured 2026-09-11, epic #737).
 *
 * Without the distinction this file guards, the hard-bounce branch of `resend-webhook` suppresses
 * all 70 at once, silently, because of a console setting nobody checked. They do not come back.
 *
 * The flag fails closed on purpose: unknown behaves like unregistered. The two mistakes do not
 * cost the same — treating a verified domain as unverified keeps one dead address in the base,
 * and the reverse deletes seventy live ones.
 *
 * Run with: npm run test:api
 */

import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const MODULE_PATH = resolve(
  import.meta.dirname,
  '../../supabase/functions/_shared/newsletter-metrics.ts'
)
const WEBHOOK_PATH = resolve(
  import.meta.dirname,
  '../../supabase/functions/resend-webhook/index.ts'
)

let mod: any

before(async () => {
  mod = await import(pathToFileURL(MODULE_PATH).href)
})

test('BR-COMUNICACAO-017 item 6: the Apple relay domain is recognised, case and spacing included', () => {
  assert.equal(mod.isApplePrivateRelayAddress('abc123@privaterelay.appleid.com'), true)
  assert.equal(mod.isApplePrivateRelayAddress('  ABC123@PrivateRelay.AppleID.com '), true)
  assert.equal(mod.isApplePrivateRelayAddress('someone@gmail.com'), false)
  // A domain that merely contains the string is not the relay.
  assert.equal(mod.isApplePrivateRelayAddress('x@privaterelay.appleid.com.evil.tld'), false)
  assert.equal(mod.isApplePrivateRelayAddress(null), false)
})

test('BR-COMUNICACAO-017 item 6.b: a relay bounce with the domain unverified belongs to the sender', () => {
  assert.equal(mod.bounceOwner('abc@privaterelay.appleid.com', false), 'sender')
})

test('BR-COMUNICACAO-017 item 6.b: once the operator has registered the domain, a relay bounce is the address', () => {
  assert.equal(mod.bounceOwner('abc@privaterelay.appleid.com', true), 'recipient')
})

test('BR-COMUNICACAO-015: a bounce from any other domain is always the recipient, verified or not', () => {
  assert.equal(mod.bounceOwner('someone@gmail.com', false), 'recipient')
  assert.equal(mod.bounceOwner('someone@gmail.com', true), 'recipient')
})

test('BR-COMUNICACAO-017 item 6.a: the verification flag fails closed — only an explicit true counts', () => {
  assert.equal(mod.isRelayDomainVerified('true'), true)
  assert.equal(mod.isRelayDomainVerified(' TRUE '), true)
  assert.equal(mod.isRelayDomainVerified('false'), false)
  assert.equal(mod.isRelayDomainVerified('1'), false)
  assert.equal(mod.isRelayDomainVerified('yes'), false)
  assert.equal(mod.isRelayDomainVerified(''), false)
  assert.equal(mod.isRelayDomainVerified(undefined), false)
})

test('BR-COMUNICACAO-017 item 6.b: the webhook suppresses only what the recipient signalled', () => {
  // Source ruler: `resend-webhook/index.ts` imports a remote URL and cannot be loaded here. The
  // functions above would keep passing while somebody restored the unconditional suppression.
  const source = readFileSync(WEBHOOK_PATH, 'utf8')
  assert.match(source, /bounceOwner\(/)
  assert.match(source, /isRelayDomainVerified\(/)
  assert.match(source, /APPLE_PRIVATE_RELAY_DOMAIN_VERIFIED/)
  // Suppression is reached only through the branch that already excluded `owner === 'sender'`.
  assert.match(source, /if \(permanent && owner === 'sender'\)/)
  assert.match(source, /\} else if \(permanent\) \{/)
  // And the sender-owned bounce is OBSERVABLE: the operator has to be able to see it.
  assert.match(source, /APPLE RELAY BOUNCE, NOT SUPPRESSED/)
})
