'use client'

/**
 * The portal side of the client record (#871): the acceptance is the contract of a client that
 * came through the Portal Locais (BR-B2B-047), and the Asaas subscription is its billing
 * (BR-B2B-046). Read from `GET /api/admin/clients/[clientId]/contract` (`portal`), which already
 * masks the CPF (BR-B2B-043 item 1) — nothing here can unmask it.
 */

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Copy } from 'lucide-react'
import { formatDate, formatFee } from '@/lib/contract/snapshot'
import { isPaidPlan } from '@/lib/partnerships/portal-review'
import type { ClientPortalRecord } from '@/lib/services/portal-submission-review-service'
import type { ClientOrigin } from './use-client-contract'

const TERM = 'text-[10px] font-bold uppercase tracking-widest text-gray-500'
const VALUE = 'text-sm font-semibold text-gray-900 dark:text-white break-words'

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className={TERM}>{label}</dt>
      <dd className={VALUE}>{children}</dd>
    </div>
  )
}

export function OriginRow({ origin }: { origin: ClientOrigin }) {
  const t = useTranslations('Clients.portal.origin')
  return <Row label={t('label')}>{t(origin)}</Row>
}

/** The hash is what a dispute quotes; copying it by hand from a 64-char mono line is where it breaks. */
function CopyHash({ hash }: { hash: string }) {
  const t = useTranslations('Clients.portal.acceptance')
  const [copied, setCopied] = useState(false)
  return (
    <span className="mt-1 flex items-center gap-2">
      <button
        type="button"
        onClick={() => void navigator.clipboard?.writeText(hash).then(() => setCopied(true))}
        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold text-primary-800 hover:bg-tuggi-blue/5 dark:text-tuggi-blue"
      >
        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
        {t('copyHash')}
      </button>
      {copied ? <span role="status" className="text-xs font-semibold text-green-700">{t('copied')}</span> : null}
    </span>
  )
}

/**
 * The acceptance as the record shows it — in the Validação tab before the link, in Contrato after
 * it (#890): login method, marketing consent and "Copiar hash" live here so neither tab loses them.
 */
export function PortalAcceptances({ records }: { records: ClientPortalRecord[] }) {
  const t = useTranslations('Clients.portal.acceptance')
  return (
    <>
      {records.map(({ submissionId, acceptance }) => (
        <dl key={submissionId} className="grid grid-cols-1 gap-y-4 gap-x-10 sm:grid-cols-2">
          {!acceptance ? (
            <p className="text-sm text-gray-600">{t('missing')}</p>
          ) : (
            <>
              <Row label={t('title')}>
                {t('terms', { version: acceptance.termsVersion, date: formatDate(acceptance.acceptedAt) })}
              </Row>
              <Row label={t('hash')}>
                <span className="font-mono text-xs">{acceptance.termsHash}</span>
                <CopyHash hash={acceptance.termsHash} />
              </Row>
              <Row label={t('signer')}>
                {t('signerLine', {
                  name: acceptance.signerName,
                  role: acceptance.signerRole,
                  cpf: acceptance.signerCpfMasked,
                })}
              </Row>
              <Row label={t('regularity')}>{acceptance.legalStatusDeclared ? t('declared') : t('notDeclared')}</Row>
              <Row label={t('commitment')}>
                {(() => {
                  const marked = (['sticker', 'display', 'social'] as const).filter(
                    (key) => acceptance.activationCommitment[key]
                  )
                  return marked.length ? marked.map((key) => t(key)).join(', ') : t('commitmentNone')
                })()}
              </Row>
              <Row label={t('login')}>{acceptance.authMethod === 'otp' ? t('methodOtp') : t('methodLink')}</Row>
              <Row label={t('marketing')}>{acceptance.marketingConsent ? t('yes') : t('no')}</Row>
            </>
          )}
        </dl>
      ))}
    </>
  )
}

export function PortalSubscriptions({ records }: { records: ClientPortalRecord[] }) {
  const t = useTranslations('Clients.portal.subscription')
  return (
    <>
      {records.map(({ submissionId, acceptance, payment }) => {
        if (!acceptance) return null
        const paid = isPaidPlan(acceptance.planChoice)
        // Only a running period has a next charge; refunded or expired has none to show.
        const running = payment?.status === 'paid' || payment?.status === 'past_due'
        return (
          <dl key={submissionId} className="grid grid-cols-1 gap-y-4 gap-x-10 sm:grid-cols-2">
            <Row label={t('plan')}>
              {paid ? t('planPaid', { months: acceptance.billingPeriod ?? 1 }) : t('planFree')}
            </Row>
            <Row label={t('amount')}>
              {!paid || acceptance.totalCents === 0
                ? t('noCharge')
                : payment?.renewalAmountCents != null
                  ? t('amountLine', {
                      first: formatFee(acceptance.totalCents),
                      renewal: formatFee(payment.renewalAmountCents),
                    })
                  : formatFee(acceptance.totalCents)}
            </Row>
            {paid && payment ? (
              <>
                <Row label={t('status')}>
                  {t.has(`statuses.${payment.status}`)
                    ? t(`statuses.${payment.status}` as 'statuses.paid')
                    : payment.status}
                  {payment.refundedAt
                    ? ` · ${t('refundedAt', { date: formatDate(payment.refundedAt) })}`
                    : payment.paidAt
                      ? ` · ${t('paidAt', { date: formatDate(payment.paidAt) })}`
                      : ''}
                </Row>
                <Row label={t('nextDue')}>
                  {!running
                    ? '—'
                    : !payment.paidThrough
                    ? payment.paidAt
                      ? t('startsAtApproval')
                      : '—'
                    : payment.canceledAt
                      ? t('renewalOff', { date: formatDate(payment.paidThrough) })
                      : formatDate(payment.paidThrough)}
                </Row>
                <Row label={t('reference')}>
                  <span className="font-mono text-xs">
                    {payment.externalReference ?? '—'}
                    {payment.providerSubscriptionId ? ` · ${payment.providerSubscriptionId}` : ''}
                  </span>
                </Row>
              </>
            ) : null}
          </dl>
        )
      })}
    </>
  )
}
