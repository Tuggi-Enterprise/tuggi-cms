'use client'

/**
 * One partnership, whole — the five states in the same order, always, and none of them hidden.
 *
 * The current band opens; the ones behind it collapse to a line with who and when; the ones
 * ahead stay legible with what they will demand. Somebody arriving at state 3 has to be able
 * to see, without clicking, that a trigger point and an audio still stand between the contract
 * and the place saying anything.
 *
 * WHAT THIS SCREEN IS NOT. It is not the client's record, not the place editor, not the
 * trigger-point editor and not the boundary drawing (DS-LAYOUT-006, 1st edge case). The fiscal
 * data, the banking data, the team, the coupons and the contract stay on
 * `/admin/clients/{id}`; band 3 shows what the pipeline decides and links to the rest. Copying
 * three fields "for convenience" is how the second source of the same fact gets born.
 *
 * EVERY BAND IS A `<section>` WITH A HEADING, its toggle is a `<button aria-expanded>`, and the
 * situation of each one (`concluída`, `em andamento`, `ainda não`) is TEXT — never an icon and
 * never a colour on its own (DS-A11Y-003).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PlaceFormModal } from '@/components/place-management/PlaceFormModal'
import { formatDate } from '@/components/admin/partner-proposals/format'
import { formatMonthlyFee } from '@/lib/partnerships/publish-plan'
import type { PendencyId } from '@/lib/partnerships/place-readiness'
import { IN_PROGRESS_STATES, type PipelineState } from '@/lib/partnerships/pipeline'
import { deriveTriageStatus, type TriageGate } from '@/lib/partnerships/triage'
import { returnParams } from '@/lib/navigation/return-to'
import type { PartnershipDetail as Detail, PartnershipPlace } from '@/lib/services/partnership-service'
import { PendencyList } from './PendencyList'
import { PlaceLinkPanel } from './PlaceLinkPanel'
import { PublishPanel, UnpublishPanel } from './PublishPanel'
import { CommunicationPanel, RefusalPanel, RefusalSummary, type RefusalOutcome } from './TriageRefusalPanel'
import { triageDeadlineText, triageText } from './triage-text'

type BandId = 'proposal' | 'conference' | 'client' | 'place' | 'publication'
type BandStatus = 'done' | 'current' | 'future'
type PanelKind = 'publish' | 'unpublish' | 'refuse' | 'communicate'
type Panel = { attractionId: string; kind: PanelKind } | null

/**
 * How far along the pipeline each state is. `discarded` reads as the very beginning.
 *
 * `refused_at_triage` sits at band 4, with the place: the refusal is a decision ABOUT THE PLACE
 * and the operator who comes back to the row goes to the place to read it. It is terminal without
 * being an ending — the partnership continues (BR-B2B-010, 6th edge case).
 *
 * `refusal_not_communicated` sits there too, and for a stronger reason: the act it is waiting for
 * (`Registrar a comunicação ao parceiro`) is a control inside band 4. Ordering it anywhere else
 * would open a band whose work is not the one the header names.
 */
const STATE_ORDER: Record<PipelineState, number> = {
  proposal_received: 0,
  in_conference: 1,
  client_created: 2,
  // Band 3 as well, and not a band of its own: the act it waits for (`Cobrar a assinatura`) is
  // the signing link, which lives in the client band beside the contract that produced it.
  contract_sent: 3,
  contract_signed: 3,
  place_in_curation: 4,
  refusal_not_communicated: 4,
  published: 5,
  discarded: 0,
  refused_at_triage: 4,
}

/**
 * The state range each band covers, and it is what decides which band OPENS.
 *
 * Band 4 starts at `contract_signed` and not at `place_in_curation`, because the act that state
 * names — `Criar o local a partir da proposta`, the one the sticky header announces — lives in
 * band 4. Covering it with band 3 opened the band whose work had just finished (the signed
 * contract) and left the only act of the state behind a closed accordion, which to the operator
 * is a menu (DS-LAYOUT-003). `client_created` still opens band 3, where `Abrir a ficha do
 * cliente` is.
 */
const BAND_RANGE: Record<BandId, [number, number]> = {
  proposal: [0, 0],
  conference: [1, 1],
  client: [2, 2],
  place: [3, 4],
  publication: [5, 5],
}

const BANDS: BandId[] = ['proposal', 'conference', 'client', 'place', 'publication']

interface PartnershipDetailProps {
  locale: string
  clientId: string
  /**
   * Where `Voltar para a fila` goes, when there is a queue behind this screen. Absent when the
   * pipeline is a TAB of the client record: the way out of a tab is the tab strip, and a link
   * back to a list the operator never came from is a false trail.
   */
  backHref?: string
  /**
   * How to reach a neighbouring tab, when this pipeline is embedded in the client record.
   *
   * THIS IS WHERE THE ROUND TRIP DIES. Band 3 used to LINK at the client record and at the
   * contract — two page changes to fill one field and come back. Inside the record those two
   * destinations are tabs, one click away, with no fetch and no navigation, so the band offers
   * the act instead of a door to it. On the standalone page there is no tab strip and the
   * links stay.
   */
  onOpenTab?: (tab: 'profile' | 'fiscal' | 'contract') => void
}

export function PartnershipDetail({
  locale,
  clientId,
  backHref,
  onOpenTab,
}: PartnershipDetailProps) {
  const t = useTranslations('Partnerships')

  const [detail, setDetail] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [failure, setFailure] = useState<'none' | 'not_found' | 'error'>('none')
  const [open, setOpen] = useState<BandId[]>([])
  const [touched, setTouched] = useState(false)
  const [panel, setPanel] = useState<Panel>(null)
  const [editingPlaceId, setEditingPlaceId] = useState<string | null>(null)
  /**
   * A refusal whose request never came back with an answer. It outlives the panel on purpose: the
   * panel closes, the screen reloads, and the operator still has to be told what to check before
   * clicking again — the table is append-only (#377, item 3).
   */
  const [refusalUnknown, setRefusalUnknown] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/admin/partnerships/clients/${clientId}`)
      if (response.status === 404) {
        setFailure('not_found')
        setDetail(null)
        return
      }
      const payload = response.ok ? await response.json() : null
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
  }, [clientId])

  useEffect(() => {
    void load()
  }, [load])

  const currentBand = useMemo<BandId>(() => {
    if (!detail) return 'proposal'
    const order = STATE_ORDER[detail.state]
    return BANDS.find((band) => order >= BAND_RANGE[band][0] && order <= BAND_RANGE[band][1]) ?? 'place'
  }, [detail])

  // The current band opens by itself, and stops doing so the moment the operator has an
  // opinion — reopening what somebody just closed is the sort of help that costs a click.
  const isOpen = (band: BandId) => (touched ? open.indexOf(band) >= 0 : band === currentBand)

  function toggle(band: BandId) {
    const currentlyOpen = isOpen(band)
    const base = touched ? open : [currentBand]
    setTouched(true)
    setOpen(currentlyOpen ? base.filter((id) => id !== band) : base.concat(band))
  }

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

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-7xl px-6 py-6" aria-busy="true">
        <span className="sr-only">{t('detail.loading')}</span>
        <div className="h-8 w-1/3 animate-pulse rounded bg-gray-100" aria-hidden="true" />
        <div className="mt-4 space-y-3" aria-hidden="true">
          {BANDS.map((band) => (
            <div key={band} className="h-12 animate-pulse rounded bg-gray-100" />
          ))}
        </div>
      </div>
    )
  }

  if (failure === 'not_found' || !detail) {
    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-10 text-center">
        <p className="font-medium text-gray-900">
          {failure === 'error' ? t('detail.errorTitle') : t('detail.notFoundTitle')}
        </p>
        <div className="mt-3 flex justify-center gap-3">
          {failure === 'error' && (
            <Button variant="outline" onClick={() => void load()}>
              {t('detail.retry')}
            </Button>
          )}
          {backHref && (
            <Link
              href={backHref}
              className="inline-flex min-h-[24px] items-center text-sm font-medium text-primary-800 underline underline-offset-4"
            >
              {t('detail.backToQueue')}
            </Link>
          )}
        </div>
      </div>
    )
  }

  const name = detail.client.name ?? detail.client.companyName ?? ''
  const returnTo = `/${locale}/admin/partnerships/clients/${clientId}`
  const returnLabel = t('returnBar.label', { name })

  function toolHref(attractionId: string, pendency: PendencyId): string {
    // The boundary is drawn inside the trigger-points panel (`TriggerPointsManager` renders
    // `BoundaryControls`), so both land there.
    const tab = pendency === 'audio_description' ? 'description' : 'trigger-points'
    const query = new URLSearchParams({ tab, ...returnParams(returnTo, returnLabel) })
    return `/${locale}/pois/${attractionId}?${query.toString()}`
  }

  /**
   * The client record, OPENED — and until this was written it was not.
   *
   * The link read `?client=`, and the screen on the other side reads `clientId`
   * (`AdminClientsPageContent`): every `Abrir a ficha do cliente` landed the operator on the
   * paginated client list with nothing open, to hunt by hand for the client they had just been
   * looking at. Built here, out of one function, so the two callers cannot drift again.
   *
   * `tab` is an allowlisted deep link of `ClientEditorModal`; the way back travels with it,
   * because the operator opened this to fill in one field and belongs back in the band.
   */
  function clientHref(tab?: 'profile' | 'fiscal' | 'contract'): string {
    // The route parameter and not `detail.client.id`: this screen IS the pipeline of that
    // client, and the two are the same id by construction of the endpoint above.
    const query = new URLSearchParams({ clientId, ...returnParams(returnTo, returnLabel) })
    if (tab) query.set('tab', tab)
    return `/${locale}/admin/clients?${query.toString()}`
  }

  /** The contract's own route — a long document with a trail, so it stays a page (#342). */
  function contractHref(): string {
    const query = new URLSearchParams(returnParams(returnTo, returnLabel))
    return `/${locale}/admin/clients/${clientId}/contract?${query.toString()}`
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-6">
      {backHref && (
        <Link
          href={backHref}
          className="inline-flex min-h-[24px] items-center text-sm font-medium text-primary-800 underline underline-offset-4"
        >
          {t('detail.backToQueue')}
        </Link>
      )}

      {/* Sticky: in a partnership with three places, publishing must not mean scrolling back
          up, and the action of the current state is never behind a menu (DS-LAYOUT-003). */}
      <header className="sticky top-0 z-10 -mx-6 mb-5 mt-3 border-b border-gray-200 bg-white px-6 py-3">
        <h1 className="text-2xl font-semibold text-gray-900">{name}</h1>
        <p className="mt-1 text-sm text-gray-800">
          {[detail.client.taxId, cityLine(detail)].filter(Boolean).join(' · ')}
        </p>
        <p className="mt-1 text-sm font-medium text-gray-900">
          {t(`states.${detail.state}`)}
          {/* `published` and `discarded` have no next step, and the place to say so is not a
              bare em dash hanging next to the state. */}
          {IN_PROGRESS_STATES.indexOf(detail.state) >= 0 && (
            <span className="ml-2 font-normal text-gray-800">
              {t(`nextSteps.${detail.state}`)}
            </span>
          )}
          {/* The clock, in the header the spec draws it in (§6.2) and out of the SAME module the
              queue column reads — the list and the detail cannot disagree about a promise made to
              a partner (BR-B2B-010, item 4). There is no second line here, so the instant of the
              deadline comes in parentheses on this one (DS-COPY-025, point 5). */}
          <span className="ml-2 font-normal text-gray-800" title={t('triage.deadlineTitle')}>
            {headerClock(detail, t)}
          </span>
        </p>
        {/* Criterion 33: the two states the refusal produces carry this line, and the screen offers
            no action that removes the partnership — BR-B2B-010, 6th edge case, and BR-B2B-027,
            item 3. Before the communication the state is `refusal_not_communicated`, and that is
            precisely when the operator is about to write to the partner. */}
        {(detail.state === 'refused_at_triage' ||
          detail.state === 'refusal_not_communicated') && (
          <p className="mt-1 text-sm font-medium text-gray-900">
            {t('triage.partnershipContinues')}
          </p>
        )}
      </header>

      {/* The refusal whose fate we do not know — raised out of the panel, because the panel closed.
          The act is append-only: repeating it is what creates two refusals, so no control here
          offers to (#377, item 3, and BR-B2B-011, item 5). */}
      {refusalUnknown && (
        <div
          role="alert"
          className="mb-4 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-gray-900"
        >
          <p className="font-semibold">{t('triage.refuseUnknownTitle')}</p>
          <p className="mt-1">{t('triage.refuseUnknownBody')}</p>
        </div>
      )}

      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="min-w-0 flex-1 space-y-3">
          {BANDS.map((band) => (
            <Band
              key={band}
              band={band}
              status={bandStatus(band, detail)}
              open={isOpen(band)}
              onToggle={() => toggle(band)}
            >
              {band === 'proposal' && <ProposalBand detail={detail} locale={locale} />}
              {band === 'conference' && <ConferenceBand detail={detail} />}
              {band === 'client' && (
                <ClientBand
                  detail={detail}
                  clientHref={clientHref}
                  contractHref={contractHref}
                  onOpenTab={onOpenTab}
                />
              )}
              {band === 'place' && (
                <PlaceBand
                  detail={detail}
                  locale={locale}
                  clientHref={clientHref}
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
              )}
              {band === 'publication' && (
                <PublicationBand
                  detail={detail}
                  panel={panel}
                  setPanel={setPanel}
                  publish={publish}
                  reload={load}
                />
              )}
            </Band>
          ))}
        </div>

        <aside className="w-full shrink-0 lg:w-72">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-900">
            {t('detail.trail')}
          </h2>
          <Trail detail={detail} />
        </aside>
      </div>

      {/* `Abrir o local` is a modal, so it comes back on its own; closing it reloads the
          pipeline, and the pendency the operator just resolved disappears without a manual
          reload (DS-LAYOUT-006, point 3). */}
      <PlaceFormModal
        placeId={editingPlaceId}
        isOpen={editingPlaceId !== null}
        onClose={() => {
          setEditingPlaceId(null)
          void load()
        }}
        onSaved={() => void load()}
      />
    </div>
  )
}

// ── The frame ────────────────────────────────────────────────────────────────────────────────

function Band({
  band,
  status,
  open,
  onToggle,
  children,
}: {
  band: BandId
  status: BandStatus
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  const t = useTranslations('Partnerships')
  const headingId = `band-${band}-heading`

  return (
    <section aria-labelledby={headingId} className="rounded-md border border-gray-200 bg-white">
      <h2 id={headingId} className="text-base font-semibold text-gray-900">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={`band-${band}-body`}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        >
          <span className="flex items-center gap-2">
            {open ? (
              <ChevronDown className="h-4 w-4 shrink-0 text-primary-800" aria-hidden="true" />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0 text-primary-800" aria-hidden="true" />
            )}
            {t(`detail.bands.${band}`)}
          </span>
          {/* Text, never an icon or a colour on its own (DS-A11Y-003). */}
          <span className="text-xs font-normal text-gray-800">
            {t(`detail.bandStatus.${status}`)}
          </span>
        </button>
      </h2>
      {open && (
        <div id={`band-${band}-body`} className="border-t border-gray-100 px-4 py-3">
          {children}
        </div>
      )}
    </section>
  )
}

/**
 * Band 5 is the one band the pipeline state cannot answer on its own. A partnership with three
 * places, two of them on air, is `place_in_curation` — and a band that reads `ainda não` while
 * two places are in front of tourists contradicts the queue, which counts `2 de 3 locais
 * publicados` from the same readiness report. The detail disagreeing with the list is the one
 * thing the single module exists to make impossible.
 */
function bandStatus(band: BandId, detail: Detail): BandStatus {
  if (band === 'publication') {
    if (detail.state === 'published') return 'done'
    if (detail.places.some((place) => place.readiness.published)) return 'current'
  }
  const order = STATE_ORDER[detail.state]
  const [from, to] = BAND_RANGE[band]
  if (order > to) return 'done'
  if (order >= from) return 'current'
  return 'future'
}

// ── The five bands ───────────────────────────────────────────────────────────────────────────

function ProposalBand({ detail, locale }: { detail: Detail; locale: string }) {
  const t = useTranslations('Partnerships')
  if (!detail.submission) {
    return <p className="text-sm text-gray-800">{t('detail.proposalMissing')}</p>
  }
  return (
    <div className="text-sm text-gray-900">
      <p>
        {detail.submission.submittedAt
          ? t('detail.proposalLine', { date: formatDate(detail.submission.submittedAt) })
          : t('detail.proposalLineUndated')}
      </p>
      <Link
        href={`/${locale}/admin/partnerships/proposals/${detail.submission.id}`}
        className="mt-2 inline-flex min-h-[24px] items-center text-sm font-medium text-primary-800 underline underline-offset-4"
      >
        {t('detail.proposalLink')}
      </Link>
    </div>
  )
}

/**
 * Band 2 reads the CLIENT's conference, not the promoted proposal's.
 *
 * It used to read `detail.submission.conference`, and for a client that was never a proposal
 * there is no submission: the band said `conferenceNone` about a step the CMS gave nobody a way
 * to complete, and the pipeline stayed pinned there. The record moved to
 * `partner.client_conferences` on 2026-08-21 and the band followed it. Where it is FILLED IN is
 * the contract page, which is also where its absence refuses something.
 */
function ConferenceBand({ detail }: { detail: Detail }) {
  const t = useTranslations('Partnerships')
  const { record, reviewedAt, reviewedByLabel } = detail.conference

  if (!reviewedAt) {
    return (
      <div className="text-sm text-gray-900">
        <p>{t('detail.conferenceNone')}</p>
        {/* The criterion behind a derived state, shown rather than assumed
            (DS-COMPONENTE-020, 1st edge case). */}
        <p className="mt-2 text-xs text-gray-800">{t('detail.conferenceDerived')}</p>
      </div>
    )
  }

  const conference = record

  return (
    <div className="text-sm text-gray-900">
      <p>
        {reviewedByLabel
          ? t('detail.conferenceLine', {
              person: reviewedByLabel,
              date: formatDate(reviewedAt),
            })
          : t('detail.conferenceLineAnonymous', { date: formatDate(reviewedAt) })}
      </p>
      {/* The licence trail line left on 2026-08-21: the conference is a tick, so there is no
          number, municipality or validity to print. What the band still says is WHO conferred
          and WHEN, which is the half of BR-B2B-030 item 2 the record still holds. */}
      <p className="mt-2 text-xs text-gray-800">{t('detail.conferenceDerived')}</p>
    </div>
  )
}

function ClientBand({
  detail,
  clientHref,
  contractHref,
  onOpenTab,
}: {
  detail: Detail
  clientHref: (tab?: 'profile' | 'fiscal' | 'contract') => string
  contractHref: () => string
  onOpenTab?: (tab: 'profile' | 'fiscal' | 'contract') => void
}) {
  const t = useTranslations('Partnerships')
  const { client, contract, submission } = detail

  return (
    <div className="space-y-1 text-sm text-gray-900">
      {client.createdAt && <p>{t('detail.clientCreated', { date: formatDate(client.createdAt) })}</p>}

      {/* Approving the partnership and signing the contract are DIFFERENT acts, and the first
          one is what BR-B2B-010, item 4, starts the clock on. They are shown apart, with the
          date of each. */}
      {client.approvedAt ? (
        submission?.promotedByLabel ? (
          <p>
            {t('detail.clientApprovedBy', {
              date: formatDate(client.approvedAt),
              person: submission.promotedByLabel,
            })}
          </p>
        ) : (
          <p>{t('detail.clientApproved', { date: formatDate(client.approvedAt) })}</p>
        )
      ) : (
        <p>{t('detail.clientNotApproved')}</p>
      )}

      {contract?.signed ? (
        contract.signerName ? (
          <p>
            {t('detail.contractSignedBy', {
              date: formatDate(contract.signedAt),
              person: contract.signerName,
            })}
          </p>
        ) : (
          <p>{t('detail.contractSigned', { date: formatDate(contract.signedAt) })}</p>
        )
      ) : (
        <p>{t('detail.contractNotSigned')}</p>
      )}

      {/* BR-B2B-010, item 3: approving the partnership never approves the place, and no text
          on this screen may suggest otherwise. */}
      <p className="pt-1 text-xs text-gray-800">{t('detail.clientSeparateActs')}</p>

      <p className="pt-2 text-gray-900">{feeLine(client.fee, t)}</p>

      {/* The next step of `client_created` is `Assinar o contrato`, and until #390 this band
          named the act without offering it: the operator left for the client list, opened the
          modal and hunted for the tab. The contract has its own page, so the band links
          straight at it — same shortcut shape as `Abrir a ficha do cliente` beside it, and no
          new tab (DS-LAYOUT-006, pt. 4). */}
      {/* Embedded in the client record these two are neighbouring tabs — no navigation, no
          fetch, and no way to lose the pipeline on the way back. Standing on its own page the
          band still links, because there is no tab strip to move to. */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        {onOpenTab ? (
          <>
            <button
              type="button"
              onClick={() => onOpenTab('profile')}
              className="inline-flex min-h-[24px] items-center text-sm font-medium text-primary-800 underline underline-offset-4"
            >
              {t('detail.openClient')}
            </button>
            <button
              type="button"
              onClick={() => onOpenTab('contract')}
              className="inline-flex min-h-[24px] items-center text-sm font-medium text-primary-800 underline underline-offset-4"
            >
              {t('detail.openContract')}
            </button>
          </>
        ) : (
          <>
            <Link
              href={clientHref()}
              className="inline-flex min-h-[24px] items-center text-sm font-medium text-primary-800 underline underline-offset-4"
            >
              {t('detail.openClient')}
            </Link>
            <Link
              href={contractHref()}
              className="inline-flex min-h-[24px] items-center text-sm font-medium text-primary-800 underline underline-offset-4"
            >
              {t('detail.openContract')}
            </Link>
          </>
        )}
      </div>
    </div>
  )
}

function PlaceBand({
  detail,
  locale,
  clientHref,
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
  locale: string
  clientHref: (tab?: 'profile' | 'fiscal' | 'contract') => string
  panel: Panel
  setPanel: (value: Panel) => void
  onOpenPlace: (id: string) => void
  toolHref: (attractionId: string, pendency: PendencyId) => string
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

  if (detail.places.length === 0) {
    return (
      <div className="text-sm">
        <p className="font-semibold text-gray-900">{t('pendencies.emptyTitle')}</p>
        <p className="mt-1 text-gray-800">{t('pendencies.emptyBody')}</p>

        {/* LINKING NOW HAS A WRITER (#409), and it goes FIRST. What stood here was a link to
            `/places` under a comment saying this act had no surface in the CMS — a round trip
            that ended in nothing. What that absence cost is measured: three of three clients
            who used the create button below ended up with an empty second row beside an
            establishment already published (`lib/partnerships/place-link`). */}
        <div className="mt-4">
          <PlaceLinkPanel clientId={detail.client.id} locale={locale} onLinked={reload} />
        </div>

        <p className="mt-4 text-xs text-gray-700">{t('placeLink.orCreate')}</p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          {/* Creating the place from the proposal is the SAME act the partner approval runs
              (#360, `applyPartnerApprovalEffects`): prefilled from what the partner wrote and
              linked by `partner_client_id`. Not a second implementation of the prefill. */}
          <Button
            type="button"
            variant="outline"
            disabled={creating}
            onClick={() => void createFromProposal()}
          >
            {t('pendencies.emptyCreate')}
          </Button>
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
              toolHref={(pendency) => toolHref(place.readiness.place.attractionId, pendency)}
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
                  clientHref={clientHref('fiscal')}
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

  if (published.length === 0) {
    return <p className="text-sm text-gray-900">{t('detail.publicationBefore')}</p>
  }

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

/**
 * The trail, built out of the pipeline's own dated events.
 *
 * It does not read `core.audit_logs` on purpose: everything shown here is a fact the five
 * bands already carry, and a second reading of the same events is a second chance for the two
 * to disagree. The full audit history has its own screen, `/admin/audit-logs`.
 */
function Trail({ detail }: { detail: Detail }) {
  const t = useTranslations('Partnerships')

  const entries = [
    detail.submission?.submittedAt
      ? t('detail.proposalLine', { date: formatDate(detail.submission.submittedAt) })
      : null,
    // The client's conference, the same source band 2 reads. Reading `submission` here would
    // put the trail and the band on two different records for the same act.
    detail.conference.reviewedAt
      ? detail.conference.reviewedByLabel
        ? t('detail.conferenceLine', {
            person: detail.conference.reviewedByLabel,
            date: formatDate(detail.conference.reviewedAt),
          })
        : t('detail.conferenceLineAnonymous', { date: formatDate(detail.conference.reviewedAt) })
      : null,
    detail.client.createdAt
      ? t('detail.clientCreated', { date: formatDate(detail.client.createdAt) })
      : null,
    detail.client.approvedAt
      ? t('detail.clientApproved', { date: formatDate(detail.client.approvedAt) })
      : null,
    detail.contract?.signed
      ? t('detail.contractSigned', { date: formatDate(detail.contract.signedAt) })
      : null,
    // Named, unlike band 5's line: there the place's name is already in the `<p>` above, and
    // here a partnership with N places would otherwise be N identical rows.
    ...detail.places
      .filter((place) => place.publishedBy)
      .map((place) => trailPublishedLine(place, t)),
  ].filter((line): line is string => typeof line === 'string')

  if (entries.length === 0) {
    return <p className="mt-2 text-sm text-gray-800">{t('detail.trailEmpty')}</p>
  }

  return (
    <ol className="mt-2 space-y-2 text-sm text-gray-800">
      {entries.map((entry, index) => (
        <li key={index} className="break-words border-l-2 border-gray-200 pl-3">
          {entry}
        </li>
      ))}
    </ol>
  )
}

// ── Lines ────────────────────────────────────────────────────────────────────────────────────

/**
 * `Triagem: venceu há 8 h (prazo 17/08, 04h00)` — the queue's two lines folded into one, because a
 * sticky header has no second line to give (DS-COPY-025, point 5, in the shape `design` wrote for
 * the detail). Same status, same texts, same module as the column.
 */
function headerClock(detail: Detail, t: ReturnType<typeof useTranslations>): string {
  const status = deriveTriageStatus(detail.triage)
  const value = triageText(status, t)
  const deadline = triageDeadlineText(status)
  return deadline
    ? t('triage.headerLineWithDeadline', { value, deadline })
    : t('triage.headerLine', { value })
}

function cityLine(detail: Detail): string {
  const { city, region } = detail.client
  if (!city) return ''
  return region ? `${city}/${region}` : city
}

function feeLine(
  fee: Detail['client']['fee'],
  t: ReturnType<typeof useTranslations>
): string {
  if (fee.isCourtesy && (fee.courtesyReason ?? '').trim().length > 0) {
    return t('detail.feeCourtesy', { reason: (fee.courtesyReason ?? '').trim() })
  }
  if (typeof fee.monthlyFeeCents === 'number') {
    return t('detail.feeLine', { fee: formatMonthlyFee(fee.monthlyFeeCents) })
  }
  // Absent is an incomplete registration and is NOT zero — BR-B2B-017, item 6.
  return t('detail.feeUndeclared')
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

/** The same fact as `publishedLine`, carrying the name — only the trail needs it. */
function trailPublishedLine(
  place: PartnershipPlace,
  t: ReturnType<typeof useTranslations>
): string {
  const name = place.readiness.place.name
  if (!place.publishedBy) return t('publish.publishedLineUndated')
  if (!place.publishedBy.by) {
    return t('publish.trailPublishedAnonymous', {
      name,
      date: formatDate(place.publishedBy.at),
    })
  }
  return t('publish.trailPublished', {
    name,
    date: formatDate(place.publishedBy.at),
    person: place.publishedBy.by,
  })
}
