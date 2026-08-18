/**
 * Fixtures for the partnerships pipeline (#359) browser tests.
 *
 * Built with the SAME pure functions the screens are typed against and the API routes call —
 * `buildPlaceReadiness` and `buildPublishPlan` — instead of a second, hand-rolled derivation.
 * `tests/api/partnerships-pipeline.test.ts` already proves those functions; a fixture that
 * reimplements their logic could drift from them silently and this suite would stop meaning
 * anything (CLAUDE.md §6, DRY).
 */

import { buildPlaceReadiness, type PartnerPlaceFacts } from '@/lib/partnerships/place-readiness'
import { buildPublishPlan, type PartnerFee } from '@/lib/partnerships/publish-plan'
import type { PipelineState } from '@/lib/partnerships/pipeline'
import type {
  ClientDirectoryRow,
  PartnershipDetail,
  PartnershipPlace,
  PipelineClient,
  PipelineContract,
} from '@/lib/services/partnership-service'
import type { ConferenceRecord } from '@/lib/partner-form/regularity'
import type { ProposalDetail } from '@/components/admin/partner-proposals/types'

/** A string the operator would actually read: not lorem ipsum, and exactly 80 characters. */
export const LONG_ESTABLISHMENT_NAME =
  'Restaurante e Pousada Recanto das Águas Claras do Vale Verde Serra Acima Ltda ME'

if (LONG_ESTABLISHMENT_NAME.length !== 80) {
  throw new Error(
    `LONG_ESTABLISHMENT_NAME is ${LONG_ESTABLISHMENT_NAME.length} chars, criterion 28 needs 80`
  )
}

/**
 * One row of the unified list. It was `queueRow` while `/admin/partnerships` existed; the queue
 * is gone and the same fixtures now feed `ClientDirectory`, which is the list that absorbed it.
 */
export function queueRow(overrides: Partial<ClientDirectoryRow> = {}): ClientDirectoryRow {
  return {
    submissionId: 'sub-0001',
    clientId: null,
    state: 'proposal_received',
    href: '/admin/partnerships/proposals/sub-0001',
    name: 'Cantina do Zé',
    country: null,
    clientType: 'venue',
    status: 'pending',
    contract: 'none',
    contractSigned: false,
    taxId: '12.345.678/0001-90',
    city: 'Santos',
    region: 'SP',
    duplicateCount: 0,
    since: '2026-08-10T12:00:00.000Z',
    places: { total: 0, published: 0, blocking: 0, silencing: 0, improving: 0, allReady: false },
    // No approval and no place: the `Triagem` column reads `—`, which is the state of every row
    // that has not reached the client yet (#377, spec §3.1).
    triage: { approvedAt: null, places: [] },
    discardReason: null,
    ...overrides,
  }
}

/** One row per in-progress state — enough for the queue to render a real table. */
export const QUEUE_ROWS_IN_PROGRESS: ClientDirectoryRow[] = [
  queueRow({ submissionId: 'sub-0001', state: 'proposal_received', name: 'Cantina do Zé' }),
  queueRow({
    submissionId: 'sub-0002',
    state: 'in_conference',
    name: 'Pousada Vista Mar',
    since: '2026-08-08T09:00:00.000Z',
  }),
  queueRow({
    submissionId: 'sub-0003',
    clientId: 'client-0003',
    state: 'client_created',
    href: '/admin/clients?clientId=client-0003&tab=partnership',
    name: 'Locadora Costa Verde',
    since: '2026-08-07T09:00:00.000Z',
  }),
  queueRow({
    submissionId: 'sub-0004',
    clientId: 'client-0004',
    state: 'contract_signed' as PipelineState,
    href: '/admin/clients?clientId=client-0004&tab=partnership',
    name: 'Transfer Serra Acima',
    since: '2026-08-05T09:00:00.000Z',
  }),
  queueRow({
    submissionId: 'sub-0005',
    clientId: 'client-0005',
    state: 'place_in_curation',
    href: '/admin/clients?clientId=client-0005&tab=partnership',
    name: 'Restaurante do Porto',
    since: '2026-08-01T09:00:00.000Z',
    places: { total: 3, published: 2, blocking: 0, silencing: 1, improving: 0, allReady: false },
  }),
]

const FILLED_CONFERENCE: ConferenceRecord = {
  documentsSeen: ['business_license'],
  licenseNumber: '12345',
  licenseIssuer: 'Santos/SP',
  licenseValidUntil: '2027-12-01',
}

function partnerPlace(facts: PartnerPlaceFacts, fee: PartnerFee): PartnershipPlace {
  const readiness = buildPlaceReadiness(facts)
  return {
    readiness,
    plan: buildPublishPlan(fee, readiness),
    publishedBy: null,
    // Nobody refused these places: the triage of #377 is exercised by
    // `tests/api/partnership-triage.test.ts`, and a fixture that carried a refusal would make
    // every screen here render the terminal state.
    refusal: null,
  }
}

function client(overrides: Partial<PipelineClient> & { id: string; fee: PartnerFee }): PipelineClient {
  return {
    name: null,
    companyName: null,
    city: null,
    region: null,
    country: null,
    clientType: null,
    taxId: null,
    status: 'active',
    approvedAt: null,
    createdAt: null,
    ...overrides,
  }
}

const SIGNED_CONTRACT: PipelineContract = {
  status: 'signed',
  signed: true,
  signedAt: '2026-08-13T10:00:00.000Z',
  signerName: 'Ana Prado',
}

/**
 * Band 4 with all three pendency classes at once (criterion 23's richest render of
 * `PendencyList`), a place name at the exact criterion-28 length, and a client past band 3 so
 * bands 1–3 render their "concluída" content instead of the empty placeholder.
 */
export function detailInCuration(): PartnershipDetail {
  const fee: PartnerFee = { monthlyFeeCents: null, isCourtesy: false, courtesyReason: null }
  const facts: PartnerPlaceFacts = {
    attractionId: 'attr-0005',
    name: LONG_ESTABLISHMENT_NAME,
    city: 'Santos',
    region: 'SP',
    entityKind: 'place',
    approved: false,
    isActive: true,
    // No coordinate (blocks_app), no trigger point (silences_app), no boundary (improves) —
    // all three classes render at once.
    latitude: null,
    longitude: null,
    showInMap: true,
    activeTriggerPointCount: 0,
    audioDescriptionCount: 1,
    hasBoundary: false,
  }

  return {
    state: 'place_in_curation',
    client: client({
      id: 'client-0005',
      name: LONG_ESTABLISHMENT_NAME,
      companyName: 'Restaurante do Porto Ltda',
      city: 'Santos',
      region: 'SP',
      taxId: '12.345.678/0001-90',
      approvedAt: '2026-08-14T13:00:00.000Z',
      createdAt: '2026-08-12T10:00:00.000Z',
      fee,
    }),
    contract: SIGNED_CONTRACT,
    submission: {
      id: 'sub-0005',
      submittedAt: '2026-08-10T09:00:00.000Z',
      promotedAt: '2026-08-12T10:00:00.000Z',
      promotedByLabel: 'ana@tuggi.app',
      reviewedAt: '2026-08-11T09:00:00.000Z',
      reviewedByLabel: 'ana@tuggi.app',
      conference: FILLED_CONFERENCE,
    },
    places: [partnerPlace(facts, fee)],
    // The same facts the queue row carries, so the header clock and the column agree — the
    // detail derives it from `approved_at` and the places, exactly as the service does (#377).
    triage: { approvedAt: '2026-08-14T13:00:00.000Z', places: [{ published: false, refusal: null }] },
  }
}

/**
 * A place with zero pendencies and a declared paid fee — the `paid_starts` variant of
 * `PublishPanel`, offered and clean, for criterion 23's axe scan of the publish panel.
 */
export function detailReadyToPublish(): PartnershipDetail {
  const fee: PartnerFee = { monthlyFeeCents: 24900, isCourtesy: false, courtesyReason: null }
  const facts: PartnerPlaceFacts = {
    attractionId: 'attr-0006',
    name: 'Pousada Vista Mar',
    city: 'Ubatuba',
    region: 'SP',
    entityKind: 'place',
    approved: false,
    isActive: true,
    latitude: -23.43,
    longitude: -45.07,
    showInMap: true,
    activeTriggerPointCount: 1,
    audioDescriptionCount: 1,
    hasBoundary: true,
  }

  return {
    state: 'place_in_curation',
    client: client({
      id: 'client-0006',
      name: 'Pousada Vista Mar',
      companyName: 'Pousada Vista Mar Ltda',
      city: 'Ubatuba',
      region: 'SP',
      taxId: '98.765.432/0001-10',
      approvedAt: '2026-08-14T13:00:00.000Z',
      createdAt: '2026-08-12T10:00:00.000Z',
      fee,
    }),
    contract: SIGNED_CONTRACT,
    submission: {
      id: 'sub-0006',
      submittedAt: '2026-08-10T09:00:00.000Z',
      promotedAt: '2026-08-12T10:00:00.000Z',
      promotedByLabel: 'ana@tuggi.app',
      reviewedAt: '2026-08-11T09:00:00.000Z',
      reviewedByLabel: 'ana@tuggi.app',
      conference: FILLED_CONFERENCE,
    },
    places: [partnerPlace(facts, fee)],
    // The same facts the queue row carries, so the header clock and the column agree — the
    // detail derives it from `approved_at` and the places, exactly as the service does (#377).
    triage: { approvedAt: '2026-08-14T13:00:00.000Z', places: [{ published: false, refusal: null }] },
  }
}

/**
 * One proposal on the conference screen, with the two acts still available.
 *
 * `submitted` and not `promoted` on purpose: it is the state that renders the most surface at
 * once — the regularity band with its three licence fields enabled, the story block with its
 * marks, the observation textarea, the outbound picker and both header buttons. An `axe` scan
 * of a screen in its emptiest state proves very little.
 */
export function proposalUnderConference(): ProposalDetail {
  return {
    submission: {
      id: 'sub-0001',
      status: 'submitted',
      answers: {
        trade_name: 'Cantina do Zé',
        tax_id: '12.345.678/0001-90',
        city: 'Santos',
        state: 'SP',
        representative_name: 'Ana Prado',
        story_founder: 'A cantina abriu em 1978, quando o avô do dono chegou de Nápoles.',
        story_unique: 'O forno a lenha é o mesmo desde a inauguração.',
      } as ProposalDetail['submission']['answers'],
      submittedAt: '2026-08-10T09:00:00.000Z',
      updatedAt: '2026-08-10T09:00:00.000Z',
      createdAt: '2026-08-10T09:00:00.000Z',
      promotedAt: null,
      promotedBy: null,
      promotedClientId: null,
      reviewedAt: null,
      reviewedBy: null,
    },
    note: { marks: [], observation: '', conference: FILLED_CONFERENCE },
    conference: FILLED_CONFERENCE,
    client: null,
    duplicates: [],
  }
}
