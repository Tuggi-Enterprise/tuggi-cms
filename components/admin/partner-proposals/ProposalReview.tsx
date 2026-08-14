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
import type { PartnerFieldId } from '@/lib/partner-form/fields'
import { absenceClassOf, buildRegularityReport } from '@/lib/partner-form/regularity'
import {
  DISCARD_REASONS,
  REVIEW_MARKS,
  applySubstituteTest,
  hasOfferMarker,
  type DiscardReasonId,
  type ReviewMark,
} from '@/lib/partner-form/proposal-review'
import { PromotionPanel } from './PromotionPanel'
import { RegularityBand } from './RegularityBand'
import { OutboundMessage, type OutboundKind } from './OutboundMessage'
import { formatDate, formatDateTime, formatMegabytes } from './format'
import type { ProposalDetail } from './types'

const STORY_FIELDS: PartnerFieldId[] = ['story_founder', 'story_before', 'story_unique', 'story_event']

const OUTBOUND_KINDS: OutboundKind[] = ['documents', 'regularity', 'gate1', 'gate2', 'gate3']

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
  const [documentError, setDocumentError] = useState(false)
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
      setDetail((await response.json()) as ProposalDetail)
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
  const documentKinds = useMemo(
    () => (detail?.documents ?? []).map((document) => document.kind),
    [detail]
  )
  const report = useMemo(
    () => buildRegularityReport(answers, documentKinds),
    [answers, documentKinds]
  )

  const categoryLabel = answers.category ? form(`categories.${answers.category}`) : ''
  const tradeName = answers.trade_name ?? detail?.invites[0]?.tradeName ?? ''
  const recipientName = detail?.invites[0]?.recipientName ?? answers.representative_name ?? ''

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
          href={`/${locale}/admin/partner-proposals`}
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

  const isDraft = detail.submission.status === 'draft'
  const isSubmitted = detail.submission.status === 'submitted'
  const isPromoted = detail.submission.status === 'promoted'
  const isDiscarded = detail.submission.status === 'discarded'

  async function openDocument(documentId: string) {
    setDocumentError(false)
    try {
      // Asked for on the click: no document URL exists in the HTML before this, and the one
      // that comes back lives for a minute and is not stored anywhere.
      const response = await fetch(
        `/api/admin/partner-proposals/${submissionId}/documents/${documentId}`,
        { method: 'POST' }
      )
      if (!response.ok) {
        setDocumentError(true)
        return
      }
      const payload = await response.json()
      window.open(payload.url, '_blank', 'noopener,noreferrer')
    } catch {
      setDocumentError(true)
    }
  }

  async function saveNote() {
    setNoteState('saving')
    try {
      const response = await fetch(`/api/admin/partner-proposals/${submissionId}/review-note`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ marks, observation }),
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
          href={`/${locale}/admin/partner-proposals`}
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
            {isDraft && (
              <>
                <Button disabled aria-disabled="true">
                  {t('promotion.action')}
                </Button>
                {/* The reason is in words beside the disabled control, never the grey alone. */}
                <span className="max-w-xs text-xs text-gray-800">{t('review.draftActionReason')}</span>
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

      {isDraft && (
        <p className="mb-4 rounded-md border border-gray-300 bg-gray-50 p-3 text-sm text-gray-900">
          <span className="font-semibold">{t('review.draftTitle')}</span>{' '}
          {t('review.draftBody', { date: formatDateTime(detail.submission.updatedAt) })}
        </p>
      )}

      {isPromoted && (
        <div className="mb-4 rounded-md border border-green-700/40 bg-green-50 p-3 text-sm text-gray-900">
          <p className="font-semibold">
            {t('review.promotedTitle', {
              date: formatDate(detail.submission.promotedAt),
              person: detail.submission.promotedBy ?? '—',
            })}
          </p>
          {detail.submission.promotedClientId && (
            <Link
              href={`/${locale}/admin/clients?client=${detail.submission.promotedClientId}`}
              className="mt-1 inline-block font-medium text-primary-800 underline underline-offset-4"
            >
              {t('review.promotedOpenClient', { name: detail.client?.name ?? tradeName })}
            </Link>
          )}
          <p className="mt-2">{t('review.promotedBody')}</p>
        </div>
      )}

      <RegularityBand report={report} answers={answers} />

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
          {detail.submission.isPartial && (
            <p className="rounded-md border border-gray-300 bg-gray-50 p-3 text-sm text-gray-900">
              <span className="font-semibold">{t('review.partialTitle')}</span>{' '}
              {t('review.partialBody')}
            </p>
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
          <section aria-labelledby="documents-heading" className="rounded-md border border-gray-300 p-4">
            <h2 id="documents-heading" className="text-base font-semibold text-gray-900">
              {t('documents.heading')}
            </h2>

            {documentError && (
              <p className="mt-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm text-gray-900">
                {t('documents.openFailedTitle')}
              </p>
            )}

            {PARTNER_DOCUMENT_KINDS.map((kind) => {
              const files = detail.documents.filter((document) => document.kind === kind)
              return (
                <div key={kind} className="mt-3">
                  <h3 className="text-sm font-semibold text-gray-900">{t(`documents.kinds.${kind}`)}</h3>

                  {kind === 'business_license' && (
                    <p className="mt-1 text-sm">
                      <span className="font-medium text-gray-900">{t('documents.validUntil')}: </span>
                      <span
                        className={
                          report.license.status === 'expired'
                            ? 'font-semibold text-destructive'
                            : 'text-gray-900'
                        }
                      >
                        {answers.business_license_valid_until
                          ? formatDate(answers.business_license_valid_until)
                          : t('documents.noValidUntil')}
                      </span>
                    </p>
                  )}

                  {files.length === 0 ? (
                    <div className="mt-1 text-sm">
                      <p className="font-medium text-gray-900">{t('documents.emptyTitle')}</p>
                      <p className="text-gray-800">{t('documents.emptyBody')}</p>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="mt-2"
                        onClick={() => setOutbound('documents')}
                      >
                        {t('documents.ask')}
                      </Button>
                    </div>
                  ) : (
                    <ul className="mt-1 space-y-2">
                      {files.map((document) => (
                        <li key={document.id} className="text-sm">
                          <p className="break-words text-gray-900">{document.fileName}</p>
                          <p className="text-xs text-gray-700">
                            {t('documents.size', { mb: formatMegabytes(document.byteSize) })} ·{' '}
                            {document.mimeType} ·{' '}
                            {t('documents.sentAt', { date: formatDate(document.createdAt) })}
                          </p>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="mt-1"
                            onClick={() => openDocument(document.id)}
                          >
                            {t('documents.open')}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )
            })}

            <p className="mt-3 border-t border-gray-200 pt-2 text-xs text-gray-700">
              {t('documents.privacy')}
            </p>
          </section>

          <section aria-labelledby="trail-heading" className="rounded-md border border-gray-300 p-4">
            <h2 id="trail-heading" className="text-base font-semibold text-gray-900">
              {t('trail.heading')}
            </h2>
            <dl className="mt-2 space-y-1 text-sm">
              {detail.invites.map((invite, index) => (
                <div key={invite.id}>
                  <dt className="text-gray-900">
                    {index === detail.invites.length - 1
                      ? t('trail.inviteCreated', { date: formatDateTime(invite.createdAt) })
                      : t('trail.linkReissued', { date: formatDateTime(invite.createdAt) })}
                  </dt>
                  <dd className="text-xs text-gray-700">
                    {t('trail.inviteSentTo', { email: invite.recipientEmail })}
                    {invite.revokedAt
                      ? ` · ${t('trail.revoked', { date: formatDateTime(invite.revokedAt) })}`
                      : ''}
                  </dd>
                </div>
              ))}
              {detail.submission.updatedAt && !detail.submission.submittedAt && (
                <div>
                  <dt className="text-gray-900">
                    {t('trail.draftSaved', { date: formatDateTime(detail.submission.updatedAt) })}
                  </dt>
                </div>
              )}
              {detail.submission.submittedAt && (
                <div>
                  <dt className="text-gray-900">
                    {t('trail.received', { date: formatDateTime(detail.submission.submittedAt) })}
                  </dt>
                </div>
              )}
              {detail.submission.promotedAt && (
                <div>
                  <dt className="text-gray-900">
                    {t('trail.promoted', { date: formatDateTime(detail.submission.promotedAt) })}
                  </dt>
                </div>
              )}
            </dl>
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
