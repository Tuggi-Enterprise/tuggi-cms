'use client'

/**
 * Conference and promotion — where BR-B2B-022 is applied (BR-B2B-026, item 4) and where
 * somebody reads the gate-2 input for the first time.
 *
 * THE TWO THINGS HAPPEN ON THE SAME SCREEN AND ARE NOT THE SAME DECISION, and half of this
 * layout exists so they do not blur into one:
 *
 *  · the regularity band decides whether a CONTRACT can be produced. It blocks nothing else —
 *    a proposal missing its licence is still promotable, and that is deliberate;
 *  · the story block is INPUT for triage, which is another decision with another owner at
 *    another moment. Turned down at triage, the place is still a partner (BR-B2B-011).
 *
 * Empty fields never appear merely greyed out: each one carries which of the three kinds of
 * absence it is, so telling "blocks the contract" from "nobody had to answer" needs no
 * knowledge of the rule.
 *
 * Field labels are READ FROM `PartnerForm.fields.<id>.label` — the same key the partner saw.
 * A reviewer reading a different question from the one that was asked is exactly the defect
 * duplicating the labels would produce.
 *
 * No block of text has `max-height` with `overflow-hidden`: a 1.200-character answer is
 * normal here, and this repo has lost text to that pair with no error at all.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { AlertTriangle, ArrowLeft, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { PARTNER_DOCUMENT_KINDS, fieldsOfStep } from '@/lib/partner-form/fields'
import type { PartnerDocumentKind, PartnerFieldId } from '@/lib/partner-form/fields'
import {
  EMPTY_CONFERENCE,
  absenceClassOf,
  buildRegularityReport,
  type ConferenceRecord,
} from '@/lib/partner-form/regularity'
import {
  DISCARD_REASONS,
  LICENSE_FIELD_MAX,
  REVIEW_MARKS,
  applySubstituteTest,
  hasOfferMarker,
  type DiscardReasonId,
  type ReviewMark,
} from '@/lib/partner-form/proposal-review'
import { returnParams } from '@/lib/navigation/return-to'
import { PromotionPanel } from './PromotionPanel'
import { RegularityBand } from './RegularityBand'
import { OutboundMessage, type OutboundKind } from './OutboundMessage'
import { formatDate, formatDateTime } from './format'
import type { ProposalDetail } from './types'

const STORY_FIELDS: PartnerFieldId[] = ['story_founder', 'story_before', 'story_unique', 'story_event']

const OUTBOUND_KINDS: OutboundKind[] = ['regularity', 'gate1', 'gate2', 'gate3']

interface ProposalReviewProps {
  locale: string
  submissionId: string
}

export function ProposalReview({ locale, submissionId }: ProposalReviewProps) {
  const t = useTranslations('PartnerProposals')
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
  const [discarding, setDiscarding] = useState(false)
  const [discardReason, setDiscardReason] = useState<DiscardReasonId>('duplicate')
  const [discardError, setDiscardError] = useState(false)
  const [conference, setConference] = useState<ConferenceRecord>(EMPTY_CONFERENCE)
  const [outbound, setOutbound] = useState<OutboundKind | null>(null)

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
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [submissionId])

  useEffect(() => {
    void load()
  }, [load])

  const answers = detail?.submission.answers ?? {}
  // The band follows what is on screen, not what was last saved: ticking `Vi o alvará` has to
  // move the line above before the operator clicks save, or they cannot tell whether the tick
  // did anything.
  const report = useMemo(() => buildRegularityReport(answers, conference), [answers, conference])
  // One question, asked once: the three licence fields are enabled by the same tick.
  const licenseSeen = conference.documentsSeen.indexOf('business_license') >= 0

  const categoryLabel = answers.category ? form(`categories.${answers.category}`) : ''
  const tradeName = answers.trade_name ?? ''
  const recipientName = answers.representative_name ?? ''

  if (loading) {
    return (
      <p className="p-6 text-sm text-gray-800" aria-busy="true">
        <Loader2 className="mr-2 inline h-4 w-4 animate-spin" aria-hidden="true" />
        {t('review.loading')}
      </p>
    )
  }

  if (notFound) {
    return (
      <div className="p-6">
        <p className="font-medium text-gray-900">{t('review.notFoundTitle')}</p>
        <p className="mt-1 text-sm text-gray-800">{t('review.notFoundBody')}</p>
        <Link
          href={`/${locale}/admin/clients?state=in_progress`}
          className="mt-3 inline-block text-sm font-medium text-primary-800 underline underline-offset-4"
        >
          {t('review.back')}
        </Link>
      </div>
    )
  }

  if (failed || !detail) {
    return (
      <div className="p-6">
        <p className="font-medium text-gray-900">{t('review.errorTitle')}</p>
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

  async function saveNote() {
    setNoteState('saving')
    try {
      const response = await fetch(`/api/admin/partner-proposals/${submissionId}/review-note`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ marks, observation, conference }),
      })
      setNoteState(response.ok ? 'saved' : 'failed')
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
    <div className="mx-auto w-full max-w-7xl px-6 py-6">
      {/* Sticky, so promoting a long proposal never asks the operator to scroll back. */}
      <header className="sticky top-0 z-10 -mx-6 mb-5 border-b border-gray-200 bg-white px-6 py-4">
        <Link
          href={`/${locale}/admin/clients?state=in_progress`}
          className="inline-flex items-center gap-1 text-sm text-primary-800 underline underline-offset-4"
        >
          <ArrowLeft className="h-3 w-3" aria-hidden="true" />
          {t('review.back')}
        </Link>

        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">
              {tradeName || t('review.noTradeName')}
            </h1>
            <p className="text-sm text-gray-700">
              {answers.tax_id ? t('review.taxId', { value: answers.tax_id }) : ''}
              {detail.submission.submittedAt
                ? ` · ${t('review.receivedAt', { date: formatDate(detail.submission.submittedAt) })}`
                : ''}
            </p>
          </div>

          {/* The two acts live here and never behind a menu (DS-LAYOUT-003). */}
          <div className="flex items-center gap-3">
            {isSubmitted && (
              <>
                <Button onClick={() => setPromoting(true)}>{t('promotion.action')}</Button>
                <Button variant="outline" onClick={() => setDiscarding(true)}>
                  {t('discard.action')}
                </Button>
              </>
            )}
            {isDiscarded && (
              <Button variant="outline" onClick={restore}>
                {t('discard.restore')}
              </Button>
            )}
          </div>
        </div>
      </header>

      {isPromoted && (
        <div className="mb-4 rounded-md border border-green-700/40 bg-green-50 p-3 text-sm text-gray-900">
          <p className="font-semibold">
            {t('review.promotedTitle', {
              date: formatDate(detail.submission.promotedAt),
              person: detail.submission.promotedBy ?? '—',
            })}
          </p>
          {/* `?client=` was the key nothing reads — the record takes `clientId` — so this
              link landed on the paginated client list with nothing open. The way back is
              this proposal, which is where the operator was reading. */}
          {detail.submission.promotedClientId && (
            <Link
              href={`/${locale}/admin/clients?${new URLSearchParams({
                clientId: detail.submission.promotedClientId,
                ...returnParams(
                  `/${locale}/admin/partnerships/proposals/${submissionId}`,
                  t('review.promotedReturnLabel')
                ),
              }).toString()}`}
              className="mt-1 inline-block font-medium text-primary-800 underline underline-offset-4"
            >
              {t('review.promotedOpenClient', { name: detail.client?.name ?? tradeName })}
            </Link>
          )}
          <p className="mt-2">{t('review.promotedBody')}</p>
        </div>
      )}

      <RegularityBand
        report={report}
        answers={answers}
        checkedBy={detail.submission.reviewedBy}
        checkedAt={detail.submission.reviewedAt}
      />

      {promoting && isSubmitted && (
        <div className="mt-5">
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
        <section className="mt-5 rounded-md border border-gray-300 bg-white p-4 text-sm">
          <h2 className="text-base font-semibold text-gray-900">{t('discard.title')}</h2>
          <p className="mt-2 text-gray-900">{t('discard.notTriage')}</p>

          <label htmlFor="discard-reason" className="mt-3 block font-medium text-gray-700">
            {t('discard.reasonLabel')}
          </label>
          <select
            id="discard-reason"
            value={discardReason}
            onChange={(event) => setDiscardReason(event.target.value as DiscardReasonId)}
            className="mt-1 block w-full rounded-md border border-input bg-white px-3 py-2 text-sm text-gray-900"
          >
            {DISCARD_REASONS.map((reason) => (
              <option key={reason.id} value={reason.id}>
                {t(`discard.reasons.${reason.id}`)}
              </option>
            ))}
          </select>

          {DISCARD_REASONS.find((reason) => reason.id === discardReason)?.notifies && (
            <p className="mt-2 text-xs text-gray-800">{t('discard.notifies')}</p>
          )}

          <p className="mt-3 text-gray-800">{t('discard.reversible')}</p>

          {discardError && (
            <p className="mt-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-gray-900">
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

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-5">
          {detail.duplicates.length > 0 && (
            <div className="rounded-md border border-secondary-700/50 bg-secondary-50 p-3 text-sm text-gray-900">
              <p className="font-semibold">
                {t('review.duplicateTitle', { count: detail.duplicates.length })}
              </p>
              <p className="mt-1">{t('review.duplicateBody')}</p>
              <ul className="mt-2 space-y-1">
                {detail.duplicates.map((duplicate) => (
                  <li key={duplicate.id}>
                    <Link
                      href={`/${locale}/admin/partnerships/proposals/${duplicate.id}`}
                      className="font-medium text-primary-800 underline underline-offset-4"
                    >
                      {t('review.duplicateOpen', { date: formatDateTime(duplicate.submittedAt) })}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <section aria-labelledby="answers-heading">
            <h2 id="answers-heading" className="text-base font-semibold text-gray-900">
              {t('review.answersHeading')}
            </h2>

            {([1, 2] as const).map((step) => (
              <div key={step} className="mt-4">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-700">
                  {t(`review.step${step}Heading`)}
                </h3>
                <dl className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-2">
                  {fieldsOfStep(step).map((field) => (
                    <div key={field.id}>
                      <dt className="text-xs text-gray-700">{form(`fields.${field.id}.label`)}</dt>
                      <dd className="text-sm text-gray-900">
                        {answers[field.id] ? (
                          answers[field.id]
                        ) : (
                          <span
                            className={
                              absenceClassOf(field.id) === 'contract'
                                ? 'font-medium text-destructive'
                                : 'text-gray-700'
                            }
                          >
                            {t(`review.absence.${absenceClassOf(field.id)}`)}
                          </span>
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </section>

          <section aria-labelledby="story-heading" className="rounded-md border border-gray-300 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 id="story-heading" className="text-base font-semibold text-gray-900">
                {t('story.heading')}
              </h2>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setSubstitute((value) => !value)}
              >
                {substitute ? t('story.substituteUndo') : t('story.substituteApply')}
              </Button>
            </div>

            {substitute && (
              <p className="mt-2 rounded-md border border-primary/40 bg-primary-50 p-2 text-sm text-gray-900">
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
                    <dt className="text-xs text-gray-700">{form(`fields.${field}.label`)}</dt>
                    <dd className="text-sm text-gray-900">
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
                        <span className="text-gray-700">{t('story.noAnswer')}</span>
                      )}
                    </dd>
                  </div>
                )
              })}
            </dl>

            <fieldset className="mt-4">
              <legend className="text-sm font-medium text-gray-900">{t('story.marksHeading')}</legend>
              <div className="mt-2 space-y-2">
                {REVIEW_MARKS.map((mark) => (
                  <label key={mark} className="flex items-center gap-2 text-sm text-gray-900">
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

            <div className="mt-3">
              <label htmlFor="review-observation" className="block text-sm font-medium text-gray-700">
                {t('story.observationLabel')}
              </label>
              <textarea
                id="review-observation"
                value={observation}
                rows={3}
                onChange={(event) => setObservation(event.target.value)}
                className="mt-1 block w-full rounded-md border border-input bg-white px-3 py-2 text-sm text-gray-900"
              />
            </div>

            <div className="mt-3 flex items-center gap-3">
              <Button type="button" size="sm" onClick={saveNote} disabled={noteState === 'saving'}>
                {noteState === 'saving' ? t('story.saving') : t('story.save')}
              </Button>
              <span role="status" className="text-sm text-primary-800">
                {noteState === 'saved' ? t('story.saved') : ''}
              </span>
              {noteState === 'failed' && (
                <span className="text-sm text-destructive">{t('story.saveFailed')}</span>
              )}
            </div>

            <p className="mt-4 border-t border-gray-200 pt-3 text-xs text-gray-800">
              {t('story.footer')}
            </p>
          </section>

          {/* The five texts of §5, chosen by the operator. Gate 3 is on the list and has no
              template — it is the option that explains why there is nothing to send. */}
          <section aria-labelledby="outbound-picker" className="space-y-3">
            <label id="outbound-picker" htmlFor="outbound-kind" className="block text-sm font-medium text-gray-700">
              {t('outbound.pick')}
            </label>
            <select
              id="outbound-kind"
              value={outbound ?? ''}
              onChange={(event) => setOutbound((event.target.value || null) as OutboundKind | null)}
              className="block w-full max-w-sm rounded-md border border-input bg-white px-3 py-2 text-sm text-gray-900"
            >
              <option value="">{t('outbound.pickNone')}</option>
              {OUTBOUND_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {t(`outbound.kinds.${kind}`)}
                </option>
              ))}
            </select>

            {outbound && (
              <OutboundMessage
                kind={outbound}
                recipientName={recipientName}
                tradeName={tradeName}
                categoryLabel={categoryLabel}
                city={answers.city ?? ''}
                report={report}
              />
            )}
          </section>
        </div>

        <aside className="space-y-5 lg:sticky lg:top-24 lg:self-start">
          {/* WHERE BR-B2B-022's EVIDENCE NOW ENTERS THE SYSTEM. The form asks for no file: the
              papers are seen in person before the link is sent, and one operator writes down
              what they saw. It is saved with the annotation below, under their name, and it is
              what the band at the top reads. */}
          <section aria-labelledby="conference-heading" className="rounded-md border border-gray-300 p-4">
            <h2 id="conference-heading" className="text-base font-semibold text-gray-900">
              {t('conference.heading')}
            </h2>
            <p className="mt-1 text-sm text-gray-800">{t('conference.intro')}</p>

            <fieldset className="mt-3">
              <legend className="sr-only">{t('conference.heading')}</legend>
              {PARTNER_DOCUMENT_KINDS.map((kind) => (
                <label key={kind} className="mt-2 flex items-start gap-2 text-sm text-gray-900">
                  <Checkbox
                    checked={conference.documentsSeen.indexOf(kind) >= 0}
                    onCheckedChange={() => toggleDocumentSeen(kind)}
                  />
                  <span>{t(`conference.seen.${kind}`)}</span>
                </label>
              ))}
            </fieldset>

            {/* Number, municipality, validity — the order the three appear on the paper in the
                operator's hand. Any other order makes them read the document twice. */}
            <div className="mt-3">
              <label htmlFor="license-number" className="block text-sm font-medium text-gray-700">
                {t('conference.licenseNumberLabel')}
              </label>
              <input
                id="license-number"
                type="text"
                value={conference.licenseNumber ?? ''}
                maxLength={LICENSE_FIELD_MAX}
                disabled={!licenseSeen}
                aria-describedby="license-number-hint"
                onChange={(event) =>
                  setConference((current) => ({
                    ...current,
                    licenseNumber: event.target.value || null,
                  }))
                }
                className="mt-1 block w-full rounded-md border border-input bg-white px-3 py-2 text-sm text-gray-900 disabled:bg-gray-100"
              />
              <span id="license-number-hint" className="mt-1 block text-xs text-gray-800">
                {licenseSeen ? t('conference.licenseNumberHint') : t('conference.licenseNumberDisabled')}
              </span>
            </div>

            <div className="mt-3">
              <label htmlFor="license-issuer" className="block text-sm font-medium text-gray-700">
                {t('conference.licenseIssuerLabel')}
              </label>
              <input
                id="license-issuer"
                type="text"
                value={conference.licenseIssuer ?? ''}
                maxLength={LICENSE_FIELD_MAX}
                disabled={!licenseSeen}
                aria-describedby="license-issuer-hint"
                onChange={(event) =>
                  setConference((current) => ({
                    ...current,
                    licenseIssuer: event.target.value || null,
                  }))
                }
                className="mt-1 block w-full rounded-md border border-input bg-white px-3 py-2 text-sm text-gray-900 disabled:bg-gray-100"
              />
              <span id="license-issuer-hint" className="mt-1 block text-xs text-gray-800">
                {licenseSeen ? t('conference.licenseIssuerHint') : t('conference.licenseIssuerDisabled')}
              </span>
            </div>

            <div className="mt-3">
              <label htmlFor="license-valid-until" className="block text-sm font-medium text-gray-700">
                {t('conference.validUntilLabel')}
              </label>
              <input
                id="license-valid-until"
                type="date"
                value={conference.licenseValidUntil ?? ''}
                disabled={!licenseSeen}
                aria-describedby="license-valid-until-hint"
                onChange={(event) =>
                  setConference((current) => ({
                    ...current,
                    licenseValidUntil: event.target.value || null,
                  }))
                }
                className="mt-1 block w-full rounded-md border border-input bg-white px-3 py-2 text-sm text-gray-900 disabled:bg-gray-100"
              />
              {/* The reason beside the disabled control, never the grey alone: without a
                  licence there is no date to copy off one. */}
              <span id="license-valid-until-hint" className="mt-1 block text-xs text-gray-800">
                {licenseSeen ? t('conference.validUntilHint') : t('conference.validUntilDisabled')}
              </span>
            </div>

            <p className="mt-3 border-t border-gray-200 pt-2 text-xs text-gray-800">
              {t('conference.savedWithNote')}
            </p>
          </section>

          {isDiscarded && (
            <p className="rounded-md border border-gray-300 bg-gray-50 p-3 text-sm text-gray-900">
              <AlertTriangle className="mr-1 inline h-4 w-4" aria-hidden="true" />
              {t('review.discardedTitle', { date: formatDate(detail.submission.updatedAt) })}
            </p>
          )}
        </aside>
      </div>
    </div>
  )
}
