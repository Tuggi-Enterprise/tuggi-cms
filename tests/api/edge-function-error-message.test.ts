/**
 * What the operator reads when an edge function refuses.
 *
 * THE CASE THAT PRODUCED THIS SUITE: a Place created at 22:57 had no description row, the audio
 * tab called `generate-translated-audio` at 22:58, and the function answered 500 with
 * `{"error":"No description found for attraction f2a87010-…"}`. The CMS showed
 * "❌ pt-br (male): Edge Function returned a non-2xx status code" — supabase-js's fixed string
 * for any non-2xx — so the reason never reached the screen. The same click works in POI
 * Management because that surface refuses BEFORE calling, and the request bodies are identical.
 *
 * Two guarantees: the function's own message wins over the generic one, and the audio tab of
 * Places/Events does not call the function without a saved description.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { readEdgeFunctionError } from '@/lib/core/edge-function-error'

const REPO_ROOT = resolve(import.meta.dirname, '../..')

function read(relative: string): string {
  return readFileSync(resolve(REPO_ROOT, relative), 'utf8')
}

function code(relative: string): string {
  return read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

/** A supabase-js `FunctionsHttpError`, as it actually arrives: fixed message, body on `context`. */
function functionsHttpError(body: unknown, status = 500) {
  const error = new Error('Edge Function returned a non-2xx status code') as Error & { context: Response }
  error.context = new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
  return error
}

test('the function message wins over "non-2xx status code"', async () => {
  const error = functionsHttpError({ error: 'No description found for attraction f2a87010.' })
  assert.equal(await readEdgeFunctionError(error), 'No description found for attraction f2a87010.')
})

test('`message` is read when the body has no `error`', async () => {
  assert.equal(await readEdgeFunctionError(functionsHttpError({ message: 'rate limit' })), 'rate limit')
})

test('the body is left readable for whoever holds the same response', async () => {
  const error = functionsHttpError({ error: 'boom' })
  await readEdgeFunctionError(error)
  // Reading a stream twice throws; `readEdgeFunctionError` clones for exactly this reason.
  assert.deepEqual(await error.context.json(), { error: 'boom' })
})

test('an unreadable body falls back to null, never to an empty message', async () => {
  assert.equal(await readEdgeFunctionError(functionsHttpError('<html>502</html>')), null)
  assert.equal(await readEdgeFunctionError(functionsHttpError({ error: '   ' })), null)
  assert.equal(await readEdgeFunctionError(functionsHttpError({ status: 'failed' })), null)
  assert.equal(await readEdgeFunctionError(new Error('no context at all')), null)
  assert.equal(await readEdgeFunctionError(null), null)
})

test('every CMS call to an edge function goes through the reader', () => {
  const hook = code('lib/hooks/useAuthenticatedFunctionCall.ts')
  assert.match(hook, /readEdgeFunctionError/)
  // The generic message stays as the last resort, not as the answer.
  assert.match(hook, /detail \|\| error\.message/)
})

test('the audio tab of Places/Events refuses without a saved description, like POI Management', () => {
  const entity = code('components/entity-management/useEntityContent.ts')
  const guard = entity.slice(entity.indexOf('const regenerateAllAudios'))

  // The precondition is the SAVED row, not the editor buffer: the function translates the most
  // recent row in `core.attraction_descriptions`, and typed-but-unsaved text would still 500.
  assert.match(guard, /hasSavedDescription/)
  assert.match(guard, /\[PROCESSING\]/)
  assert.equal(
    guard.indexOf('hasSavedDescription') < guard.indexOf("callFunction('generate-translated-audio'"),
    true,
    'the guard must run before the call, not after',
  )

  // The surface that already worked keeps its own guard.
  const poi = code('components/poi-management/POIDetailsModal.tsx')
  const poiGuard = poi.slice(poi.indexOf('const regenerateAllAudios'))
  assert.match(poiGuard, /if \(!currentDescription\.trim\(\)\)/)
})

// ── The description between the editor and the bank ──────────────────────────────────────────

test('a description typed but never saved reads as "unsaved", not as "missing"', async () => {
  const { describeDescriptionState, hasSavedDescription } = await import('@/lib/core/description-state')

  // The reported case: the operator generated the text, saw it on screen, never clicked save.
  assert.equal(
    describeDescriptionState({ descriptions: [], currentDescription: 'Texto gerado', originalDescription: '' }),
    'unsaved',
  )

  // Edited on top of a saved row: the audio would use the OLD text, so it is still "unsaved".
  assert.equal(
    describeDescriptionState({
      descriptions: [{ description: 'antigo' }],
      currentDescription: 'novo',
      originalDescription: 'antigo',
    }),
    'unsaved',
  )

  assert.equal(
    describeDescriptionState({ descriptions: [], currentDescription: '', originalDescription: '' }),
    'missing',
  )

  // The lock placeholder is not a description — it is what the generator writes while it runs.
  assert.equal(
    describeDescriptionState({
      descriptions: [{ description: '[PROCESSING]' }],
      currentDescription: '',
      originalDescription: '',
    }),
    'missing',
  )

  // A row in ANOTHER language still counts: the edge function takes the most recent row, any
  // language. Nothing on screen for the current one, so the editor is empty and the bank is not.
  assert.equal(
    describeDescriptionState({
      descriptions: [{ description: 'English text' }],
      currentDescription: '',
      originalDescription: '',
    }),
    'saved',
  )

  assert.equal(hasSavedDescription([{ description: '   ' }, null, undefined]), false)
})

test('the audio tab warns and refuses on the saved row, never on the textarea', () => {
  const tab = code('components/poi-management/tabs/NarrationAudioTab.tsx')

  assert.match(tab, /describeDescriptionState/)
  // Reading the buffer to gate the button is the bug this replaced.
  assert.equal(
    tab.includes("disabled={isGeneratingAudio || isTranslating || (!currentDescription.trim() && !currentAudioUrl)}"),
    false,
    'the button is gated by the textarea again',
  )
  assert.match(tab, /disabled=\{isGeneratingAudio \|\| isTranslating \|\| !canGenerateAudio\}/)
  // Two different sentences: "save it" and "write it" are different jobs for the operator.
  assert.match(tab, /labels\.description_unsaved_warning/)
  assert.match(tab, /labels\.description_missing_warning/)

  for (const locale of ['pt', 'en', 'es']) {
    const labels = JSON.parse(read(`messages/${locale}.json`)).Modals?.POIDetails?.labels
    for (const key of ['description_unsaved_warning', 'description_missing_warning']) {
      assert.equal(typeof labels?.[key], 'string', `${locale} is missing labels.${key}`)
    }
  }
})

// ── Approving does not require content ───────────────────────────────────────────────────────

test('BR-CONTEUDO-004 / BR-POI-006: approval is not gated by description or audio', () => {
  const modal = code('components/poi-management/POIDetailsModal.tsx')
  const approve = modal.slice(modal.indexOf('onClick={handleApprove}'))
  const disabled = approve.slice(approve.indexOf('disabled='), approve.indexOf('className='))

  // Publicado and narrável are different sets by design: content is produced when a user gets
  // close or when an operator asks for it — never as a side effect of approving.
  assert.equal(disabled.includes('currentDescription'), false, 'approval requires a description again')
  assert.equal(disabled.includes('translatedDescriptions'), false, 'approval requires audio again')
  assert.match(disabled, /disabled=\{isSaving\}/)

  // The review panel mirrored the same gate in red. Content is optional, so it informs only.
  const review = code('components/poi-management/tabs/ReviewTab.tsx')
  assert.match(review, /labels\.content_optional_title/)
  assert.equal(review.includes('labels.min_audio_required'), false)
  assert.equal(review.includes('labels.pending_requirements'), false)

  for (const locale of ['pt', 'en', 'es']) {
    const labels = JSON.parse(read(`messages/${locale}.json`)).Modals?.POIDetails?.labels
    for (const key of ['content_optional_title', 'content_optional_hint']) {
      assert.equal(typeof labels?.[key], 'string', `${locale} is missing labels.${key}`)
    }
    // Dropped with the gate: a string nobody renders is a promise nobody keeps.
    for (const key of ['min_audio_required', 'pending_requirements', 'complete_criteria_hint']) {
      assert.equal(labels?.[key], undefined, `${locale} still carries labels.${key}`)
    }
  }
})

test('creating a POI, Event or Place never asks for description or audio', () => {
  // The three create paths, checked at the point where they refuse.
  const place = code('components/place-management/PlaceFormModal.tsx')
  const event = code('components/event-management/EventFormModal.tsx')
  const poi = code('app/api/pois/create-manual/route.ts')

  for (const [name, source] of [['place', place], ['event', event]] as const) {
    const save = source.slice(source.indexOf('const handleSave'), source.indexOf('const L ='))
    assert.equal(/description|audio_url/.test(save), false, `${name} creation asks for content`)
  }
  assert.equal(/!\s*description|description.*required/i.test(poi), false, 'POI creation asks for content')

  const validation = code('lib/core/entity-form-validation.ts')
  assert.equal(validation.includes('description'), false)
  assert.equal(validation.includes('audio'), false)
})
