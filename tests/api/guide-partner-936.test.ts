/**
 * #936 — the tour guide and the transfer without a base in the CMS: one function decides the kind,
 * the approval creates no place, the guide's "Publicado" is its profile, and the guide without
 * consent does not approve. BR-B2B-054 items 4 and 5, BR-B2B-064, BR-B2B-065, BR-B2B-057
 * (as amended on 2026-10-16), DS-COPY-020.
 *
 * The database is faked; what runs for real is `partnerKindOf`, `derivePipelineState`,
 * `conferenceItems`, `buildPlacePrefill`, the admin service's client insert and the order of
 * `approvePortalSubmission` / `publishApprovedGuide`. That `core.app_get_nearby_guides` drops a
 * hidden guide is the database's promise, proven by the lab of #933 (`scripts/lab/test-issue933.sql`);
 * here, that hiding calls `cms_set_guide_hidden` with a reason and that the queue reads it.
 *
 * Run with: npm run test:api
 */

import { test, before, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'

const SUB = '11111111-1111-4111-8111-111111111111'
const CLIENT = '33333333-3333-4333-8333-333333333333'
const CMS_OP = '44444444-4444-4444-8444-444444444444'
const PHOTO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg'
const NOW = new Date('2026-10-16T12:00:00.000Z')

const GUIDE = {
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
const TRANSFER = {
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
  submission: Record<string, unknown>
  calls: string[]
  clientInsert: Record<string, unknown> | null
  publishError: { code: string; details?: string } | null
  copyError: { message: string } | null
  rpcArgs: Record<string, unknown>[]
  /** The client `findClientByTaxId` finds by the CNPJ the partner typed; null = none. */
  existingClient: Record<string, unknown> | null
}
let w: World

function reset(answers: Record<string, string> = GUIDE, over: Partial<World> = {}) {
  w = {
    submission: { id: SUB, status: 'in_review', answers, attraction_id: null, client_id: null },
    calls: [],
    clientInsert: null,
    publishError: null,
    copyError: null,
    rpcArgs: [],
    existingClient: null,
    ...over,
  }
}

function table(name: string) {
  let update: Record<string, unknown> | null = null
  let insert: Record<string, unknown> | null = null
  const q: any = {
    select: () => q,
    eq: () => q,
    in: () => q,
    limit: () => q,
    order: () => q,
    or: () => q,
    update: (values: Record<string, unknown>) => {
      update = values
      if ('approval_claimed_at' in values) w.calls.push(values.approval_claimed_at ? 'claim' : 'release')
      if ('client_id' in values) {
        w.calls.push('write_client_id')
        w.submission.client_id = values.client_id
      }
      if ('attraction_id' in values) w.calls.push('write_attraction_id')
      return q
    },
    insert: (values: Record<string, unknown>) => {
      insert = values
      w.clientInsert = values
      w.calls.push(`create_client:${values.client_type}`)
      return q
    },
    single: async () => ({ data: insert ? { id: CLIENT } : null, error: null }),
    maybeSingle: async () => {
      if (name === 'place_submissions') return { data: w.submission, error: null }
      if (name === 'place_acceptances') return { data: { email: 'ana@guia.com.br', plan_choice: null }, error: null }
      if (name === 'clients') return { data: { email: 'ana@guia.com.br', name: 'Ana Guia' }, error: null }
      return { data: null, error: null }
    },
    then: (resolve: (v: unknown) => unknown) => {
      if (update && update.approval_claimed_at) return resolve({ data: [{ id: SUB }], error: null })
      if (name === 'clients' && !update && !insert && w.existingClient) return resolve({ data: [w.existingClient], error: null })
      return resolve({ data: [], error: null })
    },
  }
  return q
}

const service = {
  schema: () => ({
    from: (name: string) => table(name),
    rpc: async (_name: string, args: Record<string, unknown>) => {
      w.calls.push(`transition:${args.p_to}`)
      w.submission.status = args.p_to
      return { data: args.p_to, error: null }
    },
  }),
  storage: {
    from: (bucket: string) => ({
      copy: async (from: string, to: string, options: { destinationBucket: string }) => {
        w.calls.push(`copy:${bucket}/${from}->${options.destinationBucket}/${to}`)
        return { data: null, error: w.copyError }
      },
    }),
  },
}

const operator: any = {
  schema: () => ({
    from: () => {
      throw new Error('no POI read on the path without a place')
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      w.calls.push(`rpc:${name}`)
      w.rpcArgs.push(args)
      if (name === 'cms_publish_guide_profile' && w.publishError) return { data: null, error: w.publishError }
      if (name === 'cms_set_guide_hidden') return { data: args.p_hidden, error: null }
      return { data: CLIENT, error: null }
    },
  }),
}

let validation: typeof import('@/lib/services/portal-validation-service')
let pipeline: typeof import('@/lib/partnerships/pipeline')
let kinds: typeof import('@/lib/partnerships/partner-kind')
let review: typeof import('@/lib/partnerships/portal-review')
let prefill: typeof import('@/lib/partner-form/place-prefill')
let board: typeof import('@/lib/clients/board-transitions')
let guides: typeof import('@/lib/services/guide-profile-service')

before(async () => {
  mock.module('@/lib/core/supabase-client', { namedExports: { getSupabaseService: () => service } })
  mock.module('@/lib/services/partner-place-provisioning', {
    namedExports: {
      createPrefilledPlace: async () => {
        w.calls.push('create_poi')
        return { status: 'created', attractionId: 'never' }
      },
      applyPlacePrefill: async () => {
        w.calls.push('apply_place')
        return { status: 'created' }
      },
      applyPrefillDescription: async () => {
        w.calls.push('describe')
        return { status: 'created' }
      },
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
  validation = await import('@/lib/services/portal-validation-service')
  pipeline = await import('@/lib/partnerships/pipeline')
  kinds = await import('@/lib/partnerships/partner-kind')
  review = await import('@/lib/partnerships/portal-review')
  prefill = await import('@/lib/partner-form/place-prefill')
  board = await import('@/lib/clients/board-transitions')
  guides = await import('@/lib/services/guide-profile-service')
})

beforeEach(() => reset())

// ── One function decides the kind ─────────────────────────────────────────────────────────────

test('BR-B2B-054 items 4 and 5 · BR-B2B-065 item 1: partnerKindOf — guide, transfer without a base, and everything else is a place', () => {
  assert.equal(kinds.partnerKindOf({ category: 'tour_guide' }), 'guide')
  assert.equal(kinds.partnerKindOf({ category: 'transfer', has_service_address: 'false' }), 'referral_only')
  assert.equal(kinds.partnerKindOf({ category: 'transfer', has_service_address: 'true' }), 'place')
  assert.equal(kinds.partnerKindOf({ category: 'travel_agency' }), 'place')
  assert.equal(kinds.partnerKindOf({ category: 'restaurant' }), 'place')
  assert.equal(kinds.partnerKindOf(null), 'place')
})

test('BR-B2B-054 item 5: agency and transfer with an address are `service`; the guide and the transfer without one have no place to prefill', () => {
  assert.equal(prefill.PLACE_TYPE_BY_CATEGORY.travel_agency, 'service')
  assert.equal(prefill.PLACE_TYPE_BY_CATEGORY.transfer, 'service')
  assert.equal(prefill.PLACE_TYPE_BY_CATEGORY.tour_guide, null)
  assert.equal(prefill.buildPlacePrefill(GUIDE), null)
  assert.equal(prefill.buildPlacePrefill(TRANSFER), null)
  assert.equal(prefill.buildPlacePrefill({ ...TRANSFER, has_service_address: 'true' })?.create.place_type, 'service')
})

test('BR-B2B-020 item 8 · BR-B2B-064 item 1 · BR-B2B-065 item 2: the new client is born tour_guide / driver; the record has no Locais tab', () => {
  assert.equal(kinds.clientTypeOfKind('guide'), 'tour_guide')
  assert.equal(kinds.clientTypeOfKind('referral_only'), 'driver')
  assert.equal(kinds.clientTypeOfKind('place'), 'venue')
  assert.equal(kinds.placesTabOf('guide'), 'guide')
  assert.equal(kinds.placesTabOf('referral_only'), null)
  assert.equal(kinds.placesTabOf('place'), 'places')
})

test('BR-B2B-064 item 9 · BR-B2B-065 item 5: the conference of a partner without a place is Quem é plus Perfil no app (or Atendimento) — no POI gates', () => {
  const base = { planChoice: 'map_and_description', hasOffers: true, photoCount: 3 }
  assert.deepEqual(review.conferenceItems({ ...base, kind: 'guide' }), ['person', 'profile'])
  assert.deepEqual(review.conferenceItems({ ...base, kind: 'referral_only' }), ['person', 'service'])
  assert.deepEqual(review.conferenceItems({ ...base, kind: 'place' }), ['company', 'place', 'story', 'offers', 'photos'])
})

// ── The queue ─────────────────────────────────────────────────────────────────────────────────

function portalState(over: Partial<import('@/lib/partnerships/pipeline').PipelineInput>) {
  return pipeline.derivePipelineState({
    origin: 'portal',
    portalStatus: 'approved',
    proposalStatus: 'submitted',
    conference: { documentsSeen: [] } as never,
    clientId: CLIENT,
    gateMissing: [],
    placeCount: 0,
    publishedPlaceCount: 0,
    ...over,
  })
}

test('BR-B2B-064 item 10 · BR-B2B-057: the guide is Publicado by its active and visible profile, never by a place', () => {
  assert.equal(portalState({ partnerKind: 'guide', portalStatus: 'live', guideProfile: { hidden: false, consent: true } }), 'published')
  assert.equal(portalState({ partnerKind: 'guide', portalStatus: 'approved', guideProfile: { hidden: false, consent: true } }), 'published')
  // approved and the profile never reached the app: work, "Aprovado, falta publicar o perfil"
  const pending = portalState({ partnerKind: 'guide', guideProfile: null })
  assert.equal(pending, 'approved_awaiting_narration')
  assert.equal(pipeline.stateMessageKey(pending, 'guide'), 'approved_awaiting_guide_profile')
  assert.equal(pipeline.stateMessageKey(pending, 'place'), 'approved_awaiting_narration')
  // the gate of BR-B2B-057 item 3 still comes first
  assert.equal(portalState({ partnerKind: 'guide', guideProfile: { hidden: false, consent: true }, gateMissing: ['partner_code'] as never }), 'awaiting_acceptance')
})

test('BR-B2B-064 items 5 and 11: hidden by the curator or without consent is Oculto do app — terminal, out of the default filter, in the Publicado column', () => {
  assert.equal(portalState({ partnerKind: 'guide', portalStatus: 'live', guideProfile: { hidden: true, consent: true } }), 'hidden_from_app')
  assert.equal(portalState({ partnerKind: 'guide', portalStatus: 'live', guideProfile: { hidden: false, consent: false } }), 'hidden_from_app')
  assert.ok(!pipeline.IN_PROGRESS_STATES.includes('hidden_from_app'))
  assert.ok(pipeline.PIPELINE_STATES.includes('hidden_from_app'))
  assert.equal(board.columnOf('hidden_from_app'), 'published')
})

test('BR-B2B-065 · DS-COPY-020: the transfer without a base, approved or live, ends in Ativo, só QR', () => {
  assert.equal(portalState({ partnerKind: 'referral_only', portalStatus: 'approved' }), 'referral_only')
  assert.equal(portalState({ partnerKind: 'referral_only', portalStatus: 'live' }), 'referral_only')
  assert.equal(portalState({ partnerKind: 'referral_only', portalStatus: 'in_review' }), 'in_validation')
  assert.ok(!pipeline.IN_PROGRESS_STATES.includes('referral_only'))
  assert.equal(board.columnOf('referral_only'), 'published')
})

// ── The approval ──────────────────────────────────────────────────────────────────────────────

test('BR-B2B-064 items 3 and 10: approving the guide creates no place and publishes the profile in the same act', async () => {
  const out = await validation.approvePortalSubmission(SUB, operator, 'op', CMS_OP, NOW)
  assert.deepEqual(out, { ok: true, status: 'live', clientId: CLIENT })
  assert.deepEqual(w.calls, [
    'claim',
    'create_client:tour_guide',
    'write_client_id',
    'approve_client',
    'transition:approved',
    `copy:place-submission-photos/${SUB}/facade/${PHOTO}->guide-photos/${CLIENT}/${PHOTO}`,
    'rpc:cms_publish_guide_profile',
    'transition:live',
  ])
  assert.ok(!w.calls.some((call) => call === 'create_poi' || call === 'apply_place' || call === 'describe'))
})

test('BR-B2B-064 item 2: the guide is born with commission zero, written as zero', async () => {
  await validation.approvePortalSubmission(SUB, operator, 'op', CMS_OP, NOW)
  assert.equal(w.clientInsert?.commission_rate, 0)
  assert.equal(w.clientInsert?.client_type, 'tour_guide')
})

test('BR-B2B-064 item 5: the guide without consent does not approve — refused before the claim and before any write', async () => {
  reset({ ...GUIDE, public_contact_consent: 'false' })
  const out = await validation.approvePortalSubmission(SUB, operator, 'op', CMS_OP, NOW)
  assert.deepEqual(out, { ok: false, httpStatus: 422, error: 'no_contact_consent' })
  assert.deepEqual(w.calls, [])
  reset({ ...GUIDE, public_contact_consent: undefined as unknown as string })
  assert.equal((await validation.approvePortalSubmission(SUB, operator, 'op', CMS_OP, NOW)).ok, false)
})

test('#936 security review: a CNPJ of a client of another type neither links nor approves — refused before any write', async () => {
  const OTHER = '55555555-5555-4555-8555-555555555555'
  reset({ ...GUIDE, tax_id: '11.222.333/0001-81' }, { existingClient: { id: OTHER, name: 'Pousada', email: 'x@p.com', client_type: 'venue' } })
  const out = await validation.approvePortalSubmission(SUB, operator, 'op', CMS_OP, NOW)
  assert.deepEqual(out, { ok: false, httpStatus: 409, error: 'tax_id_other_client_type' })
  assert.deepEqual(w.calls, ['claim', 'release'])
  assert.equal(w.submission.client_id, null)

  reset({ ...TRANSFER, tax_id: '11.222.333/0001-81' }, { existingClient: { id: OTHER, name: 'Ana', email: 'x@p.com', client_type: 'tour_guide' } })
  const transfer = await validation.approvePortalSubmission(SUB, operator, 'op', CMS_OP, NOW)
  assert.equal(transfer.ok, false)
  assert.deepEqual(w.calls, ['claim', 'release'])
})

test('#936: a CNPJ of a client of the same type links that client, no new client', async () => {
  reset({ ...GUIDE, tax_id: '11.222.333/0001-81' }, { existingClient: { id: CLIENT, name: 'Ana Guia', email: 'ana@guia.com.br', client_type: 'tour_guide' } })
  const out = await validation.approvePortalSubmission(SUB, operator, 'op', CMS_OP, NOW)
  assert.equal(out.ok, true)
  assert.deepEqual(w.calls.slice(0, 4), ['claim', 'write_client_id', 'approve_client', 'transition:approved'])
  assert.equal(w.clientInsert, null)
})

test('#936 §3: the publication failing leaves the guide approved, says so, and "Publicar o perfil" converges', async () => {
  reset(GUIDE, { publishError: { code: 'TGP22', details: 'profile_photo' } })
  const out = await validation.approvePortalSubmission(SUB, operator, 'op', CMS_OP, NOW)
  assert.deepEqual(out, { ok: true, status: 'approved', clientId: CLIENT, guidePublishError: 'invalid_profile_photo' })
  assert.ok(!w.calls.includes('transition:live'))
  assert.ok(!w.calls.includes('release'))

  w.publishError = null
  w.calls = []
  const retry = await validation.publishApprovedGuide(SUB, operator, 'op')
  assert.deepEqual(retry, { ok: true, status: 'live', clientId: CLIENT })
  assert.deepEqual(w.calls.slice(-2), ['rpc:cms_publish_guide_profile', 'transition:live'])
})

test('#936: a photo path that is not the submission\'s own facade never reaches Storage', async () => {
  assert.equal(guides.guidePhotoCopyPaths(SUB, CLIENT, `../${SUB}/facade/${PHOTO}`), null)
  assert.equal(guides.guidePhotoCopyPaths(SUB, CLIENT, `${CLIENT}/facade/${PHOTO}`), null)
  assert.deepEqual(guides.guidePhotoCopyPaths(SUB, CLIENT, `${SUB}/facade/${PHOTO}`), {
    from: `${SUB}/facade/${PHOTO}`,
    to: `${CLIENT}/${PHOTO}`,
  })
})

test('BR-B2B-065 items 2 and 3: the transfer without a base is approved as a driver, with no place and nothing to publish', async () => {
  reset(TRANSFER)
  const out = await validation.approvePortalSubmission(SUB, operator, 'op', CMS_OP, NOW)
  assert.deepEqual(out, { ok: true, status: 'approved', clientId: CLIENT })
  assert.deepEqual(w.calls, ['claim', 'create_client:driver', 'write_client_id', 'approve_client', 'transition:approved'])
  assert.equal(w.clientInsert?.commission_rate, 0)
})

test('#936: the decision route takes publish_guide', () => {
  assert.deepEqual(validation.parsePortalDecision({ action: 'publish_guide' }), { action: 'publish_guide' })
})

// ── Hiding ────────────────────────────────────────────────────────────────────────────────────

test('BR-B2B-064 item 11: hiding requires a reason, and the call carries it to cms_set_guide_hidden; showing clears it', async () => {
  assert.equal(guides.guideHideReasonText(undefined, undefined), null)
  assert.equal(guides.guideHideReasonText('other', '   '), null)
  assert.equal(guides.guideHideReasonText('tourist_report', undefined), 'tourist_report')
  assert.equal(guides.guideHideReasonText('other', 'Pediu para sair por um mês'), 'Pediu para sair por um mês')

  const hidden = await guides.setGuideHidden(operator, CLIENT, true, 'tourist_report')
  assert.deepEqual(hidden, { ok: true, value: true })
  assert.deepEqual(w.rpcArgs[w.rpcArgs.length - 1], {
    p_client_id: CLIENT,
    p_hidden: true,
    p_reason: 'tourist_report',
  })
  const shown = await guides.setGuideHidden(operator, CLIENT, false, 'ignored')
  assert.deepEqual(shown, { ok: true, value: false })
  assert.deepEqual(w.rpcArgs[w.rpcArgs.length - 1], { p_client_id: CLIENT, p_hidden: false, p_reason: null })
})
