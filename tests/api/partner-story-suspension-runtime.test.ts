/**
 * #889 — the filters of `suspensionDeps().removeVoicedFiles` (BR-B2B-019 item 7: nothing of the
 * paid description reaches the tourist; item 4: the reach is THIS place only).
 *
 * The Deno runtime file runs for real; its three Edge-only imports are replaced by a recorder that
 * stands in for the admin client. Every case asserts the filters / paths the recorder saw. No
 * database, no bucket, no Edge Function is reached.
 *
 * Run with: npm run test:api
 */

import { test, before, mock } from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const SHARED = path.resolve(process.cwd(), 'supabase/functions/_shared')
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

type Call = { op: string; args: unknown[] }
let calls: Call[] = []
let listing: { name: string }[] = []
let listError: unknown = null
let removeError: unknown = null
let rpcAnswer: { data: unknown; error: unknown } = { data: [], error: null }

const admin = {
  schema: (s: string) => ({
    rpc: async (fn: string, args: unknown) => {
      calls.push({ op: 'rpc', args: [s, fn, args] })
      return rpcAnswer
    },
  }),
  storage: {
    from: (bucket: string) => ({
      list: async (folder: string, opts: unknown) => {
        calls.push({ op: 'storage.list', args: [bucket, folder, opts] })
        return { data: listing, error: listError }
      },
      remove: async (paths: string[]) => {
        calls.push({ op: 'storage.remove', args: [bucket, paths] })
        return { data: [], error: removeError }
      },
    }),
  },
}

// Typed locally and imported by URL so `tsc` (Node) does not follow into the Deno-only graph.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let runtime: { suspensionDeps: () => Record<string, (...args: any[]) => Promise<any>> }

before(async () => {
  const url = (f: string) => pathToFileURL(path.join(SHARED, f)).href
  mock.module(url('supabase-client.ts'), { namedExports: { createAdminClient: () => admin } })
  mock.module(url('places-payment-runtime.ts'), { namedExports: { alert: async () => {} } })
  mock.module(url('read-model.ts'), { namedExports: { rebuildReadModel: async () => {} } })
  runtime = await import(url('places-story-suspension-runtime.ts'))
})

const reset = () => {
  calls = []
  listing = []
  listError = removeError = null
  rpcAnswer = { data: [], error: null }
}

test('BR-B2B-019 item 7 · storage: only master_audio/{id}/{id}-*.mp3 of THIS place is removed, by exact path', async () => {
  reset()
  listing = [
    { name: `${A}-pt-br-male.mp3` },
    { name: `${A}-en-female.mp3` },
    { name: `${B}-pt-br-male.mp3` }, // another place's file in the same folder
    { name: `${A}-notes.txt` }, // not mp3
    { name: 'cover.mp3' }, // no id prefix
    { name: `${A}-x/../${B}-y.mp3` }, // path trick
    { name: `${A}.mp3` }, // no dash after the id
  ]
  await runtime.suspensionDeps().removeVoicedFiles(A)
  const list = calls.find((c) => c.op === 'storage.list')!
  assert.deepEqual(list.args.slice(0, 2), ['travel-app-audios', `master_audio/${A}`])
  const rm = calls.find((c) => c.op === 'storage.remove')!
  assert.deepEqual(rm.args, [
    'travel-app-audios',
    [`master_audio/${A}/${A}-pt-br-male.mp3`, `master_audio/${A}/${A}-en-female.mp3`],
  ])
})

test('BR-B2B-019 item 7 · another place id is not reachable: nothing of B is deleted or removed when A runs', async () => {
  reset()
  listing = [{ name: `${B}-pt-br-male.mp3` }]
  await runtime.suspensionDeps().removeVoicedFiles(A)
  assert.equal(calls.some((c) => c.op === 'storage.remove'), false, 'no matching file: no remove call')
  const touched = JSON.stringify(calls.filter((c) => c.op !== 'storage.list'))
  assert.equal(touched.includes(B), false)
})

test('BR-B2B-019 · id that is not a uuid throws before ANY write', async () => {
  for (const bad of ['', '*', '../x', `${A}/..`, 'not-a-uuid']) {
    reset()
    await assert.rejects(runtime.suspensionDeps().removeVoicedFiles(bad), /not uuid/)
    assert.equal(calls.length, 0, JSON.stringify(bad))
  }
})

test('BR-B2B-019 · errors are thrown (never swallowed): list, remove', async () => {
  reset()
  listError = { message: 'x' }
  await assert.rejects(runtime.suspensionDeps().removeVoicedFiles(A), /audio list failed/)

  reset()
  listing = [{ name: `${A}-pt-br-male.mp3` }]
  removeError = { message: 'x' }
  await assert.rejects(runtime.suspensionDeps().removeVoicedFiles(A), /audio remove failed/)
})

test('#1055 · the three RPCs go to the partner schema with the place id, and their answers are read', async () => {
  reset()
  rpcAnswer = { data: [{ attraction_id: A, state: 'ended', archived: false }, { attraction_id: B, state: 'none', archived: false }], error: null }
  assert.deepEqual(await runtime.suspensionDeps().places(), [{ attractionId: A, state: 'ended', archived: false }])
  rpcAnswer = { data: [{ outcome: 'suspended', archive_id: B }], error: null }
  assert.equal(await runtime.suspensionDeps().suspend(A), 'suspended')
  rpcAnswer = { data: [{ outcome: 'restored', archive_id: B, text_restored: true, images_restored: 2 }], error: null }
  assert.deepEqual(await runtime.suspensionDeps().restore(A), { outcome: 'restored', textRestored: true, imagesRestored: 2 })
  assert.deepEqual(
    calls.filter((c) => c.op === 'rpc').map((c) => c.args),
    [
      ['partner', 'place_paid_content_places', {}],
      ['partner', 'place_suspend_paid_content', { p_attraction_id: A }],
      ['partner', 'place_restore_paid_content', { p_attraction_id: A }],
    ]
  )
})

test('#1055 · an RPC error throws with its code (23503 reaches the alert); an unknown outcome throws', async () => {
  reset()
  rpcAnswer = { data: null, error: { code: '23503' } }
  await assert.rejects(runtime.suspensionDeps().suspend(A), /suspend 23503/)
  await assert.rejects(runtime.suspensionDeps().restore(A), /restore 23503/)
  await assert.rejects(runtime.suspensionDeps().places(), /places read 23503/)
  rpcAnswer = { data: [{ outcome: 'something_else' }], error: null }
  await assert.rejects(runtime.suspensionDeps().suspend(A), /outcome unknown/)
  await assert.rejects(runtime.suspensionDeps().restore(A), /outcome unknown/)
})
