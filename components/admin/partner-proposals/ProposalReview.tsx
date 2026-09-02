'use client'

/**
 * Conference and promotion — where BR-B2B-022 is applied (BR-B2B-026, item 4) and where
 * somebody reads the gate-2 input for the first time.
 *
 * THE THREE THINGS HAPPEN ON THE SAME SCREEN AND ARE NOT THE SAME DECISION, and the layout
 * exists so they do not blur into one:
 *
 *  · the regularity band decides whether a CONTRACT can be produced. It blocks nothing else —
 *    a proposal missing its licence is still promotable, and that is deliberate;
 *  · the story block is INPUT for triage, which is another decision with another owner at
 *    another moment. Turned down at triage, the place is still a partner (BR-B2B-011);
 *  · promoting is the pipeline moving one band forward, and from that moment the object of the
 *    work is the CLIENT and not this submission (`detailPath`).
 *
 * REORDERED ON 2026-08-25, and the three defects behind it were all the same defect: the screen
 * was arranged by FORM and not by DECISION.
 *
 *  1. `plan_choice` — whether the partner is asking for the free tier or the paid one — was on
 *     no part of the page. The answers grid renders steps 1 and 2, and the question is step 3.
 *     It is the first row of `O essencial` now.
 *  2. The band read as a verdict with the control that answers it in a narrow rail on the other
 *     side of the page. Regularity and conference are one pair, side by side, and the tick saves
 *     from the card the operator is looking at.
 *  3. The screen never said what state the row was in or what came next, so the operator went
 *     back to the board to read the line they had just left, and again to move forward. The
 *     header carries the state and the next step out of the SAME module the board reads
 *     (`derivePipelineState`), and a promoted proposal offers the act that continues the
 *     pipeline instead of a link into a list.
 *
 * Empty fields never appear merely greyed out: each one carries which of the three kinds of
 * absence it is, so telling "blocks the contract" from "nobody had to answer" needs no
 * knowledge of the rule.
 *
 * No block of text has `max-height` with `overflow-hidden`: a 1.200-character answer is
 * normal here, and this repo has lost text to that pair with no error at all.
 */

import { CLIENT_DIRECTORY_PATH } from '@/lib/clients/directory-filter'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { AlertTriangle, ArrowLeft, ArrowRight, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { PARTNER_DOCUMENT_KINDS } from '@/lib/partner-form/fields'
import type { PartnerDocumentKind, PartnerFieldId } from '@/lib/partner-form/fields'
import {
  EMPTY_CONFERENCE,
  buildRegularityReport,
  type ConferenceRecord,
} from '@/lib/partner-form/regularity'
import {
  DISCARD_REASONS,
  REVIEW_MARKS,
  applySubstituteTest,
  hasOfferMarker,
  type DiscardReasonId,
  type ReviewMark,
} from '@/lib/partner-form/proposal-review'
import {
  IN_PROGRESS_STATES,
  derivePipelineState,
  type PipelineState,
} from '@/lib/partnerships/pipeline'
import { returnParams } from '@/lib/navigation/return-to'
import { PromotionPanel } from './PromotionPanel'
import { RegularityBand } from './RegularityBand'
import { OutboundMessage, type OutboundKind } from './OutboundMessage'
import { ProposalSummary } from './ProposalSummary'
import { ProposalAnswers } from './ProposalAnswers'
import { formatDate, formatDateTime } from './format'
import { CARD, CTA_LINK, FIELD } from './surface'
import type { ProposalDetail } from './types'

const STORY_FIELDS: PartnerFieldId[] = ['story_founder', 'story_before', 'story_unique', 'story_event']

const OUTBOUND_KINDS: OutboundKind[] = ['regularity', 'gate1', 'gate2', 'gate3']

interface ProposalReviewProps {
  locale: string
  submissionId: string
}

export function ProposalReview({ locale, submissionId }: ProposalReviewProps) {
  const t = useTranslations('PartnerProposals')
  const pipeline = useTranslations('Partnerships')
  const form = useTranslations('PartnerForm')

  const [detail, setDetail] = useState<ProposalDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [notFound, setNotFound] = useState(false)

  const [promoting, setPromoting] = useState(false)
  const [substitute, setSubstitute] = useState(false)
  const [marks, setMarks] = useState<ReviewMark[]>([])
  const [observation, setObservation] = useState('')
  const [noteState, setNoteState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle')
  /** Which of the two buttons started the save, so the outcome is reported where it was asked. */
  const [saveOrigin, setSaveOrigin] = useState<'note' | 'conference'>('note')
  const [discarding, setDiscarding] = useState(false)
  const [discardReason, setDiscardReason] = useState<DiscardReasonId>('duplicate')
  const [discardError, setDiscardError] = useState(false)
  const [conference, setConference] = useState<ConferenceRecord>(EMPTY_CONFERENCE)
  const [outbound, setOutbound] = useState<OutboundKind | null>(null)
  /**
   * The pipeline state of the client this proposal was promoted into, read from the same route
   * the board reads. `null` while it is being fetched or when the read failed.
   *
   * WHY IT IS FETCHED AND NOT DERIVED HERE. From the client onwards the state depends on the
   * contract and on the places, and this screen holds neither: deriving it from what a
   * submission knows would print `Cliente criado` beside a contract somebody signed yesterday.
   * A detail that disagrees with the queue is the one thing the shared module exists to make
   * impossible (DS-COMPONENTE-020, point 4), so the page either says the true state or says
   * nothing and sends the operator to the record that knows.
   */
  const [promotedState, setPromotedState] = useState<PipelineState | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setFailed(false)
    setNotFound(false)
    try {
      const response = await fetch(`/api/admin/partner-proposals/${submissionId}`)
      if (response.status === 404) {
        setNotFound(true)
        return
      }
      if (!response.ok) {
        setFailed(true)
        return
      }
      const payload = (await response.json()) as ProposalDetail
      setDetail(payload)
      // The screen opens on what the last reviewer wrote, not on an empty form that would
      // erase their conference the moment somebody saved an observation.
      setMarks(payload.note?.marks ?? [])
      setObservation(payload.note?.observation ?? '')
      setConference(payload.conference ?? EMPTY_CONFERENCE)
      // Restoring a discarded proposal drops the client, and a pipeline state read for a client
      // this submission no longer points at would outlive the fact it described.
      if (!payload.submission.promotedClientId) setPromotedState(null)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [submissionId])

  useEffect(() => {
    void load()
  }, [load])

  const promotedClientId = detail?.submission.promotedClientId ?? null

  useEffect(() => {
    if (!promotedClientId) return
    let live = true
    void (async () => {
      try {
        const response = await fetch(`/api/admin/partnerships/clients/${promotedClientId}`)
        if (!response.ok) return
        const payload = (await response.json()) as { detail?: { state?: PipelineState } }
        if (live && payload.detail?.state) setPromotedState(payload.detail.state)
      } catch {
        // The continue card degrades to its link, which is the act that matters.
      }
    })()
    return () => {
      live = false
    }
  }, [promotedClientId])

  const answers = detail?.submission.answers ?? {}
  // The band follows what is on screen, not what was last saved: ticking `Vi o alvará` has to
  // move the line above before the operator clicks save, or they cannot tell whether the tick
  // did anything.
  const report = useMemo(() => buildRegularityReport(answers, conference), [answers, conference])

  /**
   * THE FREE TIER HAS NO STORY TO READ, and BR-B2B-011, item 2.2, is what says so: the input of
   * a `map_only` partner IS the minimal registration, BY DESIGN (BR-B2B-016, item 1 — the app
   * says the name of the place and nothing beyond it), and what gate 2 measures without
   * qualification is WHAT WILL BE NARRATED, which for this tier is nothing.
   *
   * So the four story questions, the three reading marks and the substitute test are a block
   * about a description that will never exist. Rendered anyway, they report four absences
   * (`Sem resposta — ajudaria a triagem`) about questions this partner is not even asked.
   *
   * `=== 'map_only'` and never `!== 'map_and_description'`: an ABSENT answer is not the free
   * tier. Proposals submitted before `plan_choice` existed (2026-08-21) carry no tier at all,
   * and suppressing the story for them would hide the gate-2 input on the rows that have one.
   */
  const mapOnly = answers.plan_choice === 'map_only'

  const categoryLabel = answers.category ? form(`categories.${answers.category}`) : ''
  const tradeName = answers.trade_name ?? ''
  const recipientName = answers.representative_name ?? ''

  if (loading) {
    return (
      <p className="min-h-screen bg-gray-50 p-8 text-sm text-gray-800 dark:bg-gray-950 dark:text-gray-300" aria-busy="true">
        <Loader2 className="mr-2 inline h-4 w-4 animate-spin" aria-hidden="true" />
        {t('review.loading')}
      </p>
    )
  }

  if (notFound) {
    return (
      <div className="min-h-screen bg-gray-50 p-8 dark:bg-gray-950">
        <p className="font-medium text-gray-900 dark:text-white">{t('review.notFoundTitle')}</p>
        <p className="mt-1 text-sm text-gray-800 dark:text-gray-300">{t('review.notFoundBody')}</p>
        <Link
          href={`/${locale}${CLIENT_DIRECTORY_PATH}`}
          className="mt-3 inline-block text-sm font-medium text-primary-800 underline dark:text-tuggi-blue underline-offset-4"
        >
          {t('review.back')}
        </Link>
      </div>
    )
  }

  if (failed || !detail) {
    return (
      <div className="min-h-screen bg-gray-50 p-8 dark:bg-gray-950">
        <p className="font-medium text-gray-900 dark:text-white">{t('review.errorTitle')}</p>
        <Button variant="outline" className="mt-3" onClick={load}>
          {t('review.retry')}
        </Button>
      </div>
    )
  }

  const isSubmitted = detail.submission.status === 'submitted'
  const isPromoted = detail.submission.status === 'promoted'
  const isDiscarded = detail.submission.status === 'discarded'

  /**
   * THE STATE IN THE HEADER, out of the module the board reads and never out of a string here.
   *
   * `clientId: null` on purpose while the submission is the object: bands 1 and 2 are the only
   * ones a submission can be in, and they are decided by the conference alone. Once there is a
   * client, `promotedState` — the real one, fetched — takes over, and until it arrives the
   * header shows no state rather than a guess.
   */
  const localState = derivePipelineState({
    proposalStatus: detail.submission.status,
    conference,
    clientId: null,
    contract: 'none',
    placeCount: 0,
    publishedPlaceCount: 0,
  })
  const shownState: PipelineState | null = isPromoted ? promotedState : localState
  const clientName = detail.client?.name ?? (tradeName || t('review.noTradeName'))

  /**
   * Where the pipeline continues — the client record, opened on the partnership tab, carrying
   * the way back to this proposal (DS-LAYOUT-006, points 1 and 2). It is built with
   * `CLIENT_DIRECTORY_PATH` and `URLSearchParams` and carries NO `state` filter: a link into the
   * list that filters to the working set empties the terminal columns of the board.
   */
  const continueHref = promotedClientId
    ? `/${locale}${CLIENT_DIRECTORY_PATH}?${new URLSearchParams({
        clientId: promotedClientId,
        tab: 'partnership',
        ...returnParams(
          `/${locale}/admin/partnerships/proposals/${submissionId}`,
          t('review.promotedReturnLabel')
        ),
      }).toString()}`
    : null

  /**
   * Unticking the licence KEEPS the three fields typed off it. Unticking by mistake and
   * ticking again must not cost the operator a retype of a document that has already left
   * their hands (spec `design` §1) — and the band does not publish them meanwhile, because
   * `licenseStatus` hides identity and validity for a licence nobody says they saw.
   *
   * What is SAVED with the tick off is another matter, and `normalizeConference` drops all
   * three there: a stored record must not carry the identity of a document nobody saw.
   */
  function toggleDocumentSeen(kind: PartnerDocumentKind) {
    setConference((current) => {
      const seen = current.documentsSeen.indexOf(kind) >= 0
      return {
        ...current,
        documentsSeen: seen
          ? current.documentsSeen.filter((value) => value !== kind)
          : current.documentsSeen.concat(kind),
      }
    })
    setNoteState('idle')
  }

  /**
   * ONE ACT, TWO BUTTONS. The conference ticks and the triage annotation travel in the same
   * `PUT`, and they always did — what changed is that the conference card no longer asks the
   * operator to scroll to another card to persist a tick they made here. `origin` only decides
   * where the outcome is announced.
   */
  async function saveNote(origin: 'note' | 'conference') {
    setSaveOrigin(origin)
    setNoteState('saving')
    try {
      const response = await fetch(`/api/admin/partner-proposals/${submissionId}/review-note`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ marks, observation, conference }),
      })
      setNoteState(response.ok ? 'saved' : 'failed')
      // The band above reads `reviewedBy`/`reviewedAt`, which only exist after the write.
      if (response.ok) await load()
    } catch {
      setNoteState('failed')
    }
  }

  async function discard() {
    setDiscardError(false)
    try {
      const response = await fetch(`/api/admin/partner-proposals/${submissionId}/discard`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: discardReason }),
      })
      if (!response.ok) {
        setDiscardError(true)
        return
      }
      const reason = DISCARD_REASONS.find((candidate) => candidate.id === discardReason)
      if (reason?.notifies) setOutbound('regularity')
      setDiscarding(false)
      await load()
    } catch {
      setDiscardError(true)
    }
  }

  async function restore() {
    try {
      const response = await fetch(`/api/admin/partner-proposals/${submissionId}/discard`, {
        method: 'DELETE',
      })
      if (!response.ok) {
        setDiscardError(true)
        return
      }
      await load()
    } catch {
      setDiscardError(true)
    }
  }

  return (
    // The frame of `/pois`, which is the CMS's: page ground, generous padding, and every panel
    // a glass card. The INK is not `/pois`'s — see the note in `surface.ts`.
    <div className="cms-width min-h-screen bg-gray-50 p-6 dark:bg-gray-950 lg:p-8">
      <div className="mx-auto w-full max-w-6xl">
        {/* Sticky, so promoting a long proposal never asks the operator to scroll back. */}
        <header className={`${CARD} sticky top-0 z-30 mb-6 px-6 py-4`}>
          <Link
            href={`/${locale}${CLIENT_DIRECTORY_PATH}`}
            className="inline-flex items-center gap-1 text-sm text-primary-800 underline dark:text-tuggi-blue underline-offset-4"
          >
            <ArrowLeft className="h-3 w-3" aria-hidden="true" />
            {t('review.back')}
          </Link>

          <div className="mt-2 flex flex-wrap items-baseline justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
                {tradeName || t('review.noTradeName')}
              </h1>
              <p className="text-sm text-gray-700 dark:text-gray-400">
                {[
                  answers.tax_id ? t('review.taxId', { value: answers.tax_id }) : '',
                  [answers.city, answers.state].filter(Boolean).join(' — '),
                  detail.submission.submittedAt
                    ? t('review.receivedAt', { date: formatDate(detail.submission.submittedAt) })
                    : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>

              {/* STATE AND NEXT STEP, in the shape DS-COPY-020 gives them and out of the same
                  two message groups the board reads. States with nothing left to do carry no
                  next step, and a bare em dash next to the state is not the way to say so. */}
              {shownState && (
                <p className="mt-1 text-sm font-medium text-gray-900 dark:text-white">
                  {pipeline(`states.${shownState}`)}
                  {IN_PROGRESS_STATES.indexOf(shownState) >= 0 && (
                    <span className="font-normal text-gray-800 dark:text-gray-300">
                      {' · '}
                      {pipeline(`nextSteps.${shownState}`)}
                    </span>
                  )}
                </p>
              )}
            </div>

            {/* The two acts live here and never behind a menu (DS-LAYOUT-003). */}
            <div className="flex items-center gap-3">
              {isSubmitted && (
                <>
                  <Button variant="cta" onClick={() => setPromoting(true)}>{t('promotion.action')}</Button>
                  <Button variant="outline" onClick={() => setDiscarding(true)}>
                    {t('discard.action')}
                  </Button>
                </>
              )}
              {isPromoted && continueHref && (
                <Link href={continueHref} className={CTA_LINK}>
                  {t('review.continueAction', { name: clientName })}
                  <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
                </Link>
              )}
              {isDiscarded && (
                <Button variant="outline" onClick={restore}>
                  {t('discard.restore')}
                </Button>
              )}
            </div>
          </div>
        </header>

        {/* ESTE CNPJ JÁ É CLIENTE, e desde 2026-08-19 é aqui que a operação descobre isso.
            A porta pública parou de recusar: recusar era um oráculo de carteira de clientes, e a
            garantia contra cadastro duplicado passou a ser o índice único do banco
            (`clients_tax_id_normalized_uk`), que vale nos cinco caminhos de escrita e não só neste.

            A CONSEQUÊNCIA OPERACIONAL É UMA SÓ, E É POR ISSO QUE ESTA CAIXA EXISTE: quem sonda um
            CNPJ alheio põe o PRÓPRIO e-mail no formulário. Responder pelo e-mail da proposta
            devolveria, pela operação, exatamente o oráculo que o código deixou de ser. Respondendo
            pelo e-mail do CADASTRO, só quem controla aquele endereço fica sabendo — e quem controla
            é o dono. */}
        {isSubmitted && detail.client && (
          <div className="mb-4 rounded-2xl border border-amber-600/40 bg-amber-50 p-4 text-sm text-gray-900 dark:bg-amber-950/30 dark:text-white">
            <p className="font-semibold">
              {t('review.existingClientTitle', { name: detail.client.name ?? tradeName })}
            </p>
            <p className="mt-1">{t('review.existingClientBody')}</p>
            {detail.client.email && (
              <p className="mt-1 font-medium">
                {t('review.existingClientReplyTo', { email: detail.client.email })}
              </p>
            )}
          </div>
        )}

        {/* WHERE THE FLOW CONTINUES, and it is a card and not a footnote. Promoting used to end
            in a green stripe whose only link opened the paginated client list with nothing open —
            `?client=` was a key nothing reads — so the operator went back to the board and forward
            again to do the next act. The button opens the record ON the partnership tab, carrying
            the way back (DS-LAYOUT-006, points 1 and 2). */}
        {isPromoted && (
          <section
            aria-labelledby="continue-heading"
            className={`${CARD} mb-4 border-green-700/40 p-6`}
          >
            <p className="text-sm font-semibold text-gray-900 dark:text-white">
              {t('review.promotedTitle', {
                date: formatDate(detail.submission.promotedAt),
                person: detail.submission.promotedBy ?? '—',
              })}
            </p>
            <h2 id="continue-heading" className="mt-2 text-base font-semibold text-gray-900 dark:text-white">
              {t('review.continueHeading')}
            </h2>
            <p className="mt-1 text-sm text-gray-800 dark:text-gray-300">{t('review.promotedBody')}</p>

            {/* THE ACT IS IN THE HEADER AND NOT REPEATED HERE. Every act of this screen lives in
                the same place — `Promover`, `Descartar`, `Continuar` — and the header is sticky,
                so it is still reachable from the bottom of a long proposal. Two identical
                buttons a hand apart read as a bug, and the second one is the one nobody trusts. */}
            {continueHref ? (
              <p className="mt-3 text-xs text-gray-800 dark:text-gray-300">
                {t('review.continueHint', { name: clientName })}
              </p>
            ) : (
              <p className="mt-3 text-sm text-gray-800 dark:text-gray-300">{t('review.continueUnknown')}</p>
            )}
          </section>
        )}

        {isDiscarded && (
          <p className={`${CARD} mb-4 p-4 text-sm text-gray-900 dark:text-gray-200`}>
            <AlertTriangle className="mr-1 inline h-4 w-4" aria-hidden="true" />
            {t('review.discardedTitle', { date: formatDate(detail.submission.updatedAt) })}
          </p>
        )}

        {detail.duplicates.length > 0 && (
          <div className="mb-4 rounded-2xl border border-secondary-700/50 bg-secondary-50 p-4 text-sm text-gray-900 dark:bg-gray-900/70 dark:text-white">
            <p className="font-semibold">
              {t('review.duplicateTitle', { count: detail.duplicates.length })}
            </p>
            <p className="mt-1">{t('review.duplicateBody')}</p>
            <ul className="mt-2 space-y-1">
              {detail.duplicates.map((duplicate) => (
                <li key={duplicate.id}>
                  <Link
                    href={`/${locale}/admin/partnerships/proposals/${duplicate.id}`}
                    className="font-medium text-primary-800 underline dark:text-tuggi-blue underline-offset-4"
                  >
                    {t('review.duplicateOpen', { date: formatDateTime(duplicate.submittedAt) })}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        {promoting && isSubmitted && (
          <div className="mb-5">
            <PromotionPanel
              detail={detail}
              categoryLabel={categoryLabel}
              onClose={() => setPromoting(false)}
              onPromoted={() => {
                setPromoting(false)
                void load()
              }}
            />
          </div>
        )}

        {discarding && (
          <section className={`${CARD} mb-5 p-6 text-sm`}>
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">{t('discard.title')}</h2>
            <p className="mt-2 text-gray-900 dark:text-white">{t('discard.notTriage')}</p>

            <label htmlFor="discard-reason" className="mt-3 block font-medium text-gray-700 dark:text-gray-400">
              {t('discard.reasonLabel')}
            </label>
            <select
              id="discard-reason"
              value={discardReason}
              onChange={(event) => setDiscardReason(event.target.value as DiscardReasonId)}
              className={`mt-1 ${FIELD} max-w-lg`}
            >
              {DISCARD_REASONS.map((reason) => (
                <option key={reason.id} value={reason.id}>
                  {t(`discard.reasons.${reason.id}`)}
                </option>
              ))}
            </select>

            {DISCARD_REASONS.find((reason) => reason.id === discardReason)?.notifies && (
              <p className="mt-2 text-xs text-gray-800 dark:text-gray-300">{t('discard.notifies')}</p>
            )}

            <p className="mt-3 text-gray-800 dark:text-gray-300">{t('discard.reversible')}</p>

            {discardError && (
              <p className="mt-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-gray-900 dark:text-white">
                {t('discard.failed')}
              </p>
            )}

            <div className="mt-3 flex gap-3">
              <Button variant="destructive" onClick={discard}>
                {t('discard.confirm')}
              </Button>
              <Button variant="outline" onClick={() => setDiscarding(false)}>
                {t('discard.cancel')}
              </Button>
            </div>
          </section>
        )}

        <div className="space-y-5">
          {/* 1 — what decides the conversation. */}
          <ProposalSummary answers={answers} />

          {/* 2 — the contract gate and the control that answers it, as one pair. They were at
              opposite ends of the page: the band named the pendency and linked to an anchor the
              operator had to trust, and the tick that resolved it was saved by a button in a
              third card. `#conference-heading` still resolves, because the band still links it
              and a link into a card the reader can already see costs nothing. */}
          <div className="grid items-start gap-5 lg:grid-cols-2">
            <RegularityBand
              report={report}
              answers={answers}
              checkedBy={detail.submission.reviewedBy}
              checkedAt={detail.submission.reviewedAt}
            />

            {/* WHERE BR-B2B-022's EVIDENCE ENTERS THE SYSTEM. The form asks for no file: the
                papers are seen in person before the link is sent, and one operator writes down
                what they saw. It is saved under their name, and it is what the band reads. */}
            <section aria-labelledby="conference-heading" className={`${CARD} p-6`}>
              <h2 id="conference-heading" className="text-base font-semibold text-gray-900 dark:text-white">
                {t('conference.heading')}
              </h2>
              <p className="mt-1 text-sm text-gray-800 dark:text-gray-300">{t('conference.intro')}</p>

              <fieldset className="mt-3">
                <legend className="sr-only">{t('conference.heading')}</legend>
                {PARTNER_DOCUMENT_KINDS.map((kind) => (
                  <label key={kind} className="mt-2 flex items-start gap-2 text-sm text-gray-900 dark:text-white">
                    <Checkbox
                      checked={conference.documentsSeen.indexOf(kind) >= 0}
                      onCheckedChange={() => toggleDocumentSeen(kind)}
                    />
                    <span>{t(`conference.seen.${kind}`)}</span>
                  </label>
                ))}
              </fieldset>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  variant="cta"
                  size="sm"
                  onClick={() => saveNote('conference')}
                  disabled={noteState === 'saving'}
                >
                  {noteState === 'saving' && saveOrigin === 'conference'
                    ? t('conference.saving')
                    : t('conference.save')}
                </Button>
                <span role="status" className="text-sm text-primary-800 dark:text-tuggi-blue">
                  {noteState === 'saved' && saveOrigin === 'conference' ? t('conference.saved') : ''}
                </span>
                {noteState === 'failed' && saveOrigin === 'conference' && (
                  <span className="text-sm text-destructive">{t('conference.saveFailed')}</span>
                )}
              </div>

              <p className="mt-3 border-t border-gray-200 pt-2 dark:border-gray-800 text-xs text-gray-800 dark:text-gray-300">
                {t('conference.savedWithNote')}
              </p>
            </section>
          </div>

          {/* 3 — the other decision, and the screen says so in its own footer. */}
          <section aria-labelledby="story-heading" className={`${CARD} p-6`}>
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 id="story-heading" className="text-base font-semibold text-gray-900 dark:text-white">
                {mapOnly ? t('story.mapOnlyHeading') : t('story.heading')}
              </h2>
              {/* The substitute test is gate 2's own instrument (BR-B2B-011, item 2, alínea c).
                  With no description to narrate there is no text to run it over. */}
              {!mapOnly && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setSubstitute((value) => !value)}
                >
                  {substitute ? t('story.substituteUndo') : t('story.substituteApply')}
                </Button>
              )}
            </div>

            {mapOnly && (
              <p className="mt-2 text-sm text-gray-800 dark:text-gray-300">{t('story.mapOnlyBody')}</p>
            )}

            {!mapOnly && (
              <>
              {substitute && (
                <p className="mt-2 rounded-xl border border-primary/40 bg-primary-50 p-2 text-sm text-gray-900 dark:bg-gray-900/70 dark:text-white">
                  {t('story.substituteIntro')}
                </p>
              )}

              <dl className="mt-3 space-y-4">
                {STORY_FIELDS.map((field) => {
                  const value = answers[field] ?? ''
                  const shown = substitute
                    ? applySubstituteTest(value, {
                        names: [answers.trade_name, answers.legal_name],
                        replacement: t('story.substituteReplacement', {
                          category: categoryLabel || t('story.substituteFallbackCategory'),
                          city: answers.city || t('story.substituteFallbackCity'),
                        }),
                      })
                    : value
                  return (
                    <div key={field}>
                      <dt className="text-xs text-gray-700 dark:text-gray-400">{form(`fields.${field}.label`)}</dt>
                      <dd className="text-sm text-gray-900 dark:text-white">
                        {value ? (
                          <>
                            <span className="whitespace-pre-wrap break-words">{shown}</span>
                            {hasOfferMarker(value) && (
                              <span className="mt-1 block text-xs text-secondary-700">
                                {t('story.offerWarning')}
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-gray-700 dark:text-gray-400">{t('story.noAnswer')}</span>
                        )}
                      </dd>
                    </div>
                  )
                })}
              </dl>

              <fieldset className="mt-4">
                <legend className="text-sm font-medium text-gray-900 dark:text-white">{t('story.marksHeading')}</legend>
                <div className="mt-2 space-y-2">
                  {REVIEW_MARKS.map((mark) => (
                    <label key={mark} className="flex items-center gap-2 text-sm text-gray-900 dark:text-white">
                      <Checkbox
                        checked={marks.indexOf(mark) >= 0}
                        onCheckedChange={() =>
                          setMarks((current) =>
                            current.indexOf(mark) >= 0
                              ? current.filter((value) => value !== mark)
                              : current.concat(mark)
                          )
                        }
                      />
                      <span>{t(`story.marks.${mark}`)}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              </>
            )}

            <div className="mt-3">
              <label htmlFor="review-observation" className="block text-sm font-medium text-gray-700 dark:text-gray-400">
                {t('story.observationLabel')}
              </label>
              <textarea
                id="review-observation"
                value={observation}
                rows={3}
                onChange={(event) => setObservation(event.target.value)}
                className={`mt-1 ${FIELD}`}
              />
            </div>

            <div className="mt-3 flex items-center gap-3">
              <Button
                type="button"
                variant="cta"
                size="sm"
                onClick={() => saveNote('note')}
                disabled={noteState === 'saving'}
              >
                {noteState === 'saving' && saveOrigin === 'note' ? t('story.saving') : t('story.save')}
              </Button>
              <span role="status" className="text-sm text-primary-800 dark:text-tuggi-blue">
                {noteState === 'saved' && saveOrigin === 'note' ? t('story.saved') : ''}
              </span>
              {noteState === 'failed' && saveOrigin === 'note' && (
                <span className="text-sm text-destructive">{t('story.saveFailed')}</span>
              )}
            </div>

            <p className="mt-4 border-t border-gray-200 pt-3 dark:border-gray-800 text-xs text-gray-800 dark:text-gray-300">
              {t('story.footer')}
            </p>
          </section>

          {/* 4 — read rarely, read whole. */}
          <ProposalAnswers answers={answers} />

          {/* 5 — the five texts of §5, chosen by the operator. Gate 3 is on the list and has no
              template: it is the option that explains why there is nothing to send. It lives in
              a card now, and not as a bare select floating on the page ground. */}
          <section aria-labelledby="outbound-heading" className={`${CARD} p-6`}>
            <h2 id="outbound-heading" className="text-base font-semibold text-gray-900 dark:text-white">
              {t('outbound.heading')}
            </h2>
            <label htmlFor="outbound-kind" className="mt-3 block text-sm font-medium text-gray-700 dark:text-gray-400">
              {t('outbound.pick')}
            </label>
            <select
              id="outbound-kind"
              value={outbound ?? ''}
              onChange={(event) => setOutbound((event.target.value || null) as OutboundKind | null)}
              className={`mt-1 ${FIELD} max-w-lg`}
            >
              <option value="">{t('outbound.pickNone')}</option>
              {OUTBOUND_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {t(`outbound.kinds.${kind}`)}
                </option>
              ))}
            </select>

            {outbound && (
              <div className="mt-4">
                <OutboundMessage
                  kind={outbound}
                  recipientName={recipientName}
                  tradeName={tradeName}
                  categoryLabel={categoryLabel}
                  city={answers.city ?? ''}
                  report={report}
                />
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
