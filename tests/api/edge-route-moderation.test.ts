/**
 * Text filter of user routes in `generate-translated-audio` (#945, BR-ROTA-006), with the LLM
 * mocked: no paid call runs here.
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

const SHARED = resolve(import.meta.dirname, '../../supabase/functions/_shared/route-moderation.ts')
const EF = resolve(import.meta.dirname, '../../supabase/functions/generate-translated-audio/index.ts')

let mod: any

before(async () => {
  mod = await import(pathToFileURL(SHARED).href)
})

function deps(answer: string | Error) {
  const verdicts: Array<{ flagged: boolean; reason: string | null }> = []
  const prompts: string[] = []
  return {
    verdicts,
    prompts,
    deps: {
      runPrompt: async (prompt: string) => {
        prompts.push(prompt)
        if (answer instanceof Error) throw answer
        return answer
      },
      setModerationResult: async (flagged: boolean, reason: string | null) => { verdicts.push({ flagged, reason }) },
    },
  }
}

test('BR-ROTA-006: a clean user route is recorded as not flagged, and its translation comes back', async () => {
  const run = deps('{"name":"Beach route","description":"Along the sea.","flagged":false,"category":null}')
  const out = await mod.translateAndModerateUserRoute({ name: 'Rota da praia', description: 'Pela orla.' }, 'English', 'en', run.deps)
  assert.deepEqual(run.verdicts, [{ flagged: false, reason: null }])
  assert.equal(out.name, 'Beach route')
  assert.equal(out.description, 'Along the sea.')
  assert.match(run.prompts[0], /Rota da praia/)
  assert.match(run.prompts[0], /Pela orla\./, 'the description is screened too')
})

test('BR-ROTA-006: an improper text is flagged with its category', async () => {
  const run = deps('```json\n{"name":"x","description":"y","flagged":true,"category":"third_party_personal_data"}\n```')
  const out = await mod.translateAndModerateUserRoute({ name: 'Casa do João, rua X 12', description: 'tel 9999' }, 'English', 'en', run.deps)
  assert.equal(out.flagged, true)
  assert.deepEqual(run.verdicts, [{ flagged: true, reason: 'third_party_personal_data' }])
})

test('BR-ROTA-006: flagged without a known category keeps the flag', async () => {
  const run = deps('{"name":"x","description":null,"flagged":true,"category":"weird"}')
  await mod.translateAndModerateUserRoute({ name: 'x', description: null }, 'English', 'en', run.deps)
  assert.deepEqual(run.verdicts, [{ flagged: true, reason: 'flagged by the text filter' }])
})

test('BR-ROTA-006: a user route without description is screened by the name alone and goes on', async () => {
  const run = deps('{"name":"Beach route","description":null,"flagged":false,"category":null}')
  const out = await mod.translateAndModerateUserRoute({ name: 'Rota da praia', description: null }, 'English', 'en', run.deps)
  assert.equal(out.description, null)
  assert.deepEqual(run.verdicts, [{ flagged: false, reason: null }])
  assert.doesNotMatch(run.prompts[0], /DESCRIPTION:/)
})

test('BR-ROTA-006: an LLM failure records nothing, so the route stays in review', async () => {
  const run = deps(new Error('All Gemini translation models failed'))
  await assert.rejects(mod.translateAndModerateUserRoute({ name: 'x', description: 'y' }, 'English', 'en', run.deps))
  assert.deepEqual(run.verdicts, [])
})

test('BR-ROTA-006: an answer out of shape is a failure too, and records nothing', async () => {
  for (const answer of ['Beach route', '{"name":"x","flagged":"no"}', '{"name":"","flagged":false}', '{"name":"x","description":null,"flagged":false}']) {
    const run = deps(answer)
    await assert.rejects(mod.translateAndModerateUserRoute({ name: 'x', description: 'has one' }, 'English', 'en', run.deps), answer)
    assert.deepEqual(run.verdicts, [], answer)
  }
})

test('BR-ROTA-006: only a user route is screened', () => {
  assert.equal(mod.isUserRoute({ owner_user_id: 'u' }), true)
  assert.equal(mod.isUserRoute({ owner_user_id: null, metadata: { source: 'user_trip' } }), true)
  assert.equal(mod.isUserRoute({ owner_user_id: null, metadata: { source: 'kml' } }), false)
})

test('#945: the EF wires the filter to set_route_moderation_result and screens the stored text', () => {
  const source = readFileSync(EF, 'utf8')
  assert.match(source, /translateAndModerateUserRoute\(/)
  assert.match(source, /rpc\('set_route_moderation_result', \{\s*p_route_id: routeId, p_flagged: flagged, p_reason: reason,/)
  assert.match(source, /if \(routeData\.userRoute\)/, 'the user-route branch is decided by the stored row')
  assert.match(source, /error\?\.code === '42703'/, 'before the migration owner_user_id is absent and the CMS route path still works')
})

// ── Batch mode: first screening of freshly published user routes (#945) ──────────────────────────

function batchDeps(routes: Array<{ id: string; metadata: Record<string, unknown> | null }>, outcome: Record<string, 'pass' | 'flag' | 'fail'>) {
  const screened: string[] = []
  const attempts: Array<{ id: string; attempts: number }> = []
  const listCalls: Array<{ limit: number; maxAttempts: number }> = []
  return {
    screened,
    attempts,
    listCalls,
    deps: {
      listPending: async (limit: number, maxAttempts: number) => { listCalls.push({ limit, maxAttempts }); return routes.slice(0, limit) },
      screenRoute: async (id: string) => {
        screened.push(id)
        if (outcome[id] === 'fail') throw new Error('All Gemini translation models failed')
        return { flagged: outcome[id] === 'flag' }
      },
      recordFailedAttempt: async (route: { id: string }, n: number) => { attempts.push({ id: route.id, attempts: n }) },
    },
  }
}

test('BR-ROTA-006 batch: an empty queue answers zero counts and screens nothing', async () => {
  const run = batchDeps([], {})
  const out = await mod.handleModerationBatch(true, { mode: 'moderate_pending_user_routes', limit: 20 }, run.deps)
  assert.equal(out.status, 200)
  assert.deepEqual(out.body, { success: true, mode: 'moderate_pending_user_routes', selected: 0, passed: 0, flagged: 0, failed: 0, exhausted: 0 })
  assert.deepEqual(run.listCalls, [{ limit: 20, maxAttempts: 3 }])
})

test('BR-ROTA-006 batch: a clean route passes and an improper one is held, each counted', async () => {
  const run = batchDeps([{ id: 'a', metadata: null }, { id: 'b', metadata: { source: 'user_trip' } }], { a: 'pass', b: 'flag' })
  const out = await mod.handleModerationBatch(true, { mode: 'moderate_pending_user_routes', limit: 20 }, run.deps)
  assert.equal(out.status, 200)
  assert.equal(out.body.passed, 1)
  assert.equal(out.body.flagged, 1)
  assert.equal(out.body.failed, 0)
  assert.deepEqual(run.screened.sort(), ['a', 'b'])
  assert.deepEqual(run.attempts, [], 'a verdict is not a failed attempt')
})

test('BR-ROTA-006 batch: an LLM failure on one route does not stop the batch and counts the attempt', async () => {
  const routes = [
    { id: 'a', metadata: null },
    { id: 'b', metadata: { source: 'user_trip', moderation_attempts: 2 } },
    { id: 'c', metadata: { moderation_attempts: 1 } },
    { id: 'd', metadata: null }, { id: 'e', metadata: null }, { id: 'f', metadata: null },
  ]
  const run = batchDeps(routes, { a: 'fail', b: 'fail', c: 'pass', d: 'pass', e: 'pass', f: 'flag' })
  const out = await mod.handleModerationBatch(true, { mode: 'moderate_pending_user_routes', limit: 20 }, run.deps)
  assert.equal(out.status, 200)
  assert.deepEqual(
    { selected: out.body.selected, passed: out.body.passed, flagged: out.body.flagged, failed: out.body.failed, exhausted: out.body.exhausted },
    { selected: 6, passed: 3, flagged: 1, failed: 2, exhausted: 1 },
  )
  assert.equal(run.screened.length, 6, 'every route of the batch, including the ones after the failures')
  assert.deepEqual(run.attempts.sort((x, y) => x.id.localeCompare(y.id)), [{ id: 'a', attempts: 1 }, { id: 'b', attempts: 3 }])
})

test('BR-ROTA-006 batch: a failure to record the attempt does not stop the batch either', async () => {
  const run = batchDeps([{ id: 'a', metadata: null }, { id: 'b', metadata: null }], { a: 'fail', b: 'pass' })
  run.deps.recordFailedAttempt = async () => { throw new Error('PGRST') }
  const out = await mod.handleModerationBatch(true, { mode: 'moderate_pending_user_routes' }, run.deps)
  assert.equal(out.status, 200)
  assert.equal(out.body.failed, 1)
  assert.equal(out.body.passed, 1)
})

test('BR-ROTA-006 batch: without the service role it is 401 and nothing is read or screened', async () => {
  const run = batchDeps([{ id: 'a', metadata: null }], { a: 'pass' })
  const out = await mod.handleModerationBatch(false, { mode: 'moderate_pending_user_routes', limit: 20 }, run.deps)
  assert.equal(out.status, 401)
  assert.deepEqual(run.listCalls, [])
  assert.deepEqual(run.screened, [])
})

test('BR-ROTA-006 batch: limit is an integer from 1 to 20, and a queue read failure is 503 with no detail', async () => {
  for (const limit of [0, 21, 2.5, '20', null]) {
    const out = await mod.handleModerationBatch(true, { mode: 'moderate_pending_user_routes', limit }, batchDeps([], {}).deps)
    assert.equal(out.status, 400, String(limit))
  }
  const broken = batchDeps([], {})
  broken.deps.listPending = async () => { throw new Error('pending user routes: 42703') }
  const out = await mod.handleModerationBatch(true, { mode: 'moderate_pending_user_routes', limit: 5 }, broken.deps)
  assert.deepEqual(out, { status: 503, body: { error: 'pending_routes_unavailable' } })
})

test('#945: the EF wires the batch mode to the machine key, the queue filters and the shared per-route path', () => {
  const source = readFileSync(EF, 'utf8')
  assert.match(source, /parsedBody\.mode === MODERATION_BATCH_MODE/)
  assert.match(source, /handleModerationBatch\(isServiceRole,/)
  assert.match(source, /const isServiceRole = isOwnMachineKey\(bearer\)/)
  for (const filter of [/\.eq\('status', 'pending_review'\)/, /\.not\('owner_user_id', 'is', null\)/, /\.is\('moderation_reason', null\)/, /\.is\('moderation_reviewed_at', null\)/, /\.order\('created_at', \{ ascending: true \}\)/]) {
    assert.match(source, filter)
  }
  assert.equal(source.match(/const produceRouteTranslation = /g)?.length, 1, 'one per-route path')
  assert.equal(source.match(/produceRouteTranslation\(/g)?.length, 2, 'called by the route mode and by the batch')
  assert.ok(source.indexOf('parsedBody.mode === MODERATION_BATCH_MODE') < source.indexOf('checkRateLimit(req'), 'the batch is decided before the per-request limit')
})
