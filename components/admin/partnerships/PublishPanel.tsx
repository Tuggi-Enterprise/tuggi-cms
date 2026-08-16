'use client'

/**
 * The 4 → 5 act — DS-COMPONENTE-021.
 *
 * IN LINE AND NOT A MODAL, the same shape as `PromotionPanel`: the operator has to keep seeing
 * the pendency list while deciding whether to publish a place that will be mute.
 *
 * FOUR CONFIRMATIONS, EACH ONE WHOLE. The variant comes from `buildPublishPlan` on the server
 * and is re-derived there when the request lands, so this file chooses no consequence — it
 * renders one. A confirmation with a conditional clause inside would make the operator work
 * out which half of the sentence applies to them (1st edge case of the decision).
 *
 * THE VALUE IS IN THE BUTTON, and `Confirmar` appears nowhere. WCAG 2.2 SC 3.3.4 asks a
 * financial act to be reversible, verified OR confirmed; the money here is a recurring monthly
 * fee on somebody else's company, and printing it on the control is the confirmation.
 *
 * `Tentar de novo` EXISTS HERE AND NOT ON THE PROMOTION, and the difference is the destination:
 * publishing the same place twice is the same state (one `approved = true`), promoting a
 * proposal twice is not.
 */

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatMonthlyFee } from '@/lib/partnerships/publish-plan'
import type { PartnershipPlace } from '@/lib/services/partnership-service'
import { formatDate } from '@/components/admin/partner-proposals/format'

type Failure = 'write' | 'network' | 'refused' | null

interface PublishPanelProps {
  place: PartnershipPlace
  /** Where the fee and the courtesy are registered — variant (iv)'s only way out. */
  clientHref: string
  onClose: () => void
  onPublished: () => void
  publish: (approved: boolean) => Promise<'ok' | 'write' | 'network' | 'refused'>
}

export function PublishPanel({
  place,
  clientHref,
  onClose,
  onPublished,
  publish,
}: PublishPanelProps) {
  const t = useTranslations('Partnerships')
  const [submitting, setSubmitting] = useState(false)
  const [failure, setFailure] = useState<Failure>(null)

  const name = place.readiness.place.name
  const plan = place.plan

  async function commit() {
    setSubmitting(true)
    setFailure(null)
    const outcome = await publish(true)
    setSubmitting(false)
    if (outcome === 'ok') {
      onPublished()
      return
    }
    setFailure(outcome)
  }

  const missing = missingForNarration(place, t)

  return (
    <section
      aria-labelledby="publish-heading"
      className="mt-4 rounded-md border-2 border-primary/50 bg-white p-4"
    >
      <h4 id="publish-heading" className="text-base font-semibold text-gray-900">
        {t('publish.title', { name })}
      </h4>

      {/* Block A — what is about to happen, and it changes with the pendency that is left. */}
      <p className="mt-3 text-sm text-gray-900">
        {missing === null
          ? t('publish.effectWithAudio')
          : t('publish.effectSilent', { missing })}
      </p>

      {/* Block B — the tier and the money. One variant, whole. */}
      <div className="mt-4 rounded-md border border-gray-300 p-3 text-sm">
        {plan.variant === 'paid_starts' && (
          <>
            <p className="font-semibold text-gray-900">{t('publish.paidStartsTitle')}</p>
            <p className="mt-1 text-gray-900">
              {t('publish.paidStartsBody', {
                fee: formatMonthlyFee(plan.feeCents ?? 0),
                date: formatDate(new Date().toISOString()),
              })}
            </p>
            <p className="mt-2 text-gray-800">{t('publish.paidStartsContent')}</p>
          </>
        )}

        {plan.variant === 'paid_pending' && (
          <>
            <p className="font-semibold text-gray-900">{t('publish.paidPendingTitle')}</p>
            <p className="mt-1 text-gray-900">{t('publish.paidPendingBody')}</p>
          </>
        )}

        {plan.variant === 'courtesy' && (
          <>
            <p className="font-semibold text-gray-900">{t('publish.courtesyTitle')}</p>
            <p className="mt-1 text-gray-900">
              {t('publish.courtesyBody', { reason: plan.courtesyReason ?? '' })}
            </p>
          </>
        )}

        {plan.variant === 'undeclared' && (
          <>
            <p className="font-semibold text-gray-900">{t('publish.undeclaredTitle')}</p>
            <p className="mt-1 text-gray-900">{t('publish.undeclaredBody')}</p>
          </>
        )}
      </div>

      {/* The act is offered but the place cannot enter the app: saying "entra no app" would be
          false, and the blocking pendencies right above already name what is missing and where
          it is fixed — nothing is disabled in silence (DS-COMPONENTE-021, point 2). */}
      {plan.variant !== 'undeclared' && !plan.offersAct && (
        <div className="mt-3 rounded-md border border-gray-300 bg-gray-50 p-3 text-sm">
          <p className="font-semibold text-gray-900">{t('publish.blockedTitle')}</p>
          <p className="mt-1 text-gray-800">{t('publish.blockedBody')}</p>
        </div>
      )}

      {failure && (
        <div
          className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-gray-900"
          role="alert"
        >
          <p className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            {failure === 'network' ? t('publish.networkTitle') : t('publish.failedTitle')}
          </p>
          <p className="mt-1">
            {failure === 'network' ? t('publish.networkBody') : t('publish.failedBody')}
          </p>
          {failure === 'network' && (
            <Button type="button" variant="outline" className="mt-2" onClick={commit}>
              {t('publish.retry')}
            </Button>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-3">
        {plan.variant === 'undeclared' ? (
          <a
            href={clientHref}
            className="inline-flex min-h-[24px] items-center text-sm font-medium text-primary-800 underline underline-offset-4"
          >
            {t('publish.undeclaredAction', { name })}
          </a>
        ) : (
          plan.offersAct && (
            <Button type="button" onClick={commit} disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                  {t('publish.publishing')}
                </>
              ) : (
                confirmLabel(plan.variant, name, plan.feeCents, t)
              )}
            </Button>
          )
        )}
        <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
          {t('publish.back')}
        </Button>
      </div>
    </section>
  )
}

/**
 * `Tirar do app` — the reverse, and its copy says exactly what is written and nothing else.
 *
 * BR-B2B-018 says when the fee STARTS; no rule describes the effect of the POI leaving the
 * air, so the second line neither claims it stops nor claims it continues — it says where that
 * is resolved (DS-COMPONENTE-021, point 4). Spec §9, question 1, is the operator's to answer,
 * and the day it is answered this copy changes.
 */
export function UnpublishPanel({
  place,
  onClose,
  onUnpublished,
  publish,
}: {
  place: PartnershipPlace
  onClose: () => void
  onUnpublished: () => void
  publish: (approved: boolean) => Promise<'ok' | 'write' | 'network' | 'refused'>
}) {
  const t = useTranslations('Partnerships')
  const [submitting, setSubmitting] = useState(false)
  const [failed, setFailed] = useState(false)
  const name = place.readiness.place.name

  async function commit() {
    setSubmitting(true)
    setFailed(false)
    const outcome = await publish(false)
    setSubmitting(false)
    if (outcome === 'ok') {
      onUnpublished()
      return
    }
    setFailed(true)
  }

  return (
    <section
      aria-labelledby="unpublish-heading"
      className="mt-4 rounded-md border-2 border-destructive/40 bg-white p-4"
    >
      <h4 id="unpublish-heading" className="text-base font-semibold text-gray-900">
        {t('publish.unpublishTitle', { name })}
      </h4>
      <p className="mt-2 text-sm text-gray-900">{t('publish.unpublishBody')}</p>
      <p className="mt-2 text-sm font-semibold text-gray-900">{t('publish.unpublishContract')}</p>

      {failed && (
        <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm" role="alert">
          {t('publish.unpublishFailed')}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-3">
        <Button type="button" variant="destructive" onClick={commit} disabled={submitting}>
          {submitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              {t('publish.unpublishing')}
            </>
          ) : (
            t('publish.unpublishConfirm', { name })
          )}
        </Button>
        <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
          {t('publish.back')}
        </Button>
      </div>
    </section>
  )
}

/**
 * What is missing for the place to say anything, as the operator reads it — or `null` when
 * nothing is. It is exactly the `silences_app` class, which is why block A and the pendency
 * list can never contradict each other.
 */
function missingForNarration(
  place: PartnershipPlace,
  t: ReturnType<typeof useTranslations>
): string | null {
  const parts: string[] = []
  if (place.readiness.silencing.indexOf('trigger_point') >= 0) {
    parts.push(t('publish.missingTriggerPoint'))
  }
  if (place.readiness.silencing.indexOf('audio_description') >= 0) {
    parts.push(t('publish.missingAudio'))
  }
  return parts.length === 0 ? null : parts.join(t('publish.missingSeparator'))
}

function confirmLabel(
  variant: string,
  name: string,
  feeCents: number | null,
  t: ReturnType<typeof useTranslations>
): string {
  if (variant === 'paid_starts') {
    return t('publish.paidStartsAction', { fee: formatMonthlyFee(feeCents ?? 0), name })
  }
  if (variant === 'paid_pending') return t('publish.paidPendingAction', { name })
  return t('publish.courtesyAction', { name })
}
