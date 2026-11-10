/**
 * #1184 — the tour guide asks for the partnership in the app, and every guide gets the default
 * rate. BR-B2B-066 items 1, 4 and 10, BR-B2B-064 items 1, 2 and 9.a, BR-B2B-065 item 3,
 * BR-MONETIZACAO-039 items 6 and 6.c (as amended on 2026-11-10).
 *
 * The database is faked. What runs for real: `partnerKindOf`, `placesTabOf`, `taxConfigOfClient`,
 * `isApprovedAppPartnerWithoutPlace`, the queue's parsing and screen, the read of the guide profile
 * and the admin service's client insert. That the approval of the request creates the empty profile
 * and that the database writes the default rate are the database's promise (migration of #1184).
 *
 * Mutations that turn this suite red:
 *  · the guide of the app recognised only by the portal's answers (no "Perfil no app" tab);
 *  · the empty profile of the app guide breaking the read (a null photo turned into a URL);
 *  · a rate declared in the CMS for the guide, zero included;
 *  · the transfer without a base, or the free tier, losing its zero written as zero;
 *  · a `tour_guide` request dropped from the queue, or shown without its label;
 *  · the tick "Aparece no app" free to switch on before there is a photo and a bio to confer.
 *
 * Run with: npm run test:api
 */

import { before, beforeEach, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'

import { RPC_ROWS } from '../ct/partner-requests-fixtures'

const ROOT = resolve(import.meta.dirname, '../..')
const CLIENT = '33333333-3333-4333-8333-333333333333'

interface World {
  insert: Record<string, unknown> | null
  profileRow: Record<string, unknown> | null
}
let w: World

beforeEach(() => {
  w = { insert: null, profileRow: null }
})

function query() {
  const q: any = {
    insert: (values: Record<string, unknown>) => {
      w.insert = values
      return q
    },
    select: () => q,
    eq: () => q,
    in: () => q,
    single: async () => ({ data: { id: CLIENT }, error: null }),
    maybeSingle: async () => ({ data: w.profileRow, error: null }),
  }
  return q
}
const service = { schema: () => ({ from: () => query() }), from: () => query() }

let kinds: typeof import('@/lib/partnerships/partner-kind')
let admin: typeof import('@/lib/services/partner-proposal-admin-service')
let guides: typeof import('@/lib/services/guide-profile-service')
let queue: typeof import('@/lib/partner-requests/queue')
let countries: typeof import('@/components/admin/clients/shared/countries')
let PartnerRequestsQueue: typeof import('@/components/admin/clients/board/PartnerRequests')['PartnerRequestsQueue']

before(async () => {
  mock.module('@/lib/core/supabase-client', { namedExports: { getSupabaseService: () => service } })
  kinds = await import('@/lib/partnerships/partner-kind')
  admin = await import('@/lib/services/partner-proposal-admin-service')
  guides = await import('@/lib/services/guide-profile-service')
  queue = await import('@/lib/partner-requests/queue')
  countries = await import('@/components/admin/clients/shared/countries')
  ;({ PartnerRequestsQueue } = await import('@/components/admin/clients/board/PartnerRequests'))
})

// ── One derivation of the kind ───────────────────────────────────────────────────────────────

test('BR-B2B-066 items 1 and 10 · BR-B2B-064 item 1: partnerKindOf reads the guide from client_type, with no portal answers', () => {
  assert.equal(kinds.partnerKindOf(null, 'tour_guide'), 'guide')
  assert.equal(kinds.partnerKindOf(undefined, 'tour_guide'), 'guide')
  // Both paths lead to the same guide record: the portal guide still reads as a guide.
  assert.equal(kinds.partnerKindOf({ category: 'tour_guide' }, 'tour_guide'), 'guide')
  assert.equal(kinds.partnerKindOf({ category: 'tour_guide' }), 'guide')
  // The other three app types and the venue keep their path; the transfer still reads from answers.
  for (const type of ['creator', 'influencer', 'driver', 'venue', null]) {
    assert.equal(kinds.partnerKindOf(null, type), 'place', String(type))
  }
  assert.equal(kinds.partnerKindOf({ category: 'transfer', has_service_address: 'false' }, 'driver'), 'referral_only')
})

test('BR-B2B-066 item 10 · BR-B2B-064 item 11.a: the app guide without a submission gets the "Perfil no app" tab', () => {
  assert.equal(kinds.placesTabOf(kinds.partnerKindOf(null, 'tour_guide')), 'guide')
  const modal = readFileSync(resolve(ROOT, 'components/admin/clients/ClientEditorModal.tsx'), 'utf8')
  // The record's kind is the one derivation, fed the client's type next to the (absent) answers.
  assert.match(modal, /partnerKindOf\(review\?\.answers, client\?\.client_type\)/)
  // The tab opens with no submission: `submissionId` may be null, and nothing else gates it.
  assert.match(modal, /activeTab === 'guide' && partnerKind === 'guide' && clientId \? \(/)
  assert.match(modal, /<GuideProfileTab clientId=\{clientId\} submissionId=\{review\?\.id \?\? null\}/)
})

test('BR-B2B-066 item 10.b: the empty profile the approval creates reads without breaking, every missing field as null', async () => {
  w.profileRow = {
    client_id: CLIENT,
    display_name: null,
    bio: null,
    photo_path: null,
    languages: [],
    specialties: [],
    whatsapp: null,
    public_contact_consent: false,
    hidden: false,
    hidden_reason: null,
    updated_at: '2026-11-10T12:00:00Z',
    listed_in_app: false,
    meeting_point_address: null,
    meeting_point_city: null,
    meeting_point_lat: null,
    meeting_point_lng: null,
  }
  const read = await guides.loadGuideProfile(CLIENT)
  assert.ok(read.ok && read.profile)
  assert.equal(read.profile.displayName, null)
  assert.equal(read.profile.bio, null)
  assert.equal(read.profile.photoPath, null)
  assert.equal(read.profile.photoUrl, null)
  assert.equal(read.profile.whatsapp, null)
  assert.deepEqual(read.profile.languages, [])
  assert.equal(read.profile.consent, false)
  assert.equal(read.profile.listedInApp, false)
  assert.equal(read.profile.meetingPoint, null)

  // A portal guide's profile still reads whole.
  w.profileRow = { ...w.profileRow, display_name: 'Ana Guia', bio: 'A pé.', photo_path: `${CLIENT}/a.jpg`, whatsapp: '5522999998888' }
  const full = await guides.loadGuideProfile(CLIENT)
  assert.ok(full.ok && full.profile)
  assert.match(full.profile.photoUrl ?? '', /\/storage\/v1\/object\/public\/guide-photos\/33333333-3333-4333-8333-333333333333\/a\.jpg$/)
})

test('BR-B2B-064 item 9.a: the app guide is conferred before the tick, so the tick stays locked without photo and bio', () => {
  const tab = readFileSync(resolve(ROOT, 'components/admin/clients/tabs/GuideProfileTab.tsx'), 'utf8')
  assert.match(tab, /const nothingToConfer = profile\.photoUrl === null \|\| profile\.bio === null/)
  // Switching ON is locked; switching OFF an already ticked guide stays free.
  assert.match(tab, /const tickLocked = listLocked \|\| \(nothingToConfer && !profile\.listedInApp\)/)
  assert.match(tab, /disabled=\{busy \|\| tickLocked\}/)
  // The "Publicar o perfil" button needs a portal submission; the app guide has none.
  assert.match(tab, /\{submissionId \? \(\s*<Button variant="cta"/)
  // No line tells the curator the guide withdrew a consent it never gave.
  const pt = JSON.parse(readFileSync(resolve(ROOT, 'messages/pt.json'), 'utf8'))
  assert.doesNotMatch(pt.Clients.guide.visibility.noConsentLine, /tirou a autorização no portal/)
  for (const locale of ['pt', 'en', 'es']) {
    const messages = JSON.parse(readFileSync(resolve(ROOT, `messages/${locale}.json`), 'utf8'))
    assert.equal(typeof messages.Clients.guide.visibility.incompleteLocked, 'string', locale)
  }
})

// ── The rate: the database's, never the CMS's ────────────────────────────────────────────────

test('BR-B2B-064 item 2 · BR-MONETIZACAO-039 item 6.c: the portal guide is created with NO rate from the CMS, not zero', async () => {
  const out = await admin.createPromotedClient({}, { category: 'tour_guide', plan_choice: 'no_place' }, { clientType: 'tour_guide' })
  assert.deepEqual(out, { ok: true, clientId: CLIENT, created: true })
  assert.ok(w.insert)
  assert.equal('commission_rate' in w.insert, false)
  assert.equal(w.insert.monthly_fee_cents, null)
  assert.equal(w.insert.client_type, 'tour_guide')

  // A guide submission from before #933's amendment sent `map_only`; it is still a guide.
  await admin.createPromotedClient({}, { category: 'tour_guide', plan_choice: 'map_only' }, { clientType: 'tour_guide' })
  assert.equal('commission_rate' in w.insert, false)
})

test('BR-B2B-065 item 3 · BR-MONETIZACAO-039 item 6.f: the transfer without a base and the free tier keep zero, written as zero', async () => {
  await admin.createPromotedClient({}, { category: 'transfer', has_service_address: 'false', plan_choice: 'no_place' }, { clientType: 'driver' })
  assert.equal(w.insert?.commission_rate, 0)
  assert.equal(w.insert?.monthly_fee_cents, null)

  await admin.createPromotedClient({}, { category: 'restaurant', plan_choice: 'map_only' })
  assert.equal(w.insert?.commission_rate, 0)
})

// ── The queue of the app requests ────────────────────────────────────────────────────────────

const GUIDE_ROW = {
  ...RPC_ROWS[2],
  request_id: 77,
  user_id: '77777777-7777-4777-8777-777777777777',
  partner_type: 'tour_guide',
  full_name: 'Ana Guia',
  terms_version: 'parceiros-sem-local-2026-11-v3',
}

test('BR-B2B-066 item 1: the tour_guide request reaches the queue, beside the other three', () => {
  assert.deepEqual([...kinds.APP_PARTNER_TYPES], ['creator', 'influencer', 'driver', 'tour_guide'])
  const rows = queue.parsePartnerRequestRows([...RPC_ROWS, GUIDE_ROW]) ?? []
  assert.deepEqual(
    rows.map((row) => row.partnerType),
    ['creator', 'influencer', 'driver', 'tour_guide']
  )
})

test('BR-B2B-066 item 1: the queue labels the guide request with its type, as the other three', () => {
  const messages = JSON.parse(readFileSync(resolve(ROOT, 'messages/pt.json'), 'utf8'))
  const html = renderToStaticMarkup(
    // eslint-disable-next-line react/no-children-prop
    createElement(NextIntlClientProvider, {
      locale: 'pt',
      messages: { Clients: { board: { requests: messages.Clients.board.requests } } },
      timeZone: 'America/Sao_Paulo',
      children: createElement(PartnerRequestsQueue, {
        requests: queue.parsePartnerRequestRows([GUIDE_ROW]) ?? [],
        status: 'ready',
        busyId: null,
        notice: null,
        onApprove: () => {},
        onRefuse: () => {},
      }),
    })
  )
  assert.match(html, />Guia de turismo</)
  assert.match(html, /Ana Guia/)
})

test('BR-B2B-066 item 2: the guide approval goes through the same RPC as the other three, with no rate in the CMS', () => {
  const route = readFileSync(resolve(ROOT, 'app/api/admin/partner-requests/[requestId]/approve/route.ts'), 'utf8')
  assert.match(route, /approve_partner_request_as/)
  // No type branch: the database decides what the approval creates for each type.
  assert.doesNotMatch(route, /tour_guide|partnerType|partner_type/)
  assert.doesNotMatch(route, /commission_rate\s*:/)
})

// ── The guide's document and its board row ───────────────────────────────────────────────────

test('BR-B2B-066 item 4: the guide carries a CPF or a CNPJ, named by the document and not by the country', () => {
  assert.equal(countries.taxConfigOfClient('tour_guide', 'Brazil', '390.533.447-05').type, 'cpf')
  assert.equal(countries.taxConfigOfClient('tour_guide', 'Brazil', '11.222.333/0001-81').type, 'cnpj')
})

test('#1184: the approved guide is not the QR-and-code-only row of the other three app types', () => {
  const approved = { clientType: 'tour_guide', status: 'approved', commissionStartsAt: '2026-11-10T12:00:00Z' }
  assert.equal(kinds.isApprovedAppPartnerWithoutPlace(approved, 0), false)
  assert.equal(kinds.isApprovedAppPartnerWithoutPlace({ ...approved, clientType: 'driver' }, 0), true)
})
