'use client'

/**
 * Compose → review → run → result. The individual grant and the batch are the SAME
 * dialog, with `targets.length === 1` or more.
 *
 * Two written decisions shape it, and both come from the same fact: **a CMS grant is not
 * idempotent**. The unique event index of `drive.time_credit_grants` covers `purchase`
 * and `coupon` only, so resending the same composition grants twice.
 *
 * - `DS-COMPONENTE-013` — confirmation of an irreversible act is ONE sentence with verb,
 *   amount and a person identified by name and e-mail; the button repeats the verb and
 *   the number; initial focus is not on it. And the confirmation says what will be
 *   ASKED, while the result says what HAPPENED, with the value the server returned —
 *   no balance is computed here.
 * - `DS-COMPONENTE-014` — a non-atomic batch declares that before running, shows a result
 *   per recipient afterwards, and the only path back is the subset that was **refused with
 *   an answer**. Whoever timed out is not in it: `grantedIds` cannot protect them, because
 *   the id only gets there when a response comes back. The decision is `outcome.ts`;
 *   `grantedIds` is still checked when the list is built AND again in the loop.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useSupabaseClient } from '@supabase/auth-helpers-react'
import { AlertTriangle, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatDuration } from '@/lib/format/duration'
import { DialogShell } from './DialogShell'
import { GrantCreditForm, draftTotalMinutes, type TierOption } from './GrantCreditForm'
import { creditFailureText, readFailure } from './errorText'
import {
  isRetryable,
  periodWasStacked,
  retryTargets,
  type GrantOutcome,
  type RunResult,
} from './outcome'
import { tierGrantsAccess } from '@/lib/credit/tiers'
import type { EntitlementState, GrantDraft, GrantTarget } from './types'

/** Above this many recipients the list no longer fits the modal without scrolling. */
const TYPED_CONFIRMATION_THRESHOLD = 20

type Step = 'compose' | 'review' | 'running' | 'result'

interface TargetSnapshot {
  state: EntitlementState | null
  balanceMinutes: number | null
  endsAt: string | null
  /** Read failed: the row shows "balance not loaded", never `0 min` (DS-COMPONENTE-007). */
  unknown: boolean
}

/** Every date on this screen is read the same way, and comparisons use this, not instants. */
const displayDate = (iso: string): string => new Date(iso).toLocaleDateString()

function emptyDraft(): GrantDraft {
  return { grantType: 'minutes', hours: 1, minutes: 0, endsAt: '', tierId: '', sourceRef: '' }
}

function oneYearFromToday(): string {
  const max = new Date()
  max.setFullYear(max.getFullYear() + 1)
  return max.toISOString().slice(0, 10)
}

interface Props {
  targets: GrantTarget[]
  onClose: () => void
  /** Fired after at least one grant went through, so the caller can refresh. */
  onGranted?: () => void
}

/**
 * Mounted only while it is open, and never left mounted with stale state: the caller does
 * `{open && <GrantCreditDialog .../>}`. A reset-on-open effect would be a second source of
 * truth for "this is a fresh composition", and the one thing this dialog must never do is
 * resend a composition that already ran.
 */
export function GrantCreditDialog({ targets, onClose, onGranted }: Props) {
  const t = useTranslations('Pages.AppUsers.credit')
  const supabase = useSupabaseClient()
  const cancelRef = useRef<HTMLButtonElement | null>(null)
  const stopRef = useRef(false)

  const [step, setStep] = useState<Step>('compose')
  const [draft, setDraft] = useState<GrantDraft>(emptyDraft)
  const [queue, setQueue] = useState<GrantTarget[]>(targets)
  const [snapshots, setSnapshots] = useState<Record<string, TargetSnapshot>>({})
  const [tiers, setTiers] = useState<TierOption[]>([])
  const [typed, setTyped] = useState('')
  const [done, setDone] = useState(0)
  const [results, setResults] = useState<RunResult[]>([])
  const [grantedIds, setGrantedIds] = useState<string[]>([])
  const [stopped, setStopped] = useState(false)

  const maxUntil = useMemo(() => oneYearFromToday(), [])
  const totalMinutes = draftTotalMinutes(draft)
  const isBatch = queue.length > 1

  // The licence list only matters for a period grant, so it is fetched when it is picked.
  useEffect(() => {
    if (draft.grantType !== 'until' || tiers.length > 0) return
    let cancelled = false
    void (async () => {
      const { data } = await supabase
        .schema('drive')
        .from('subscription_tiers')
        .select('id, display_name, name')
        .eq('is_active', true)
      // Free is active in `drive.subscription_tiers` and must never be offered here: a
      // period on it writes a paid end date onto a profile the published app still reads
      // as free, so the operator would see success and the tourist would get nothing. The
      // server refuses it too — this filter is so the operator is never shown the choice.
      if (!cancelled && data) {
        setTiers((data as TierOption[]).filter((tier) => tierGrantsAccess(tier.name)))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [draft.grantType, tiers.length, supabase])

  const loadSnapshots = useCallback(async (people: GrantTarget[]) => {
    const entries = await Promise.all(
      people.map(async (target): Promise<[string, TargetSnapshot]> => {
        try {
          const response = await fetch(
            `/api/admin/users/${target.userId}/credit?session_limit=1`
          )
          if (!response.ok) throw new Error('unreadable')
          const envelope = await response.json()
          return [
            target.userId,
            {
              state: envelope.state ?? null,
              balanceMinutes: envelope.balance_minutes ?? null,
              endsAt: envelope.ends_at ?? null,
              unknown: false,
            },
          ]
        } catch {
          return [
            target.userId,
            { state: null, balanceMinutes: null, endsAt: null, unknown: true },
          ]
        }
      })
    )
    setSnapshots(Object.fromEntries(entries))
  }, [])

  const goToReview = () => {
    setTyped('')
    setStep('review')
    void loadSnapshots(queue)
  }

  const personLabel = (target: GrantTarget): string => {
    const name = target.name?.trim() || t('confirm.who_unnamed')
    // No e-mail: the last 6 characters of the uuid are a tie-breaker, never an identity.
    const tail = target.email?.trim() || `…${target.userId.slice(-6)}`
    return `${name} · ${tail}`
  }

  const stateLabel = (snapshot?: TargetSnapshot): string => {
    if (!snapshot || snapshot.unknown || !snapshot.state) return t('panel.balance_unknown')
    if (snapshot.state === 'unlimited') return t('panel.state_unlimited')
    if (snapshot.state === 'metered') return t('panel.state_metered')
    return t('panel.state_free')
  }

  const balanceLabel = (snapshot?: TargetSnapshot): string =>
    !snapshot || snapshot.unknown || snapshot.balanceMinutes == null
      ? t('panel.balance_unknown')
      : formatDuration(snapshot.balanceMinutes)

  const unlimitedCount = queue.filter(
    (target) => snapshots[target.userId]?.state === 'unlimited'
  ).length

  const composeIsValid =
    draft.grantType === 'minutes'
      ? totalMinutes > 0
      : Boolean(draft.endsAt) && Boolean(draft.tierId)

  const needsTypedConfirmation = queue.length > TYPED_CONFIRMATION_THRESHOLD
  const confirmWord = t('batch.confirm_word')
  const typedConfirmed =
    !needsTypedConfirmation ||
    typed.trim().toLocaleLowerCase() === confirmWord.trim().toLocaleLowerCase()

  const body =
    draft.grantType === 'minutes'
      ? { grant_type: 'minutes', minutes: totalMinutes, source_ref: draft.sourceRef }
      : {
          grant_type: 'until',
          ends_at: new Date(`${draft.endsAt}T23:59:59`).toISOString(),
          tier_id: draft.tierId,
          source_ref: draft.sourceRef,
        }

  const run = async () => {
    stopRef.current = false
    setStopped(false)
    setStep('running')
    setDone(0)
    const collected: RunResult[] = []
    const granted = [...grantedIds]

    for (const target of queue) {
      if (stopRef.current) break
      // Second guard, on purpose: the retry list is already filtered, and this is what
      // makes "nobody is granted twice by this dialog" true of the loop itself.
      if (granted.includes(target.userId)) continue

      try {
        const response = await fetch(`/api/admin/users/${target.userId}/credit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })

        if (!response.ok) {
          const refusal = await readFailure(response)
          // A body that could not be read is not a refusal: a 504 with an HTML page is the
          // uncertain outcome wearing a status code, and it gets the network sentence and
          // no way back.
          const outcome: GrantOutcome = refusal.unreadable
            ? { kind: 'no_answer' }
            : { kind: 'refused', code: refusal.code }
          collected.push({
            target,
            ok: false,
            retryable: isRetryable(outcome),
            message: refusal.unreadable
              ? t('errors.network')
              : creditFailureText(t, refusal, {
                  requestedMinutes: totalMinutes,
                  maxUntilLabel: displayDate(maxUntil),
                }),
          })
        } else {
          const envelope = await response.json()
          granted.push(target.userId)
          collected.push({
            target,
            ok: true,
            retryable: isRetryable({ kind: 'granted' }),
            message: envelope.duplicate
              ? t('result.duplicate')
              : draft.grantType === 'minutes'
                ? // The balance comes from the RPC envelope. Nothing is added here.
                  t('result.granted', { duration: formatDuration(envelope.balance_minutes) })
                : // The result says what HAPPENED: the effective date, and — when the
                  // period stacked on live access — that it was added to what was there.
                  t(
                    periodWasStacked(
                      envelope.requested_ends_at,
                      envelope.ends_at,
                      displayDate
                    )
                      ? 'result.granted_until_stacked'
                      : 'result.granted_until',
                    { date: envelope.ends_at ? displayDate(envelope.ends_at) : '' }
                  ),
          })
        }
      } catch {
        // The one path that grants twice by accident: not idempotent + timeout + the
        // reflex to retry. This message sends the operator to the history FIRST, and the
        // outcome is never retryable — the id is not in `grantedIds` exactly because no
        // answer came back, so `grantedIds` alone would not protect this recipient.
        collected.push({
          target,
          ok: false,
          retryable: isRetryable({ kind: 'no_answer' }),
          message: t('errors.network'),
        })
      }

      setDone((current) => current + 1)
      setResults([...collected])
    }

    setGrantedIds(granted)
    setResults(collected)
    setStopped(stopRef.current)
    setStep('result')
    if (collected.some((result) => result.ok)) onGranted?.()
  }

  const okCount = results.filter((result) => result.ok).length
  // NOT "everyone who failed": whoever timed out may already have been granted, and this
  // dialog is the only place a second grant can be issued by accident (card #330).
  const retryable = retryTargets(results, grantedIds)

  const retryFailed = () => {
    setQueue(retryable)
    setResults([])
    setDone(0)
    setStopped(false)
    setTyped('')
    setStep('review')
    void loadSnapshots(retryable)
  }

  const copyResult = () => {
    const text = results
      .map((result) => `${result.ok ? 'OK' : 'X'}\t${personLabel(result.target)}\t${result.message}`)
      .join('\n')
    void navigator.clipboard?.writeText(text)
  }

  const singleTarget = queue[0]
  const singleSnapshot = singleTarget ? snapshots[singleTarget.userId] : undefined
  const title =
    step === 'review' && !isBatch
      ? t('confirm.title')
      : step === 'review'
        ? t('batch.review_title')
        : t('form.title')

  return (
    <DialogShell
      open
      title={title}
      busy={step === 'running'}
      onClose={onClose}
      initialFocusRef={step === 'review' ? cancelRef : undefined}
      footer={renderFooter()}
    >
      {step === 'compose' ? (
        <GrantCreditForm draft={draft} onChange={setDraft} tiers={tiers} maxUntil={maxUntil} />
      ) : null}

      {step === 'review' && !isBatch && singleTarget ? (
        <div className="space-y-3 text-sm text-gray-900 dark:text-white">
          <p className="font-semibold">
            {draft.grantType === 'minutes'
              ? t('confirm.sentence_minutes', {
                  duration: formatDuration(totalMinutes),
                  minutes: totalMinutes,
                  who: personLabel(singleTarget),
                })
              : t('confirm.sentence_until', {
                  who: personLabel(singleTarget),
                  date: new Date(draft.endsAt).toLocaleDateString(),
                })}
          </p>
          <p className="text-gray-700 dark:text-gray-300">{t('confirm.permanence')}</p>
          {singleSnapshot?.state === 'unlimited' ? (
            <p className="flex gap-2 text-gray-900 dark:text-white">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
              {/* Same fact, two consequences: minutes land inert until the period ends,
                  a period is ADDED to the one that is running and the final date lands
                  after the one just picked (BR-MONETIZACAO-065). Said before the click,
                  because afterwards the operator reads the different date as their own
                  mistake and corrects it by granting again — which stacks more. */}
              {t(
                draft.grantType === 'minutes'
                  ? 'confirm.inert_warning'
                  : 'confirm.until_stacks_warning',
                { date: singleSnapshot.endsAt ? displayDate(singleSnapshot.endsAt) : '' }
              )}
            </p>
          ) : null}
        </div>
      ) : null}

      {step === 'review' && isBatch ? (
        <div className="space-y-3 text-sm text-gray-900 dark:text-white">
          <p className="font-semibold">
            {t('batch.sentence', {
              duration: formatDuration(totalMinutes),
              minutes: totalMinutes,
              count: queue.length,
            })}
          </p>
          {unlimitedCount > 0 ? (
            <p className="flex gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
              {/* "The balance lands parked" is only true for minutes. For a period grant
                  nothing is parked — the period stacks on the one already running. */}
              {t(
                draft.grantType === 'minutes'
                  ? 'batch.unlimited_note'
                  : 'batch.until_stacks_note',
                { count: unlimitedCount }
              )}
            </p>
          ) : null}
          <p className="flex gap-2 text-gray-700 dark:text-gray-300">
            <Info className="h-4 w-4 shrink-0" aria-hidden="true" />
            {t('batch.not_atomic')}
          </p>
          <ul className="max-h-64 divide-y divide-gray-100 overflow-y-auto rounded-md border border-gray-200 dark:divide-gray-800 dark:border-gray-700">
            {queue.map((target) => (
              <li key={target.userId} className="flex justify-between gap-4 px-3 py-2">
                <span className="truncate">{personLabel(target)}</span>
                <span className="shrink-0 text-gray-700 dark:text-gray-300">
                  {stateLabel(snapshots[target.userId])} · {balanceLabel(snapshots[target.userId])}
                </span>
              </li>
            ))}
          </ul>
          {needsTypedConfirmation ? (
            <div>
              <Label htmlFor="credit-typed-confirmation" className="dark:text-gray-300">
                {t('batch.type_to_confirm', { word: confirmWord })}
              </Label>
              <Input
                id="credit-typed-confirmation"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {step === 'running' ? (
        <div className="space-y-3 text-sm text-gray-900 dark:text-white">
          <p aria-live="polite">{t('batch.running', { done, count: queue.length })}</p>
          <div className="h-2 w-full rounded-full bg-gray-200 dark:bg-gray-700">
            <div
              className="h-2 rounded-full bg-primary transition-all"
              style={{ width: `${queue.length ? (done / queue.length) * 100 : 0}%` }}
            />
          </div>
        </div>
      ) : null}

      {step === 'result' ? (
        <div className="space-y-3 text-sm text-gray-900 dark:text-white">
          <p className="font-semibold">
            {t('batch.result_title', { ok: okCount, failed: results.length - okCount })}
          </p>
          {stopped ? (
            <p className="text-gray-700 dark:text-gray-300">
              {t('batch.stopped', { done, count: queue.length })}
            </p>
          ) : null}
          <ul className="max-h-72 divide-y divide-gray-100 overflow-y-auto rounded-md border border-gray-200 dark:divide-gray-800 dark:border-gray-700">
            {results.map((result) => (
              <li key={result.target.userId} className="px-3 py-2">
                <span className="font-medium">
                  {result.ok ? '✓' : '✗'} {personLabel(result.target)}
                </span>
                <span className="ml-2 text-gray-700 dark:text-gray-300">{result.message}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </DialogShell>
  )

  function renderFooter() {
    if (step === 'compose') {
      return (
        <>
          <Button variant="outline" onClick={onClose}>
            {t('form.cancel')}
          </Button>
          <span className="flex items-center gap-3">
            {draft.grantType === 'minutes' && totalMinutes === 0 ? (
              <span className="text-sm text-gray-700 dark:text-gray-300">
                {t('form.min_amount')}
              </span>
            ) : null}
            <Button disabled={!composeIsValid} onClick={goToReview}>
              {t('form.review')}
            </Button>
          </span>
        </>
      )
    }

    if (step === 'review') {
      return (
        <>
          <Button ref={cancelRef} variant="outline" onClick={onClose}>
            {t('form.cancel')}
          </Button>
          <Button disabled={!typedConfirmed} onClick={() => void run()}>
            {isBatch
              ? t('batch.cta_confirm', { count: queue.length })
              : draft.grantType === 'minutes'
                ? t('confirm.cta_minutes', { minutes: totalMinutes })
                : t('confirm.cta_until', { date: new Date(draft.endsAt).toLocaleDateString() })}
          </Button>
        </>
      )
    }

    if (step === 'running') {
      return (
        <Button
          variant="outline"
          onClick={() => {
            // Stops the NEXT call. What is already in flight is not cancelled, and the
            // copy says so.
            stopRef.current = true
            setStopped(true)
          }}
        >
          {t('batch.stop')}
        </Button>
      )
    }

    return (
      <>
        <Button variant="outline" onClick={copyResult}>
          {t('batch.copy')}
        </Button>
        {/* Absent, not disabled, when the only failures are uncertain — an individual grant
            that timed out ends with no way back at all, and that is the design. */}
        {retryable.length > 0 ? (
          <Button variant="outline" onClick={retryFailed}>
            {t('batch.retry_failed', { count: retryable.length })}
          </Button>
        ) : null}
        {/* The compose step never comes back and the confirm button never re-enables:
            the same composition must not be sendable twice (DS-COMPONENTE-014). */}
        <Button onClick={onClose}>{t('batch.close')}</Button>
      </>
    )
  }
}
