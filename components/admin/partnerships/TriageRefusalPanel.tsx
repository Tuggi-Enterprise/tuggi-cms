'use client'

/**
 * The refusal of the triage, and the communication of it — two acts, two panels, never one
 * click.
 *
 * WHY TWO. BR-B2B-010, item 4, promises the partner an outcome within 72 straight hours: the
 * place published, or the refusal COMMUNICATED. BR-B2B-011, item 5, says the communicated refusal
 * is what ends that deadline. So the decision does not stop the clock and the screen must not
 * pretend it did — `RefusalPanel` registers what a person decided, `CommunicationPanel` records
 * that the person told the partner. `communicated_at` is write-once in the database
 * (`core.tg_partner_triage_refusal_guard`), which is what makes the second panel a one-way door.
 *
 * WHAT NEITHER PANEL OFFERS: any way to end the partnership. Refusing the place does not end it
 * (BR-B2B-010, 6th edge case) and takes no POI out of the catalogue (BR-B2B-027, item 3), and
 * `A parceria continua.` is on the screen for the operator who is about to click — not in a
 * footnote afterwards (criterion 33).
 *
 * THE GATE IS CHOSEN, NEVER COMPUTED. BR-B2B-011's preamble: *"quem decide quem entra é operador,
 * nao o sistema"*. The three options are the rule's three gates, in its order, and the reason is
 * required because item 4 forbids a refusal that only says "not approved".
 *
 * AND IT NEVER SAYS `Tente de novo` — that is the difference between this panel and `PublishPanel`.
 * Publishing the same place twice is the same state; refusing it twice is two rows in an
 * append-only table, and the second one enters the history that BR-B2B-011, item 4, exists to
 * preserve. So the failure that does not know what happened closes the panel instead of offering
 * the click again (#377, item 3).
 */

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { formatDateTime } from '@/components/admin/partner-proposals/format'
import { TRIAGE_GATES, type TriageGate, type TriageRefusal } from '@/lib/partnerships/triage'

/**
 * `refused` — the route answered and wrote nothing; repeating is safe.
 * `failed`  — we do not know whether the row landed; repeating is what creates two refusals.
 * The two are never one outcome here, because the sentences the operator reads are opposite
 * (#377, item 3).
 */
export type RefusalOutcome = 'ok' | 'refused' | 'failed'

export function RefusalPanel({
  onClose,
  refuse,
  onRefused,
  onRefusalUnknown,
}: {
  onClose: () => void
  refuse: (gate: TriageGate, reason: string) => Promise<RefusalOutcome>
  onRefused: () => Promise<void>
  /** The panel closes, the screen reloads, and the sentence is raised to the page. */
  onRefusalUnknown: () => Promise<void>
}) {
  const t = useTranslations('Partnerships')
  const [gate, setGate] = useState<TriageGate | ''>('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [rejected, setRejected] = useState(false)

  const ready = gate !== '' && reason.trim().length > 0

  async function submit() {
    if (!ready) return
    setBusy(true)
    setRejected(false)
    const outcome = await refuse(gate, reason.trim())
    setBusy(false)
    if (outcome === 'ok') {
      await onRefused()
      return
    }
    // The server refused before writing: the criterion or the reason is what has to change, and
    // the button stays where it is because trying again cannot produce a second row.
    if (outcome === 'refused') {
      setRejected(true)
      return
    }
    // We do not know. THIS is the one that must not offer a retry — the guard `TGB11` stops a
    // refusal from being REWRITTEN, never from being written twice (BR-B2B-011, item 5).
    await onRefusalUnknown()
  }

  return (
    <section
      aria-labelledby="triage-refusal-title"
      className="mt-3 rounded-md border border-gray-300 p-3 text-sm"
    >
      <h4 id="triage-refusal-title" className="font-semibold text-gray-900">
        {t('triage.refuseTitle')}
      </h4>
      <p className="mt-1 text-gray-800">{t('triage.refuseBody')}</p>
      {/* The line the rule requires, where the decision is taken. */}
      <p className="mt-1 font-medium text-gray-900">{t('triage.partnershipContinues')}</p>

      <div className="mt-3">
        <Label htmlFor="triage-gate">{t('triage.refuseGateLabel')}</Label>
        <select
          id="triage-gate"
          value={gate === '' ? '' : String(gate)}
          onChange={(event) =>
            setGate(event.target.value === '' ? '' : (Number(event.target.value) as TriageGate))
          }
          className="mt-1 block w-full rounded-md border border-input bg-white px-3 py-2 text-sm text-gray-900"
        >
          <option value="">—</option>
          {TRIAGE_GATES.map((option) => (
            <option key={option} value={option}>
              {t(`triage.gates.${option}`)}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-3">
        <Label htmlFor="triage-reason">{t('triage.refuseReasonLabel')}</Label>
        <textarea
          id="triage-reason"
          value={reason}
          rows={3}
          onChange={(event) => setReason(event.target.value)}
          aria-describedby="triage-reason-hint"
          className="mt-1 block w-full rounded-md border border-input bg-white px-3 py-2 text-sm text-gray-900"
        />
        <p id="triage-reason-hint" className="mt-1 text-xs text-gray-800">
          {t('triage.refuseReasonHint')}
        </p>
      </div>

      <p className="mt-3 text-xs text-gray-800">{t('triage.refuseSeparateAct')}</p>

      {rejected && (
        <p role="alert" className="mt-2 text-sm font-medium text-red-800">
          {t('triage.refuseRejected')}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-3">
        <Button type="button" variant="cta" disabled={!ready || busy} onClick={() => void submit()}>
          {t('triage.refuseConfirm')}
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
          {t('triage.refuseCancel')}
        </Button>
      </div>
    </section>
  )
}

/**
 * The act that stops the clock — and it sends nothing.
 *
 * The CMS has no channel to the partner; the operator writes the e-mail, makes the call, sends
 * the message, and then records here that it happened. The copy says exactly that, because a
 * button called `Já comuniquei` next to a system that quietly sends nothing is the sort of
 * ambiguity that ends with a partner nobody told.
 */
export function CommunicationPanel({
  refusal,
  onClose,
  communicate,
  onCommunicated,
}: {
  refusal: TriageRefusal
  onClose: () => void
  communicate: (refusalId: string) => Promise<RefusalOutcome>
  onCommunicated: () => Promise<void>
}) {
  const t = useTranslations('Partnerships')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<'none' | 'failed' | 'already'>('none')

  async function submit() {
    setBusy(true)
    setFailure('none')
    const outcome = await communicate(refusal.id)
    setBusy(false)
    if (outcome === 'ok') {
      await onCommunicated()
      return
    }
    // `refused` is the 409 of a refusal somebody else already closed: the job is done, and
    // reloading is the honest answer rather than an error the operator caused.
    if (outcome === 'refused') {
      setFailure('already')
      await onCommunicated()
      return
    }
    setFailure('failed')
  }

  return (
    <section
      aria-labelledby="triage-communication-title"
      className="mt-3 rounded-md border border-gray-300 p-3 text-sm"
    >
      <h4 id="triage-communication-title" className="font-semibold text-gray-900">
        {t('triage.communicateAction')}
      </h4>
      <p className="mt-1 text-gray-800">{t('triage.communicateBody')}</p>

      {failure === 'already' && (
        <p role="status" className="mt-2 text-gray-900">
          {t('triage.communicateAlready')}
        </p>
      )}
      {failure === 'failed' && (
        <p role="alert" className="mt-2 font-medium text-red-800">
          {t('triage.communicateFailed')}
        </p>
      )}

      <p className="mt-2 text-xs text-gray-800">
        {refusal.decidedByLabel
          ? t('triage.refusedLine', {
              date: formatDateTime(refusal.decidedAt),
              person: refusal.decidedByLabel,
            })
          : t('triage.refusedLineAnonymous', { date: formatDateTime(refusal.decidedAt) })}
      </p>

      <div className="mt-3 flex flex-wrap gap-3">
        <Button type="button" variant="cta" disabled={busy} onClick={() => void submit()}>
          {t('triage.communicateConfirm')}
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
          {t('triage.communicateCancel')}
        </Button>
      </div>
    </section>
  )
}

/**
 * What a refused place says once the decision is on the record: which criterion refused, what
 * was missing, who decided and when — BR-B2B-011, item 4 — plus whether the partner has been
 * told. `A parceria continua.` is here as well, because this block is what the operator reads
 * when he comes back to the row (criterion 33).
 */
export function RefusalSummary({ refusal }: { refusal: TriageRefusal }) {
  const t = useTranslations('Partnerships')

  return (
    <div className="mt-3 rounded-md border border-gray-200 p-3 text-sm">
      <p className="font-semibold text-gray-900">{t('triage.refusedTitle')}</p>
      <p className="mt-1 text-gray-900">
        {refusal.decidedByLabel
          ? t('triage.refusedLine', {
              date: formatDateTime(refusal.decidedAt),
              person: refusal.decidedByLabel,
            })
          : t('triage.refusedLineAnonymous', { date: formatDateTime(refusal.decidedAt) })}
      </p>
      {/* Gate outside 1..3 is a row the CHECK cannot produce; the reason then stands alone
          rather than naming a criterion nobody chose. */}
      {refusal.gate !== null && (
        <p className="mt-1 text-gray-900">
          {t('triage.refusedGate', { gate: t(`triage.gates.${refusal.gate}`) })}
        </p>
      )}
      <p className="mt-1 break-words text-gray-900">
        {t('triage.refusedReason', { reason: refusal.reason })}
      </p>
      <p className="mt-2 text-gray-900">
        {refusal.communicatedAt
          ? t('triage.communicatedLine', { date: formatDateTime(refusal.communicatedAt) })
          : t('triage.notCommunicated')}
      </p>
      <p className="mt-2 font-medium text-gray-900">{t('triage.partnershipContinues')}</p>
    </div>
  )
}
