/**
 * #889 — the filters of `suspensionDeps().removeVoicedCopies` (BR-B2B-019 item 7: nothing of the
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
let deleteError: unknown = null
let removeError: unknown = null

// A chain that records every filter and answers a DELETE / a storage call from the knobs above.
function chain(table: string) {
  const self: Record<string, unknown> = {}
  for (const m of ['delete', 'update', 'select', 'eq', 'neq', 'or', 'in', 'not', 'maybeSingle']) {
    self[m] = (...args: unknown[]) => {
      calls.push({ op: `${table}.${m}`, args })
      return self
    }
  }
  self.then = (res: (v: unknown) => unknown) => res({ data: [], error: deleteError })
  return self
}

const admin = {
  schema: (s: string) => ({ from: (t: string) => chain(`${s}.${t}`), rpc: async () => ({ data: true, error: null }) }),
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
  listError = deleteError = removeError = null
}

test('BR-B2B-019 item 7 · DELETE always carries attraction_id and spares the base row (language/gender)', async () => {
  reset()
  await runtime.suspensionDeps().removeVoicedCopies(A)
  const names = calls.map((c) => c.op)
  assert.deepEqual(names.slice(0, 3), ['core.attraction_descriptions.delete', 'core.attraction_descriptions.eq', 'core.attraction_descriptions.or'])
  const eq = calls.find((c) => c.op === 'core.attraction_descriptions.eq')!
  assert.deepEqual(eq.args, ['attraction_id', A], 'never a DELETE without the place filter')
  const or = calls.find((c) => c.op === 'core.attraction_descriptions.or')!
  assert.equal(or.args[0], 'language.neq.pt-br,gender.neq.male', 'the base row is not matched')
  assert.equal(calls.some((c) => c.op === 'core.attraction_descriptions.update'), false)
})

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
  await runtime.suspensionDeps().removeVoicedCopies(A)
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
  await runtime.suspensionDeps().removeVoicedCopies(A)
  assert.equal(calls.some((c) => c.op === 'storage.remove'), false, 'no matching file: no remove call')
  const touched = JSON.stringify(calls.filter((c) => c.op !== 'storage.list'))
  assert.equal(touched.includes(B), false)
})

test('BR-B2B-019 · id that is not a uuid throws before ANY write', async () => {
  for (const bad of ['', '*', '../x', `${A}/..`, 'not-a-uuid']) {
    reset()
    await assert.rejects(runtime.suspensionDeps().removeVoicedCopies(bad), /not uuid/)
    assert.equal(calls.length, 0, JSON.stringify(bad))
  }
})

test('BR-B2B-019 · errors are thrown (never swallowed): delete, list, remove', async () => {
  reset()
  deleteError = { code: '42501' }
  await assert.rejects(runtime.suspensionDeps().removeVoicedCopies(A), /copies delete/)
  assert.equal(calls.some((c) => c.op.startsWith('storage')), false, 'a failed DELETE stops before storage')

  reset()
  listError = { message: 'x' }
  await assert.rejects(runtime.suspensionDeps().removeVoicedCopies(A), /audio list failed/)

  reset()
  listing = [{ name: `${A}-pt-br-male.mp3` }]
  removeError = { message: 'x' }
  await assert.rejects(runtime.suspensionDeps().removeVoicedCopies(A), /audio remove failed/)
})

test('BR-B2B-019 · writeBase is a conditional UPDATE: keyed by place, base language/gender AND fromKind', async () => {
  reset()
  await runtime.suspensionDeps().writeBase(A, 'partner_story_script', {
    description: 'Bar do Zé',
    audio_url: null,
    updated_at: 'x',
    verification_status: 'approved',
    generation_meta: { kind: 'partner_name_only' },
  })
  const eqs = calls.filter((c) => c.op === 'core.attraction_descriptions.eq').map((c) => c.args)
  assert.deepEqual(eqs, [
    ['attraction_id', A],
    ['language', 'pt-br'],
    ['gender', 'male'],
    ['generation_meta->>kind', 'partner_story_script'],
  ])
})
