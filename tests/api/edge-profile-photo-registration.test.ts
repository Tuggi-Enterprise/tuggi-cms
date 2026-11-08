/**
 * Registration of the profile photo, `register-profile-photo` (#1130, BR-USUARIO-052 item 2.e,
 * BR-USUARIO-050 item 3): a clean photo is set with the user id of the token; an improper one is
 * deleted from the bucket and never set (BR-ROTA-008 item 4, the owner of the rule); with the
 * provider down nothing is set or deleted (fail closed). Bucket, provider and RPC are faked: no call
 * leaves the process. The SafeSearch thresholds are the ones of `photo-moderation.ts`, read here
 * through `parseSafeSearchResponse`.
 *
 * Deno source, loaded through a path built at run time: a static `.ts` import fails the repo's `tsc`.
 *
 * Run with: npm run test:api
 */

import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const FUNCTIONS = resolve(import.meta.dirname, '../../supabase/functions')
const MODULE = resolve(FUNCTIONS, '_shared/profile-photo-registration.ts')
const MODERATION = resolve(FUNCTIONS, '_shared/photo-moderation.ts')

const USER = '11111111-2222-4333-8444-555555555555'
const PHOTO = '33333333-4444-4555-8666-777777777777'
const KEY = `${USER}/${PHOTO}.jpg`
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
const SCREENED_AT = '2026-11-08T12:05:00.000Z'

let mod: any
let moderation: any

before(async () => {
  mod = await import(pathToFileURL(MODULE).href)
  moderation = await import(pathToFileURL(MODERATION).href)
})

const level = (a: Record<string, string>) => ({ responses: [{ safeSearchAnnotation: a }] })
const CLEAN = level({ adult: 'VERY_UNLIKELY', spoof: 'UNLIKELY', medical: 'UNLIKELY', violence: 'UNLIKELY', racy: 'POSSIBLE' })
const VIOLENT = level({ adult: 'UNLIKELY', spoof: 'UNLIKELY', medical: 'UNLIKELY', violence: 'LIKELY', racy: 'UNLIKELY' })

function fakes(opts: {
  vision?: unknown | Error
  read?: 'found' | 'missing' | Error
  register?: { ok: true; photoKey: string } | { ok: false; code: string | null }
  removed?: boolean
} = {}) {
  const trail = { read: 0, classified: 0, removed: [] as string[], registered: [] as unknown[], order: [] as string[] }
  const deps = {
    hasApiKey: true,
    now: () => {
      trail.order.push('clock')
      return new Date(SCREENED_AT)
    },
    readPhoto: async () => {
      trail.read++
      trail.order.push('read')
      if (opts.read instanceof Error) throw opts.read
      if (opts.read === 'missing') return { kind: 'missing' }
      return { kind: 'found', bytes: JPEG }
    },
    classify: async () => {
      trail.classified++
      trail.order.push('classify')
      const v = opts.vision ?? CLEAN
      if (v instanceof Error) throw v
      return moderation.parseSafeSearchResponse(v)
    },
    removePhoto: async (key: string) => {
      trail.removed.push(key)
      return opts.removed ?? true
    },
    register: async (userId: string, key: string, screenedAt: string) => {
      trail.order.push('register')
      trail.registered.push({ userId, key, screenedAt })
      return opts.register ?? { ok: true, photoKey: key }
    },
  }
  return { deps, trail }
}

const run = (body: unknown, userId: string | null, deps: unknown) =>
  mod.handleProfilePhotoRegistration(body, userId, deps)

test('BR-USUARIO-052 item 2.e (#1130): a clean photo is set with the user id of the token, after the screening', async () => {
  const { deps, trail } = fakes()
  const out = await run({ storageKey: KEY }, USER, deps)
  assert.equal(out.status, 200)
  assert.deepEqual(out.body, { photoKey: KEY })
  assert.deepEqual(trail.registered, [{ userId: USER, key: KEY, screenedAt: SCREENED_AT }])
  assert.deepEqual(trail.order, ['clock', 'read', 'classify', 'register'])
  assert.deepEqual(trail.removed, [])
})

test('BR-USUARIO-052 item 2.e.ii, BR-ROTA-008 item 4 (#1130): an improper photo is deleted, never set, and answered with its category', async () => {
  const { deps, trail } = fakes({ vision: VIOLENT })
  const out = await run({ storageKey: KEY }, USER, deps)
  assert.equal(out.status, 422)
  assert.deepEqual(out.body, { error: 'photo_refused', categories: ['violence'] })
  assert.deepEqual(trail.removed, [KEY])
  assert.equal(trail.registered.length, 0)
})

test('#1130: a refusal whose delete failed is not final: 503, nothing set', async () => {
  const { deps, trail } = fakes({ vision: VIOLENT, removed: false })
  const out = await run({ storageKey: KEY }, USER, deps)
  assert.equal(out.status, 503)
  assert.equal(trail.registered.length, 0)
})

for (const [name, vision] of [
  ['an HTTP error', new Error('safesearch http 500')],
  ['a timeout', Object.assign(new Error('timeout'), { name: 'TimeoutError' })],
  ['an UNKNOWN level', level({ adult: 'UNKNOWN', violence: 'UNLIKELY', racy: 'UNLIKELY' })],
] as const) {
  test(`BR-USUARIO-052 item 2.e.ii (#1130): fail closed, the provider with ${name} gives 503 and nothing is set or deleted`, async () => {
    const { deps, trail } = fakes({ vision })
    const out = await run({ storageKey: KEY }, USER, deps)
    assert.equal(out.status, 503)
    assert.deepEqual(out.body, { error: 'moderation_unavailable' })
    assert.equal(trail.registered.length, 0)
    assert.deepEqual(trail.removed, [])
  })
}

test('#1130: no provider key and a bucket failure are 503 with nothing set or deleted', async () => {
  const noKey = fakes()
  const a = await run({ storageKey: KEY }, USER, { ...noKey.deps, hasApiKey: false })
  assert.equal(a.status, 503)
  assert.equal(noKey.trail.read, 0)
  const bucket = fakes({ read: new Error('boom') })
  const b = await run({ storageKey: KEY }, USER, bucket.deps)
  assert.equal(b.status, 503)
  assert.deepEqual(b.body, { error: 'storage_unavailable' })
  assert.equal(bucket.trail.registered.length + bucket.trail.removed.length, 0)
})

test('BR-USUARIO-050 item 3 (#1130): no user behind the token is 401, nothing read', async () => {
  const { deps, trail } = fakes()
  const out = await run({ storageKey: KEY }, null, deps)
  assert.equal(out.status, 401)
  assert.deepEqual(out.body, { error: 'unauthorized' })
  assert.equal(trail.read, 0)
})

for (const [name, body] of [
  ['another user folder', { storageKey: `99999999-2222-4333-8444-555555555555/${PHOTO}.jpg` }],
  ['a climb out of the folder', { storageKey: `${USER}/../${PHOTO}.jpg` }],
  ['a deeper path', { storageKey: `${USER}/x/${PHOTO}.jpg` }],
  ['a name that is not a uuid', { storageKey: `${USER}/photo.jpg` }],
  ['another extension', { storageKey: `${USER}/${PHOTO}.png` }],
  ['the user id in the body instead of the key', { userId: USER }],
  ['no body', null],
] as const) {
  test(`BR-USUARIO-050 item 3 (#1130): ${name} is 400 invalid_body, nothing read`, async () => {
    const { deps, trail } = fakes()
    const out = await run(body, USER, deps)
    assert.equal(out.status, 400)
    assert.deepEqual(out.body, { error: 'invalid_body' })
    assert.equal(trail.read, 0)
  })
}

test('#1130: an object not in the bucket is 409 TGW16, the app uploads again under a new key', async () => {
  const { deps, trail } = fakes({ read: 'missing' })
  const out = await run({ storageKey: KEY }, USER, deps)
  assert.equal(out.status, 409)
  assert.deepEqual(out.body, { error: 'rpc_refused', code: 'TGW16' })
  assert.equal(trail.classified, 0)
})

test('#1130: TGW16, TGW19 and TGU37 from the RPC are 409 with the code; another failure is 503', async () => {
  for (const code of ['TGW16', 'TGW19', 'TGU37']) {
    const { deps } = fakes({ register: { ok: false, code } })
    const out = await run({ storageKey: KEY }, USER, deps)
    assert.equal(out.status, 409)
    assert.deepEqual(out.body, { error: 'rpc_refused', code })
  }
  const { deps } = fakes({ register: { ok: false, code: '57014' } })
  assert.equal((await run({ storageKey: KEY }, USER, deps)).status, 503)
})

test('#1130: the function answers 401 to a machine key, has its rate limit entry, and logs no key or user id', () => {
  const index = readFileSync(resolve(FUNCTIONS, 'register-profile-photo/index.ts'), 'utf8')
  assert.match(index, /if \(token && !isOwnMachineKey\(token\)\)/)
  assert.match(index, /RATE_LIMIT_CONFIG\[FUNCTION_NAME\]/)
  const logs = index.match(/console\.(log|warn|error)\([^\n]*/g) ?? []
  assert.ok(logs.length > 0)
  for (const line of logs) assert.doesNotMatch(line, /key|uid|userId|bytes|data\b/i)
  const limiter = readFileSync(resolve(FUNCTIONS, '_shared/rate-limiter.ts'), 'utf8')
  assert.match(limiter, /'register-profile-photo': \{\s*maxRequests: \d+,\s*windowSeconds: \d+,/)
})
