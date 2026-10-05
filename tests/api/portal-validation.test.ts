/**
 * #812 — the operator's decision on a Portal Locais submission (BR-B2B-049, BR-B2B-047).
 *
 * The parsing and the error mapping run here; the order of the approval's writes and the
 * contract route's refusal are read from the source, because they talk to a database this
 * suite does not have (migration 20261004120000 is not applied yet).
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  PORTAL_REFUSAL_REASONS,
  parsePortalDecision,
  transitionErrorOf,
} from '@/lib/services/portal-validation-service'

const ROOT = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8')

test('#812: approve needs nothing else', () => {
  assert.deepEqual(parsePortalDecision({ action: 'approve' }), { action: 'approve' })
})

test('#812: asking for changes needs a message of at least 10 characters', () => {
  assert.deepEqual(parsePortalDecision({ action: 'request_changes', note: '  curto ' }), { error: 'invalid_note' })
  assert.deepEqual(parsePortalDecision({ action: 'request_changes', note: ' Troque a foto da fachada. ' }), {
    action: 'request_changes',
    note: 'Troque a foto da fachada.',
  })
})

test('#812: refusing needs a reason from the closed list AND a message', () => {
  assert.deepEqual(parsePortalDecision({ action: 'reject', note: 'Endereço não existe.' }), { error: 'invalid_reason' })
  assert.deepEqual(parsePortalDecision({ action: 'reject', reason: 'ineligible' }), { error: 'invalid_note' })
  assert.deepEqual(parsePortalDecision({ action: 'reject', reason: 'made_up', note: 'Endereço não existe.' }), {
    error: 'invalid_reason',
  })
  assert.deepEqual(parsePortalDecision({ action: 'reject', reason: 'duplicate', note: 'Já existe outro cadastro.' }), {
    action: 'reject',
    reason: 'duplicate',
    note: 'Já existe outro cadastro.',
  })
  assert.deepEqual([...PORTAL_REFUSAL_REASONS], ['ineligible', 'duplicate', 'nothing_to_tell', 'irregular_company', 'other'])
})

test('#812: an unknown action or a body that is not an object is refused', () => {
  assert.deepEqual(parsePortalDecision({ action: 'publish' }), { error: 'unknown_action' })
  assert.deepEqual(parsePortalDecision(null), { error: 'invalid_body' })
  assert.deepEqual(parsePortalDecision(['approve']), { error: 'invalid_body' })
})

test('contract §8.3: the state machine SQLSTATEs become the route status', () => {
  assert.deepEqual(transitionErrorOf('TGP10'), { httpStatus: 409, error: 'status_conflict' })
  assert.deepEqual(transitionErrorOf('TGP01'), { httpStatus: 404, error: 'not_found' })
  assert.deepEqual(transitionErrorOf('TGP22'), { httpStatus: 422, error: 'invalid_note' })
  assert.deepEqual(transitionErrorOf(undefined), { httpStatus: 503, error: 'transition_failed' })
})

test('BR-B2B-049 item 7: the POI exists and attraction_id is written BEFORE the approved transition', () => {
  const src = read('lib/services/portal-validation-service.ts')
  const body = src.slice(src.indexOf('async function approveClaimed'))
  const create = body.indexOf('createPrefilledPlace(prefill, operator)')
  const link = body.indexOf('.update({ attraction_id: created.attractionId })')
  const approve = body.indexOf("transition(submission.id, 'approved'")
  assert.ok(create > 0 && link > create && approve > link)
})

test('#812: status is never written by UPDATE — only attraction_id and the approval claim are', () => {
  const src = read('lib/services/portal-validation-service.ts')
  assert.doesNotMatch(src, /update\(\{[^}]*status/)
  assert.match(src, /rpc\('transition_place_submission'/)
})

test('#812: one allowlist each — PROMOTION_MAP for the client, buildPlacePrefill for the place', () => {
  const src = read('lib/services/portal-validation-service.ts')
  assert.match(src, /buildPromotionPlan\(answers, null/)
  assert.match(src, /buildPlacePrefill\(answers\)/)
  assert.match(src, /createPromotedClient\(write\.updates, answers\)/)
})

test('BR-B2B-047 item 1: the contract route refuses to generate for a portal client', () => {
  const src = read('app/api/admin/clients/[clientId]/contract/route.ts')
  const generate = src.slice(src.indexOf('async function generate('))
  const guard = generate.indexOf('await isPortalClient(clientId)')
  assert.ok(guard > 0, 'guard missing')
  // security review: the lookup fails closed — an error refuses instead of generating
  assert.match(generate, /portalClient === null\) \{\s*return NextResponse\.json\(\{ error: 'portal_lookup_failed' \}, \{ status: 503 \}\)/)
  assert.ok(guard < generate.indexOf('loadPlatformOwner()'), 'guard after the generation started')
  assert.match(generate, /portal_skips_contract/)
})
