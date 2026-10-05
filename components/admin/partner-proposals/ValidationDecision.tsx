'use client'

/**
 * The aside of the Portal Locais validation screen and its three dialogs (#812, spec §3 and §5):
 * Aprovar · Pedir ajuste · Recusar. Every act posts to
 * `app/api/admin/partnerships/validation/[submissionId]/route.ts`, which ends in
 * `partner.transition_place_submission` (BR-B2B-049).
 *
 * "Aprovar" waits for the operator's ticks and nothing else: an automatic warning on the left
 * never disables it (BR-B2B-011).
 */

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { AlertTriangle, Check, Info, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DialogShell } from '@/components/admin/credit/DialogShell'
import { formatFee } from '@/lib/contract/snapshot'
import {
  ADJUSTMENT_AREAS,
  PORTAL_NOTE_MAX,
  PORTAL_NOTE_MIN,
  PORTAL_REFUSAL_REASONS,
  isPaidPlan,
  type AdjustmentArea,
} from '@/lib/partnerships/portal-review'
import { placeToolHref } from '@/lib/partnerships/place-tool'
import type { PortalSubmissionReview } from '@/lib/services/portal-submission-review-service'
import { formatShortDate } from './format'
import { CARD, CTA_LINK, FIELD } from './surface'

export type DecisionResult =
  | { kind: 'approved'; paid: boolean; attractionId: string | null }
  | { kind: 'changes' }
  | { kind: 'rejected'; refundTotal: string | null }

type Dialog = 'approve' | 'changes' | 'reject' | null

interface Props {
  review: PortalSubmissionReview
  tradeName: string
  locale: string
  done: number
  total: number
  /** The screen is read-only: decided, with the place, or awaiting payment. */
  readOnly: boolean
  decided: boolean
  onDecided: (result: DecisionResult) => void
  /** 409: someone else decided — the screen reloads read-only. */
  onConflict: () => void
  nextRef: React.RefObject<HTMLAnchorElement | null>
}

const COUNTER_FROM = 1800

function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

export function ValidationDecision({
  review,
  tradeName,
  locale,
  done,
  total,
  readOnly,
  decided,
  onDecided,
  onConflict,
  nextRef,
}: Props) {
  const t = useTranslations('PartnerValidation')
  const acceptance = review.acceptance
  const plan = acceptance?.planChoice ?? review.answers.plan_choice
  const paid = isPaidPlan(plan)
  const totalCents = acceptance?.totalCents ?? 0
  const charged = review.payment?.status === 'paid' && totalCents > 0
  const hasOffers = Boolean(review.answers.offer_free || review.answers.offer_subscriber)
  const missing = total - done
  const canApprove = !readOnly && missing === 0

  const [dialog, setDialog] = useState<Dialog>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ text: string; attractionId?: string | null; detail?: string } | null>(null)

  const [areas, setAreas] = useState<AdjustmentArea[]>([])
  const [changesNote, setChangesNote] = useState('')
  const [changesInvalid, setChangesInvalid] = useState(false)
  const [reason, setReason] = useState('')
  const [rejectNote, setRejectNote] = useState('')
  const [reasonInvalid, setReasonInvalid] = useState(false)
  const [rejectNoteInvalid, setRejectNoteInvalid] = useState(false)

  const approveRef = useRef<HTMLButtonElement | null>(null)
  const changesRef = useRef<HTMLTextAreaElement | null>(null)
  const reasonRef = useRef<HTMLSelectElement | null>(null)
  const rejectNoteRef = useRef<HTMLTextAreaElement | null>(null)

  const open = (which: Exclude<Dialog, null>) => {
    setError(null)
    setDialog(which)
  }

  // A / J / R open the dialogs when the focus is not in a text field (spec §3).
  useEffect(() => {
    if (readOnly) return
    const onKey = (event: KeyboardEvent) => {
      if (dialog || event.metaKey || event.ctrlKey || event.altKey || isTextField(event.target)) return
      const key = event.key.toLowerCase()
      if (key === 'a' && canApprove) open('approve')
      else if (key === 'j') open('changes')
      else if (key === 'r') open('reject')
      else return
      event.preventDefault()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [readOnly, dialog, canApprove])

  const refundTotal = charged ? formatFee(totalCents) : null

  async function post(body: Record<string, unknown>) {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/admin/partnerships/validation/${review.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string
        attractionId?: string | null
      }
      if (response.status === 409 && payload.error === 'status_conflict') {
        setError({ text: t('dialogs.conflict') })
        setTimeout(() => {
          setDialog(null)
          onConflict()
        }, 1500)
        return null
      }
      if (!response.ok) return { failed: true as const, ...payload }
      return { failed: false as const, ...payload }
    } catch {
      return { failed: true as const }
    } finally {
      setBusy(false)
    }
  }

  async function approve() {
    const outcome = await post({ action: 'approve' })
    if (!outcome) return
    if (outcome.failed) {
      if (outcome.error === 'approval_in_progress') setError({ text: t('dialogs.approveBusy') })
      else if (outcome.attractionId) setError({ text: t('dialogs.approvePartial'), attractionId: outcome.attractionId, detail: outcome.error })
      else setError({ text: t('dialogs.approveError') })
      return
    }
    setDialog(null)
    onDecided({ kind: 'approved', paid, attractionId: outcome.attractionId ?? null })
  }

  async function sendChanges() {
    if (changesNote.trim().length < PORTAL_NOTE_MIN) {
      setChangesInvalid(true)
      changesRef.current?.focus()
      return
    }
    const outcome = await post({ action: 'request_changes', note: changesNote })
    if (!outcome) return
    if (outcome.failed) {
      setError({ text: t('dialogs.changesError') })
      return
    }
    setDialog(null)
    onDecided({ kind: 'changes' })
  }

  async function reject() {
    const badReason = !reason
    const badNote = rejectNote.trim().length < PORTAL_NOTE_MIN
    setReasonInvalid(badReason)
    setRejectNoteInvalid(badNote)
    if (badReason) {
      reasonRef.current?.focus()
      return
    }
    if (badNote) {
      rejectNoteRef.current?.focus()
      return
    }
    const outcome = await post({ action: 'reject', reason, note: rejectNote })
    if (!outcome) return
    if (outcome.failed) {
      setError({ text: t('dialogs.rejectError') })
      return
    }
    setDialog(null)
    onDecided({ kind: 'rejected', refundTotal })
  }

  function toggleArea(area: AdjustmentArea, on: boolean) {
    const next = ADJUSTMENT_AREAS.filter((candidate) => (candidate === area ? on : areas.includes(candidate)))
    setAreas(next)
    // The opening line is rewritten from the ticks; whatever the operator typed after it stays.
    const body = changesNote.startsWith('Ajustar:') ? changesNote.split('\n').slice(1).join('\n') : changesNote
    const list = next.map((id) => t(`dialogs.areas.${id}`).toLowerCase()).join(', ')
    setChangesNote(next.length ? `${t('dialogs.areasPrefix', { list })}\n${body.replace(/^\n/, '')}` : body)
  }

  const planLine = (() => {
    if (!paid) return t('decision.planFree')
    const totalText = formatFee(totalCents)
    const amount =
      acceptance?.voucherCode && acceptance.voucherDiscountCents
        ? t('decision.voucher', {
            total: totalText,
            code: acceptance.voucherCode,
            discount: formatFee(acceptance.voucherDiscountCents),
          })
        : totalText
    return t('decision.planPaid', { months: acceptance?.billingPeriod ?? Number(review.answers.billing_period ?? 1), total: amount })
  })()

  const paymentLine = (() => {
    const status = review.payment?.status
    if (status === 'refund_pending') return { ok: false, text: t('decision.refundPending') }
    if (status === 'refunded') return { ok: true, text: t('decision.refunded', { date: formatShortDate(review.payment?.refundedAt) }) }
    if (!paid || totalCents === 0) return { ok: true, text: t('decision.noCharge') }
    if (status === 'paid') return { ok: true, text: t('decision.paid', { date: formatShortDate(review.payment?.paidAt) }) }
    return { ok: false, text: t('decision.pendingPayment') }
  })()

  const busyLabel = (label: string) => (
    <>
      <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
      {label}
    </>
  )

  const errorBox = error ? (
    <div role="alert" className="mt-4 flex items-start gap-2 text-sm text-destructive">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>
        {error.text}{' '}
        {error.attractionId ? (
          <Link className="underline" href={placeToolHref({ locale, attractionId: error.attractionId, entityKind: 'place' })}>
            {t('dialogs.openPlace')}
          </Link>
        ) : null}
        {error.detail ? <span className="mt-1 block text-xs opacity-80">{error.detail}</span> : null}
      </span>
    </div>
  ) : null

  const queueHref = `/${locale}/admin/clients`

  return (
    <aside aria-label={t('decision.label')} className={`${CARD} sticky top-24 space-y-4 p-5 text-sm`}>
      <p className="font-semibold text-gray-900 dark:text-white">{planLine}</p>
      <p className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
        {paymentLine.ok ? (
          <Check className="h-4 w-4 text-green-800" aria-hidden="true" />
        ) : (
          <AlertTriangle className="h-4 w-4 text-secondary-700" aria-hidden="true" />
        )}
        {paymentLine.text}
      </p>

      {decided ? (
        <div className="flex flex-col gap-2">
          {review.nextInReviewId ? (
            <Link ref={nextRef} className={CTA_LINK} href={`/${locale}/admin/partnerships/validation/${review.nextInReviewId}`}>
              {t('decision.next')}
            </Link>
          ) : (
            <p>{t('decision.queueEmpty')}</p>
          )}
          <Link className="text-center underline" href={queueHref}>
            {t('decision.backToQueue')}
          </Link>
        </div>
      ) : (
        <>
          <p aria-live="polite" className="text-gray-700 dark:text-gray-300">
            {t('decision.progress', { done, total })}
          </p>
          <div className="flex flex-col gap-2">
            <Button
              variant="cta"
              className="w-full"
              disabled={!canApprove}
              aria-describedby={missing > 0 ? 'approve-missing' : undefined}
              title={t('decision.shortcut', { key: 'A' })}
              onClick={() => open('approve')}
            >
              {t('decision.approve')}
            </Button>
            {missing > 0 && !readOnly ? (
              <p id="approve-missing" className="text-xs text-gray-600 dark:text-gray-400">
                {t('decision.missing', { count: missing })}
              </p>
            ) : null}
            <Button
              variant="outline"
              className="w-full"
              disabled={readOnly}
              title={t('decision.shortcut', { key: 'J' })}
              onClick={() => open('changes')}
            >
              {t('decision.requestChanges')}
            </Button>
            <Button
              variant="outline"
              className="w-full text-destructive"
              disabled={readOnly}
              title={t('decision.shortcut', { key: 'R' })}
              onClick={() => open('reject')}
            >
              {t('decision.reject')}
            </Button>
          </div>
        </>
      )}

      <DialogShell
        open={dialog === 'approve'}
        title={t('dialogs.approveTitle', { name: tradeName })}
        busy={busy}
        onClose={() => setDialog(null)}
        initialFocusRef={approveRef}
        footer={
          <>
            <Button variant="outline" disabled={busy} onClick={() => setDialog(null)}>
              {t('dialogs.cancel')}
            </Button>
            <Button ref={approveRef} variant="cta" disabled={busy} onClick={approve}>
              {busy ? busyLabel(t('dialogs.approving')) : t('decision.approve')}
            </Button>
          </>
        }
      >
        <div className="space-y-2 text-sm text-gray-700 dark:text-gray-300">
          <p>{paid ? t('dialogs.approvePaid') : t('dialogs.approveFree')}</p>
          {hasOffers ? <p>{t('dialogs.approveOffers')}</p> : null}
          <p>{t('dialogs.approveEmail')}</p>
        </div>
        {errorBox}
      </DialogShell>

      <DialogShell
        open={dialog === 'changes'}
        title={t('dialogs.changesTitle', { name: tradeName })}
        busy={busy}
        onClose={() => setDialog(null)}
        initialFocusRef={changesRef}
        footer={
          <>
            <Button variant="outline" disabled={busy} onClick={() => setDialog(null)}>
              {t('dialogs.cancel')}
            </Button>
            <Button variant="cta" disabled={busy} onClick={sendChanges}>
              {busy ? busyLabel(t('dialogs.sending')) : t('dialogs.send')}
            </Button>
          </>
        }
      >
        <fieldset disabled={busy} className="space-y-4 text-sm">
          <div>
            <legend className="mb-2 font-medium text-gray-900 dark:text-white">{t('dialogs.where')}</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {ADJUSTMENT_AREAS.map((area) => (
                <label key={area} className="flex min-h-6 cursor-pointer items-center gap-2">
                  <Checkbox checked={areas.includes(area)} onCheckedChange={(on) => toggleArea(area, on === true)} />
                  {t(`dialogs.areas.${area}`)}
                </label>
              ))}
            </div>
          </div>
          <div>
            <label htmlFor="changes-note" className="mb-1 block font-medium text-gray-900 dark:text-white">
              {t('dialogs.message')}
            </label>
            <textarea
              id="changes-note"
              ref={changesRef}
              rows={6}
              maxLength={PORTAL_NOTE_MAX}
              className={FIELD}
              value={changesNote}
              aria-invalid={changesInvalid || undefined}
              aria-describedby="changes-help"
              onChange={(event) => {
                setChangesNote(event.target.value)
                setChangesInvalid(false)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault()
                  void sendChanges()
                }
              }}
            />
            <p id="changes-help" className="mt-1 text-xs text-gray-600 dark:text-gray-400">
              {t('dialogs.changesHelp')}
            </p>
            {changesNote.length >= COUNTER_FROM ? (
              <p className="text-xs text-gray-600">{t('dialogs.counter', { count: changesNote.length, max: PORTAL_NOTE_MAX })}</p>
            ) : null}
            {changesInvalid ? <p className="mt-1 text-xs text-destructive">{t('dialogs.changesInvalid')}</p> : null}
          </div>
          <p className="text-xs text-gray-600 dark:text-gray-400">{t('dialogs.changesNote')}</p>
        </fieldset>
        {errorBox}
      </DialogShell>

      <DialogShell
        open={dialog === 'reject'}
        title={t('dialogs.rejectTitle', { name: tradeName })}
        busy={busy}
        onClose={() => setDialog(null)}
        initialFocusRef={reasonRef}
        footer={
          <>
            <Button variant="outline" disabled={busy} onClick={() => setDialog(null)}>
              {t('dialogs.cancel')}
            </Button>
            <Button variant="destructive" disabled={busy} onClick={reject}>
              {busy
                ? busyLabel(t('dialogs.rejecting'))
                : charged
                  ? t('dialogs.rejectAndRefund')
                  : t('dialogs.rejectOnly')}
            </Button>
          </>
        }
      >
        <fieldset disabled={busy} className="space-y-4 text-sm">
          <div>
            <label htmlFor="reject-reason" className="mb-1 block font-medium text-gray-900 dark:text-white">
              {t('dialogs.reason')}
            </label>
            <select
              id="reject-reason"
              ref={reasonRef}
              className={FIELD}
              value={reason}
              aria-invalid={reasonInvalid || undefined}
              onChange={(event) => {
                setReason(event.target.value)
                setReasonInvalid(false)
              }}
            >
              <option value="">{t('dialogs.reasonPlaceholder')}</option>
              {PORTAL_REFUSAL_REASONS.map((id) => (
                <option key={id} value={id}>
                  {t(`dialogs.reasons.${id}`)}
                </option>
              ))}
            </select>
            {reasonInvalid ? <p className="mt-1 text-xs text-destructive">{t('dialogs.reasonInvalid')}</p> : null}
          </div>
          <div>
            <label htmlFor="reject-note" className="mb-1 block font-medium text-gray-900 dark:text-white">
              {t('dialogs.message')}
            </label>
            <textarea
              id="reject-note"
              ref={rejectNoteRef}
              rows={5}
              maxLength={PORTAL_NOTE_MAX}
              className={FIELD}
              value={rejectNote}
              aria-invalid={rejectNoteInvalid || undefined}
              aria-describedby="reject-help"
              onChange={(event) => {
                setRejectNote(event.target.value)
                setRejectNoteInvalid(false)
              }}
            />
            <p id="reject-help" className="mt-1 text-xs text-gray-600 dark:text-gray-400">
              {t('dialogs.rejectHelp')}
            </p>
            {rejectNoteInvalid ? (
              <p className="mt-1 text-xs text-destructive">{t('dialogs.rejectMessageInvalid')}</p>
            ) : null}
          </div>
          <div className="flex items-start gap-2 rounded-xl bg-gray-50 p-3 dark:bg-gray-800">
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p>{charged ? t('dialogs.refundPaid', { total: formatFee(totalCents) }) : t('dialogs.refundNone')}</p>
          </div>
          <p className="text-xs text-gray-600 dark:text-gray-400">{t('dialogs.irreversible')}</p>
        </fieldset>
        {errorBox}
      </DialogShell>
    </aside>
  )
}
