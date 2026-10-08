'use client'

/**
 * The client record's Parceria tab, whole (#910): one tab for what used to be Validação and
 * Parceria, in one fixed order, and a block with no data does not render — not even with a
 * sentence about its absence.
 *
 *   1  state band — the pipeline's state, next step and clock; under it the submission's band
 *   2–8  the portal submission, while it is being validated (`SubmissionBlocks`)
 *   9  O local — while a place is not published, or there is none
 *   10 Publicação — once a place is published
 *   11 Contrato — regularity, the contract or the portal term, and the way to the Contrato tab
 *   12 the submission after the decision, collapsed
 *   13 Histórico — the submission's history and the pipeline's dated facts, merged by date
 *
 * "In validation" is the predicate that already gives the record header the submission's acts:
 * a submission exists and it is undecided, or there is no client yet. Anything else is the
 * pipeline ("esteira").
 *
 * The two reads (the pipeline, keyed by the client, and the submission) each keep their own
 * skeleton and their own error in the place of their blocks: the tab never waits blank for both.
 *
 * WHAT THIS SCREEN IS NOT. It is not the place editor, not the trigger-point editor and not the
 * boundary drawing (DS-LAYOUT-006, 1st edge case). The fiscal data, the banking data, the team, the
 * coupons and the contract stay in their own tabs; this tab shows what the pipeline decides and
 * switches to the rest. Copying three fields "for convenience" is how the second source of the
 * same fact gets born.
 */

import { useCallback, useEffect, useState } from 'react'
import { useRecordRead } from '@/lib/hooks/use-record-cache'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { FileSignature, History, Lock, MapPin, Radio } from 'lucide-react'
import { gateLine } from '@/components/admin/clients/board/row-text'
import { Button } from '@/components/ui/button'
import { PlaceFormModal } from '@/components/place-management/PlaceFormModal'
import { formatDate } from '@/components/admin/partner-proposals/format'
import { RecordSection } from '@/components/admin/clients/shared/RecordSection'
import { useClientContract } from '@/components/admin/clients/shared/use-client-contract'
import {
  SubmissionBand,
  SubmissionBlocks,
  SubmissionReadState,
  submissionWasApproved,
  useSubmissionHistory,
  type HistoryEntry,
  type SubmissionProps,
} from '@/components/admin/clients/shared/PortalSubmission'
import type { ClientEditorTab } from '@/components/admin/clients/ClientEditorModal'
import type { PendencyId } from '@/lib/partnerships/place-readiness'
import { IN_PROGRESS_STATES } from '@/lib/partnerships/pipeline'
import { deriveTriageStatus, type TriageGate } from '@/lib/partnerships/triage'
import { returnParams } from '@/lib/navigation/return-to'
import { placeToolHref } from '@/lib/partnerships/place-tool'
import type { PartnershipDetail as Detail, PartnershipPlace } from '@/lib/services/partnership-service'
import { PendencyList } from './PendencyList'
import { trailPublishedLines } from './trail-text'
import { PublishPanel, UnpublishPanel } from './PublishPanel'
import { CommunicationPanel, RefusalPanel, RefusalSummary, type RefusalOutcome } from './TriageRefusalPanel'
import { triageDeadlineText, triageText } from './triage-text'
import { clientApprovedText } from './approval-text'

type PanelKind = 'publish' | 'unpublish' | 'refuse' | 'communicate'
type Panel = { attractionId: string; kind: PanelKind } | null

const LINK_BUTTON =
  'inline-flex min-h-[24px] items-center text-sm font-medium text-primary-800 underline underline-offset-4'

interface PartnershipDetailProps {
  locale: string
  /** Absent in the pre-registration of a portal submission: there is no pipeline yet, only the submission. */
  clientId?: string
  /** The record's tab strip: the blocks switch tabs, never navigate. */
  onOpenTab: (tab: ClientEditorTab) => void
  /** The portal submission this record shows, when there is one. */
  submission?: Omit<SubmissionProps, 'locale' | 'onOpenTab'>
  /** `DecisionSummary` for the phone, which has no sidebar. */
  phoneSummary?: React.ReactNode
}

export function PartnershipDetail({
  locale,
  clientId,
  onOpenTab,
  submission,
  phoneSummary,
}: PartnershipDetailProps) {
  const t = useTranslations('Partnerships')
  const tValidation = useTranslations('PartnerValidation')

  const [detail, setDetail] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(Boolean(clientId))
  const [failure, setFailure] = useState<'none' | 'not_found' | 'error'>('none')
  const [panel, setPanel] = useState<Panel>(null)
  const [editingPlaceId, setEditingPlaceId] = useState<string | null>(null)
  /**
   * A refusal whose request never came back with an answer. It outlives the panel on purpose: the
   * panel closes, the screen reloads, and the operator still has to be told what to check before
   * clicking again — the table is append-only (#377, item 3).
   */
  const [refusalUnknown, setRefusalUnknown] = useState(false)

  const read = useRecordRead()

  /** `fresh` after an act; the first read may take the one the record's other tab already made. */
  const load = useCallback(async (fresh: boolean = true) => {
    if (!clientId) return
    setLoading(true)
    try {
      const response = await read<{ detail?: Detail }>(`/api/admin/partnerships/clients/${clientId}`, { fresh })
      if (response.status === 404) {
        setFailure('not_found')
        setDetail(null)
        return
      }
      const payload = response.ok ? response.body : null
      if (payload?.detail) {
        setDetail(payload.detail as Detail)
        setFailure('none')
      } else {
        setFailure('error')
      }
    } catch {
      setFailure('error')
    } finally {
      setLoading(false)
    }
  }, [clientId, read])

  useEffect(() => {
    void load(false)
  }, [load])

  const publish = useCallback(
    async (attractionId: string, approved: boolean) => {
      try {
        const response = await fetch(
          `/api/admin/partnerships/clients/${clientId}/places/${attractionId}/publish`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ approved }),
          }
        )
        if (response.ok) return 'ok' as const
        const payload = await response.json().catch(() => ({}))
        return payload?.error === 'publish_not_offered' ? ('refused' as const) : ('write' as const)
      } catch {
        // The request never came back with an answer. Publishing the same place twice is the
        // same state, so this one DOES get a retry (DS-COMPONENTE-021, 2nd edge case).
        return 'network' as const
      }
    },
    [clientId]
  )

  /**
   * Register the refusal — one round of the triage, and it is not idempotent: the table is
   * append-only and a second click is a second refusal (BR-B2B-011, item 5). So no retry is
   * offered on a network error, exactly like the promotion of a proposal.
   *
   * THE TWO FAILURES ARE DIFFERENT FACTS, and the copy for them says opposite things (#377,
   * item 3). A 4xx is the route answering before it wrote anything — every one of them is a
   * validation, a place that is not this client's or a place already published, and all of them
   * return before `triageRefusalService.register`. Repeating that is safe. Anything else — the
   * `write_failed` 503, a 5xx, a request that never came back — leaves us not knowing whether the
   * row landed, and THAT is the one where repeating creates two refusals.
   */
  const refuse = useCallback(
    async (attractionId: string, gate: TriageGate, reason: string): Promise<RefusalOutcome> => {
      try {
        const response = await fetch(
          `/api/admin/partnerships/clients/${clientId}/places/${attractionId}/triage-refusal`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ gate, reason }),
          }
        )
        if (response.ok) return 'ok'
        return response.status >= 400 && response.status < 500 ? 'refused' : 'failed'
      } catch {
        return 'failed'
      }
    },
    [clientId]
  )

  /** Record the communication — the act that stops the 72h clock of BR-B2B-010, item 4. */
  const communicate = useCallback(
    async (attractionId: string, refusalId: string): Promise<RefusalOutcome> => {
      try {
        const response = await fetch(
          `/api/admin/partnerships/clients/${clientId}/places/${attractionId}/triage-refusal/communicate`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ refusalId }),
          }
        )
        if (response.ok) return 'ok'
        const payload = await response.json().catch(() => ({}))
        // Already communicated is not a failure: somebody closed it, and the screen says so.
        return payload?.error === 'already_communicated' ? 'refused' : 'failed'
      } catch {
        return 'failed'
      }
    },
    [clientId]
  )

  const review = submission?.record.review ?? null
  const inValidation = Boolean(review) && (Boolean(submission?.record.undecided) || !clientId)
  const submissionHistory = useSubmissionHistory(review)

  const name = detail ? (detail.client.name ?? detail.client.companyName ?? '') : ''
  // A tool opened from here comes back to this tab (#875).
  const returnTo = `/${locale}/admin/clients?clientId=${clientId}&tab=partnership`
  const returnLabel = t('returnBar.label', { name })

  /**
   * WHICH EDITOR, and it is `placeToolHref` that decides — the same module the client record
   * reads. It used to be `/pois/{id}` whatever the kind, and a `place` opened there answered
   * `POI not found` (operator, 2026-08-25).
   */
  function toolHref(place: PartnershipPlace, pendency: PendencyId): string {
    return placeToolHref({
      locale,
      attractionId: place.readiness.place.attractionId,
      entityKind: place.readiness.place.entityKind,
      pendency,
      returnTo,
      returnLabel,
    })
  }

  /**
   * Variant (iv) of the publish panel sends the operator to the fee: the record's own Fiscal tab,
   * by the address the record reads (`clientId` + `tab`), with the way back to this tab.
   */
  const fiscalHref = `/${locale}/admin/clients?${new URLSearchParams({
    clientId: clientId ?? '',
    tab: 'fiscal',
    ...returnParams(returnTo, returnLabel),
  }).toString()}`

  const places = detail?.places ?? []
  const showPlace = places.length === 0 || places.some((place) => !place.readiness.published)
  const showPublication = places.some((place) => place.readiness.published)
  const history = detail
    ? mergeHistory(submissionHistory, pipelineHistory(detail, locale, t, submissionWasApproved(review)))
    : submissionHistory

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8">
      {/* 1 · state band. Not sticky: the record's header is what holds the top. */}
      {detail ? (
        <div className="space-y-1">
          <p className="text-sm font-medium text-gray-900 dark:text-white">
            {t(`states.${detail.state}`)}
            {/* `published` and `discarded` have no next step, and the place to say so is not a
                bare em dash hanging next to the state. */}
            {IN_PROGRESS_STATES.indexOf(detail.state) >= 0 && (
              <span className="ml-2 font-normal text-gray-800 dark:text-gray-200">{t(`nextSteps.${detail.state}`)}</span>
            )}
            {/* The clock, out of the SAME module the queue column reads — the list and the record
                cannot disagree about a promise made to a partner (BR-B2B-010, item 4). */}
            <span className="ml-2 font-normal text-gray-800 dark:text-gray-200" title={t('triage.deadlineTitle')}>
              {headerClock(detail, t)}
            </span>
          </p>
          {/* Criterion 33: the two states the refusal produces carry this line, and the screen offers
              no action that removes the partnership — BR-B2B-010, 6th edge case, and BR-B2B-027, item 3. */}
          {(detail.state === 'refused_at_triage' || detail.state === 'refusal_not_communicated') && (
            <p className="text-sm font-medium text-gray-900 dark:text-white">{t('triage.partnershipContinues')}</p>
          )}
        </div>
      ) : null}

      {/* The refusal whose fate we do not know — raised out of the panel, because the panel closed.
          The act is append-only: repeating it is what creates two refusals, so no control here
          offers to (#377, item 3, and BR-B2B-011, item 5). */}
      {refusalUnknown && (
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-gray-900">
          <p className="font-semibold">{t('triage.refuseUnknownTitle')}</p>
          <p className="mt-1">{t('triage.refuseUnknownBody')}</p>
        </div>
      )}

      {submission ? (
        <>
          <SubmissionBand record={submission.record} validationHref={submission.validationHref} onOpenTab={onOpenTab} />
          <SubmissionReadState record={submission.record} boardHref={submission.boardHref} />
        </>
      ) : null}

      {/* 2 to 8 · the submission, while it is the work */}
      {submission && inValidation ? <SubmissionBlocks {...submission} locale={locale} collapsed={false} /> : null}

      {/* 9 to 11 · the pipeline, with its own skeleton and its own error */}
      {clientId && loading && !detail ? (
        <div className="space-y-8" aria-busy="true">
          <span className="sr-only">{t('detail.loading')}</span>
          <div className="h-40 animate-pulse rounded-3xl bg-gray-100" aria-hidden="true" />
          <div className="h-24 animate-pulse rounded-3xl bg-gray-100" aria-hidden="true" />
        </div>
      ) : clientId && !detail ? (
        <div role="alert" className="rounded-3xl border border-gray-200 bg-white p-6 text-center">
          <p className="font-medium text-gray-900">
            {failure === 'error' ? t('detail.errorTitle') : t('detail.notFoundTitle')}
          </p>
          {failure === 'error' && (
            <Button variant="outline" className="mt-3" onClick={() => void load()}>
              {t('detail.retry')}
            </Button>
          )}
        </div>
      ) : detail ? (
        <>
          {showPlace ? (
            <RecordSection icon={<MapPin className="h-4 w-4 text-indigo-500" />} title={t('detail.blockPlace')} color="indigo-500">
              {/* BR-B2B-057: the same line the board card prints; the routes refuse the same way. */}
              {detail.gateMissing.length > 0 && (
                <p className="mb-3 flex items-start gap-1 text-xs text-gray-900 dark:text-gray-200">
                  <Lock className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                  <span>{gateLine(detail.gateMissing, t)}</span>
                </p>
              )}
              <PlaceBand
                detail={detail}
                fiscalHref={fiscalHref}
                onOpenTab={onOpenTab}
                panel={panel}
                setPanel={setPanel}
                onOpenPlace={setEditingPlaceId}
                toolHref={toolHref}
                publish={publish}
                refuse={refuse}
                communicate={communicate}
                reload={load}
                refusalUnknown={refusalUnknown}
                setRefusalUnknown={setRefusalUnknown}
              />
            </RecordSection>
          ) : null}

          {showPublication ? (
            <RecordSection icon={<Radio className="h-4 w-4 text-green-500" />} title={t('detail.blockPublication')} color="green-500">
              <PublicationBand detail={detail} panel={panel} setPanel={setPanel} publish={publish} reload={load} />
            </RecordSection>
          ) : null}

          <ContractBlock detail={detail} clientId={detail.client.id} onOpenTab={onOpenTab} />
        </>
      ) : null}

      {/* 12 · the submission after the decision: a record, not work */}
      {submission && review && !inValidation ? <SubmissionBlocks {...submission} locale={locale} collapsed /> : null}

      {/* 13 · history */}
      {history.length > 0 ? (
        <RecordSection icon={<History className="h-4 w-4 text-tuggi-blue" />} title={tValidation('history.title')}>
          <ol className="space-y-3 text-sm font-semibold text-gray-900 dark:text-white">
            {history.map((entry) => (
              <li key={entry.key} className="break-words">
                {entry.node}
              </li>
            ))}
          </ol>
        </RecordSection>
      ) : null}

      {/* The phone has no sidebar: the conference goes under the tab. */}
      {phoneSummary ? <div className="lg:hidden">{phoneSummary}</div> : null}

      {/* `Abrir o local` is a modal, so it comes back on its own; closing it reloads the
          pipeline, and the pendency the operator just resolved disappears without a manual
          reload (DS-LAYOUT-006, point 3). */}
      {clientId ? (
        <PlaceFormModal
          placeId={editingPlaceId}
          isOpen={editingPlaceId !== null}
          onClose={() => {
            setEditingPlaceId(null)
            void load()
          }}
          onSaved={() => void load()}
        />
      ) : null}
    </div>
  )
}

// ── Block 11 · Contrato ──────────────────────────────────────────────────────────────────────

/**
 * Up to three lines and the way to the Contrato tab (#910 §4): the regularity conference, when it
 * was registered; the generated contract of an old client, or the portal term the partner accepted;
 * and "Abrir o contrato". The portal term comes from `useClientContract`, the read the Contrato tab
 * makes, so the two tabs cannot tell different stories about the same acceptance.
 */
function ContractBlock({
  detail,
  clientId,
  onOpenTab,
}: {
  detail: Detail
  clientId: string
  onOpenTab: (tab: ClientEditorTab) => void
}) {
  const t = useTranslations('Partnerships')
  const { summary, failed } = useClientContract(clientId)
  const { conference, contract } = detail

  const portalTerm =
    summary?.origin === 'portal'
      ? ([...(summary.portal ?? [])]
          .map((record) => record.acceptance)
          .filter((acceptance): acceptance is NonNullable<typeof acceptance> => Boolean(acceptance))
          .sort((a, b) => String(b.acceptedAt).localeCompare(String(a.acceptedAt)))[0] ?? null)
      : null

  return (
    <RecordSection icon={<FileSignature className="h-4 w-4 text-indigo-500" />} title={t('detail.blockContract')} color="indigo-500">
      <div className="space-y-1 text-sm text-gray-900 dark:text-gray-100">
        {conference.reviewedAt ? (
          <p>
            {conference.reviewedByLabel
              ? t('detail.regularityLine', { person: conference.reviewedByLabel, date: formatDate(conference.reviewedAt) })
              : t('detail.regularityLineAnonymous', { date: formatDate(conference.reviewedAt) })}
          </p>
        ) : null}

        {portalTerm ? (
          <p>{t('detail.portalTermsLine', { version: portalTerm.termsVersion, date: formatDate(portalTerm.acceptedAt) })}</p>
        ) : summary?.origin === 'portal' ? null : summary || failed ? (
          contract?.signed ? (
            contract.signerName ? (
              <p>{t('detail.contractSignedBy', { date: formatDate(contract.signedAt), person: contract.signerName })}</p>
            ) : (
              <p>{t('detail.contractSigned', { date: formatDate(contract.signedAt) })}</p>
            )
          ) : (
            <p>{t('detail.contractNotSigned')}</p>
          )
        ) : null}
      </div>
      <button type="button" onClick={() => onOpenTab('contract')} className={`mt-3 ${LINK_BUTTON}`}>
        {t('detail.openContract')}
      </button>
    </RecordSection>
  )
}

// ── Block 13 · Histórico ─────────────────────────────────────────────────────────────────────

/**
 * The pipeline's dated facts, the lines the old side trail printed.
 *
 * It does not read `core.audit_logs` on purpose: everything shown here is a fact the pipeline
 * already carries, and a second reading of the same events is a second chance for the two to
 * disagree. The full audit history has its own screen, `/admin/audit-logs`.
 *
 * `approvedInSubmission`: the submission's history already has the transition to `approved`, so
 * "Cliente criado" and "Parceria aprovada" would be the same fact with less information (#910 §6).
 */
function pipelineHistory(
  detail: Detail,
  locale: string,
  t: ReturnType<typeof useTranslations>,
  approvedInSubmission: boolean
): HistoryEntry[] {
  const entries: HistoryEntry[] = []
  const proposal = detail.submission
  if (proposal?.submittedAt) {
    entries.push({
      at: proposal.submittedAt,
      key: 'proposal',
      node: (
        <>
          {t('detail.proposalLine', { date: formatDate(proposal.submittedAt) })}{' '}
          <Link href={`/${locale}/admin/partnerships/proposals/${proposal.id}`} className={LINK_BUTTON}>
            {t('detail.proposalLink')}
          </Link>
        </>
      ),
    })
  }
  const { conference, client, contract } = detail
  if (conference.reviewedAt) {
    entries.push({
      at: conference.reviewedAt,
      key: 'conference',
      node: conference.reviewedByLabel
        ? t('detail.conferenceLine', { person: conference.reviewedByLabel, date: formatDate(conference.reviewedAt) })
        : t('detail.conferenceLineAnonymous', { date: formatDate(conference.reviewedAt) }),
    })
  }
  if (!approvedInSubmission && client.createdAt) {
    entries.push({ at: client.createdAt, key: 'created', node: t('detail.clientCreated', { date: formatDate(client.createdAt) }) })
  }
  if (!approvedInSubmission && client.approvedAt) {
    entries.push({ at: client.approvedAt, key: 'approved', node: clientApprovedText(client.approvedAt, detail.approvedByLabel, t) })
  }
  if (contract?.signed) {
    entries.push({ at: contract.signedAt, key: 'contract', node: t('detail.contractSigned', { date: formatDate(contract.signedAt) }) })
  }
  // Named: a partnership with N places would otherwise be N identical rows.
  for (const place of detail.places) {
    const [line] = trailPublishedLines([place], t)
    if (line) entries.push({ at: place.publishedBy?.at ?? null, key: `published-${place.readiness.place.attractionId}`, node: line })
  }
  return entries
}

/** One list, oldest first; an undated fact goes last, where it cannot claim an order it does not have. */
function mergeHistory(...sources: HistoryEntry[][]): HistoryEntry[] {
  const time = (entry: HistoryEntry) => {
    const value = entry.at ? Date.parse(entry.at) : NaN
    return Number.isNaN(value) ? Number.POSITIVE_INFINITY : value
  }
  return sources.flat().sort((a, b) => time(a) - time(b))
}

// ── Blocks 9 and 10 ──────────────────────────────────────────────────────────────────────────

function PlaceBand({
  detail,
  fiscalHref,
  onOpenTab,
  panel,
  setPanel,
  onOpenPlace,
  toolHref,
  publish,
  refuse,
  communicate,
  reload,
  refusalUnknown,
  setRefusalUnknown,
}: {
  detail: Detail
  fiscalHref: string
  onOpenTab: (tab: ClientEditorTab) => void
  panel: Panel
  setPanel: (value: Panel) => void
  onOpenPlace: (id: string) => void
  toolHref: (place: PartnershipPlace, pendency: PendencyId) => string
  publish: (attractionId: string, approved: boolean) => Promise<'ok' | 'write' | 'network' | 'refused'>
  refuse: (attractionId: string, gate: TriageGate, reason: string) => Promise<RefusalOutcome>
  communicate: (attractionId: string, refusalId: string) => Promise<RefusalOutcome>
  reload: () => Promise<void>
  /** Read to clear it: opening the panel again is the operator saying he has checked. */
  refusalUnknown: boolean
  setRefusalUnknown: (value: boolean) => void
}) {
  const t = useTranslations('Partnerships')
  const [creating, setCreating] = useState(false)

  async function createFromProposal() {
    setCreating(true)
    try {
      await fetch(`/api/admin/partnerships/clients/${detail.client.id}/places`, { method: 'POST' })
    } catch {
      // The reload below is what tells the operator whether it worked: a place that appeared
      // is the answer, and a banner that says "created" over a list that did not change is
      // worse than no banner.
    }
    await reload()
    setCreating(false)
  }

  /*
   * NO PLACE LINKED (#910 §4): linking lives in the Locais tab, with the search and the welcome-place
   * divergence, so the block says so and switches there. Creating from the proposal stays, when there
   * is a proposal to create from: it is the SAME act the partner approval runs (`provisionPartnerPlace`).
   */
  if (detail.places.length === 0) {
    return (
      <div className="space-y-3 text-sm text-gray-900 dark:text-gray-100">
        <p>{t('detail.noPlaceLinked')}</p>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => onOpenTab('places')} className={LINK_BUTTON}>
            {t('detail.linkInPlaces')}
          </button>
          {detail.submission ? (
            <Button type="button" variant="outline" disabled={creating} onClick={() => void createFromProposal()}>
              {t('pendencies.emptyCreate')}
            </Button>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {detail.places.map((place) => (
        <article key={place.readiness.place.attractionId} className="rounded-md border border-gray-200 p-3">
          {/* Never truncated in the detail: an 80-character name wraps onto a second line. */}
          <h3 className="break-words text-sm font-semibold text-gray-900">
            {place.readiness.place.name}
          </h3>

          <div className="mt-3">
            <PendencyList
              readiness={place.readiness}
              onOpenPlace={() => onOpenPlace(place.readiness.place.attractionId)}
              toolHref={(pendency) => toolHref(place, pendency)}
            />
          </div>

          {/* The refusal, once it is on the record: which criterion, what was missing, who, when,
              and whether the partner has been told. Shown for a place that is NOT in the app —
              a place that was refused, corrected and published is published, and band 5 is where
              it then speaks from (BR-B2B-011, item 5). */}
          {!place.readiness.published && place.refusal && (
            <>
              <RefusalSummary refusal={place.refusal} />
              {place.refusal.communicatedAt === null && (
                <div className="mt-3">
                  {panel?.attractionId === place.readiness.place.attractionId &&
                  panel.kind === 'communicate' ? (
                    <CommunicationPanel
                      refusal={place.refusal}
                      onClose={() => setPanel(null)}
                      communicate={(refusalId) =>
                        communicate(place.readiness.place.attractionId, refusalId)
                      }
                      onCommunicated={async () => {
                        setPanel(null)
                        await reload()
                      }}
                    />
                  ) : (
                    <Button
                      type="button"
                      variant="cta"
                      onClick={() =>
                        setPanel({
                          attractionId: place.readiness.place.attractionId,
                          kind: 'communicate',
                        })
                      }
                    >
                      {t('triage.communicateAction')}
                    </Button>
                  )}
                </div>
              )}
            </>
          )}

          {!place.readiness.published && (
            <div className="mt-3">
              {panel?.attractionId === place.readiness.place.attractionId &&
              panel.kind === 'publish' ? (
                <PublishPanel
                  place={place}
                  // The fee and the courtesy live in `Fiscal e Pagamentos`, so variant (iv)'s
                  // way out opens that tab and not the record's front page.
                  clientHref={fiscalHref}
                  onClose={() => setPanel(null)}
                  onPublished={async () => {
                    setPanel(null)
                    await reload()
                  }}
                  publish={(approved) => publish(place.readiness.place.attractionId, approved)}
                />
              ) : panel?.attractionId === place.readiness.place.attractionId &&
                panel.kind === 'refuse' ? (
                <RefusalPanel
                  onClose={() => setPanel(null)}
                  refuse={(gate, reason) =>
                    refuse(place.readiness.place.attractionId, gate, reason)
                  }
                  onRefused={async () => {
                    setPanel(null)
                    await reload()
                  }}
                  onRefusalUnknown={async () => {
                    // Close first, reload, and only then raise the sentence: the operator has to
                    // read it over a screen that already shows whether the row landed.
                    setPanel(null)
                    await reload()
                    setRefusalUnknown(true)
                  }}
                />
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    type="button"
                    variant="cta"
                    onClick={() =>
                      setPanel({
                        attractionId: place.readiness.place.attractionId,
                        kind: 'publish',
                      })
                    }
                  >
                    {t('publish.actionNamed', { name: place.readiness.place.name })}
                  </Button>
                  {/* The other outcome of the triage, beside the one it is the alternative to —
                      BR-B2B-010, item 4, promises ONE of the two within 72 hours, and a screen
                      that offers only publishing hides the outcome the operator owes. A refusal
                      already on the record is not offered again: correcting one is a new round
                      (BR-B2B-011, item 5), and that starts with the place changing. */}
                  {!place.refusal && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        // Reopening the panel is the operator saying he has checked the esteira,
                        // which is exactly what the sentence asked of him.
                        if (refusalUnknown) setRefusalUnknown(false)
                        setPanel({
                          attractionId: place.readiness.place.attractionId,
                          kind: 'refuse',
                        })
                      }}
                    >
                      {t('triage.refuseAction')}
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </article>
      ))}
    </div>
  )
}

function PublicationBand({
  detail,
  panel,
  setPanel,
  publish,
  reload,
}: {
  detail: Detail
  panel: Panel
  setPanel: (value: Panel) => void
  publish: (attractionId: string, approved: boolean) => Promise<'ok' | 'write' | 'network' | 'refused'>
  reload: () => Promise<void>
}) {
  const t = useTranslations('Partnerships')
  const published = detail.places.filter((place) => place.readiness.published)

  return (
    <div className="space-y-4">
      {published.map((place) => (
        <div key={place.readiness.place.attractionId} className="text-sm">
          <p className="break-words font-semibold text-gray-900">{place.readiness.place.name}</p>
          <p className="mt-1 text-gray-900">{publishedLine(place, t)}</p>
          {/* Only the variants that started it say so. */}
          {place.plan.startsBilling && place.publishedBy && (
            <p className="mt-1 text-gray-900">
              {t('publish.billingStarted', { date: formatDate(place.publishedBy.at) })}
            </p>
          )}

          {panel?.attractionId === place.readiness.place.attractionId &&
          panel.kind === 'unpublish' ? (
            <UnpublishPanel
              place={place}
              onClose={() => setPanel(null)}
              onUnpublished={async () => {
                setPanel(null)
                await reload()
              }}
              publish={(approved) => publish(place.readiness.place.attractionId, approved)}
            />
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() =>
                setPanel({ attractionId: place.readiness.place.attractionId, kind: 'unpublish' })
              }
            >
              {t('publish.unpublishAction')}
            </Button>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Lines ────────────────────────────────────────────────────────────────────────────────────

/**
 * `Triagem: venceu há 8 h (prazo 17/08, 04h00)` — the queue's two lines folded into one, on the
 * state band's single line (DS-COPY-025, point 5, in the shape `design` wrote for the detail). Same
 * status, same texts, same module as the column.
 */
function headerClock(detail: Detail, t: ReturnType<typeof useTranslations>): string {
  const status = deriveTriageStatus(detail.triage)
  const value = triageText(status, t)
  const deadline = triageDeadlineText(status)
  return deadline
    ? t('triage.headerLineWithDeadline', { value, deadline })
    : t('triage.headerLine', { value })
}

function publishedLine(
  place: PartnershipPlace,
  t: ReturnType<typeof useTranslations>
): string {
  if (!place.publishedBy) return t('publish.publishedLineUndated')
  if (!place.publishedBy.by) {
    return t('publish.publishedLineAnonymous', { date: formatDate(place.publishedBy.at) })
  }
  return t('publish.publishedLine', {
    date: formatDate(place.publishedBy.at),
    person: place.publishedBy.by,
  })
}
