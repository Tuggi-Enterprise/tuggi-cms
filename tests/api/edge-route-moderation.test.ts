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
