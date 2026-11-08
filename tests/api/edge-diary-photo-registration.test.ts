/**
 * Registration of a diary photo, `register-diary-photo` (#1116, BR-ROTA-008 item 4): an improper
 * photo is refused at upload, deleted from the bucket and never registered; with the provider down
 * nothing is registered or deleted (fail closed). Bucket, provider and RPC are faked: no call
 * leaves the process. The SafeSearch thresholds are the ones of `photo-moderation.ts`, read here
 * through `parseSafeSearchResponse`.
 *
 * Deno source, loaded through a path built at run time: a static `.ts` import fails the repo's `tsc`.
 *
 * Run with: npm run test:api
 */

import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const MODULE = resolve(import.meta.dirname, '../../supabase/functions/_shared/diary-photo-registration.ts')
const MODERATION = resolve(import.meta.dirname, '../../supabase/functions/_shared/photo-moderation.ts')

const USER = '11111111-2222-4333-8444-555555555555'
const DIARY = '22222222-3333-4444-8555-666666666666'
const PHOTO = '33333333-4444-4555-8666-777777777777'
const ANNOTATION = '44444444-5555-4666-8777-888888888888'
const KEY = `${USER}/${DIARY}/${PHOTO}.jpg`
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
const IMPROPER = level({ adult: 'VERY_LIKELY', spoof: 'UNLIKELY', medical: 'UNLIKELY', violence: 'UNLIKELY', racy: 'VERY_LIKELY' })

const body = (over: Record<string, unknown> = {}) => ({
  photoId: PHOTO,
  annotationId: ANNOTATION,
  storageKey: KEY,
  takenAt: '2026-11-08T12:00:00.000Z',
  ...over,
})

function fakes(opts: {
  vision?: unknown | Error
  read?: 'found' | 'missing' | Error
  bytes?: Uint8Array
  register?: { ok: true; photoId: string; created: boolean } | { ok: false; code: string | null }
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
      return { kind: 'found', bytes: opts.bytes ?? JPEG }
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
    register: async (userId: string, photo: unknown, screenedAt: string) => {
      trail.order.push('register')
      trail.registered.push({ userId, photo, screenedAt })
      return opts.register ?? { ok: true, photoId: PHOTO, created: true }
    },
  }
  return { deps, trail }
}

test('BR-ROTA-008 item 4 (#1116): a clean photo is registered with the user id of the token', async () => {
  const { deps, trail } = fakes()
  const out = await mod.handleDiaryPhotoRegistration(body(), USER, deps)
  assert.equal(out.status, 200)
  assert.deepEqual(out.body, { photoId: PHOTO, created: true })
  assert.deepEqual(trail.registered, [
    {
      userId: USER,
      photo: { photoId: PHOTO, annotationId: ANNOTATION, storageKey: KEY, takenAt: '2026-11-08T12:00:00.000Z' },
      screenedAt: SCREENED_AT,
    },
  ])
  assert.deepEqual(trail.removed, [])
})

test('BR-ROTA-008 item 4 (#1116): p_screened_at is the clock read before the object, so a swap during the screening is refused by the database', async () => {
  const { deps, trail } = fakes()
  await mod.handleDiaryPhotoRegistration(body(), USER, deps)
  assert.deepEqual(trail.order, ['clock', 'read', 'classify', 'register'])
  assert.equal((trail.registered[0] as { screenedAt: string }).screenedAt, SCREENED_AT)
})

test('#1116: the object changed after the screening (TGW16 from the RPC) is 409 rpc_refused, the app uploads again', async () => {
  const { deps } = fakes({ register: { ok: false, code: 'TGW16' } })
  const out = await mod.handleDiaryPhotoRegistration(body(), USER, deps)
  assert.equal(out.status, 409)
  assert.deepEqual(out.body, { error: 'rpc_refused', code: 'TGW16' })
})

test('BR-ROTA-008 item 4 (#1116): an improper photo is deleted from the bucket, never registered, and answered with its categories', async () => {
  const { deps, trail } = fakes({ vision: IMPROPER })
  const out = await mod.handleDiaryPhotoRegistration(body(), USER, deps)
  assert.equal(out.status, 422)
  assert.deepEqual(out.body, { error: 'photo_refused', categories: ['adult', 'racy'] })
  assert.deepEqual(trail.removed, [KEY])
  assert.equal(trail.registered.length, 0)
})

test('#1116: a refusal whose delete failed is not final: 503, nothing registered, the app sends again', async () => {
  const { deps, trail } = fakes({ vision: IMPROPER, removed: false })
  const out = await mod.handleDiaryPhotoRegistration(body(), USER, deps)
  assert.equal(out.status, 503)
  assert.equal(trail.registered.length, 0)
})

for (const [name, vision] of [
  ['an HTTP error', new Error('safesearch http 500')],
  ['a timeout', Object.assign(new Error('timeout'), { name: 'TimeoutError' })],
  ['an answer with an error', { responses: [{ error: { code: 3 } }] }],
  ['an UNKNOWN level', level({ adult: 'UNKNOWN', violence: 'UNLIKELY', racy: 'UNLIKELY' })],
] as const) {
  test(`BR-ROTA-008 item 4 (#1116): fail closed, the provider with ${name} gives 503 and nothing is registered or deleted`, async () => {
    const { deps, trail } = fakes({ vision })
    const out = await mod.handleDiaryPhotoRegistration(body(), USER, deps)
    assert.equal(out.status, 503)
    assert.deepEqual(out.body, { error: 'moderation_unavailable' })
    assert.equal(trail.registered.length, 0)
    assert.deepEqual(trail.removed, [])
  })
}

test('#1116: no provider key is 503 before the bucket is even read', async () => {
  const { deps, trail } = fakes()
  const out = await mod.handleDiaryPhotoRegistration(body(), USER, { ...deps, hasApiKey: false })
  assert.equal(out.status, 503)
  assert.equal(trail.read, 0)
  assert.equal(trail.registered.length, 0)
})

for (const [name, over] of [
  ['another user folder', { storageKey: `99999999-2222-4333-8444-555555555555/${DIARY}/${PHOTO}.jpg` }],
  ['a climb out of the folder', { storageKey: `${USER}/../other/${PHOTO}.jpg` }],
  ['the bare folder', { storageKey: `${USER}/` }],
  ['a photo id that is not a uuid', { photoId: 'x' }],
  ['an annotation id that is not a uuid', { annotationId: 1 }],
  ['a time that is not ISO', { takenAt: 'yesterday' }],
] as const) {
  test(`#1116: ${name} is 400 invalid_body, nothing read`, async () => {
    const { deps, trail } = fakes()
    const out = await mod.handleDiaryPhotoRegistration(body(over), USER, deps)
    assert.equal(out.status, 400)
    assert.deepEqual(out.body, { error: 'invalid_body' })
    assert.equal(trail.read, 0)
  })
}

test('#1116: no user behind the token is 401, nothing read', async () => {
  const { deps, trail } = fakes()
  const out = await mod.handleDiaryPhotoRegistration(body(), null, deps)
  assert.equal(out.status, 401)
  assert.equal(trail.read, 0)
})

test('#1116: an object not in the bucket is 409 TGW16, the code the app reads as "upload again"', async () => {
  const { deps, trail } = fakes({ read: 'missing' })
  const out = await mod.handleDiaryPhotoRegistration(body(), USER, deps)
  assert.equal(out.status, 409)
  assert.deepEqual(out.body, { error: 'rpc_refused', code: 'TGW16' })
  assert.equal(trail.classified, 0)
  assert.equal(trail.registered.length, 0)
})

test('#1116: another bucket failure is 503', async () => {
  const { deps } = fakes({ read: new Error('boom') })
  const out = await mod.handleDiaryPhotoRegistration(body(), USER, deps)
  assert.equal(out.status, 503)
})

test('#1116: a format the provider does not read is 422 photo_unsupported, nothing deleted or registered', async () => {
  for (const [over, opts] of [
    [{ storageKey: `${USER}/${DIARY}/${PHOTO}.heic` }, {}],
    [{}, { bytes: new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) }],
    // an animated GIF under a .jpg key: Vision reads only its first frame
    [{}, { bytes: new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0]) }],
    [{}, { bytes: new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]) }],
  ] as const) {
    const { deps, trail } = fakes(opts)
    const out = await mod.handleDiaryPhotoRegistration(body(over), USER, deps)
    assert.equal(out.status, 422)
    assert.deepEqual(out.body, { error: 'photo_unsupported' })
    assert.equal(trail.classified, 0)
    assert.deepEqual(trail.removed, [])
    assert.equal(trail.registered.length, 0)
  }
})

test('#1116: a photo past PHOTO_MODERATION_MAX_BYTES is 422 photo_unsupported', async () => {
  const big = new Uint8Array(moderation.PHOTO_MODERATION_MAX_BYTES + 1)
  big.set([0xff, 0xd8, 0xff])
  const { deps, trail } = fakes({ bytes: big })
  const out = await mod.handleDiaryPhotoRegistration(body(), USER, deps)
  assert.equal(out.status, 422)
  assert.equal(trail.classified, 0)
})

test('#1116: the RPC SQLSTATE TGW16 or TGW19 is 409 rpc_refused with the code; another failure is 503', async () => {
  for (const code of ['TGW16', 'TGW19']) {
    const { deps } = fakes({ register: { ok: false, code } })
    const out = await mod.handleDiaryPhotoRegistration(body(), USER, deps)
    assert.equal(out.status, 409)
    assert.deepEqual(out.body, { error: 'rpc_refused', code })
  }
  const { deps } = fakes({ register: { ok: false, code: '57014' } })
  const out = await mod.handleDiaryPhotoRegistration(body(), USER, deps)
  assert.equal(out.status, 503)
})
