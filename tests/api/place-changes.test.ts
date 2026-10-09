/**
 * #922: the CMS queue of the portal's photo and text changes (BR-B2B-061 item 2; contract
 * `docs/contracts/portal-fotos-e-texto.md` §5).
 *
 * Pinned here: admin and editor only; refusing requires a reason and writes nothing else;
 * approving a photo copies the private file to `travel-app-images/partners/<attraction>/<request>.<ext>`
 * BEFORE the decision and passes the object path (never a URL); approving a text removes only this
 * place's voiced mp3s, after the decision; a failed cleanup answers 502 and approving again retries;
 * the database refusals map to the route's answers.
 *
 * Run with: npm run test:api
 */

import { test, before, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import type { NextRequest } from 'next/server'

const REQ = '11111111-2222-4333-8444-555555555555'
const ATTR = 'aaaaaaaa-2222-4333-8444-555555555555'
const SUB = 'bbbbbbbb-2222-4333-8444-555555555555'
const PHOTO = `${SUB}/changes/cccccccc-2222-4333-8444-555555555555.jpg`
const CMS_USER = 'cms-1'

type Call = { op: string; args: unknown[] }
let calls: Call[]
let role: string
let request: Record<string, unknown> | null
let rpc: Record<string, { data?: unknown; error?: { code: string; message: string; details?: string } }>
let audioFiles: { name: string }[]
let removeError: unknown
let uploadError: unknown

function client() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = {
    auth: { getUser: async () => ({ data: { user: { id: 'uid-1', email: 'ana@tuggi.app' } }, error: null }) },
    schema: (schema: string) => ({
      from: (table: string) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const q: any = {
          select: () => q,
          eq: (...args: unknown[]) => (calls.push({ op: `${schema}.${table}.eq`, args }), q),
          maybeSingle: async () =>
            table === 'cms_users'
              ? { data: { id: CMS_USER, email: 'ana@tuggi.app', role, is_active: true }, error: null }
              : { data: request, error: null },
        }
        return q
      },
      rpc: async (fn: string, args?: unknown) => {
        calls.push({ op: `rpc ${schema}.${fn}`, args: [args] })
        const a = rpc[fn]
        return { data: a?.data ?? null, error: a?.error ?? null }
      },
    }),
    storage: {
      from: (bucket: string) => ({
        download: async (path: string) => (calls.push({ op: 'download', args: [bucket, path] }), { data: new Blob(['x']), error: null }),
        upload: async (path: string, _b: unknown, opts: unknown) => (calls.push({ op: 'upload', args: [bucket, path, opts] }), { data: {}, error: uploadError }),
        createSignedUrls: async (paths: string[]) => ({ data: paths.map((p) => ({ path: p, signedUrl: `https://signed/${p}` })), error: null }),
        list: async (folder: string) => (calls.push({ op: 'list', args: [bucket, folder] }), { data: audioFiles, error: null }),
        remove: async (paths: string[]) => (calls.push({ op: 'remove', args: [bucket, paths] }), { data: [], error: removeError }),
      }),
    },
  }
  return c
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let list: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let decide: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let lib: any

before(async () => {
  mock.module('next/headers', { namedExports: { cookies: async () => ({ get: () => undefined, getAll: () => [] }) } })
  mock.module('@/lib/core/supabase-client', {
    namedExports: { getSupabaseRouteHandler: () => client(), getSupabaseService: () => client(), getSupabase: () => client() },
  })
  list = await import('@/app/api/admin/clients/changes/route')
  decide = await import('@/app/api/admin/clients/changes/[requestId]/route')
  lib = await import('@/lib/partnerships/place-changes')
})

beforeEach(() => {
  calls = []
  role = 'admin'
  request = { id: REQ, attraction_id: ATTR, kind: 'photo', photo_path: PHOTO }
  rpc = { decide_place_change: { data: [{ outcome: 'approved', request_id: REQ }] } }
  audioFiles = []
  removeError = null
  uploadError = null
})

const post = (body: unknown, id = REQ) => {
  const req = new Request(`http://localhost/api/admin/clients/changes/${id}`, { method: 'POST', body: JSON.stringify(body) }) as unknown as NextRequest
  return decide.POST(req, { params: Promise.resolve({ requestId: id }) })
}
const get = () => list.GET(new Request('http://localhost/api/admin/clients/changes') as unknown as NextRequest, { params: Promise.resolve({}) })
const decision = () => calls.find((c) => c.op === 'rpc partner.decide_place_change')?.args[0] as Record<string, unknown> | undefined

test('BR-B2B-061 · only admin and editor reach the queue and the decision', async () => {
  for (const r of ['viewer', 'client']) {
    role = r
    assert.equal((await get()).status, 403, r)
    assert.equal((await post({ decision: 'approved' })).status, 403, r)
  }
  assert.equal(decision(), undefined)
  role = 'editor'
  rpc.place_change_queue = { data: [] }
  assert.equal((await get()).status, 200)
})

test('BR-B2B-061 item 2 · the queue signs the proposed photo for the side-by-side preview', async () => {
  rpc.place_change_queue = {
    data: [
      { request_id: REQ, submission_id: SUB, attraction_id: ATTR, place_name: 'Casa', city: 'Cabo Frio', kind: 'photo', slot: 0, photo_path: PHOTO, current_value: 'https://air/f.jpg', requested_at: '2026-10-08T12:00:00Z' },
      { request_id: SUB, submission_id: SUB, attraction_id: ATTR, kind: 'text', slot: null, proposed_text: 'Novo', current_value: 'Velho', requested_at: '2026-10-08T13:00:00Z' },
    ],
  }
  const body = await (await get()).json()
  assert.equal(body.changes.length, 2)
  assert.equal(body.changes[0].photoUrl, `https://signed/${PHOTO}`)
  assert.equal(body.changes[0].currentValue, 'https://air/f.jpg')
  assert.equal(body.changes[1].proposedText, 'Novo')
})

test('BR-B2B-061 item 2 · refusing requires a reason; nothing is copied and nothing is removed', async () => {
  const empty = await post({ decision: 'rejected', note: '   ' })
  assert.equal(empty.status, 422)
  assert.equal(decision(), undefined)
  const res = await post({ decision: 'rejected', note: ' A foto está escura. ' })
  assert.equal(res.status, 200)
  assert.deepEqual(decision(), { p_request_id: REQ, p_decision: 'rejected', p_decided_by: CMS_USER, p_note: 'A foto está escura.', p_object_path: null })
  assert.ok(!calls.some((c) => c.op === 'upload' || c.op === 'remove' || c.op === 'download'))
})

test('BR-B2B-061 item 2 · approving a photo copies it to the public bucket first, then decides with the object path', async () => {
  const res = await post({ decision: 'approved' })
  assert.equal(res.status, 200)
  const ops = calls.map((c) => c.op)
  assert.ok(ops.indexOf('upload') < ops.indexOf('rpc partner.decide_place_change'), 'copy before the decision')
  assert.deepEqual(calls.find((c) => c.op === 'download')!.args, ['place-submission-photos', PHOTO])
  assert.deepEqual(calls.find((c) => c.op === 'upload')!.args, ['travel-app-images', `partners/${ATTR}/${REQ}.jpg`, { upsert: true, contentType: 'image/jpeg' }])
  assert.deepEqual(decision(), { p_request_id: REQ, p_decision: 'approved', p_decided_by: CMS_USER, p_note: null, p_object_path: `partners/${ATTR}/${REQ}.jpg` })
  assert.ok(ops.indexOf('rpc core.app_poi_read_build') > ops.indexOf('rpc partner.decide_place_change'))
})

test('BR-B2B-061 item 2 · a copy that fails stops before the decision (502, approve again)', async () => {
  uploadError = { message: 'boom' }
  const res = await post({ decision: 'approved' })
  assert.equal(res.status, 502)
  assert.equal((await res.json()).error, 'publish_failed')
  assert.equal(decision(), undefined)
})

test('BR-B2B-061 item 2 · approving a text removes only THIS place voiced mp3s, after the decision', async () => {
  request = { id: REQ, attraction_id: ATTR, kind: 'text', photo_path: null }
  audioFiles = [{ name: `${ATTR}-pt-br-male.mp3` }, { name: `${ATTR}-en-female.mp3` }, { name: `${SUB}-pt-br-male.mp3` }, { name: `${ATTR}-notes.txt` }]
  const res = await post({ decision: 'approved' })
  assert.equal(res.status, 200)
  assert.deepEqual(decision(), { p_request_id: REQ, p_decision: 'approved', p_decided_by: CMS_USER, p_note: null, p_object_path: null })
  assert.deepEqual(calls.find((c) => c.op === 'list')!.args, ['travel-app-audios', `master_audio/${ATTR}`])
  assert.deepEqual(calls.find((c) => c.op === 'remove')!.args, ['travel-app-audios', [`master_audio/${ATTR}/${ATTR}-pt-br-male.mp3`, `master_audio/${ATTR}/${ATTR}-en-female.mp3`]])
  assert.ok(!calls.some((c) => c.op === 'upload'))
})

test('BR-B2B-061 item 2 · a cleanup that fails answers 502; approving again (unchanged) cleans again', async () => {
  request = { id: REQ, attraction_id: ATTR, kind: 'text', photo_path: null }
  audioFiles = [{ name: `${ATTR}-pt-br-male.mp3` }]
  removeError = { message: 'boom' }
  const first = await post({ decision: 'approved' })
  assert.equal(first.status, 502)
  assert.equal((await first.json()).error, 'audio_cleanup_failed')
  removeError = null
  rpc.decide_place_change = { data: [{ outcome: 'unchanged' }] }
  calls = []
  const again = await post({ decision: 'approved' })
  assert.equal(again.status, 200)
  assert.equal(calls.filter((c) => c.op === 'remove').length, 1)
})

test('BR-B2B-061 · database refusals map to the route', async () => {
  const cases: [string, string | undefined, number, string][] = [
    ['TGP10', 'withdrawn', 409, 'not_pending'],
    ['TGP10', 'submission_status', 409, 'not_live'],
    ['TGP22', 'note', 422, 'note_required'],
    ['TGP22', 'object_path', 502, 'publish_failed'],
    ['TGP01', undefined, 404, 'not_found'],
    ['PGRST202', undefined, 503, 'not_available'],
  ]
  for (const [code, details, status, error] of cases) {
    rpc.decide_place_change = { error: { code, message: 'x', details } }
    const res = await post({ decision: 'rejected', note: 'motivo' })
    assert.equal(res.status, status, code + details)
    assert.equal((await res.json()).error, error)
  }
  request = null
  assert.equal((await post({ decision: 'approved' })).status, 404)
  assert.equal((await post({ decision: 'approved' }, 'not-a-uuid')).status, 400)
  assert.equal((await post({ decision: 'maybe' })).status, 400)
})

test('BR-B2B-061 · pure rules: published path keeps the extension; the audio filter is exact', () => {
  assert.equal(lib.publishedObjectPath(ATTR, REQ, `${SUB}/changes/cccccccc-2222-4333-8444-555555555555.webp`), `partners/${ATTR}/${REQ}.webp`)
  assert.equal(lib.publishedObjectPath(ATTR, REQ, `${SUB}/facade/x.jpg`), null)
  assert.deepEqual(lib.voicedAudioPaths(ATTR, [`${ATTR}-a.mp3`, `x/${ATTR}-b.mp3`, `${ATTR}-c.wav`]), [`master_audio/${ATTR}/${ATTR}-a.mp3`])
  assert.equal(lib.imageContentType('a.png'), 'image/png')
})
