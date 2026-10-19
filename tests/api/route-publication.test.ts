/**
 * `lib/routes/route-publication.ts` (#945): the shape of what the CMS sends about a route's
 * publication and how it reads the review queue. The database decides; these pin the reading.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyPublicationError, dateInputToInstant, hasPublicationColumns, instantToDateInput, isUserRoute,
  moderationStatus, openReports, parseRoutePublication, reviewQueueIds, routeAvailability, routeLink,
} from '@/lib/routes/route-publication'

const NOW = new Date('2026-10-18T12:00:00.000Z')

test('BR-ROTA-007: availability mirrors core.custom_route_availability, in its order', () => {
  const base = { status: 'active', is_active: true, valid_from: null, valid_until: null }
  assert.equal(routeAvailability(base, NOW), 'ok')
  assert.equal(routeAvailability({ ...base, status: 'removed_by_moderation', is_active: false }, NOW), 'removed_by_moderation')
  assert.equal(routeAvailability({ ...base, is_active: false }, NOW), 'removed_by_author')
  assert.equal(routeAvailability({ ...base, status: 'removed_by_author' }, NOW), 'removed_by_author')
  assert.equal(routeAvailability({ ...base, status: 'pending_review', valid_until: '2026-01-01T00:00:00Z' }, NOW), 'pending_review')
  assert.equal(routeAvailability({ ...base, valid_until: '2026-10-17T00:00:00Z' }, NOW), 'expired')
  assert.equal(routeAvailability({ ...base, valid_from: '2026-10-19T00:00:00Z' }, NOW), 'not_yet_valid')
})

test('BR-ROTA-003: visibility is public or link_only, nothing else', () => {
  assert.deepEqual(parseRoutePublication({ visibility: 'link_only' }), { params: { p_visibility: 'link_only' } })
  assert.deepEqual(parseRoutePublication({ visibility: 'private' }), { error: 'visibility_invalid' })
  assert.deepEqual(parseRoutePublication({}), { params: {} })
})

test('BR-ROTA-004: validity travels as a pair; an end on or before the start is refused', () => {
  const ok = parseRoutePublication({ valid_until: '2026-11-01T00:00:00.000Z' })
  assert.deepEqual(ok, { params: { p_set_validity: true, p_valid_from: null, p_valid_until: '2026-11-01T00:00:00.000Z' } })
  assert.deepEqual(
    parseRoutePublication({ valid_from: '2026-11-01T00:00:00Z', valid_until: '2026-11-01T00:00:00Z' }),
    { error: 'validity_invalid' },
  )
  assert.deepEqual(parseRoutePublication({ valid_from: 'amanhã' }), { error: 'validity_invalid' })
})

test('BR-ROTA-004: a date input covers the whole day in the browser zone, and reads back the same day', () => {
  const from = dateInputToInstant('2026-10-20', 'start')!
  const until = dateInputToInstant('2026-10-20', 'end')!
  assert.ok(Date.parse(until) > Date.parse(from), 'one same-day validity is valid (until > from in the CHECK)')
  assert.equal(instantToDateInput(from), '2026-10-20')
  assert.equal(instantToDateInput(until), '2026-10-20')
  assert.equal(dateInputToInstant('', 'start'), null)
})

test('BR-ROTA-005: the slug follows the format of the database, and the link is tuggi.app/r/<slug>', () => {
  assert.deepEqual(parseRoutePublication({ slug: ' rota-da-praia-2 ' }), { params: { p_slug: 'rota-da-praia-2' } })
  for (const bad of ['Rota', 'rota--praia', '-rota', 'rota_praia', '', 'a'.repeat(81)]) {
    assert.deepEqual(parseRoutePublication({ slug: bad }), { error: 'slug_invalid' }, bad)
  }
  assert.equal(routeLink('rota-da-praia'), 'https://tuggi.app/r/rota-da-praia')
})

test('BR-ROTA-005/007: refusals of the RPC become field errors', () => {
  assert.equal(classifyPublicationError({ code: 'TGW09', message: 'Route slug x already belongs to another route' }), 'slug_taken')
  assert.equal(classifyPublicationError({ code: 'TGW09', message: 'Invalid route slug' }), 'slug_invalid')
  assert.equal(classifyPublicationError({ code: '23505', message: 'custom_routes_slug_key' }), 'slug_taken')
  assert.equal(classifyPublicationError({ code: 'TGW10', message: 'stays removed' }), 'route_removed_by_author')
  assert.equal(classifyPublicationError({ code: '42501', message: 'nope' }), null)
})

test('BR-ROTA-006: a user route is the owner or the trip source; removal is a status', () => {
  assert.equal(isUserRoute({ owner_user_id: 'u' }), true)
  assert.equal(isUserRoute({ owner_user_id: null, metadata: { source: 'user_trip' } }), true)
  assert.equal(isUserRoute({ owner_user_id: null, metadata: { source: 'osrm' } }), false)
  assert.equal(moderationStatus('remove'), 'removed_by_moderation')
  assert.equal(moderationStatus('approve'), 'active')
  assert.equal(moderationStatus('restore'), 'active')
})

test('#945: the publication controls exist only when the row has the columns', () => {
  assert.equal(hasPublicationColumns({ id: 'r', name: 'x' }), false)
  assert.equal(hasPublicationColumns({ id: 'r', status: 'active' }), true)
  assert.equal(hasPublicationColumns(null), false)
})

test('BR-ROTA-006: reports filed before the last admin decision are closed', () => {
  const reports = [
    { route_id: 'a', reason: 'spam', created_at: '2026-10-10T00:00:00Z' },
    { route_id: 'a', reason: 'ofensa', created_at: '2026-10-15T00:00:00Z' },
    { route_id: 'a', reason: 'ofensa', created_at: '2026-10-16T00:00:00Z' },
    { route_id: 'a', reason: null, created_at: '2026-10-17T00:00:00Z' },
  ]
  assert.deepEqual(openReports(reports, null), { count: 4, reasons: ['ofensa', 'spam'] })
  assert.deepEqual(openReports(reports, '2026-10-12T00:00:00Z'), { count: 3, reasons: ['ofensa'] })
  assert.deepEqual(openReports(reports, '2026-10-18T00:00:00Z'), { count: 0, reasons: [] })
})

test('BR-ROTA-006: the queue is pending_review plus live routes with open reports; removed ones leave it', () => {
  const pending = [{ id: 'p', status: 'pending_review', moderation_reviewed_at: null }]
  const reported = [
    { id: 'live', status: 'active', moderation_reviewed_at: null },
    { id: 'approved', status: 'active', moderation_reviewed_at: '2026-10-18T00:00:00Z' },
    { id: 'gone', status: 'removed_by_moderation', moderation_reviewed_at: null },
    { id: 'p', status: 'pending_review', moderation_reviewed_at: null },
  ]
  const reports = ['live', 'approved', 'gone', 'p'].map((route_id) => ({ route_id, reason: 'x', created_at: '2026-10-17T00:00:00Z' }))
  assert.deepEqual(reviewQueueIds(pending, reported, reports).sort(), ['live', 'p'])
})
