/**
 * #155 — `supabase/functions/_shared/secret-key.ts`, the only place any CMS Edge
 * Function reads its privileged key from.
 *
 * The legacy `SUPABASE_SERVICE_ROLE_KEY` leaked and still authenticates, so the
 * project has to move onto `SUPABASE_SECRET_KEYS` — a JSON object indexed by key
 * NAME. The project holds four secret keys and only `ef_secret_key` belongs to
 * the Edge Functions, so the name is asserted here as a literal: picking any of
 * the other three resolves fine and fails silently, which no other assertion in
 * this file would catch. The fallback still has to shout, and the
 * `console.error` asserted below still must never carry a key value.
 *
 * The helper is Deno source (`.ts` specifiers, `Deno.env`), so it is loaded
 * through a path built at run time — a static import would end in `.ts` and fail
 * `npm run type-check` for the whole repo.
 *
 * Run with: npm run test:api
 */

import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

interface SecretKeyModule {
  getSecretKey: () => string
  SECRET_KEY_NAME: string
}

const HELPER_PATH = resolve(
  import.meta.dirname,
  '../../supabase/functions/_shared/secret-key.ts'
)

const NEW_KEY = 'sb_secret_THIS_IS_THE_NEW_KEY'
const LEGACY_KEY = 'eyJhbGciOiJIUzI1NiJ9.THIS_IS_THE_LEAKED_LEGACY_KEY'

let helper: SecretKeyModule

/** Installs the Deno global the helper reads. Node has no `Deno.env`. */
function setDenoEnv(env: Record<string, string | undefined>): void {
  ;(globalThis as { Deno?: unknown }).Deno = {
    env: { get: (name: string) => env[name] },
  }
}

/** Runs `getSecretKey()` capturing what it wrote to console.error. */
function resolveKey(): { key: string; errors: string[] } {
  const errors: string[] = []
  const original = console.error
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(' '))
  }
  try {
    return { key: helper.getSecretKey(), errors }
  } finally {
    console.error = original
  }
}

before(async () => {
  setDenoEnv({})
  helper = (await import(pathToFileURL(HELPER_PATH).href)) as SecretKeyModule
})

test('#155: the configured name is `ef_secret_key`, the secret created for the Edge Functions', () => {
  assert.equal(
    helper.SECRET_KEY_NAME,
    'ef_secret_key',
    'the project also holds `default`, `cms_secret_key` and `app_secret_key`, ' +
      'and each belongs to another consumer'
  )
})

test('#155: `default` exists in this project and must never be the one picked', () => {
  // The whole map, as the runtime injects it. `default` resolving is exactly the
  // failure this test exists for: it would answer 200 with the wrong identity.
  setDenoEnv({
    SUPABASE_SECRET_KEYS: JSON.stringify({
      default: 'sb_secret_THE_WRONG_ONE',
      cms_secret_key: 'sb_secret_BELONGS_TO_THE_CMS',
      app_secret_key: 'sb_secret_BELONGS_TO_THE_APP',
      ef_secret_key: NEW_KEY,
    }),
    SUPABASE_SERVICE_ROLE_KEY: LEGACY_KEY,
  })

  const { key, errors } = resolveKey()

  assert.equal(key, NEW_KEY, 'any other entry of the map is a silent wrong-identity bug')
  assert.deepEqual(errors, [], 'the configured name resolved: there is nothing to warn about')
})

test('#155: the configured name in SUPABASE_SECRET_KEYS wins, silently', () => {
  setDenoEnv({
    SUPABASE_SECRET_KEYS: JSON.stringify({
      [helper.SECRET_KEY_NAME]: NEW_KEY,
      other: 'sb_secret_SOME_OTHER_KEY',
    }),
    SUPABASE_SERVICE_ROLE_KEY: LEGACY_KEY,
  })

  const { key, errors } = resolveKey()

  assert.equal(key, NEW_KEY, 'the new key must be preferred while both generations coexist')
  assert.deepEqual(errors, [], 'the happy path is the end state: it must not warn')
})

test('#155: with no SUPABASE_SECRET_KEYS it falls back to the legacy key and says so', () => {
  setDenoEnv({ SUPABASE_SERVICE_ROLE_KEY: LEGACY_KEY })

  const { key, errors } = resolveKey()

  assert.equal(key, LEGACY_KEY, 'the bridge keeps production alive until the key is named')
  assert.equal(errors.length, 1, 'a silent fallback is how a migration never finishes')
  assert.match(errors[0], /#155/)
  assert.match(errors[0], /SUPABASE_SERVICE_ROLE_KEY/)
  assert.ok(
    !errors[0].includes(LEGACY_KEY),
    'the log must never carry the key value, not even the one it fell back to'
  )
})

test('#155: a map without the configured name falls back and prints the available names', () => {
  setDenoEnv({
    SUPABASE_SECRET_KEYS: JSON.stringify({
      sb_secret_prod: NEW_KEY,
      ci: 'sb_secret_CI_KEY',
    }),
    SUPABASE_SERVICE_ROLE_KEY: LEGACY_KEY,
  })

  const { key, errors } = resolveKey()

  assert.equal(key, LEGACY_KEY)
  assert.equal(errors.length, 1)
  // The names are the whole point of the log: this is how the real one gets found.
  assert.match(errors[0], /sb_secret_prod/)
  assert.match(errors[0], /ci/)
  for (const value of [NEW_KEY, 'sb_secret_CI_KEY', LEGACY_KEY]) {
    assert.ok(!errors[0].includes(value), `the log leaked a key value: ${value}`)
  }
})

test('#155: a malformed SUPABASE_SECRET_KEYS is a fallback, not a crash', () => {
  setDenoEnv({
    SUPABASE_SECRET_KEYS: 'not json at all',
    SUPABASE_SERVICE_ROLE_KEY: LEGACY_KEY,
  })

  const { key, errors } = resolveKey()

  assert.equal(key, LEGACY_KEY, 'a bad value must degrade to the bridge, not take the function down')
  assert.equal(errors.length, 1)
})
