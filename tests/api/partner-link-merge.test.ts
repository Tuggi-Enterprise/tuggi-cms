/**
 * #885 — linking the client to a POI the catalogue already carries brings the registration with it
 * (BR-B2B-033, item 5), and `Puxar dados do cadastro` does the same for a place linked earlier.
 *
 * The REAL `mergePlacePrefill`, `applyPlacePrefill`, `mergeRegistrationIntoPlace`,
 * `portalRegistrationOfPlace`, `applyPartnerPlaceDescription` and both routes run; only the database
 * is faked (`setup/fake-catalogue-place-db.ts` + the #888 description fake). Every case asserts what
 * was left on the POI or what left the process, not which function was called.
 *
 * Rules: BR-B2B-033 item 5 (the catalogue wins on identity, the partner on the operational facts,
 * tags unite, idempotent), BR-B2B-016 (tier → description; never over an existing one),
 * BR-B2B-025 (the text is the partner's), BR-B2B-011 (nothing here approves), BR-B2B-033 item 3
 * (1 place : 1 owner — the `.is('partner_client_id', null)` race guard).
 *
 * Mutations that turn this suite red: the merge overwriting the catalogue's name or pin; tags
 * replaced instead of united; the race guard dropped; the link failing because the merge failed;
 * `PULL_PARTNER_REGISTRATION` audited on a non-merge; `country`/`place_type` written.
 *
 * Run with: npm run test:api
 */

import { test, before, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { NextRequest } from 'next/server'

import {
  CATALOGUE_WINS_COLUMNS,
  PLACE_PREFILL_NEVER_WRITES,
  buildPlacePrefill,
  mergePlacePrefill,
  placePrefillIsClosed,
  type CataloguePlace,
} from '@/lib/partner-form/place-prefill'
import type { PartnerAnswers } from '@/lib/partner-form/schema'
import { CLIENT, OTHER_CLIENT, POI, freshWorld, operatorOf, serviceOf, type World } from './setup/fake-catalogue-place-db'

const root = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

const HOURS = JSON.stringify({ monday: [{ open: '12:00', close: '23:00' }] })
const STORY = 'Meu avô Aurélio abriu a cantina em 1962, no galpão do antigo mercado de peixe.'

/** The portal's answers: the old form's plus the portal keys (contract §8.1). */
function answers(over: PartnerAnswers = {}): PartnerAnswers {
  return {
    trade_name: 'BAIRES BISTRO',
    category: 'restaurant',
    address: 'Rua das Pedras',
    address_number: '120',
    district: 'Centro',
    postal_code: '28950-000',
    city: 'Búzios',
    state: 'RJ',
    opening_hours: HOURS,
    lat: '-22.75',
    lng: '-41.88',
    amenities: JSON.stringify(['wifi', 'parking', 'pet_friendly']),
    subtypes: JSON.stringify(['bistro']),
    ...over,
  }
}

const prefillOf = (a: PartnerAnswers = answers()) => {
  const p = buildPlacePrefill(a)
  assert.ok(p)
  return p
}

const emptyCatalogue = (over: Partial<CataloguePlace> = {}): CataloguePlace => ({
  identity: {},
  tags: null,
  hasCoordinate: false,
  ...over,
})

// ── 1 · the pure merge ──────────────────────────────────────────────────────────────────────

test('BR-B2B-033 item 5 · the catalogue keeps its name and pin; the partner brings hours; coordinate is not written', () => {
  const write = mergePlacePrefill(
    prefillOf(),
    emptyCatalogue({
      identity: { name: 'Baires Bistrô', city: 'Búzios', state: 'Rio de Janeiro' },
      hasCoordinate: true,
    })
  )
  assert.equal('name' in write.attraction, false, 'BAIRES BISTRO must not replace Baires Bistrô')
  assert.equal('city' in write.attraction, false)
  assert.equal('state' in write.attraction, false)
  assert.deepEqual(write.attraction.opening_hours, { monday: [{ open: '12:00', close: '23:00' }] })
  assert.equal(write.coordinate, null, 'the catalogue already has a pin')
})

test('BR-B2B-033 item 5 · an empty address / postal code on the catalogue is filled by the partner; a filled one is kept', () => {
  const filled = mergePlacePrefill(prefillOf(), emptyCatalogue({ identity: { name: 'Baires Bistrô', formatted_address: '  ', postal_code: null } }))
  assert.equal(filled.attraction.postal_code, '28950-000')
  assert.ok(filled.attraction.formatted_address, 'blank (whitespace) counts as empty')

  const kept = mergePlacePrefill(
    prefillOf(),
    emptyCatalogue({ identity: { formatted_address: 'Av. Curada, 1', postal_code: '28900-000' } })
  )
  assert.equal('formatted_address' in kept.attraction, false)
  assert.equal('postal_code' in kept.attraction, false)
})

test('BR-B2B-033 item 5 · no catalogue pin → the partner pin is written once', () => {
  const write = mergePlacePrefill(prefillOf(), emptyCatalogue({ hasCoordinate: false }))
  assert.deepEqual(write.coordinate, { latitude: -22.75, longitude: -41.88 })
})

test('BR-B2B-033 item 5 · tags are the union, order stable, no duplicate: [a,b] + [b,c] = [a,b,c]', () => {
  const prefill = prefillOf()
  prefill.details.tags = ['b', 'c']
  const write = mergePlacePrefill(prefill, emptyCatalogue({ tags: ['a', 'b'] }))
  assert.deepEqual(write.details.tags, ['a', 'b', 'c'])
})

test('BR-B2B-033 item 5 · country and place_type are never written, and nothing on the never-written list is', () => {
  const write = mergePlacePrefill(prefillOf(), emptyCatalogue())
  for (const column of ['country', 'place_type', ...PLACE_PREFILL_NEVER_WRITES]) {
    assert.equal(column in write.attraction, false, `${column} reached the merge`)
    assert.equal(column in write.details, false, `${column} reached the details`)
  }
  assert.equal((CATALOGUE_WINS_COLUMNS as readonly string[]).includes('country'), false)
})

// ── 2 · idempotence, pure ───────────────────────────────────────────────────────────────────

test('BR-B2B-033 item 5 · merging over its own result writes the same thing', () => {
  const prefill = prefillOf()
  const first = mergePlacePrefill(prefill, emptyCatalogue({ identity: { name: 'Baires Bistrô' }, tags: ['a'], hasCoordinate: true }))
  // The catalogue after the first write: identity filled, tags united, pin as before.
  const after: CataloguePlace = {
    identity: {
      name: 'Baires Bistrô',
      formatted_address: first.attraction.formatted_address as string,
      postal_code: first.attraction.postal_code as string,
      street_name: first.attraction.street_name as string,
      house_number: first.attraction.house_number as string,
      neighborhood: first.attraction.neighborhood as string,
      city: 'Búzios',
      state: 'Rio de Janeiro',
    },
    tags: first.details.tags as string[],
    hasCoordinate: true,
  }
  const second = mergePlacePrefill(prefill, after)
  const operational = (w: typeof first) =>
    Object.fromEntries(Object.entries(w.attraction).filter(([k]) => !(CATALOGUE_WINS_COLUMNS as readonly string[]).includes(k)))
  assert.deepEqual(operational(second), operational(first))
  assert.deepEqual(second.details, first.details)
  assert.equal(second.coordinate, null)
})

// ── 3 · the allowlist stays closed ──────────────────────────────────────────────────────────

test('BR-B2B-011 · BR-B2B-010 · placePrefillIsClosed() is still true after the merge columns', () => {
  assert.equal(placePrefillIsClosed(), true)
})

// ── the service, with the fake database ─────────────────────────────────────────────────────

let w: World
let svc: typeof import('@/lib/services/partner-place-provisioning')
let linkRoute: typeof import('@/app/api/admin/partnerships/clients/[clientId]/places/link/route')
let registrationRoute: typeof import('@/app/api/admin/partnerships/clients/[clientId]/places/[attractionId]/registration/route')
let audits: { action: string; entityId: string; description: string }[]

before(async () => {
  mock.module('next/headers', {
    namedExports: { cookies: async () => ({ get: () => undefined, getAll: () => [] }) },
  })
  mock.module('@/lib/core/supabase-client', {
    namedExports: {
      getSupabaseRouteHandler: () => operatorOf(w),
      getSupabaseService: () => serviceOf(w),
      getSupabase: () => serviceOf(w),
      getSupabaseClient: () => ({}),
    },
  })
  mock.module('@/lib/services/audit-service', {
    namedExports: {
      logAuditEvent: async (input: { action: string; entityId: string; description: string }) => {
        audits.push({ action: input.action, entityId: input.entityId, description: input.description })
      },
    },
  })
  svc = await import('@/lib/services/partner-place-provisioning')
  linkRoute = await import('@/app/api/admin/partnerships/clients/[clientId]/places/link/route')
  registrationRoute = await import('@/app/api/admin/partnerships/clients/[clientId]/places/[attractionId]/registration/route')
})

beforeEach(() => {
  w = freshWorld()
  audits = []
})

const merge = () => svc.mergeRegistrationIntoPlace(CLIENT, POI, operatorOf(w))
const linked = () => (w.attraction!.partner_client_id = CLIENT)
const attractionWrites = () => w.writes.filter((x) => x.table === 'attractions')

test('BR-B2B-033 item 5 · BR-B2B-016 · the merge on a linked POI: identity kept, hours in, pin untouched, description is the name', async () => {
  linked()
  w.portal = { id: 'sub-1', answers: answers() }
  w.details = { tags: ['seafood'] }

  const out = await merge()

  assert.deepEqual(out, { status: 'merged', attractionId: POI, prefill: 'applied', description: 'written' })
  assert.equal(w.attraction!.name, 'Baires Bistrô')
  assert.deepEqual(w.attraction!.opening_hours, { monday: [{ open: '12:00', close: '23:00' }] })
  assert.equal(w.attraction!.postal_code, '28950-000')
  assert.equal(w.attraction!.partner_client_id, CLIENT)
  assert.equal(w.attraction!.approved, true, 'BR-B2B-011: the merge does not touch approval')
  assert.deepEqual(w.coordinateWrites, [], 'the catalogue pin is not overwritten')
  assert.deepEqual(w.details!.tags, ['seafood', 'bistro', 'parking'])
  assert.equal(w.details!.has_wifi, true)
  assert.equal(w.desc.row?.description, 'Baires Bistrô', 'free tier: the name, from the catalogue spelling')
})

test('BR-B2B-033 item 5 · running the merge twice changes nothing and the description is unchanged', async () => {
  linked()
  w.portal = { id: 'sub-1', answers: answers() }

  const first = await merge()
  const snapshot = JSON.stringify({ a: w.attraction, d: w.details, desc: w.desc.row, pins: w.coordinateWrites })
  const second = await merge()

  assert.equal(first.status === 'merged' && first.description, 'written')
  assert.equal(second.status === 'merged' && second.description, 'unchanged')
  assert.equal(JSON.stringify({ a: w.attraction, d: w.details, desc: w.desc.row, pins: w.coordinateWrites }), snapshot)
})

test('BR-B2B-033 item 5 · no catalogue pin → the merge writes the partner pin once, then leaves it', async () => {
  linked()
  w.hasCoordinate = false
  w.portal = { id: 'sub-1', answers: answers() }

  await merge()
  await merge()

  assert.deepEqual(w.coordinateWrites, [{ lat: -22.75, lng: -41.88 }], 'second run sees the pin and skips')
})

// ── 4 · replace mode keeps its behaviour ────────────────────────────────────────────────────

test('BR-B2B-033 · applyPlacePrefill `replace` (the place just created): writes as-is, pin included, no catalogue read', async () => {
  w.attraction!.formatted_address = 'Av. Curada, 1'
  w.hasCoordinate = true

  const out = await svc.applyPlacePrefill(POI, prefillOf(), CLIENT, operatorOf(w))

  assert.deepEqual(out, { status: 'created', attractionId: POI })
  assert.equal(w.attraction!.formatted_address, 'Rua das Pedras, Centro', 'replace overwrites: nothing to protect')
  assert.equal(w.attraction!.partner_client_id, CLIENT)
  assert.equal(w.coordinateWrites.length, 1, 'replace writes the pin without asking')
  assert.deepEqual(w.reads, [], 'replace never reads the catalogue')
})

// ── 5 · the link route ──────────────────────────────────────────────────────────────────────

function post(url: string, body?: unknown): NextRequest {
  return new Request(`http://localhost${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as NextRequest
}
const link = (clientId = CLIENT, attractionId = POI) =>
  linkRoute.POST(post(`/api/x/${clientId}/places/link`, { attractionId }), { params: Promise.resolve({ clientId }) })

test('BR-B2B-033 item 3 · link: the write keeps `.is(partner_client_id, null)` and the response carries the registration', async () => {
  w.portal = { id: 'sub-1', answers: answers() }

  const res = await link()
  const body = await res.json()

  assert.equal(res.status, 200)
  assert.equal(body.linked, true)
  assert.equal(body.registration.status, 'merged')
  const first = attractionWrites()[0]
  assert.deepEqual(first.patch, { partner_client_id: CLIENT }, 'the link writes nothing but the owner')
  assert.deepEqual(first.filters.find(([k]) => k === 'is'), ['is', 'partner_client_id', null])
  assert.equal(w.attraction!.approved, true)
  assert.equal(audits.some((a) => a.action === 'LINK_PARTNER_PLACE'), true)
  assert.equal(audits.some((a) => a.action === 'PULL_PARTNER_REGISTRATION'), false, 'the link audits the link')
})

test('BR-B2B-033 item 3 · link: lost race → 409 other_owner and the merge does not run', async () => {
  w.stealOnLinkWrite = true
  w.portal = { id: 'sub-1', answers: answers() }

  const res = await link()

  assert.equal(res.status, 409)
  assert.equal((await res.json()).error, 'other_owner')
  assert.equal(w.attraction!.partner_client_id, OTHER_CLIENT, 'the first owner keeps the place')
  assert.equal(attractionWrites().length, 1, 'nothing written after the lost race')
  assert.equal(w.attraction!.opening_hours, undefined)
})

test('BR-B2B-033 item 5 · link: a failing merge does not undo or fail the link (200, registration.failed)', async () => {
  w.fail.mergeOwnerRead = true

  const res = await link()
  const body = await res.json()

  assert.equal(res.status, 200)
  assert.equal(body.linked, true)
  assert.deepEqual(body.registration, { status: 'failed', reason: 'lookup_failed', attractionId: POI })
  assert.equal(w.attraction!.partner_client_id, CLIENT, 'the link stands')
})

// ── 6 · mergeRegistrationIntoPlace outcomes ─────────────────────────────────────────────────

test('BR-B2B-033 item 3 · merge on a POI linked to ANOTHER client → skipped/not_linked, nothing written', async () => {
  w.attraction!.partner_client_id = OTHER_CLIENT
  w.portal = { id: 'sub-1', answers: answers() }

  assert.deepEqual(await merge(), { status: 'skipped', reason: 'not_linked' })
  assert.equal(w.writes.length, 0)
  assert.equal(w.desc.row, null)
})

test('BR-B2B-033 item 5 · merge: owner read fails → failed/lookup_failed; catalogue identity read fails → failed, nothing written (fail closed)', async () => {
  linked()
  w.fail.mergeOwnerRead = true
  assert.deepEqual(await merge(), { status: 'failed', reason: 'lookup_failed', attractionId: POI })

  w = freshWorld()
  linked()
  w.portal = { id: 'sub-1', answers: answers() }
  w.fail.catalogueRead = true
  assert.deepEqual(await merge(), { status: 'failed', reason: 'lookup_failed', attractionId: POI })
  assert.equal(w.writes.length, 0, 'merging blind would let BAIRES BISTRO overwrite the curated name')
})

test('BR-B2B-033 item 5 · merge: portal lookup fails → failed/lookup_failed (not "no registration")', async () => {
  linked()
  w.fail.portalLookup = true
  assert.deepEqual(await merge(), { status: 'failed', reason: 'lookup_failed', attractionId: POI })
})

test('BR-B2B-016 item 9 · merge without a registration: merged + no_promoted_proposal, description = the name', async () => {
  linked()

  assert.deepEqual(await merge(), {
    status: 'merged',
    attractionId: POI,
    prefill: 'no_promoted_proposal',
    description: 'written',
  })
  assert.equal(w.desc.row?.description, 'Baires Bistrô')
  assert.equal(w.writes.length, 0, 'no attraction or details write without a registration')
})

test('BR-B2B-033 item 5 · the old form\'s promoted proposal is the fallback registration, and its plan is a request, not a payment', async () => {
  linked()
  w.promotedAnswers = answers({ story_script: STORY })

  const out = await merge()

  assert.equal(out.status === 'merged' && out.prefill, 'applied')
  assert.equal(w.desc.row?.description, 'Baires Bistrô', 'no accepted tier → free tier → the name, never the story')
})

test('BR-B2B-016 item 1 · BR-B2B-025 · portal acceptance map_and_description reaches the description policy: the story is written', async () => {
  linked()
  w.portal = { id: 'sub-1', answers: answers({ story_script: `  ${STORY}\n` }) }
  w.acceptancePlan = 'map_and_description'

  const out = await merge()

  assert.equal(out.status === 'merged' && out.description, 'written')
  assert.equal(w.desc.row?.description, STORY, 'trimmed, not rewritten')
  assert.deepEqual(w.desc.row?.generation_meta, { kind: 'partner_story_script' })
  assert.equal(w.desc.row?.audio_url, null, 'BR-B2B-018: text only, nothing on air')
})

test('BR-B2B-016 · merge never writes over a description the catalogue already had', async () => {
  linked()
  w.portal = { id: 'sub-1', answers: answers({ story_script: STORY }) }
  w.acceptancePlan = 'map_and_description'
  w.desc.row = { description: 'Texto do curador.', audio_url: 'x.mp3', generation_meta: { kind: 'operator_edit' } }

  const out = await merge()

  assert.notEqual(out.status === 'merged' && out.description, 'written')
  assert.equal(w.desc.row?.description, 'Texto do curador.')
})

test('BR-B2B-033 item 5 · a registration with nothing to prefill → merged + nothing_to_prefill (description still runs)', async () => {
  linked()
  w.portal = { id: 'sub-1', answers: { category: 'restaurant' } }

  const out = await merge()

  assert.equal(out.status === 'merged' && out.prefill, 'nothing_to_prefill')
  assert.equal(w.writes.length, 0)
  assert.equal(w.desc.row?.description, 'Baires Bistrô')
})

// ── risk: place_details row absent ──────────────────────────────────────────────────────────

test('RISK #885 · CURRENT BEHAVIOUR (known defect): a POI with no place_details row loses offers/amenities/tags in silence', async () => {
  linked()
  w.details = null
  w.portal = { id: 'sub-1', answers: answers({ offer_enabled: 'true', offer_free: '10% off', price_range: '2' }) }

  const out = await merge()

  // What the operator is told: success.
  assert.deepEqual(out, { status: 'merged', attractionId: POI, prefill: 'applied', description: 'written' })
  // What the database holds: no details row, so the UPDATE matched nothing and nothing was created.
  const detailsWrite = w.writes.find((x) => x.table === 'place_details')
  assert.ok(detailsWrite, 'the details were sent')
  assert.ok('app_benefit' in detailsWrite.patch && 'has_wifi' in detailsWrite.patch && 'tags' in detailsWrite.patch)
  assert.equal(detailsWrite.touched, false, 'UPDATE of a missing row matches zero rows and raises no error')
  assert.equal(w.details, null, 'the offer, wifi and tags are gone — no row was created')
  // The attraction columns of the same registration DID land: the loss is partial and invisible.
  assert.deepEqual(w.attraction!.opening_hours, { monday: [{ open: '12:00', close: '23:00' }] })
})

// ── 7 · the registration route ──────────────────────────────────────────────────────────────

const pull = (clientId = CLIENT, attractionId = POI) =>
  registrationRoute.POST(post(`/api/x/${clientId}/places/${attractionId}/registration`), {
    params: Promise.resolve({ clientId, attractionId }),
  })

test('BR-B2B-033 · registration route: an invalid UUID is a 400, and nothing is read or written', async () => {
  const badClient = await pull('not-a-uuid')
  assert.equal(badClient.status, 400)
  assert.equal((await badClient.json()).error, 'invalid_client_id')
  const badPlace = await pull(CLIENT, '123')
  assert.equal(badPlace.status, 400)
  assert.equal((await badPlace.json()).error, 'invalid_attraction_id')
  assert.equal(w.writes.length, 0)
  assert.equal(audits.length, 0)
})

test('BR-B2B-033 item 5 · registration route: merged → 200 {outcome}, audited once as PULL_PARTNER_REGISTRATION', async () => {
  linked()
  w.portal = { id: 'sub-1', answers: answers() }

  const res = await pull()
  const body = await res.json()

  assert.equal(res.status, 200)
  assert.equal(body.outcome.status, 'merged')
  assert.deepEqual(audits.map((a) => a.action), ['PULL_PARTNER_REGISTRATION'])
  assert.equal(audits[0].entityId, POI)
  assert.match(audits[0].description, /prefill: applied, description: written/)
})

test('BR-B2B-033 item 5 · registration route: skipped and failed answer 200 {outcome} and are NOT audited', async () => {
  // not linked
  const skipped = await pull()
  assert.equal(skipped.status, 200)
  assert.deepEqual((await skipped.json()).outcome, { status: 'skipped', reason: 'not_linked' })

  // failed
  linked()
  w.fail.mergeOwnerRead = true
  const failed = await pull()
  assert.equal(failed.status, 200)
  assert.equal((await failed.json()).outcome.status, 'failed')

  assert.equal(audits.length, 0, 'a pull that merged nothing leaves no audit line')
})

test('#885 · PULL_PARTNER_REGISTRATION is in the audit action union, next to the link and the unlink', () => {
  const audit = read('lib/services/audit-service.ts')
  for (const action of ['LINK_PARTNER_PLACE', 'UNLINK_PARTNER_PLACE', 'PULL_PARTNER_REGISTRATION']) {
    assert.match(audit, new RegExp(`\\| '${action}'`))
  }
})

// ── 8 · the tab (no component bench in this CMS: no jsdom, no testing-library — source ruler) ─

test('#885 · PlacesTab: the button POSTs the registration route, and every outcome has its sentence', () => {
  const tab = read('components/admin/clients/tabs/PlacesTab.tsx')
  assert.match(tab, /\/places\/\$\{attractionId\}\/registration`/)
  assert.match(tab, /method: 'POST'/)
  assert.match(tab, /t\('registration\.action'\)/)

  // pullResultOf: merged/applied, merged/nothing_to_prefill, merged/no_promoted_proposal,
  // skipped/not_linked, everything else = failed.
  assert.match(tab, /outcome\.prefill === 'applied'\) return 'applied'/)
  assert.match(tab, /'nothing_to_prefill' \? 'nothingToPrefill' : 'noRegistration'/)
  assert.match(tab, /outcome\.reason === 'not_linked'\) return 'notLinked'/)
  assert.match(tab, /return 'failed'\s*\}/)

  const pt = JSON.parse(read('messages/pt.json')).Partnerships.registration
  const type = tab.match(/type PullResult = ([^\n]+)/)?.[1] ?? ''
  const results = [...type.matchAll(/'(\w+)'/g)].map((m) => m[1])
  assert.deepEqual(results.sort(), ['applied', 'failed', 'noRegistration', 'notLinked', 'nothingToPrefill'])
  for (const key of ['action', 'pulling', ...results]) {
    assert.equal(typeof pt[key], 'string', `Partnerships.registration.${key} missing`)
    assert.ok(pt[key].trim().length > 0)
  }
  assert.equal(new Set(results.map((r) => pt[r])).size, results.length, 'each outcome says something different')
})
