/**
 * The partnership pipeline on one surface — #359, épico #356.
 *
 * The card's obligatory case is the defect it was measured against: of the 6 clients with a
 * `welcome_poi_id`, 3 have ZERO trigger points — places that are published, intact, and mute.
 * So the assertions that matter most are the ones about the middle class of pendency
 * (`silences_app`) and about the act that starts money, and each of those is proved twice:
 * once on the pure decision and once end to end through the route.
 *
 * Mutations run against this suite, each one turning it red:
 *  · dropping `activeTriggerPointCount === 0` from `buildPlaceReadiness`;
 *  · moving `boundary` out of `improves`;
 *  · making `buildPublishPlan` answer `paid_starts` without a description on air;
 *  · letting the publish route write a second column.
 *
 * Run with: npm run test:api
 */

import { test, before, mock } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'

import {
  PENDENCY_CLASS,
  buildPlaceReadiness,
  leastAdvanced,
  summarizePlaces,
  type PartnerPlaceFacts,
} from '@/lib/partnerships/place-readiness'
import { buildPublishPlan, formatMonthlyFee } from '@/lib/partnerships/publish-plan'
import {
  IN_PROGRESS_STATES,
  PIPELINE_STATES,
  conferenceStarted,
  derivePipelineState,
  detailPath,
} from '@/lib/partnerships/pipeline'
import { EMPTY_CONFERENCE, type ConferenceRecord } from '@/lib/partner-form/regularity'
import { PUBLIC_PATH_PREFIXES } from '@/lib/roles'
import { deriveTriageStatus, isTriageOverdue } from '@/lib/partnerships/triage'

const REPO_ROOT = resolve(import.meta.dirname, '../..')

const CLIENT_ID = '44444444-4444-4444-4444-444444444444'
const SUBMISSION_ID = '33333333-3333-3333-3333-333333333333'
const PLACE_ID = '77777777-7777-7777-7777-777777777777'
const OTHER_PLACE_ID = '88888888-8888-8888-8888-888888888888'
const OPERATOR_ID = 'cms-user-1'

/** A place with everything in place. Each test takes away exactly the fact it is about. */
function place(overrides: Partial<PartnerPlaceFacts> = {}): PartnerPlaceFacts {
  return {
    attractionId: PLACE_ID,
    name: 'Cantina do Zé',
    city: 'Santos',
    region: 'SP',
    // What `core.cms_create_place` writes, and therefore what a partner's place IS.
    entityKind: 'place',
    approved: false,
    isActive: true,
    latitude: -23.96,
    longitude: -46.33,
    showInMap: true,
    activeTriggerPointCount: 3,
    audioDescriptionCount: 1,
    hasBoundary: true,
    ...overrides,
  }
}

function conference(overrides: Partial<ConferenceRecord> = {}): ConferenceRecord {
  return { ...EMPTY_CONFERENCE, ...overrides }
}

// ── The pendencies — DS-COMPONENTE-020, criteria 8 to 14 ─────────────────────────────────────

test('#359 crit. 9 · DS-COMPONENTE-020: a null coordinate is the ONLY pendency of the blocking class', () => {
  const readiness = buildPlaceReadiness(place({ latitude: null, longitude: null }))

  assert.deepEqual(readiness.blocking, ['coordinate'])
  assert.equal(
    readiness.blocking.indexOf('hidden_from_map'),
    -1,
    'with no coordinate at all, `show_in_map` decides nothing and must not be named twice'
  )
  assert.equal(readiness.published, false, 'and it cannot be in the app')
})

test('#359 crit. 10 · BR-B2B-011: no active trigger point SILENCES the place and does not block publishing', () => {
  // This is the measured case of #356: 3 of the 6 clients with a `welcome_poi_id`.
  const readiness = buildPlaceReadiness(place({ activeTriggerPointCount: 0 }))

  assert.deepEqual(readiness.silencing, ['trigger_point'])
  assert.deepEqual(readiness.blocking, [], 'nothing blocks — the place appears, and is mute')

  const plan = buildPublishPlan(
    { monthlyFeeCents: 24_900, isCourtesy: false, courtesyReason: null },
    readiness
  )
  assert.equal(plan.offersAct, true, 'the screen offers the act; no software turns the place down')
})

test('#359 crit. 11: the audio pendency appears without `audio_url` and goes when there is one', () => {
  assert.deepEqual(buildPlaceReadiness(place({ audioDescriptionCount: 0 })).silencing, [
    'audio_description',
  ])
  assert.deepEqual(buildPlaceReadiness(place({ audioDescriptionCount: 1 })).silencing, [])
})

test('#359 crit. 12 · DS-COMPONENTE-020 pt. 3: an absent boundary is a MELHORIA and never blocks', () => {
  const readiness = buildPlaceReadiness(place({ hasBoundary: false }))

  assert.equal(PENDENCY_CLASS.boundary, 'improves')
  assert.deepEqual(readiness.improving, ['boundary'])
  assert.deepEqual(readiness.blocking, [], 'it is not in the blocking class')
  assert.deepEqual(readiness.silencing, [], 'and it is not in the silencing one either')
})

test('#359 crit. 13: a place with nothing missing reads `ready`, not an empty block', () => {
  const readiness = buildPlaceReadiness(place())
  assert.equal(readiness.ready, true)
  assert.deepEqual(readiness.pending, [])
})

test('#359: `hidden_from_map` blocks a POI, and says nothing about a `place`', () => {
  // `show_in_map` is in the POI predicate (`core.app_poi_read_build`) and NOT in the places one
  // (`core.app_get_nearby_places`). A partner's place is `entity_kind = 'place'`, so naming it
  // there would send the operator to fix a flag that decides nothing for that kind.
  const poi = buildPlaceReadiness(place({ entityKind: 'poi', showInMap: false }))
  assert.deepEqual(poi.blocking, ['hidden_from_map'])
  assert.equal(poi.published, false)

  const partnerPlace = buildPlaceReadiness(place({ approved: true, showInMap: false }))
  assert.deepEqual(partnerPlace.blocking, [])
  assert.equal(partnerPlace.published, true, 'a `place` is visible regardless of show_in_map')
})

test('#359 · BR-POI-005 · #362: a deactivated registration is out of the app, both kinds', () => {
  for (const entityKind of ['place', 'poi']) {
    const readiness = buildPlaceReadiness(place({ entityKind, approved: true, isActive: false }))
    assert.equal(readiness.published, false, entityKind)
    assert.equal(readiness.blocking.indexOf('inactive') >= 0, true, entityKind)
  }
})

test('#359 crit. 19 · the visibility predicate of the kind the partner place actually is', () => {
  // `core.cms_create_place` inserts `entity_kind = 'place'`, so the partner's place never
  // enters `core.app_poi_read` — it is served by `core.app_get_nearby_places`, whose predicate
  // is `entity_kind = 'place' AND approved AND is_active AND location_geography IS NOT NULL`
  // (`supabase/migrations/20260709_02_places_narration_payload.sql`). Trigger point and audio
  // are deliberately NOT part of it.
  assert.equal(buildPlaceReadiness(place({ approved: true })).published, true)
  assert.equal(
    buildPlaceReadiness(place({ approved: true, activeTriggerPointCount: 0 })).published,
    true,
    'a mute place is still in the app — that is the whole defect this screen exposes'
  )
  assert.equal(buildPlaceReadiness(place({ approved: false })).published, false)
  assert.equal(
    buildPlaceReadiness(place({ approved: true, latitude: null, longitude: null })).published,
    false
  )
  assert.equal(buildPlaceReadiness(place({ approved: true, isActive: false })).published, false)
})

test('#359 crit. 5 · DS-COMPONENTE-020: 3 places, 2 published shows the PROPORTION and the least advanced', () => {
  const readiness = [
    buildPlaceReadiness(place({ attractionId: PLACE_ID, approved: true })),
    buildPlaceReadiness(
      place({ attractionId: OTHER_PLACE_ID, approved: true, hasBoundary: false })
    ),
    // The one that is stuck: not published, no coordinate, no trigger point.
    buildPlaceReadiness(
      place({
        attractionId: 'stuck',
        approved: false,
        latitude: null,
        longitude: null,
        activeTriggerPointCount: 0,
      })
    ),
  ]

  const summary = summarizePlaces(readiness)
  assert.equal(summary.total, 3)
  assert.equal(summary.published, 2)

  const worst = leastAdvanced(readiness)
  assert.equal(worst?.place.attractionId, 'stuck')
  assert.equal(
    summary.blocking,
    worst?.blocking.length,
    'the count is the least advanced place, never the sum across places'
  )
  assert.equal(summary.silencing, worst?.silencing.length)
  assert.equal(summary.allReady, false)
})

test('#359 crit. 8 · DS-COMPONENTE-020 pt. 4: queue count and detail list are one module', () => {
  // The queue shows `summarizePlaces`, the detail shows each `buildPlaceReadiness`. The two
  // cannot disagree because the first is derived from the second — asserted, not claimed.
  const readiness = [
    buildPlaceReadiness(place({ attractionId: PLACE_ID, activeTriggerPointCount: 0 })),
    buildPlaceReadiness(place({ attractionId: OTHER_PLACE_ID, approved: true })),
  ]
  const summary = summarizePlaces(readiness)
  const worst = leastAdvanced(readiness)

  assert.equal(summary.blocking, worst?.blocking.length)
  assert.equal(summary.silencing, worst?.silencing.length)
  assert.equal(summary.improving, worst?.improving.length)
})

// ── The act of publishing — DS-COMPONENTE-021, criteria 15 to 17 ─────────────────────────────

test('#359 crit. 15 · BR-B2B-017/018: paid tier with a description on air is the variant that starts money', () => {
  const readiness = buildPlaceReadiness(place())
  const plan = buildPublishPlan(
    { monthlyFeeCents: 24_900, isCourtesy: false, courtesyReason: null },
    readiness
  )

  assert.equal(plan.variant, 'paid_starts')
  assert.equal(plan.startsBilling, true)
  assert.equal(plan.feeCents, 24_900)
  assert.equal(plan.offersAct, true)
  // The value has to be printable on the button, in reais and only in reais (BR-B2B-017,
  // 1st edge case). The number is never a literal in code — it comes from the record.
  assert.match(formatMonthlyFee(plan.feeCents ?? 0), /249,00/)
})

test('#359 crit. 16 · BR-B2B-018 1st edge case: paid tier WITHOUT a description starts nothing', () => {
  const readiness = buildPlaceReadiness(place({ audioDescriptionCount: 0 }))
  const plan = buildPublishPlan(
    { monthlyFeeCents: 24_900, isCourtesy: false, courtesyReason: null },
    readiness
  )

  assert.equal(plan.variant, 'paid_pending')
  assert.equal(plan.startsBilling, false, 'nothing begins to run')
  assert.equal(plan.feeCents, null, 'and no value is printed, because none is starting')
  assert.equal(plan.offersAct, true)
})

test('#359 crit. 17 · DS-COMPONENTE-021 pt. 2: no fee and no courtesy does NOT offer the act', () => {
  const readiness = buildPlaceReadiness(place())
  const plan = buildPublishPlan(
    { monthlyFeeCents: null, isCourtesy: false, courtesyReason: null },
    readiness
  )

  assert.equal(plan.variant, 'undeclared')
  assert.equal(plan.offersAct, false)
  assert.equal(plan.startsBilling, false)
})

test('#359 crit. 17 · BR-B2B-017 item 6: registering the courtesy WITH a reason brings the act back', () => {
  const readiness = buildPlaceReadiness(place())
  const plan = buildPublishPlan(
    { monthlyFeeCents: null, isCourtesy: true, courtesyReason: 'Parceiro fundador de Búzios' },
    readiness
  )

  assert.equal(plan.variant, 'courtesy')
  assert.equal(plan.offersAct, true)
  assert.equal(plan.startsBilling, false)
  assert.equal(plan.courtesyReason, 'Parceiro fundador de Búzios')
})

test('#359 · BR-B2B-017 item 6: a courtesy with NO reason is an unexplained discount, not a decision', () => {
  const readiness = buildPlaceReadiness(place())
  const plan = buildPublishPlan(
    { monthlyFeeCents: null, isCourtesy: true, courtesyReason: '   ' },
    readiness
  )

  assert.equal(plan.variant, 'undeclared', 'same reading as `lib/contract/snapshot.ts`')
  assert.equal(plan.offersAct, false)
})

test('#359 · spec §5: with no description on air, an undeclared fee still PUBLISHES', () => {
  // The sentence that proves the boundary is in the right place: what the screen refuses is
  // the confirmation it cannot write truthfully, never the place (BR-B2B-011, preâmbulo).
  const readiness = buildPlaceReadiness(place({ audioDescriptionCount: 0 }))
  const plan = buildPublishPlan(
    { monthlyFeeCents: null, isCourtesy: false, courtesyReason: null },
    readiness
  )

  assert.equal(plan.variant, 'paid_pending')
  assert.equal(plan.offersAct, true)
})

test('#359 · DS-COMPONENTE-021: a blocking pendency withdraws the act, and only the act', () => {
  const readiness = buildPlaceReadiness(place({ latitude: null, longitude: null }))
  const plan = buildPublishPlan(
    { monthlyFeeCents: 24_900, isCourtesy: false, courtesyReason: null },
    readiness
  )

  // "A partir de agora o local entra no app" would be false with no coordinate, and the
  // pendency block right above already names what is missing and where it is fixed.
  assert.equal(plan.offersAct, false)
  assert.equal(plan.variant, 'paid_starts', 'the money reading is unchanged; only the offer is')
})

test('#359 · BR-B2B-017 item 5: courtesy wins over a fee that is also on the record', () => {
  const plan = buildPublishPlan(
    { monthlyFeeCents: 24_900, isCourtesy: true, courtesyReason: 'Piloto' },
    buildPlaceReadiness(place())
  )
  assert.equal(plan.variant, 'courtesy')
  assert.equal(plan.startsBilling, false)
})

// ── The states — DS-COPY-020, criteria 3 and 4 ───────────────────────────────────────────────

test('#359 crit. 3 · DS-COPY-020: every state derives from the condition the spec writes down', () => {
  const base = {
    proposalStatus: 'submitted' as const,
    conference: conference(),
    clientId: null,
    contractSigned: false,
    placeCount: 0,
    publishedPlaceCount: 0,
  }

  assert.equal(derivePipelineState(base), 'proposal_received')

  // State 2 has NO column behind it: it is derived from the conference having been started.
  assert.equal(
    derivePipelineState({ ...base, conference: conference({ licenseNumber: '12345' }) }),
    'in_conference'
  )
  assert.equal(conferenceStarted(conference()), false)
  assert.equal(conferenceStarted(conference({ documentsSeen: ['business_license'] })), true)

  assert.equal(
    derivePipelineState({ ...base, proposalStatus: 'promoted', clientId: CLIENT_ID }),
    'client_created'
  )
  assert.equal(
    derivePipelineState({
      ...base,
      proposalStatus: 'promoted',
      clientId: CLIENT_ID,
      contractSigned: true,
    }),
    'contract_signed'
  )
  assert.equal(
    derivePipelineState({
      ...base,
      proposalStatus: 'promoted',
      clientId: CLIENT_ID,
      contractSigned: true,
      placeCount: 1,
    }),
    'place_in_curation'
  )
  assert.equal(
    derivePipelineState({
      ...base,
      proposalStatus: 'promoted',
      clientId: CLIENT_ID,
      contractSigned: true,
      placeCount: 1,
      publishedPlaceCount: 1,
    }),
    'published'
  )
  assert.equal(derivePipelineState({ ...base, proposalStatus: 'discarded' }), 'discarded')
})

test('#359 crit. 5 · DS-COMPONENTE-020: one of three published is NOT `Publicado`', () => {
  assert.equal(
    derivePipelineState({
      proposalStatus: 'promoted',
      conference: conference(),
      clientId: CLIENT_ID,
      contractSigned: true,
      placeCount: 3,
      publishedPlaceCount: 2,
    }),
    'place_in_curation'
  )
})

test('#359 crit. 4: the default filter is `Em andamento` and carries no terminal state', () => {
  assert.equal(IN_PROGRESS_STATES.indexOf('discarded'), -1)
  assert.equal(IN_PROGRESS_STATES.indexOf('published'), -1)
  assert.equal(PIPELINE_STATES.indexOf('discarded') >= 0, true, 'but it is filterable by name')
})

test('#359 · spec §2: the identity of the row changes halfway, and so does the route', () => {
  assert.equal(
    detailPath('proposal_received', { submissionId: SUBMISSION_ID, clientId: null }),
    `/admin/partnerships/proposals/${SUBMISSION_ID}`
  )
  // From the client onwards the object is the client, and the client record is where the five
  // bands live now — the same header, one click from the fiscal data and the contract.
  assert.equal(
    detailPath('contract_signed', { submissionId: SUBMISSION_ID, clientId: CLIENT_ID }),
    `/admin/clients?clientId=${CLIENT_ID}&tab=partnership`
  )
  assert.equal(
    detailPath('discarded', { submissionId: SUBMISSION_ID, clientId: CLIENT_ID }),
    `/admin/partnerships/proposals/${SUBMISSION_ID}`,
    'a discarded proposal keeps pointing at where its reason and its restore control live'
  )
})

// ── The routes and the screens, statically — criteria 1, 2, 18, 29, 30 to 34, 36 ─────────────

function read(relative: string): string {
  return readFileSync(resolve(REPO_ROOT, relative), 'utf8')
}

test('#359 crit. 1: the old proposal LIST is gone and `Parcerias` opens the pipeline', () => {
  assert.equal(
    existsSync(resolve(REPO_ROOT, 'app/[locale]/admin/partner-proposals')),
    false,
    'the queue absorbed it; a screen with no route is an orphan (CLAUDE.md §6)'
  )
  assert.equal(
    existsSync(resolve(REPO_ROOT, 'app/[locale]/admin/partnerships/page.tsx')),
    true
  )
  assert.equal(
    existsSync(
      resolve(REPO_ROOT, 'app/[locale]/admin/partnerships/proposals/[submissionId]/page.tsx')
    ),
    true,
    'the conference screen moved route; it was not reopened'
  )

  const header = read('components/ui/Header.tsx')
  assert.match(header, /'Parcerias', href: '\/admin\/partnerships'/)
  assert.equal(
    header.indexOf('/admin/partner-proposals'),
    -1,
    'nothing in the menu points at the route that no longer exists'
  )
})

function messages(): Record<string, any> {
  return JSON.parse(read('messages/pt.json'))
}

test('#359 crit. 2 · DS-A11Y-003: every state has a text label, and they are all different', () => {
  const states = messages().Partnerships.states as Record<string, string>
  const labels = Object.keys(states).map((key) => states[key])

  for (const state of PIPELINE_STATES) {
    assert.equal(typeof states[state], 'string', `${state} has no label`)
    assert.equal(states[state].trim().length > 0, true, `${state} has an empty label`)
  }
  assert.equal(
    new Set(labels).size,
    labels.length,
    'two states with the same word would be indistinguishable in the column'
  )
})

test('#359 crit. 29: the pipeline screens hand the pt messages down explicitly', () => {
  // The namespace lives only in `messages/pt.json` (spec §2), and an ABSENT key in next-intl
  // renders the KEY NAME. "Only pt" and "`/en/` never shows `Partnerships.title`" are both
  // true only because of this provider.
  for (const page of [
    'app/[locale]/admin/partnerships/page.tsx',
    'app/[locale]/admin/partnerships/clients/[clientId]/page.tsx',
  ]) {
    const source = read(page)
    assert.match(source, /NextIntlClientProvider/, page)
    assert.match(source, /locale="pt"/, page)
    assert.match(source, /Partnerships: ptMessages\.Partnerships/, page)
  }

  const all = JSON.parse(read('messages/en.json'))
  assert.equal(
    'Partnerships' in all,
    false,
    'copying the Portuguese into en/es would create a second source of the same text'
  )
})

test('#359 crit. 30 to 32 · BR-B2B-010/011/022/029: what the copy may never claim', () => {
  const copy = JSON.stringify(messages().Partnerships).toLowerCase()

  // BR-B2B-010, item 3 — no surface may claim that an approved partner appears in the app.
  assert.equal(copy.indexOf('todo parceiro aprovado'), -1)
  assert.equal(copy.indexOf('aprovar a parceria publica'), -1)

  // BR-B2B-022, item 7 — the Tuggi does not verify, audit, inspect or certify anybody.
  for (const forbidden of ['fiscaliza', 'certifica', 'auditamos', 'verificamos a legalidade']) {
    assert.equal(copy.indexOf(forbidden), -1, `the copy must not say "${forbidden}"`)
  }

  // BR-B2B-029, item 1 — nothing may suggest the public form asks for the licence.
  assert.equal(copy.indexOf('formulário pede o alvará'), -1)

  // BR-B2B-011, item 6 — gate 3 is never described on a screen.
  assert.equal(copy.indexOf('portão 3'), -1)
  assert.equal(copy.indexOf('portao 3'), -1)

  // The one thing the copy MUST say, because BR-B2B-010, item 3, is the promise most easily
  // broken by a screen that puts the two acts side by side.
  assert.match(
    messages().Partnerships.detail.clientSeparateActs,
    /não aprova o local/i,
    'band 3 has to say that approving the partnership does not approve the place'
  )
})

test('#359 crit. 20 · BR-B2B-018: `Tirar do app` says what is written, and nothing beyond it', () => {
  const publish = messages().Partnerships.publish

  assert.match(publish.unpublishBody, /continuam aqui/)
  assert.match(publish.unpublishContract, /não encerra o contrato/)
  assert.match(publish.unpublishContract, /não cancela a cobrança/)
  // No rule describes the effect of the POI leaving the air (spec §9, question 1), so the copy
  // claims neither outcome.
  assert.equal(
    /a mensalidade (para|continua)/i.test(publish.unpublishContract),
    false,
    'the copy must not answer a question no rule answers'
  )
})

test('#359 crit. 34: no pipeline surface is public', () => {
  // It used to be checked against the public form: the merchant filling it in must not be
  // shown a word of the internal pipeline. #396 moved that form to `tuggi-enterprise`, so what
  // this repository can still assert is the stronger half — it serves NO session-less page in
  // that feature at all, and the pipeline's own vocabulary therefore cannot leak from one.
  assert.equal(
    existsSync(resolve(REPO_ROOT, 'app/[locale]/parceria/page.tsx')),
    false,
    'the public proposal left this deployment; the old address answers a 301'
  )
  for (const prefix of PUBLIC_PATH_PREFIXES) {
    assert.notEqual(prefix, '/parceria', 'no session-less prefix points at the pipeline')
  }
})

test('#390 · BR-B2B-026 item 4: the band that says `Assinar o contrato` links to the contract', () => {
  // The esteira named the next step of `client_created` and offered no way to take it: the
  // operator left for the client list, opened the modal and hunted for the tab. The step and
  // the door now live in the same band.
  assert.match(
    messages().Partnerships.nextSteps.client_created,
    /contrato/i,
    'the next step of this state is still the contract'
  )

  // The href moved into `contractHref`, which composes the same path and adds the way back —
  // so the assertion is on the destination, not on the shape of the JSX attribute.
  const detail = read('components/admin/partnerships/PartnershipDetail.tsx')
  assert.match(
    detail,
    /\/admin\/clients\/\$\{clientId\}\/contract/,
    'the client band links straight at the contract page'
  )
  assert.match(detail, /href=\{contractHref\(\)\}/, 'and the band uses that one builder')
  assert.match(detail, /t\('detail\.openContract'\)/, 'and it is labelled by a key, not a literal')

  // A link is only a door if the page is on the other side of it.
  assert.equal(
    existsSync(resolve(REPO_ROOT, 'app/[locale]/admin/clients/[clientId]/contract/page.tsx')),
    true
  )

  // #408: the CMS is Portuguese-only for now, and the label follows the rest of `Partnerships`
  // — one source of the text, not three that drift.
  assert.equal(typeof messages().Partnerships.detail.openContract, 'string')
  for (const locale of ['en', 'es']) {
    assert.equal(
      read(`messages/${locale}.json`).indexOf('openContract'),
      -1,
      `${locale}.json must not carry a second copy of this label`
    )
  }
})

test('#359 crit. 36 · DS-LAYOUT-006 pt. 4: no shortcut opens a new tab', () => {
  for (const file of [
    'components/admin/partnerships/PendencyList.tsx',
    'components/admin/partnerships/PartnershipDetail.tsx',
    'components/admin/partnerships/PartnershipsQueue.tsx',
  ]) {
    assert.equal(read(file).indexOf('target="_blank"'), -1, file)
  }
})

test('#359 crit. 35 · DS-LAYOUT-006: the tool opens ON the object and declares the way back', () => {
  const detail = read('components/admin/partnerships/PartnershipDetail.tsx')
  assert.match(detail, /\/pois\/\$\{attractionId\}/, 'the tool is reached on the POI itself')
  assert.match(detail, /returnTo/)
  assert.match(detail, /returnLabel/)

  const poiPage = read('app/[locale]/pois/[id]/page.tsx')
  assert.match(poiPage, /returnTo/, 'and the tool knows where to send the operator back')
  assert.match(poiPage, /initialTab/)

  // A return path that is not an in-app path is refused, so the query string cannot bounce an
  // authenticated operator out to another origin. The guard itself moved to
  // `lib/navigation/return-to` once a second screen needed it — the client record — and is
  // proved in `tests/api/return-to.test.ts`. What this suite still owns is that THIS page
  // navigates with the parsed value and never with the raw one.
  assert.match(poiPage, /parseReturnTo\(searchParams\?\.get\(RETURN_TO_PARAM\)\)/)
  assert.equal(
    poiPage.indexOf('router.push(rawReturnTo'),
    -1,
    'the unvalidated value must never reach a navigation'
  )
  assert.match(poiPage, /router\.push\(returnTo \?\? '\/pois'\)/)
})

test('#359 crit. 18: the publish path names ONE column, and none of the forbidden ones', () => {
  const route = read(
    'app/api/admin/partnerships/clients/[clientId]/places/[attractionId]/publish/route.ts'
  )
  for (const forbidden of ['commission_rate', 'monthly_fee_cents', 'is_courtesy', 'slug']) {
    // They appear in prose above the handler; what may not appear is a write of them.
    assert.equal(
      route.indexOf(`${forbidden}:`),
      -1,
      `the publish route must not write ${forbidden}`
    )
  }

  // The keys are named literally in `setApproved`, so the allowlist can be read off the source
  // instead of trusted: the publication (`approved`) and the stamp that says who put the place
  // in front of tourists and when. A fourth key cannot arrive from a call site.
  const service = read('lib/core/place-service.ts')
  const update = /async setApproved\([\s\S]{0,600}?\.update\((\{[\s\S]*?\})\)/.exec(service)
  assert.ok(update, 'setApproved still writes through a literal `.update({ ... })`')
  const written = (update![1].match(/^\s*(\w+)\s*[:,]/gm) ?? []).map((line) =>
    line.trim().replace(/[:,]$/, '')
  )
  assert.deepEqual(
    written.sort(),
    ['approved', 'approved_at', 'approved_by'],
    'setApproved writes the publication and nothing else'
  )
})

// ── The design validation of 2026-08-16 — what the six fixes have to keep true ────────────────

test('#359 · DS-COMPONENTE-021, 3rd/4th edge cases: refusing the act refuses the CONFIRMATION', () => {
  const panel = read('components/admin/partnerships/PublishPanel.tsx')

  // What blocks the place comes first, and whatever the tier variant is. The old guard revealed
  // one reason at a time: a place with no coordinate AND no declared fee showed only the fee,
  // so the operator registered it, came back, and only then met the coordinate — two trips.
  assert.equal(panel.indexOf("plan.variant !== 'undeclared' && !plan.offersAct"), -1)
  assert.match(panel, /const blocked = place\.readiness\.blocking\.length > 0/)
  const blockedAt = panel.indexOf('{blocked && (')
  const effectAt = panel.indexOf("t('publish.effectWithAudio')")
  const tierAt = panel.indexOf('{showTier && (')
  assert.ok(blockedAt > 0, 'the blocking notice renders on the blocking pendencies alone')
  assert.ok(blockedAt < effectAt && blockedAt < tierAt, 'and it is the first thing the panel says')

  // The sentence that describes the outcome does not survive the removal of the control that
  // causes it — the panel may not say "a partir de agora o local entra no app" above the notice
  // that it will not.
  assert.match(panel, /\{offersAct && \(\s*<p[\s\S]{0,240}?publish\.effectWithAudio/)

  // The tier block survives the refusal in exactly one case: when IT is the refusal, and the
  // way out (register the fee, or the courtesy with its reason) is written inside it.
  assert.match(panel, /const showTier = offersAct \|\| plan\.variant === 'undeclared'/)
})

test('#359 · DS-LAYOUT-003: the act the header names is in the band that opens', () => {
  const detail = read('components/admin/partnerships/PartnershipDetail.tsx')

  // `contract_signed` opens band 4, where `Criar o local a partir da proposta` lives — not
  // band 3, whose work is the contract that has just been signed.
  assert.match(detail, /client: \[2, 2\]/)
  assert.match(detail, /place: \[3, 4\]/)

  // `published` and `discarded` have no next step, and a bare em dash beside the state is not
  // the way to say so.
  assert.match(detail, /IN_PROGRESS_STATES\.indexOf\(detail\.state\) >= 0 && \(/)
})

test('#359 · DS-COMPONENTE-020, pt. 4: the detail never contradicts the queue about the app', () => {
  const detail = read('components/admin/partnerships/PartnershipDetail.tsx')
  // Band 5 cannot come from the pipeline state alone: a partnership with 2 of 3 places on air
  // is `place_in_curation`, and `ainda não` beside the queue's `2 de 3 locais publicados` is
  // the disagreement the single module exists to make impossible.
  assert.match(detail, /detail\.places\.some\(\(place\) => place\.readiness\.published\)/)

  // And a place that IS in the app does not read as "pronto para publicar". Only the branch
  // with no pendency at all splits — a published place with a `silences_app` pendency keeps
  // the whole block, which is the #356 defect.
  const list = read('components/admin/partnerships/PendencyList.tsx')
  assert.match(list, /readiness\.published \? 'published' : 'ready'/)
  assert.match(list, /if \(readiness\.ready\)/)
})

test('#359 · DS-COPY-020/-021: the copy the validation replaced', () => {
  const copy = messages().Partnerships

  // A queue row one click from a monthly fee may not read as "nothing to do here": three lines
  // in `Local em curadoria` showed `—` under `O que falta` while being ready to publish.
  assert.notEqual(copy.nextSteps.place_in_curation, '—')
  assert.match(copy.nextSteps.place_in_curation, /publicar/i)

  // The `inactive` body may not state a fact about the pendency beside it: a place with no
  // coordinate and inactive read "Falta a coordenada do local." above "…mesmo aprovado e com
  // coordenada."
  assert.equal(copy.pendencies.items.inactive.body.toLowerCase().indexOf('coordenada'), -1)

  // The label describes what the click does. There is no writer of `partner_client_id` on an
  // existing POI anywhere in the CMS — that is card #374.
  assert.equal(copy.pendencies.emptyLink.toLowerCase().indexOf('vincular'), -1)

  assert.equal(typeof copy.pendencies.publishedTitle, 'string')
  assert.equal(typeof copy.pendencies.publishedBody, 'string')
  assert.notEqual(copy.pendencies.publishedTitle, copy.pendencies.readyTitle)

  // The trail of a client with N places is N named lines, not N identical ones.
  assert.match(copy.publish.trailPublished, /\{name\}/)
  assert.match(copy.publish.trailPublishedAnonymous, /\{name\}/)
})

// ── The route, end to end — criteria 17, 18, 21, 22 ──────────────────────────────────────────

interface FakeState {
  clients: Record<string, any>[]
  attractions: Record<string, any>[]
  attraction_coordinate: Record<string, any>[]
  attraction_trigger_points: Record<string, any>[]
  attraction_descriptions: Record<string, any>[]
  /** #377 — the refusal outcome of the triage. Empty in every publish test, by design. */
  partner_triage_refusals: Record<string, any>[]
  audit_logs: Record<string, any>[]
  /** Every write that left the process, whole. Criterion 18 is proved against THIS. */
  writes: { table: string; patch: Record<string, any> }[]
}

let state: FakeState

function freshState(clientOverrides: Record<string, any> = {}): FakeState {
  return {
    clients: [
      {
        id: CLIENT_ID,
        name: 'Cantina do Zé',
        company_name: 'Cantina do Zé Alimentos Ltda',
        city: 'Santos',
        state: 'SP',
        tax_id: '12ABC34501DE35',
        status: 'approved',
        approved_at: '2026-08-15T10:32:00Z',
        created_at: '2026-08-14T09:00:00Z',
        monthly_fee_cents: 24_900,
        is_courtesy: false,
        courtesy_reason: null,
        ...clientOverrides,
      },
    ],
    attractions: [
      {
        id: PLACE_ID,
        name: 'Cantina do Zé',
        city: 'Santos',
        state: 'SP',
        entity_kind: 'place',
        approved: false,
        is_active: true,
        partner_client_id: CLIENT_ID,
      },
    ],
    attraction_coordinate: [
      {
        attraction_id: PLACE_ID,
        latitude: -23.96,
        longitude: -46.33,
        show_in_map: true,
        boundary_type: 'polygon',
        boundary_area_m2: 900,
      },
    ],
    attraction_trigger_points: [{ attraction_id: PLACE_ID, is_active: true }],
    attraction_descriptions: [{ attraction_id: PLACE_ID, audio_url: 'https://audio/1.mp3' }],
    partner_triage_refusals: [],
    audit_logs: [],
    writes: [],
  }
}

/**
 * One fake database behind both identities — the service client and the operator's — because
 * the pipeline reads with one and writes with the other, and a test where the write lands
 * somewhere the read cannot see proves nothing.
 */
function createFakeDb(current: () => FakeState) {
  function build(table: string) {
    const filters: { op: string; column: string; value: any }[] = []
    let operation: 'select' | 'update' | 'insert' = 'select'
    let payload: Record<string, any> | null = null

    function matches(row: Record<string, any>): boolean {
      return filters.every((filter) => {
        const value = row[filter.column]
        if (filter.op === 'eq') return value === filter.value
        if (filter.op === 'in') return (filter.value as any[]).indexOf(value) >= 0
        // `.is(col, null)` has to match a row that simply does not carry the column: an absent
        // key here IS a NULL column in Postgres, and reading it as "present and different" made
        // the write-once UPDATE of #377 miss the very row it exists for.
        if (filter.op === 'is') {
          return filter.value === null ? value == null : value === filter.value
        }
        if (filter.op === 'notIs') {
          return filter.value === null ? value != null : value !== filter.value
        }
        return true
      })
    }

    function apply() {
      const store = current()
      const rows = ((store as any)[table] ?? []) as Record<string, any>[]

      if (operation === 'insert') {
        const inserted = payload ?? {}
        // The stored row is a COPY, and it gets the `id` a real INSERT would: every table here
        // has `DEFAULT gen_random_uuid()`, and a row with no id cannot be addressed by the act
        // that comes after it (#377's communication is exactly that act). `writes` keeps what the
        // caller sent, unchanged — criterion 18 is proved against that and not against defaults.
        const stored = { id: randomUUID(), ...inserted }
        rows.push(stored)
        ;(store as any)[table] = rows
        store.writes.push({ table, patch: inserted })
        return { data: [stored], error: null }
      }

      const matched = rows.filter(matches)

      if (operation === 'update') {
        for (const row of matched) Object.assign(row, payload ?? {})
        store.writes.push({ table, patch: payload ?? {} })
        return { data: matched, error: null }
      }

      return { data: matched, error: null }
    }

    const chain: any = {
      select: () => chain,
      insert: (values: Record<string, any>) => {
        operation = 'insert'
        payload = values
        return chain
      },
      update: (values: Record<string, any>) => {
        operation = 'update'
        payload = values
        return chain
      },
      eq: (column: string, value: any) => {
        filters.push({ op: 'eq', column, value })
        return chain
      },
      in: (column: string, value: any[]) => {
        filters.push({ op: 'in', column, value })
        return chain
      },
      is: (column: string, value: any) => {
        filters.push({ op: 'is', column, value })
        return chain
      },
      not: (column: string, _operator: string, value: any) => {
        filters.push({ op: 'notIs', column, value })
        return chain
      },
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () => {
        const result = apply()
        return { data: result.data[0] ?? null, error: result.error }
      },
      // `single()` is what an INSERT … RETURNING one row uses (#377's refusal service). It
      // errors on no row, like PostgREST does, so a test can tell "refused" from "wrote".
      single: async () => {
        const result = apply()
        const row = result.data[0] ?? null
        return row === null
          ? { data: null, error: { message: 'no rows returned' } }
          : { data: row, error: null }
      },
      then: (onFulfilled: (value: any) => unknown) => Promise.resolve(apply()).then(onFulfilled),
    }
    return chain
  }

  return {
    schema: () => ({ from: (table: string) => build(table) }),
    from: (table: string) => build(table),
    auth: {
      getUser: async () => ({
        data: { user: { id: OPERATOR_ID, email: 'admin@tuggi.app' } },
        error: null,
      }),
      admin: {
        getUserById: async () => ({ data: { user: { email: 'ana@tuggi.app' } }, error: null }),
      },
    },
  }
}

function createFakeAuthClient(current: () => FakeState) {
  const db = createFakeDb(current)
  const cmsChain: any = {
    select: () => cmsChain,
    eq: () => cmsChain,
    maybeSingle: async () => ({
      data: { email: 'admin@tuggi.app', role: 'admin', is_active: true },
      error: null,
    }),
  }
  return {
    ...db,
    schema: () => ({
      from: (table: string) => (table === 'cms_users' ? cmsChain : db.schema().from(table)),
    }),
  }
}

let PUBLISH: (req: any, ctx: any) => Promise<Response>
/** #377 — the other outcome of the triage, and the act that stops its clock. */
let REFUSE: (req: any, ctx: any) => Promise<Response>
let COMMUNICATE: (req: any, ctx: any) => Promise<Response>
/**
 * IMPORTED AFTER `mock.module`, AND THAT IS NOT OPTIONAL. A top-level
 * `import { loadPartnerPlace } from '@/lib/services/partnership-service'` binds the REAL
 * `getSupabaseService` at module evaluation, before the mock is installed — the mock then
 * replaces the registry entry and the already-bound consumer keeps the original. Every route
 * test in this file answered `500` the first time it was written that way.
 */
let loadPartnerPlaceLive: typeof import('@/lib/services/partnership-service')['loadPartnerPlace']

before(async () => {
  process.env.NEXT_PUBLIC_APP_URL ??= 'https://cms.tuggi.app'

  mock.module('next/headers', {
    namedExports: { cookies: async () => ({ get: () => undefined, getAll: () => [] }) },
  })

  mock.module('@/lib/core/supabase-client', {
    namedExports: {
      getSupabaseService: () => createFakeDb(() => state),
      getSupabase: () => createFakeDb(() => state),
      getSupabaseRouteHandler: () => createFakeAuthClient(() => state),
      getSupabaseClient: () => createFakeDb(() => state),
    },
  })

  const route = await import(
    '@/app/api/admin/partnerships/clients/[clientId]/places/[attractionId]/publish/route'
  )
  PUBLISH = route.POST as any

  const refusalRoute = await import(
    '@/app/api/admin/partnerships/clients/[clientId]/places/[attractionId]/triage-refusal/route'
  )
  REFUSE = refusalRoute.POST as any

  const communicateRoute = await import(
    '@/app/api/admin/partnerships/clients/[clientId]/places/[attractionId]/triage-refusal/communicate/route'
  )
  COMMUNICATE = communicateRoute.POST as any

  const pipeline = await import('@/lib/services/partnership-service')
  loadPartnerPlaceLive = pipeline.loadPartnerPlace
})

/** A fresh caller each time: `withRateLimit` keys by IP and would fail a test because of the
 *  test before it. */
let callerSequence = 0

function request(body: unknown) {
  callerSequence += 1
  return {
    method: 'POST',
    url: 'https://cms.tuggi.app/api/admin/partnerships',
    nextUrl: { searchParams: new URLSearchParams() },
    headers: new Headers({
      'content-type': 'application/json',
      'x-forwarded-for': `10.0.0.${callerSequence % 250}`,
    }),
    json: async () => body,
  } as any
}

const context = { params: Promise.resolve({ clientId: CLIENT_ID, attractionId: PLACE_ID }) }

test('#359 crit. 18 · 21: publishing writes the publication and nothing else, and leaves a trail', async () => {
  state = freshState()

  const response = await PUBLISH(request({ approved: true }), context)
  assert.equal(response.status, 200)

  const attractionWrites = state.writes.filter((write) => write.table === 'attractions')
  assert.equal(attractionWrites.length, 1, 'one write, not two')
  assert.deepEqual(
    Object.keys(attractionWrites[0].patch).sort(),
    ['approved', 'approved_at', 'approved_by'],
    'the whole of what left the process — not a list somebody kept up to date'
  )
  assert.equal(attractionWrites[0].patch.approved, true)
  // The column existing is not the datum existing: the `data` measured 136 filled rows in
  // ~2.23 M approved ones, and zero among `place` and `event` (2026-08-16).
  assert.equal(attractionWrites[0].patch.approved_by, OPERATOR_ID)
  assert.equal(
    Number.isNaN(Date.parse(attractionWrites[0].patch.approved_at)),
    false,
    'approved_at is a timestamp, not a flag'
  )

  // Nothing on the client record moved: `commission_rate`, `monthly_fee_cents`, `is_courtesy`,
  // `status` and `slug` are unreachable from this path.
  assert.equal(state.writes.filter((write) => write.table === 'clients').length, 0)

  const trail = state.audit_logs[state.audit_logs.length - 1]
  assert.equal(trail.action, 'PUBLISH_PARTNER_PLACE')
  assert.equal(trail.entity_id, PLACE_ID)
  assert.equal(trail.user_id, OPERATOR_ID)
  assert.match(trail.description, new RegExp(CLIENT_ID))
})

test('#359 crit. 19: after publishing, the place satisfies the read model predicate', async () => {
  state = freshState()

  const response = await PUBLISH(request({ approved: true }), context)
  const payload = await response.json()

  assert.equal(payload.place.readiness.published, true)
  assert.equal(state.attractions[0].approved, true)
})

test('#359 crit. 22 · DS-COMPONENTE-021: publishing twice is the same state', async () => {
  state = freshState()

  await PUBLISH(request({ approved: true }), context)
  const second = await PUBLISH(request({ approved: true }), context)

  assert.equal(second.status, 200)
  assert.equal(state.attractions[0].approved, true, 'idempotent at the destination')
  for (const write of state.writes.filter((item) => item.table === 'attractions')) {
    assert.deepEqual(Object.keys(write.patch).sort(), ['approved', 'approved_at', 'approved_by'])
  }
})

test('#359 crit. 17 · DS-COMPONENTE-021 pt. 2: the route refuses the act it cannot describe', async () => {
  state = freshState({ monthly_fee_cents: null, is_courtesy: null, courtesy_reason: null })

  const response = await PUBLISH(request({ approved: true }), context)
  assert.equal(response.status, 409)
  assert.equal((await response.json()).error, 'publish_not_offered')

  assert.equal(
    state.writes.filter((write) => write.table === 'attractions').length,
    0,
    'and nothing was written'
  )
  assert.equal(state.attractions[0].approved, false)
})

test('#359 crit. 17: registering the courtesy with a reason lets the same request through', async () => {
  state = freshState({
    monthly_fee_cents: null,
    is_courtesy: true,
    courtesy_reason: 'Parceiro fundador',
  })

  const response = await PUBLISH(request({ approved: true }), context)
  assert.equal(response.status, 200)
  assert.equal(state.attractions[0].approved, true)
})

test('#359 crit. 20: taking a place out of the app is never refused', async () => {
  state = freshState({ monthly_fee_cents: null, is_courtesy: null, courtesy_reason: null })
  state.attractions[0].approved = true

  const response = await PUBLISH(request({ approved: false }), context)
  assert.equal(response.status, 200)
  assert.equal(state.attractions[0].approved, false)

  // The stamp goes with it: `approved = false` beside `approved_by = <somebody>` would say a
  // row was published by a person while it is not published at all.
  assert.equal(state.attractions[0].approved_at, null)
  assert.equal(state.attractions[0].approved_by, null)

  const trail = state.audit_logs[state.audit_logs.length - 1]
  assert.equal(trail.action, 'UNPUBLISH_PARTNER_PLACE')
})

test('#359 · BR-CMS-002: a place that is not this client’s is not this screen’s to approve', async () => {
  state = freshState()
  state.attractions[0].partner_client_id = '99999999-9999-9999-9999-999999999999'

  const response = await PUBLISH(request({ approved: true }), context)
  assert.equal(response.status, 404)
  assert.equal((await response.json()).error, 'place_not_linked')
  assert.equal(state.writes.filter((write) => write.table === 'attractions').length, 0)
})

test('#359: the route validates its input before it reaches the database', async () => {
  state = freshState()

  const bad = await PUBLISH(request({ approved: 'yes' }), context)
  assert.equal(bad.status, 400)
  assert.equal((await bad.json()).error, 'invalid_approved')

  const badId = await PUBLISH(request({ approved: true }), {
    params: Promise.resolve({ clientId: 'not-a-uuid', attractionId: PLACE_ID }),
  })
  assert.equal(badId.status, 400)
})

// ── The refusal of the triage, end to end — #377, criteria 6 and 33 ──────────────────────────

const REFUSAL_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

test('#377 · BR-B2B-011 item 4: the refusal writes the gate, the reason and WHO decided', async () => {
  state = freshState()

  const response = await REFUSE(
    request({ gate: 2, reason: 'O insumo é o cadastro mínimo e nada além dele.' }),
    context
  )
  assert.equal(response.status, 201)

  const written = state.writes.filter((write) => write.table === 'partner_triage_refusals')
  assert.equal(written.length, 1)
  assert.deepEqual(Object.keys(written[0].patch).sort(), [
    'attraction_id',
    'decided_by',
    'gate',
    'reason',
  ])
  assert.equal(written[0].patch.gate, 2)
  assert.equal(written[0].patch.attraction_id, PLACE_ID)
  // From the SESSION and never from the body — BR-B2B-029/-030: an author supplied by the caller
  // is not a trail.
  assert.equal(written[0].patch.decided_by, OPERATOR_ID)
  // `decided_at` is left to the column default, so the instant is the database's clock.
  assert.equal('decided_at' in written[0].patch, false)
  // And nothing else was written: BR-B2B-010, 6th edge case, and BR-B2B-027, item 3 — the
  // partnership continues and no POI leaves the catalogue.
  assert.deepEqual(
    state.writes.filter((write) => write.table !== 'partner_triage_refusals' && write.table !== 'audit_logs'),
    []
  )
})

test('#377 · BR-B2B-011: the route refuses what is not one of the three gates', async () => {
  state = freshState()

  for (const body of [
    { gate: 4, reason: 'qualquer' },
    { gate: 0, reason: 'qualquer' },
    { gate: '2', reason: 'qualquer' },
    { reason: 'qualquer' },
  ]) {
    const response = await REFUSE(request(body), context)
    assert.equal(response.status, 400, JSON.stringify(body))
    assert.equal((await response.json()).error, 'invalid_gate')
  }
  assert.deepEqual(state.writes, [], 'a refused request writes nothing')
})

test('#377 · BR-B2B-011 item 4: "não foi aprovado" is not a refusal — the reason is required', async () => {
  state = freshState()

  for (const reason of ['', '   ', null, 42]) {
    const response = await REFUSE(request({ gate: 1, reason }), context)
    assert.equal(response.status, 400)
    assert.equal((await response.json()).error, 'invalid_reason')
  }

  const long = await REFUSE(request({ gate: 1, reason: 'x'.repeat(2001) }), context)
  assert.equal(long.status, 400)
  assert.equal((await long.json()).error, 'reason_too_long')
  assert.deepEqual(state.writes, [])
})

test('#377 · BR-B2B-027 item 3: a place already in the app is not refused at triage', async () => {
  state = freshState()
  state.attractions[0].approved = true

  const response = await REFUSE(request({ gate: 3, reason: 'qualquer' }), context)
  assert.equal(response.status, 409)
  assert.equal((await response.json()).error, 'place_already_published')
  // Gate 3 is about ENTRY. Removing what is already on air is a decision nobody took, and this
  // route is not where it would be taken.
  assert.deepEqual(state.writes, [])
})

test('#377 · BR-CMS-002: a place that is not this client’s is not this screen’s to refuse', async () => {
  state = freshState()
  state.attractions[0].partner_client_id = 'another-client'

  const response = await REFUSE(request({ gate: 1, reason: 'qualquer' }), context)
  assert.equal(response.status, 404)
  assert.equal((await response.json()).error, 'place_not_linked')
})

test('#377 · BR-B2B-010 item 4: the communication is a SECOND act, and it stops the clock', async () => {
  state = freshState()
  state.partner_triage_refusals = [
    {
      id: REFUSAL_ID,
      attraction_id: PLACE_ID,
      gate: 2,
      reason: 'Falta um fato próprio do lugar.',
      decided_by: OPERATOR_ID,
      decided_at: '2026-08-16T09:00:00.000Z',
      communicated_at: null,
    },
  ]

  const response = await COMMUNICATE(request({ refusalId: REFUSAL_ID }), context)
  assert.equal(response.status, 200)

  const written = state.writes.filter((write) => write.table === 'partner_triage_refusals')
  assert.equal(written.length, 1)
  assert.deepEqual(Object.keys(written[0].patch), ['communicated_at'])
  assert.equal(typeof state.partner_triage_refusals[0].communicated_at, 'string')
  // The decision was NOT rewritten: the row is append-only and the guard would refuse it anyway
  // (BR-B2B-011, item 5).
  assert.equal(state.partner_triage_refusals[0].decided_at, '2026-08-16T09:00:00.000Z')
  assert.equal(state.partner_triage_refusals[0].gate, 2)
})

test('#377 · `communicated_at` is write-once, and the loser of the race gets 409', async () => {
  state = freshState()
  state.partner_triage_refusals = [
    {
      id: REFUSAL_ID,
      attraction_id: PLACE_ID,
      gate: 2,
      reason: 'Falta um fato próprio do lugar.',
      decided_by: OPERATOR_ID,
      decided_at: '2026-08-16T09:00:00.000Z',
      communicated_at: '2026-08-17T09:00:00.000Z',
    },
  ]

  const response = await COMMUNICATE(request({ refusalId: REFUSAL_ID }), context)
  assert.equal(response.status, 409)
  const payload = await response.json()
  assert.equal(payload.error, 'already_communicated')
  // The first communication is what the partner was told about, and it stands.
  assert.equal(payload.communicatedAt, '2026-08-17T09:00:00.000Z')
  // The UPDATE is narrowed to `communicated_at IS NULL`, so the statement leaves the process and
  // affects NOTHING — the row keeps the instant the partner was told about, and the guard
  // (`TGB11`) is the belt behind that brace.
  assert.equal(state.partner_triage_refusals[0].communicated_at, '2026-08-17T09:00:00.000Z')
})

test('#377: a refusal of ANOTHER place is not closed from this one', async () => {
  state = freshState()
  state.partner_triage_refusals = [
    {
      id: REFUSAL_ID,
      attraction_id: OTHER_PLACE_ID,
      gate: 2,
      reason: 'Falta um fato próprio do lugar.',
      decided_by: OPERATOR_ID,
      decided_at: '2026-08-16T09:00:00.000Z',
      communicated_at: null,
    },
  ]

  const response = await COMMUNICATE(request({ refusalId: REFUSAL_ID }), context)
  assert.equal(response.status, 404)
  assert.equal((await response.json()).error, 'refusal_not_found')
  assert.equal(state.partner_triage_refusals[0].communicated_at, null)
})

test('#377: both routes validate their input before they reach the database', async () => {
  state = freshState()

  const badContext = { params: Promise.resolve({ clientId: 'nope', attractionId: PLACE_ID }) }
  assert.equal((await REFUSE(request({ gate: 1, reason: 'x' }), badContext)).status, 400)
  assert.equal((await COMMUNICATE(request({ refusalId: REFUSAL_ID }), badContext)).status, 400)

  const badRefusal = await COMMUNICATE(request({ refusalId: 'not-a-uuid' }), context)
  assert.equal(badRefusal.status, 400)
  assert.equal((await badRefusal.json()).error, 'invalid_refusal_id')
  assert.deepEqual(state.writes, [])
})

test('#377 crit. 6: after the refusal is communicated, the pipeline reads the row as CLOSED', async () => {
  state = freshState()

  const refused = await REFUSE(request({ gate: 2, reason: 'Falta um fato próprio do lugar.' }), context)
  assert.equal(refused.status, 201)

  const registered = state.partner_triage_refusals[0]
  // Registered and not yet communicated: the place is refused, and the clock is still running —
  // the operator still owes the partner the news (BR-B2B-010, item 4).
  const place = await loadPartnerPlaceLive(CLIENT_ID, PLACE_ID, createFakeDb(() => state) as any)
  // `?? null` because this fake does not apply the column defaults a real INSERT would: the
  // column is nullable and the row simply has no value yet.
  assert.equal(place?.refusal?.communicatedAt ?? null, null)
  assert.equal(place?.refusal?.gate, 2)
  assert.equal(
    isTriageOverdue(
      deriveTriageStatus(
        { approvedAt: state.clients[0].approved_at, places: [{ published: false, refusal: place!.refusal! }] },
        new Date('2026-08-20T10:32:00.000Z')
      )
    ),
    true
  )

  const told = await COMMUNICATE(request({ refusalId: registered.id }), context)
  assert.equal(told.status, 200)

  const after = await loadPartnerPlaceLive(CLIENT_ID, PLACE_ID, createFakeDb(() => state) as any)
  assert.equal(typeof after?.refusal?.communicatedAt, 'string')
  assert.equal(
    deriveTriageStatus(
      { approvedAt: state.clients[0].approved_at, places: [{ published: false, refusal: after!.refusal! }] },
      new Date('2026-08-20T10:32:00.000Z')
    ).kind,
    'closed'
  )
})
