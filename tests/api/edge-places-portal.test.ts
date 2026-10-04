/**
 * #820 / #827 — the two Edge Functions the Portal Locais calls, against
 * `docs/contracts/places-cms.md` (workspace).
 *
 * The pure half (`_shared/place-story-preview.ts`) runs here under Node. The `index.ts` files
 * import supabase-js from esm.sh and cannot be loaded, so what proves the gate and the retry
 * contract there is a static reading of the source — the two halves together.
 *
 * Run with: npm run test:api
 */

import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const FUNCTIONS = resolve(import.meta.dirname, '../../supabase/functions')

type Mod = typeof import('../../supabase/functions/_shared/place-story-preview')
let mod: Mod

before(async () => {
  mod = await import(pathToFileURL(resolve(FUNCTIONS, '_shared/place-story-preview.ts')).href)
})

const ANSWERS = {
  trade_name: 'Bar do Zé',
  category: 'bar_cafe',
  city: 'Búzios',
  district: 'Centro',
  story_founder: 'O Zé abriu em 1978 depois de pescar a vida inteira.',
  story_unique: 'A única roda de samba de segunda-feira da cidade.',
  offer_free: '10% de desconto na primeira cerveja',
  offer_subscriber: 'Porção grátis',
  representative_cpf: '123.456.789-09',
  representative_phone: '22999998888',
  tax_id: '12.345.678/0001-95',
}

test('BR-B2B-053 item 5: no offer, CPF, phone or tax id reaches the story prompt', () => {
  const prompt = mod.buildPlaceStoryPrompt(ANSWERS)!
  assert.ok(prompt.includes('Bar do Zé'))
  assert.ok(prompt.includes('roda de samba'))
  for (const forbidden of ['desconto na primeira', 'Porção grátis', '123.456.789', '22999998888', '0001-95']) {
    assert.ok(!prompt.includes(forbidden), `prompt carried ${forbidden}`)
  }
})

test('BR-B2B-051 item 4: ~15 s ceiling and facts only, written into the prompt', () => {
  const prompt = mod.buildPlaceStoryPrompt(ANSWERS)!
  assert.match(prompt, new RegExp(`No máximo ${mod.PLACE_STORY_MAX_WORDS} palavras`))
  assert.match(prompt, /Não invente/)
  assert.equal(mod.PLACE_STORY_MAX_WORDS, 40)
})

test('BR-B2B-051 item 4: Gemini 2.5 Flash-Lite and a pt-BR Standard voice, pinned', () => {
  assert.equal(mod.PLACE_STORY_MODEL, 'gemini-2.5-flash-lite')
  assert.match(mod.PLACE_STORY_VOICE, /^pt-BR-Standard-[A-Z]$/)
  assert.equal(mod.PLACE_STORY_LANGUAGE, 'pt-BR')
})

test('a submission with no trade name has no prompt', () => {
  assert.equal(mod.buildPlaceStoryPrompt({ city: 'Búzios' }), null)
  assert.equal(mod.buildPlaceStoryPrompt({ trade_name: '   ' }), null)
})

test('a field is capped and its whitespace collapsed', () => {
  const inputs = mod.storyInputs({ trade_name: 'A\n\n  B', story_event: 'x'.repeat(2000) })
  assert.deepEqual(inputs[0], ['Nome do local', 'A B'])
  assert.equal(inputs[1][1].length, 600)
})

test('cleanStoryText strips quotes and markdown the model adds', () => {
  assert.equal(mod.cleanStoryText('"**Bar do Zé**, desde 1978."\n'), 'Bar do Zé, desde 1978.')
})

test('cost: Flash-Lite tokens plus Standard characters, in micro-USD, rounded up', () => {
  // 300 in × 0.1 + 60 out × 0.4 + 250 chars × 4 = 30 + 24 + 1000
  assert.equal(mod.placeStoryCostMicros({ inputTokens: 300, outputTokens: 60, ttsCharacters: 250 }), 1054)
  assert.equal(mod.placeStoryCostMicros({ inputTokens: 1, outputTokens: 0, ttsCharacters: 0 }), 1)
})

test('story-preview request: a uuid generation_id and nothing else', () => {
  const id = '3f2a9c1e-8b4d-4e2f-9a7b-1c2d3e4f5a6b'
  assert.deepEqual(mod.parseStoryPreviewRequest({ generation_id: id }), { generationId: id })
  assert.deepEqual(mod.parseStoryPreviewRequest({ generation_id: id.toUpperCase() }), { generationId: id })
  assert.equal(mod.parseStoryPreviewRequest({ generation_id: 'abc' }), null)
  assert.equal(mod.parseStoryPreviewRequest({}), null)
  assert.equal(mod.parseStoryPreviewRequest(null), null)
  assert.equal(mod.parseStoryPreviewRequest([id]), null)
})

test('movement request: finite numbers in range; strings refused', () => {
  assert.deepEqual(mod.parseMovementRequest({ lat: -22.75, lng: -41.88 }), { lat: -22.75, lng: -41.88 })
  assert.equal(mod.parseMovementRequest({ lat: '-22.75', lng: -41.88 }), null)
  assert.equal(mod.parseMovementRequest({ lat: 91, lng: 0 }), null)
  assert.equal(mod.parseMovementRequest({ lat: 0, lng: -181 }), null)
  assert.equal(mod.parseMovementRequest({ lat: Number.NaN, lng: 0 }), null)
})

test('movement response: no data means people_count null, whatever the row says', () => {
  assert.deepEqual(
    mod.shapeMovementResponse({ has_data: false, people_count: 42, radius_m: 300, window_days: 30 }),
    { has_data: false, people_count: null, radius_m: 300, window_days: 30 }
  )
  assert.deepEqual(
    mod.shapeMovementResponse({ has_data: true, people_count: 512, radius_m: 300, window_days: 30 }),
    { has_data: true, people_count: 512, radius_m: 300, window_days: 30 }
  )
})

function source(name: string): string {
  return readFileSync(resolve(FUNCTIONS, name, 'index.ts'), 'utf8')
}

for (const name of ['places-movement', 'places-story-preview']) {
  test(`${name}: the secret gate runs before the body is read or the database is touched`, () => {
    const src = source(name)
    const gate = src.indexOf('isPlacesSecret(req.headers.get(PLACES_SECRET_HEADER))')
    assert.ok(gate > 0, 'gate missing')
    assert.ok(gate < src.indexOf('req.json()'), 'body read before the gate')
    assert.ok(gate < src.indexOf('createAdminClient()'), 'database before the gate')
    assert.match(src, /json\(401, \{ error: 'unauthorized' \}\)/)
  })
}

test('places-story-preview: 409 when already generated, and the write is conditional on null', () => {
  const src = source('places-story-preview')
  assert.match(src, /generation\.output_text !== null\) return json\(409/)
  assert.match(src, /\.is\('output_text', null\)/)
})

test('BR-B2B-051 item 6: a provider failure answers 502 before any write', () => {
  const src = source('places-story-preview')
  const failure = src.indexOf("console.error(\n      '[places-story-preview] provider failed'")
  const write = src.indexOf('.update({')
  assert.ok(failure > 0 && write > 0)
  assert.ok(failure < write, 'the failure path must return before the update')
})
