'use client'

/**
 * #1281 BR-MONETIZACAO-091 item 8.2: the last block of the Painel tab, who got the hours of
 * "estou viajando agora". The one block of the panel that names a person, and only by the email of
 * the account: never the destination, the wish nor the contact email (BR-USUARIO-055 items 6.b,
 * 6.c and 8; the route's `normalizeTripNowCredits` drops anything else). Admin only, like the
 * whole page (BR-CMS-003). Its own route and read, so it loads and fails without holding the counts
 * above, and they fail without taking it down.
 */

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Navigation } from 'lucide-react'
import { CELL, DIM, HEAD_SOLO, HEAD_SOLO_NUM, NUM } from '@/components/ui/dense-table'
import { formatDurationOrDash } from '@/lib/format/duration'
import { UNKNOWN_VALUE } from '@/lib/format/unknown'
import type { TripAdminError, TripNowCredits as NowCredits } from '@/lib/trip-reminder/settings'
import { bandName, countFormat, formatInstant } from './format'
import { ReadFailure } from './ReadFailure'

type Load = { state: 'loading' } | { state: 'error'; error: TripAdminError | null } | { state: 'ready'; data: NowCredits }

export function TripNowCredits() {
  const t = useTranslations('TripReminder')
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    fetch('/api/admin/trip-reminder/now-credits', { cache: 'no-store' })
      .then(async (response) => {
        const envelope = await response.json().catch(() => null)
        if (!alive) return
        if (response.ok && envelope) setLoad({ state: 'ready', data: envelope as NowCredits })
        else setLoad({ state: 'error', error: envelope?.error ?? null })
      })
      .catch(() => {
        if (alive) setLoad({ state: 'error', error: null })
      })
    return () => {
      alive = false
    }
  }, [attempt])

  const n = (value: number) => countFormat.format(value)

  return (
    <section aria-labelledby="trip-now-hours">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="trip-now-hours" className="text-lg font-bold text-gray-900 dark:text-gray-100">
          {t('panel.now_hours_heading')}
        </h2>
        {load.state === 'ready' ? (
          <span className="inline-flex items-center gap-1 text-sm font-semibold tabular-nums text-gray-900 dark:text-gray-100">
            <Navigation className="h-4 w-4" aria-hidden="true" />
            {t('panel.now_hours_total')}: {n(load.data.total)}
          </span>
        ) : null}
      </div>
      <p className={`mb-2 text-sm ${DIM}`}>{t('panel.now_hours_intro')}</p>
      {load.state === 'loading' ? <p className={`text-sm ${DIM}`}>{t('loading')}</p> : null}
      {load.state === 'error' ? (
        <ReadFailure
          error={load.error}
          onRetry={() => {
            setLoad({ state: 'loading' })
            setAttempt((value) => value + 1)
          }}
        />
      ) : null}
      {load.state === 'ready' && load.data.rows.length === 0 ? <p className={`text-sm ${DIM}`}>{t('panel.now_hours_empty')}</p> : null}
      {load.state === 'ready' && load.data.rows.length > 0 ? (
        <>
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={HEAD_SOLO}>{t('panel.now_hours_account')}</th>
                  <th className={HEAD_SOLO}>{t('panel.now_hours_credited_on')}</th>
                  <th className={HEAD_SOLO_NUM}>{t('panel.now_hours_hours')}</th>
                  <th className={HEAD_SOLO}>{t('panel.duration')}</th>
                </tr>
              </thead>
              <tbody>
                {load.data.rows.map((row, index) => (
                  <tr key={`${row.credited_at}-${index}`} className="border-t border-gray-100 dark:border-gray-800">
                    <td className={`${CELL} whitespace-nowrap`}>{row.email ?? UNKNOWN_VALUE}</td>
                    <td className={`${CELL} whitespace-nowrap`}>{formatInstant(row.credited_at)}</td>
                    <td className={NUM}>{formatDurationOrDash(row.minutes)}</td>
                    <td className={CELL}>
                      {row.duration_band === null ? <span className={DIM}>{bandName(t, null)}</span> : bandName(t, row.duration_band)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {load.data.total > load.data.rows.length ? (
            <p className={`mt-2 text-sm ${DIM}`}>
              {t('panel.now_hours_truncated', { shown: n(load.data.rows.length), total: n(load.data.total) })}
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  )
}
