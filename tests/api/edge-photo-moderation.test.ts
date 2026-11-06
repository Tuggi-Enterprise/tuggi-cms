/**
 * Photo screening of a user route version, `moderate-route-photos` (#1106, BR-ROTA-006 item 3):
 * OpenAI `omni-moderation-latest`, one photo per request, by signed URL. A flagged photo is
 * SIGNALLED and blocks nothing. The provider is mocked: no call leaves the process.
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

const SHARED = resolve(import.meta.dirname, '../../supabase/functions/_shared/photo-moderation.ts')
const EF = resolve(import.meta.dirname, '../../supabase/functions/moderate-route-photos/index.ts')
const REVISION_ID = '11111111-2222-4333-8444-555555555555'

let mod: any

before(async () => {
  mod = await import(pathToFileURL(SHARED).href)
})

const REVISION = {
  stops: [
    { kind: 'annotation', ref: 'a1', photo_keys: ['u/d/p1.jpg', 'u/d/p2.jpg'] },
    { kind: 'poi', ref: 'x', photo_keys: [] },
    { kind: 'annotation', ref: 'a2', photo_keys: ['u/d/p3.heic'] },
  ],
  cover_photo_key: 'u/d/p1.jpg',
}

function deps(answers: Record<string, unknown | Error>) {
  const signed: string[] = []
  const classified: string[] = []
  return {
    signed,
    classified,
    deps: {
      hasApiKey: true,
      readRevision: async () => REVISION,
      sign: async (key: string) => { signed.push(key); return `https://signed.test/${key}?token=t` },
      classify: async (url: string) => {
        classified.push(url)
        const key = url.replace('https://signed.test/', '').replace('?token=t', '')
        const answer = answers[key]
        if (answer instanceof Error) throw answer
        return mod.parseModerationResponse(answer)
      },
    },
  }
}

const clean = { results: [{ flagged: false, categories: { sexual: false, violence: false } }] }
const sexual = { results: [{ flagged: true, categories: { sexual: true, violence: false, 'violence/graphic': true } }] }

test('BR-ROTA-006 item 3 (#1106): a flagged photo comes back signalled with its categories, and the answer is still 200', async () => {
  const run = deps({ 'u/d/p1.jpg': clean, 'u/d/p2.jpg': sexual })
  const out = await mod.handlePhotoModeration({ revisionId: REVISION_ID }, run.deps)
  assert.equal(out.status, 200)
  assert.equal(out.body.model, 'omni-moderation-latest')
  assert.deepEqual(out.body.photos, [
    { key: 'u/d/p1.jpg', status: 'clean', categories: [] },
    { key: 'u/d/p2.jpg', status: 'flagged', categories: ['sexual', 'violence/graphic'] },
    { key: 'u/d/p3.heic', status: 'unchecked', categories: [] },
  ])
  assert.equal(Object.keys(out.body).includes('blocked'), false, 'the filter decides nothing')
})

test('#1106: each photo is its own request, once each (the cover repeats a stop photo), by signed URL', async () => {
  const run = deps({ 'u/d/p1.jpg': clean, 'u/d/p2.jpg': clean })
  await mod.handlePhotoModeration({ revisionId: REVISION_ID }, run.deps)
  assert.deepEqual(run.signed.sort(), ['u/d/p1.jpg', 'u/d/p2.jpg'])
  assert.equal(run.classified.length, 2)
  assert.deepEqual(mod.buildModerationBody('https://signed.test/x'), {
    model: 'omni-moderation-latest',
    input: [{ type: 'image_url', image_url: { url: 'https://signed.test/x' } }],
  })
})

test('#1106: a provider failure or an answer out of shape leaves the photo unchecked, never clean', async () => {
  const run = deps({ 'u/d/p1.jpg': new Error('moderation http 500'), 'u/d/p2.jpg': { results: [] } })
  const out = await mod.handlePhotoModeration({ revisionId: REVISION_ID }, run.deps)
  assert.deepEqual(out.body.photos.map((p: { status: string }) => p.status), ['unchecked', 'unchecked', 'unchecked'])
})

test('#1106: bad id is 400, no key is 503, unknown version is 404, before any photo is signed', async () => {
  const run = deps({})
  assert.equal((await mod.handlePhotoModeration({ revisionId: 'x' }, run.deps)).status, 400)
  assert.equal((await mod.handlePhotoModeration({ revisionId: REVISION_ID }, { ...run.deps, hasApiKey: false })).status, 503)
  assert.equal((await mod.handlePhotoModeration({ revisionId: REVISION_ID }, { ...run.deps, readRevision: async () => null })).status, 404)
  assert.deepEqual(run.signed, [])
})

test('#1106: the EF is admin only, keeps the key in its secret, signs short and logs no key', () => {
  const source = readFileSync(EF, 'utf8')
  assert.match(source, /const admin = await requireAdmin\(req\);\s*if \(admin instanceof Response\) return admin;/)
  assert.ok(source.indexOf('requireAdmin(req)') < source.indexOf('createSignedUrl'), 'gate before any photo')
  assert.match(source, /Deno\.env\.get\('OPENAI_API_KEY'\)/)
  assert.match(source, /createSignedUrl\(key, PHOTO_SIGNED_URL_TTL_S\)/)
  assert.equal(mod.PHOTO_SIGNED_URL_TTL_S <= 300, true, 'a short-lived URL')
  const logs = source.match(/console\.\w+\([^;]*\);/g) ?? []
  for (const line of logs) assert.doesNotMatch(line, /key|url|photo\b/i, line)
})
