'use client'

/**
 * The regularity band — BR-B2B-022, and the first thing under the header because it is the
 * only thing on this screen that BLOCKS anything.
 *
 * What it blocks is the CONTRACT. It never says the proposal is refused, never says
 * "aprovado", and never says the Tuggi verified, audited or certified anybody: item 7 of the
 * rule. It says what is there and what is missing.
 *
 * THE EXPIRY LINES LEFT ON 2026-08-21 with the date that fed them: the conference is a tick
 * now (operator's decision, see `ConferenceRecord`), so `Venceu em {data}` and the licence
 * number trail describe facts this system no longer holds. Every remaining line carries an icon
 * AND text (DS-A11Y-003); the icon alone would leave the state to colour.
 *
 * THE TWO DOCUMENT LINES ARE SOMEBODY'S WORD, NOT A FILE, and the band says so twice, in this
 * order: `checkedBy` names the person and the date (BR-B2B-030, item 2), and only then does
 * the footer say what the Tuggi does not hold and does not attest (BR-B2B-022, item 7).
 * Affirm, then limit — and the limit carries its own scope, because a footer that opens with
 * "these two lines" points at a set that changes every time the band gains a line.
 */

import { useTranslations } from 'next-intl'
import { AlertTriangle, Check, X } from 'lucide-react'
import type { RegularityReport } from '@/lib/partner-form/regularity'
import type { PartnerAnswers } from '@/lib/partner-form/schema'
import { formatDate } from './format'

/**
 * The shell is the CMS's glass panel; the ink stays accessible — see the note in
 * `ProposalReview.tsx`, which declares the same two constants for the same reason.
 */
const CARD =
  'rounded-3xl border border-gray-200 bg-white/70 shadow-2xl shadow-black/5 backdrop-blur-xl ' +
  'dark:border-gray-800 dark:bg-gray-900/70'

interface RegularityBandProps {
  report: RegularityReport
  answers: PartnerAnswers
  /** Who registered the conference and when — absent until somebody saves one. */
  checkedBy: string | null
  checkedAt: string | null
}

export function RegularityBand({ report, answers, checkedBy, checkedAt }: RegularityBandProps) {
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
          note: null,
        }
      case 'business_license':
        return {
          id: item.id,
          ok: item.ok,
          tone: item.ok ? 'ok' : 'bad',
          text: item.ok ? t('regularity.licenseOk') : t('regularity.licenseMissing'),
          note: null,
        }
      case 'incorporation_document':
        return {
          id: item.id,
          ok: item.ok,
          tone: item.ok ? 'ok' : 'bad',
          text: item.ok
            ? t('regularity.incorporationOk')
            : t('regularity.incorporationMissing'),
          note: null,
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
          note: null,
        }
    }
  })

  return (
    <section
      aria-labelledby="regularity-heading"
      className={`${CARD} p-6`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="regularity-heading" className="text-base font-semibold text-gray-900 dark:text-white">
          {t('regularity.heading')}
        </h2>
        <span className="text-xs text-gray-700 dark:text-gray-400">{t('regularity.rule')}</span>
      </div>

      <ul className="mt-3 space-y-2">
        {lines.map((line) => (
          <li key={line.id} className="flex items-start gap-2 text-sm">
            <Icon tone={line.tone} />
            <span>
              <span className="font-medium text-gray-900 dark:text-white">{t(`regularity.items.${line.id}`)}: </span>
              <span className={line.tone === 'ok' ? 'text-gray-800' : 'text-gray-900'}>{line.text}</span>
              {/* `note` survives the removal of the licence trail: it is the slot a line uses
                  when it has something to add under itself, and it wraps rather than truncates. */}
              {line.note ? (
                <span className="block break-words text-xs text-gray-800 dark:text-gray-300">{line.note}</span>
              ) : null}
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

      <div className="mt-3 border-t border-gray-200 pt-3 text-xs text-gray-700 dark:text-gray-400">
        {checkedBy && checkedAt && (
          <p>{t('regularity.checkedBy', { person: checkedBy, date: formatDate(checkedAt) })}</p>
        )}
        <p className={checkedBy && checkedAt ? 'mt-1' : undefined}>{t('regularity.source')}</p>
      </div>
    </section>
  )
}

/** Decorative: every one of these sits beside text that says the same thing. */
function Icon({ tone }: { tone: string }) {
  if (tone === 'ok') return <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-800" aria-hidden="true" />
  if (tone === 'warn')
    return <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-secondary-700" aria-hidden="true" />
  return <X className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
}
