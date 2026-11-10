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
 *  · the tick "Aparece no app" free to switch on before there is a photo and a bio to confer;
 *  · the portal guide's approval not calling partner.apply_default_commission, calling it before
 *    the client is approved or with another id, or calling it for the transfer;
 *  · a failure of that call undoing the approval, or reaching the screen unsaid;
 *  · a TGP23 photo or bio refusal read as "no meeting point";
 *  · the queue telling the curator a guide link "completes the account's own record".
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

const SUB = '11111111-1111-4111-8111-111111111111'
const CMS_OP = '44444444-4444-4444-8444-444444444444'
const PHOTO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg'
const NOW = new Date('2026-11-10T12:00:00.000Z')

const PORTAL_GUIDE = {
  trade_name: 'Ana Guia',
  category: 'tour_guide',
  city: 'Búzios',
  state: 'RJ',
  plan_choice: 'no_place',
  bio: 'Guia credenciada, conto a história da península a pé.',
  languages: '["pt","en"]',
  subtypes: '["city_tour"]',
  whatsapp: '22999998888',
  service_cities: '[{"city":"Búzios","state":"RJ","lat":-22.75,"lng":-41.88}]',
  profile_photo: `${SUB}/facade/${PHOTO}`,
  public_contact_consent: 'true',
  legal_status_declaration: 'true',
}
const PORTAL_TRANSFER = {
  trade_name: 'Transfer do Zé',
  category: 'transfer',
  has_service_address: 'false',
  city: 'Búzios',
  state: 'RJ',
  plan_choice: 'no_place',
  whatsapp: '22999997777',
  service_cities: '[{"city":"Búzios","state":"RJ","lat":-22.75,"lng":-41.88}]',
}

interface World {
  insert: Record<string, unknown> | null
  profileRow: Record<string, unknown> | null
  /** The order of what the portal approval did, as the fake database saw it. */
  calls: string[]
  submission: Record<string, unknown>
  /** What `partner.apply_default_commission` answers; null = it wrote the rate. */
  commissionError: { code: string; details?: string } | null
}
let w: World

function reset(answers: Record<string, string> = PORTAL_GUIDE, over: Partial<World> = {}) {
  w = {
    insert: null,
    profileRow: null,
    calls: [],
    submission: { id: SUB, status: 'in_review', answers, attraction_id: null, client_id: null },
    commissionError: null,
    ...over,
  }
}
beforeEach(() => reset())

function query(name = '') {
  let update: Record<string, unknown> | null = null
  const q: any = {
    insert: (values: Record<string, unknown>) => {
      w.insert = values
      w.calls.push(`create_client:${values.client_type}`)
      return q
    },
    update: (values: Record<string, unknown>) => {
      update = values
      if ('approval_claimed_at' in values) w.calls.push(values.approval_claimed_at ? 'claim' : 'release')
      if ('client_id' in values) {
        w.calls.push('write_client_id')
        w.submission.client_id = values.client_id
      }
      return q
    },
    select: () => q,
    eq: () => q,
    in: () => q,
    or: () => q,
    order: () => q,
    limit: () => q,
    single: async () => ({ data: { id: CLIENT }, error: null }),
    maybeSingle: async () => {
      if (name === 'place_submissions') return { data: w.submission, error: null }
      if (name === 'place_acceptances') return { data: { email: 'ana@guia.com.br', plan_choice: null }, error: null }
      if (name === 'clients') return { data: { email: 'ana@guia.com.br', name: 'Ana Guia' }, error: null }
      if (name === 'place_slugs') return { data: { slug: 'ana-guia' }, error: null }
      return { data: w.profileRow, error: null }
    },
    then: (resolve: (v: unknown) => unknown) =>
      resolve({ data: update && update.approval_claimed_at ? [{ id: SUB }] : [], error: null }),
  }
  return q
}
const service = {
  schema: () => ({
    from: (name: string) => query(name),
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === 'apply_default_commission') {
        w.calls.push(`commission:${args.p_client_id}`)
        return w.commissionError ? { data: null, error: w.commissionError } : { data: 0.2, error: null }
      }
      w.calls.push(`transition:${args.p_to}`)
      w.submission.status = args.p_to
      return { data: args.p_to, error: null }
    },
  }),
  from: (name: string) => query(name),
  storage: {
    from: () => ({
      copy: async () => {
        w.calls.push('copy_photo')
        return { data: null, error: null }
      },
    }),
  },
}
const operator: any = {
  schema: () => ({
    from: () => {
      throw new Error('no POI read on the path without a place')
    },
    rpc: async (name: string) => {
      w.calls.push(`rpc:${name}`)
      return { data: CLIENT, error: null }
    },
  }),
}

let kinds: typeof import('@/lib/partnerships/partner-kind')
let admin: typeof import('@/lib/services/partner-proposal-admin-service')
let guides: typeof import('@/lib/services/guide-profile-service')
let queue: typeof import('@/lib/partner-requests/queue')
let countries: typeof import('@/components/admin/clients/shared/countries')
let PartnerRequestsQueue: typeof import('@/components/admin/clients/board/PartnerRequests')['PartnerRequestsQueue']
let validation: typeof import('@/lib/services/portal-validation-service')

before(async () => {
  mock.module('@/lib/core/supabase-client', { namedExports: { getSupabaseService: () => service } })
  // The place path is not under test here; the approval of a partner without a place never reaches it.
  mock.module('@/lib/services/partner-place-provisioning', {
    namedExports: {
      createPrefilledPlace: async () => ({ status: 'failed', reason: 'not_under_test' }),
      applyPlacePrefill: async () => ({ status: 'failed', reason: 'not_under_test' }),
      applyPrefillDescription: async () => ({ status: 'failed', reason: 'not_under_test' }),
    },
  })
  mock.module('@/lib/services/client-service', {
    namedExports: {
      ClientService: {
        approveClient: async () => {
          w.calls.push('approve_client')
          return { status: 'approved' }
        },
      },
    },
  })
  kinds = await import('@/lib/partnerships/partner-kind')
  admin = await import('@/lib/services/partner-proposal-admin-service')
  guides = await import('@/lib/services/guide-profile-service')
  queue = await import('@/lib/partner-requests/queue')
  countries = await import('@/components/admin/clients/shared/countries')
  ;({ PartnerRequestsQueue } = await import('@/components/admin/clients/board/PartnerRequests'))
  validation = await import('@/lib/services/portal-validation-service')
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
  assert.match(tab, /const photoMissing = profile\.photoUrl === null \|\| listRefused === 'photo'/)
  assert.match(tab, /const bioMissing = profile\.bio === null \|\| listRefused === 'bio'/)
  assert.match(tab, /const nothingToConfer = photoMissing \|\| bioMissing/)
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

test('BR-B2B-064 item 2 · BR-MONETIZACAO-039 item 6.c: the portal guide is created with its rate written as null, not zero and not absent', async () => {
  const out = await admin.createPromotedClient({}, { category: 'tour_guide', plan_choice: 'no_place' }, { clientType: 'tour_guide' })
  assert.deepEqual(out, { ok: true, clientId: CLIENT, created: true })
  assert.ok(w.insert)
  assert.ok('commission_rate' in w.insert)
  assert.equal(w.insert.commission_rate, null)
  assert.equal(w.insert.monthly_fee_cents, null)
  assert.equal(w.insert.client_type, 'tour_guide')

  // A guide submission from before #933's amendment sent `map_only`; it is still a guide.
  await admin.createPromotedClient({}, { category: 'tour_guide', plan_choice: 'map_only' }, { clientType: 'tour_guide' })
  assert.ok('commission_rate' in w.insert)
  assert.equal(w.insert.commission_rate, null)
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

// ── The default rate written by the one writer, after the approval ───────────────────────────

test('BR-B2B-064 item 2 · BR-MONETIZACAO-039 item 6.c: the portal guide approval calls apply_default_commission once, after the client is approved, with its id', async () => {
  const out = await validation.approvePortalSubmission(SUB, operator, 'op', CMS_OP, NOW)
  assert.deepEqual(out, { ok: true, status: 'live', clientId: CLIENT })
  assert.deepEqual(w.calls, [
    'claim',
    'create_client:tour_guide',
    'write_client_id',
    'approve_client',
    `commission:${CLIENT}`,
    'transition:approved',
    'copy_photo',
    'rpc:cms_publish_guide_profile',
    'transition:live',
  ])
  assert.equal(w.calls.filter((call) => call.startsWith('commission:')).length, 1)
  assert.equal(w.insert?.commission_rate, null)
})

test('BR-B2B-065 item 3 · BR-MONETIZACAO-039 item 6.f: the transfer without a base keeps its zero and never calls apply_default_commission', async () => {
  reset(PORTAL_TRANSFER)
  const out = await validation.approvePortalSubmission(SUB, operator, 'op', CMS_OP, NOW)
  assert.deepEqual(out, { ok: true, status: 'approved', clientId: CLIENT })
  assert.ok(!w.calls.some((call) => call.startsWith('commission:')))
  assert.equal(w.insert?.commission_rate, 0)
})

test('BR-MONETIZACAO-039 item 6.c: a failed apply_default_commission does not undo the approval, says so, and logs no personal data', async () => {
  const logged: unknown[][] = []
  const original = console.error
  console.error = (...args: unknown[]) => {
    logged.push(args)
  }
  try {
    const cases: [{ code: string; details?: string }, string][] = [
      [{ code: 'TGP22', details: 'status' }, 'commission_invalid_status'],
      [{ code: 'TGP22', details: 'client_type' }, 'commission_invalid_client_type'],
      [{ code: 'P0002' }, 'commission_client_not_found'],
      [{ code: 'PGRST202' }, 'commission_write_failed'],
    ]
    for (const [error, expected] of cases) {
      reset(PORTAL_GUIDE, { commissionError: error })
      const out = await validation.approvePortalSubmission(SUB, operator, 'op', CMS_OP, NOW)
      assert.deepEqual(out, { ok: true, status: 'live', clientId: CLIENT, commissionError: expected }, error.code)
      // The approval stands: the claim is kept, the transitions ran, the profile was published.
      assert.ok(!w.calls.includes('release'))
      assert.ok(w.calls.includes('transition:approved'))
      assert.ok(w.calls.includes('transition:live'))
    }
  } finally {
    console.error = original
  }
  const text = JSON.stringify(logged)
  assert.match(text, /default commission not written/)
  assert.doesNotMatch(text, /Ana Guia|ana@guia\.com\.br|22999998888/)
})

test('BR-MONETIZACAO-039 item 6.c: the route and the screen carry the unwritten rate to the curator', () => {
  const route = readFileSync(resolve(ROOT, 'app/api/admin/partnerships/validation/[submissionId]/route.ts'), 'utf8')
  assert.match(route, /commissionError: outcome\.commissionError \?\? null/)
  const decision = readFileSync(resolve(ROOT, 'components/admin/partner-proposals/ValidationDecision.tsx'), 'utf8')
  assert.match(decision, /commissionFailed: Boolean\(outcome\.commissionError\)/)
  const submission = readFileSync(resolve(ROOT, 'components/admin/clients/shared/PortalSubmission.tsx'), 'utf8')
  assert.match(submission, /result\?\.kind === 'approved' && result\.commissionFailed \? \(/)
  assert.match(submission, /t\('done\.commissionFailed'\)/)
  const pt = JSON.parse(readFileSync(resolve(ROOT, 'messages/pt.json'), 'utf8'))
  assert.equal(typeof pt.PartnerValidation.done.commissionFailed, 'string')
})

// ── "Aparece no app" refused: the reason the database names ──────────────────────────────────

test('BR-B2B-064 items 9.a and 11.a: TGP23 meeting_point, photo and bio each reach the tab as their own reason', async () => {
  assert.deepEqual(guides.guideRpcErrorOf('TGP23', 'meeting_point'), { httpStatus: 409, error: 'meeting_point_required' })
  assert.deepEqual(guides.guideRpcErrorOf('TGP23', 'photo'), { httpStatus: 409, error: 'photo_required' })
  assert.deepEqual(guides.guideRpcErrorOf('TGP23', 'bio'), { httpStatus: 409, error: 'bio_required' })
  // The database before #1184 sent no DETAIL: that was the meeting point.
  assert.deepEqual(guides.guideRpcErrorOf('TGP23'), { httpStatus: 409, error: 'meeting_point_required' })

  for (const [detail, expected] of [['meeting_point', 'meeting_point_required'], ['photo', 'photo_required'], ['bio', 'bio_required']]) {
    const refusing: any = {
      schema: () => ({ rpc: async () => ({ data: null, error: { code: 'TGP23', details: detail, message: 'x' } }) }),
    }
    const original = console.error
    console.error = () => {}
    try {
      assert.deepEqual(await guides.setGuideListed(refusing, CLIENT, true), { ok: false, httpStatus: 409, error: expected })
    } finally {
      console.error = original
    }
  }

  const tab = readFileSync(resolve(ROOT, 'components/admin/clients/tabs/GuideProfileTab.tsx'), 'utf8')
  assert.match(tab, /meeting_point_required: 'meeting_point', photo_required: 'photo', bio_required: 'bio'/)
  assert.match(tab, /const pointMissing = listLocked \|\| listRefused === 'meeting_point'/)
  assert.match(tab, /photoMissing && bioMissing \? 'incompleteLocked' : photoMissing \? 'photoLocked' : 'bioLocked'/)
  for (const locale of ['pt', 'en', 'es']) {
    const visibility = JSON.parse(readFileSync(resolve(ROOT, `messages/${locale}.json`), 'utf8')).Clients.guide.visibility
    for (const key of ['listedLocked', 'incompleteLocked', 'photoLocked', 'bioLocked']) {
      assert.equal(typeof visibility[key], 'string', `${locale} ${key}`)
    }
  }
})

// ── The queue: a guide request that links a Portal guide ─────────────────────────────────────

function queueHtml(rows: Record<string, unknown>[]) {
  const messages = JSON.parse(readFileSync(resolve(ROOT, 'messages/pt.json'), 'utf8'))
  return renderToStaticMarkup(
    // eslint-disable-next-line react/no-children-prop
    createElement(NextIntlClientProvider, {
      locale: 'pt',
      messages: { Clients: { board: { requests: messages.Clients.board.requests } } },
      timeZone: 'America/Sao_Paulo',
      children: createElement(PartnerRequestsQueue, {
        requests: queue.parsePartnerRequestRows(rows) ?? [],
        status: 'ready',
        busyId: null,
        notice: null,
        onApprove: () => {},
        onRefuse: () => {},
      }),
    })
  )
}

test('#1184 D5 · BR-B2B-066 item 5.a: the guide request that links a Portal guide shows the document in use, and not "completes the account record"', () => {
  const PORTAL_GUIDE_ID = '88888888-8888-4888-8888-888888888888'
  const linking = { ...GUIDE_ROW, document_in_use: true, existing_client_id: PORTAL_GUIDE_ID, record_shared: false }
  const [row] = queue.parsePartnerRequestRows([linking]) ?? []
  assert.equal(queue.linksPortalGuide(row), true)
  const html = queueHtml([linking])
  assert.match(html, /Documento já está em outro parceiro/)
  assert.doesNotMatch(html, /Completa o cadastro que a conta já tem/)

  // A creator completing its own record keeps the line.
  const creator = { ...RPC_ROWS[0], document_in_use: false, existing_client_id: PORTAL_GUIDE_ID, record_shared: false }
  const [own] = queue.parsePartnerRequestRows([creator]) ?? []
  assert.equal(queue.linksPortalGuide(own), false)
  assert.match(queueHtml([creator]), /Completa o cadastro que a conta já tem/)
})
