/**
 * The in-person conference of BR-B2B-022, item 3, as a fact about the CLIENT.
 *
 * THE DEFECT THIS SUITE EXISTS FOR. Until 2026-08-21 the evidence lived only inside the review
 * annotation of a promoted proposal, and the contract gate read it there. A client registered
 * directly has no proposal, so the gate answered "nothing seen" about a document nobody had any
 * way to record, and the CMS offered no screen that wrote one. Measured against production on
 * that date: 10 of 12 clients could never generate a contract, with no way out of the checklist.
 *
 * Mutations that turn this suite red:
 *  · pointing the regularity gate back at `partner_form_submissions`;
 *  · accepting a document kind outside the closed list;
 *  · letting the promotion overwrite a conference already registered against the client;
 *  · dropping `reviewed_by` from the write.
 *
 * Run with: npm run test:api
 */

import { test, before, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dirname, '../..')

interface ConferenceRow {
  client_id: string
  documents_seen: string[]
  reviewed_by: string | null
  reviewed_at: string | null
}

let rows: ConferenceRow[]

/**
 * The narrowest fake that still answers the three calls the service makes: the `maybeSingle`
 * read, the `upsert` and the plain `insert` whose duplicate the seed relies on.
 */
function createFakeService() {
  return {
    schema: () => ({
      from: () => {
        const filters: Record<string, string> = {}
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: (column: string, value: string) => {
            filters[column] = value
            return chain
          },
          maybeSingle: async () => {
            const row = rows.find((candidate) => candidate.client_id === filters.client_id)
            return { data: row ?? null, error: null }
          },
          upsert: async (values: ConferenceRow) => {
            const index = rows.findIndex((row) => row.client_id === values.client_id)
            if (index >= 0) rows[index] = { ...rows[index], ...values }
            else rows.push({ ...values, reviewed_at: values.reviewed_at ?? null })
            return { error: null }
          },
          insert: async (values: ConferenceRow) => {
            if (rows.some((row) => row.client_id === values.client_id)) {
              return { error: { code: '23505', message: 'duplicate key' } }
            }
            rows.push({ ...values, reviewed_at: values.reviewed_at ?? '2026-08-21T00:00:00.000Z' })
            return { error: null }
          },
        }
        return chain
      },
    }),
  }
}

let service: typeof import('@/lib/services/client-conference-service')

before(async () => {
  mock.module('@/lib/core/supabase-client', {
    namedExports: {
      getSupabaseService: () => createFakeService(),
      getSupabaseRouteHandler: () => ({}),
      getSupabaseClient: () => ({}),
    },
  })
  service = await import('@/lib/services/client-conference-service')
})

beforeEach(() => {
  rows = []
})

const CLIENT = '33333333-3333-4333-8333-333333333333'
const OPERATOR = '44444444-4444-4444-8444-444444444444'

// ── Normalization ─────────────────────────────────────────────────────────────────────────

test('a document kind outside the closed list is refused, not silently dropped', () => {
  assert.equal(
    service.normalizeClientConference({ documentsSeen: ['business_license', 'passaporte'] }),
    null
  )
})

/**
 * FIVE NORMALIZATION TESTS STOOD HERE, ALL ABOUT THE LICENCE TRANSCRIPTIONS: the three fields
 * falling together with the tick, trimming, the `YYYY-MM-DD` shape, and the length ceiling.
 * The three fields left the record on 2026-08-21 (operator: *"nao iremos pedir o numero do
 * alvará, só dar um check no cms"*), so there is no behaviour left for them to guard.
 *
 * The one below replaces them, and it guards what a shrink actually risks: a body still
 * carrying the retired keys must not smuggle them into storage.
 */
test('the retired licence keys in a body are ignored, and never reach the row', () => {
  const normalized = service.normalizeClientConference({
    documentsSeen: ['business_license'],
    licenseNumber: '1.234/2019',
    licenseIssuer: 'Santos',
    licenseValidUntil: '2027-01-01',
  })

  assert.deepEqual(normalized, { documentsSeen: ['business_license'] })
})

test('a duplicated tick is stored once', () => {
  const normalized = service.normalizeClientConference({
    documentsSeen: ['business_license', 'business_license'],
  })
  assert.deepEqual(normalized?.documentsSeen, ['business_license'])
})

// ── Storage ───────────────────────────────────────────────────────────────────────────────

test('a client with no conference reads as empty, and that is what refuses the contract', async () => {
  const record = await service.getClientConference(CLIENT)

  assert.deepEqual(record.conference.documentsSeen, [])
  assert.equal(record.reviewedAt, null)
  assert.equal(record.reviewedBy, null)
})

test('the write names the operator: the record is somebody asserting, never a file we hold', async () => {
  const conference = service.normalizeClientConference({
    documentsSeen: ['business_license', 'incorporation_document'],
  })!

  assert.equal(await service.saveClientConference(CLIENT, conference, OPERATOR), true)

  const stored = await service.getClientConference(CLIENT)
  assert.deepEqual(stored.conference.documentsSeen, ['business_license', 'incorporation_document'])
  assert.equal(stored.reviewedBy, OPERATOR)
})

test('a second operator overwrites, and `reviewed_by` moves with the assertion', async () => {
  const first = service.normalizeClientConference({ documentsSeen: ['business_license'] })!
  await service.saveClientConference(CLIENT, first, OPERATOR)

  const second = service.normalizeClientConference({ documentsSeen: [] })!
  await service.saveClientConference(CLIENT, second, 'other-operator')

  const stored = await service.getClientConference(CLIENT)
  assert.deepEqual(stored.conference.documentsSeen, [])
  assert.equal(stored.reviewedBy, 'other-operator')
})

// ── The transfer at promotion ─────────────────────────────────────────────────────────────

test('promotion carries the proposal conference onto the client it became', async () => {
  await service.seedConferenceFromProposal(CLIENT, { documentsSeen: ['business_license'] }, OPERATOR)

  const stored = await service.getClientConference(CLIENT)
  assert.deepEqual(stored.conference.documentsSeen, ['business_license'])
  assert.equal(stored.reviewedBy, OPERATOR)
})

test('an empty proposal conference writes nothing: a row that asserts nothing is not a trail', async () => {
  await service.seedConferenceFromProposal(CLIENT, { documentsSeen: [] }, OPERATOR)

  assert.equal(rows.length, 0)
  assert.equal((await service.getClientConference(CLIENT)).reviewedAt, null)
})

test('promotion never overwrites a conference already registered against the client', async () => {
  const own = service.normalizeClientConference({
    documentsSeen: ['business_license', 'incorporation_document'],
  })!
  await service.saveClientConference(CLIENT, own, OPERATOR)

  await service.seedConferenceFromProposal(
    CLIENT,
    { documentsSeen: ['business_license'] },
    'older-operator'
  )

  const stored = await service.getClientConference(CLIENT)
  assert.deepEqual(stored.conference.documentsSeen, ['business_license', 'incorporation_document'])
  assert.equal(stored.reviewedBy, OPERATOR, 'the newer assertion survives the older one')
})

test('#409 · DS-COMPONENTE-020 — a missing document names the control that resolves it', () => {
  // The band and the conference fieldset are on the SAME page, far enough apart that the band
  // read as a verdict with no way to answer it. The link is an in-page anchor and not a route:
  // a proposal has no client, and the contract screen is addressed by `clientId`.
  const band = readFileSync(
    resolve(REPO_ROOT, 'components/admin/partner-proposals/RegularityBand.tsx'),
    'utf8'
  )
  assert.match(band, /const CONFERENCE_ANCHOR = '#conference-heading'/)
  assert.match(band, /act: item\.ok \? null : CONFERENCE_ANCHOR/)

  // The anchor has to exist on the page that renders the band, or the link is a promise
  // nothing keeps.
  const review = readFileSync(
    resolve(REPO_ROOT, 'components/admin/partner-proposals/ProposalReview.tsx'),
    'utf8'
  )
  assert.match(review, /id="conference-heading"/)

  // Only the two documents link: the CNPJ and the representative are fields the partner typed,
  // and nobody on this screen ticks them.
  const linked = Array.from(band.matchAll(/act: item\.ok \? null : CONFERENCE_ANCHOR/g))
  assert.equal(linked.length, 2)
})

