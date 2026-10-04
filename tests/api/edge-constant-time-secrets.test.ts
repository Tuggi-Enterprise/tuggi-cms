/**
 * #830 / #820 / #827 — the secret comparisons of the Edge Functions are constant time.
 *
 *  - `_shared/constant-time.ts` `constantTimeEqual`, the one comparison;
 *  - `_shared/secret-key.ts` `isOwnSecretKey`, which used `Array.includes` until #830;
 *  - `_shared/places-secret.ts` `isPlacesSecret`, the gate of the Portal Locais functions
 *    (`docs/contracts/places-cms.md`): no secret configured refuses everyone.
 *
 * Deno source, loaded through a path built at run time (a static `.ts` import fails the repo's
 * type-check), with `Deno.env` stubbed on the global.
 *
 * Run with: npm run test:api
 */

import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const SHARED = resolve(import.meta.dirname, '../../supabase/functions/_shared')

let constantTimeEqual: (a: string, b: string) => boolean
let isOwnSecretKey: (token: string) => boolean
let isPlacesSecret: (provided: string | null | undefined) => boolean

function setDenoEnv(env: Record<string, string | undefined>): void {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (name: string) => env[name] } }
}

function quiet<T>(fn: () => T): T {
  const original = console.error
  console.error = () => {}
  try {
    return fn()
  } finally {
    console.error = original
  }
}

before(async () => {
  setDenoEnv({})
  ;({ constantTimeEqual } = await import(pathToFileURL(resolve(SHARED, 'constant-time.ts')).href))
  ;({ isOwnSecretKey } = await import(pathToFileURL(resolve(SHARED, 'secret-key.ts')).href))
  ;({ isPlacesSecret } = await import(pathToFileURL(resolve(SHARED, 'places-secret.ts')).href))
})

test('constantTimeEqual: equal, different, prefix and empty', () => {
  assert.equal(constantTimeEqual('abc', 'abc'), true)
  assert.equal(constantTimeEqual('abc', 'abd'), false)
  assert.equal(constantTimeEqual('abc', 'abcd'), false, 'a prefix is not a match')
  assert.equal(constantTimeEqual('', 'a'), false)
  assert.equal(constantTimeEqual('', ''), true)
  assert.equal(constantTimeEqual('ação', 'ação'), true)
  assert.equal(constantTimeEqual('ação', 'acao'), false)
})

test('isOwnSecretKey (#830): still accepts the two named keys and refuses the rest', () => {
  setDenoEnv({
    SUPABASE_SECRET_KEYS: JSON.stringify({ ef_secret_key: 'sb_secret_EF', cms_secret_key: 'sb_secret_CMS' }),
  })
  assert.equal(isOwnSecretKey('sb_secret_EF'), true)
  assert.equal(isOwnSecretKey('sb_secret_CMS'), true)
  assert.equal(isOwnSecretKey('sb_secret_E'), false)
  assert.equal(isOwnSecretKey('sb_secret_EFX'), false)
  assert.equal(isOwnSecretKey(''), false)
})

test('isOwnSecretKey (#830): no `includes` left in the comparison', () => {
  const source = readFileSync(resolve(SHARED, 'secret-key.ts'), 'utf8')
  assert.doesNotMatch(source, /accepted\.includes\(/)
  assert.match(source, /constantTimeEqual\(candidate, key\)/)
})

test('isPlacesSecret: only the configured PLACES_CMS_SECRET passes', () => {
  setDenoEnv({ PLACES_CMS_SECRET: 'places-secret-0123456789abcdef' })
  assert.equal(isPlacesSecret('places-secret-0123456789abcdef'), true)
  assert.equal(isPlacesSecret('places-secret-0123456789abcde'), false)
  assert.equal(isPlacesSecret(null), false)
  assert.equal(isPlacesSecret(''), false)
})

test('isPlacesSecret: a project without the secret refuses everyone, even an empty header', () => {
  setDenoEnv({})
  assert.equal(quiet(() => isPlacesSecret('')), false)
  assert.equal(quiet(() => isPlacesSecret('anything')), false)
})

test('isPlacesSecret is not a Supabase key: it never reads SUPABASE_SECRET_KEYS', () => {
  setDenoEnv({ SUPABASE_SECRET_KEYS: JSON.stringify({ ef_secret_key: 'sb_secret_EF' }) })
  assert.equal(quiet(() => isPlacesSecret('sb_secret_EF')), false)
})
