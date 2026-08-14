'use client'

/**
 * The regularity band — BR-B2B-022, and the first thing under the header because it is the
 * only thing on this screen that BLOCKS anything.
 *
 * What it blocks is the CONTRACT. It never says the proposal is refused, never says
 * "aprovado", and never says the Tuggi verified, audited or certified anybody: item 7 of the
 * rule. It says what is there and what is missing.
 *
 * AN EXPIRED LICENCE IS AN ABSENT LICENCE, and the operator does not do the arithmetic — the
 * line says `Venceu em {data} — há {n} dias` with the number already counted. Every line
 * carries an icon AND text (DS-A11Y-003); the icon alone would leave the state to colour.
 */

import { useTranslations } from 'next-intl'
import { AlertTriangle, Check, X } from 'lucide-react'
import type { RegularityReport } from '@/lib/partner-form/regularity'
import type { PartnerAnswers } from '@/lib/partner-form/schema'
import { formatDate } from './format'
import type { Translator } from './types'

interface RegularityBandProps {
  report: RegularityReport
  answers: PartnerAnswers
}

export function RegularityBand({ report, answers }: RegularityBandProps) {
  const t = useTranslations('PartnerProposals')

  const lines = report.items.map((item) => {
    switch (item.id) {
      case 'tax_id':
        return {
          id: item.id,
          ok: item.ok,
          tone: item.ok ? 'ok' : 'bad',
          text: item.ok
            ? t('regularity.taxIdOk', { value: answers.tax_id ?? '' })
            : t('regularity.taxIdMissing'),
        }
      case 'business_license':
        return { id: item.id, ok: item.ok, ...licenseLine(report, t) }
      case 'incorporation_document':
        return {
          id: item.id,
          ok: item.ok,
          tone: item.ok ? 'ok' : 'bad',
          text: item.ok
            ? t('regularity.incorporationOk', { count: item.fileCount })
            : t('regularity.incorporationMissing'),
        }
      default:
        return {
          id: item.id,
          ok: item.ok,
          tone: item.ok ? 'ok' : 'bad',
          text: item.ok
            ? t('regularity.representativeOk', {
                name: answers.representative_name ?? '',
                role: answers.representative_role ?? '',
              })
            : t('regularity.representativeMissing'),
        }
    }
  })

  return (
    <section
      aria-labelledby="regularity-heading"
      className="rounded-md border border-gray-300 bg-white p-4"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="regularity-heading" className="text-base font-semibold text-gray-900">
          {t('regularity.heading')}
        </h2>
        <span className="text-xs text-gray-700">{t('regularity.rule')}</span>
      </div>

      <ul className="mt-3 space-y-2">
        {lines.map((line) => (
          <li key={line.id} className="flex items-start gap-2 text-sm">
            <Icon tone={line.tone} />
            <span>
              <span className="font-medium text-gray-900">{t(`regularity.items.${line.id}`)}: </span>
              <span className={line.tone === 'ok' ? 'text-gray-800' : 'text-gray-900'}>{line.text}</span>
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-4 flex items-start gap-2 border-t border-gray-200 pt-3 text-sm font-medium">
        <Icon tone={report.ready ? 'ok' : 'bad'} />
        <span className={report.ready ? 'text-green-800' : 'text-gray-900'}>
          {report.ready
            ? t('regularity.ready')
            : t('regularity.notReady', {
                items: report.missing
                  .map((id) => t(`regularity.items.${id}`).toLowerCase())
                  .join(t('regularity.itemSeparator')),
              })}
        </span>
      </p>
    </section>
  )
}

function licenseLine(
  report: RegularityReport,
  t: Translator
): { tone: string; text: string } {
  const { status, validUntil, daysRemaining } = report.license

  if (status === 'expired') {
    return {
      tone: 'bad',
      text: t('regularity.licenseExpired', {
        date: formatDate(validUntil),
        days: Math.abs(daysRemaining ?? 0),
      }),
    }
  }
  if (status === 'expiring') {
    return {
      tone: 'warn',
      text: t('regularity.licenseExpiring', {
        date: formatDate(validUntil),
        days: daysRemaining ?? 0,
      }),
    }
  }
  if (status === 'undated') return { tone: 'bad', text: t('regularity.licenseUndated') }
  if (status === 'missing') return { tone: 'bad', text: t('regularity.licenseMissing') }

  return {
    tone: 'ok',
    text: t('regularity.licenseOk', { date: formatDate(validUntil), days: daysRemaining ?? 0 }),
  }
}

/** Decorative: every one of these sits beside text that says the same thing. */
function Icon({ tone }: { tone: string }) {
  if (tone === 'ok') return <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-800" aria-hidden="true" />
  if (tone === 'warn')
    return <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-secondary-700" aria-hidden="true" />
  return <X className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
}
