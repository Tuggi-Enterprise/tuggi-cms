'use client'

/**
 * Painel tab of `/admin/trip-reminder` (#1233): `drive.cms_get_planned_trips_panel()` as it came.
 * BR-USUARIO-055 item 6.c: counts only. The read has no person and no phone number, and this block
 * prints nothing that is not a count, a month, a destination or a channel.
 */

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { CalendarClock, CalendarDays, Hourglass, MailX, MapPin, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CountryFlag } from '@/components/ui/CountryFlag'
import { StatCard, StatCardRow } from '@/components/ui/StatCard'
import { CELL, DIM, HEAD_SOLO, HEAD_SOLO_NUM, NUM } from '@/components/ui/dense-table'
import type { PlannedTripsPanel, TripAdminError } from '@/lib/trip-reminder/settings'
import { countFormat, errorText, formatMonth } from './format'

type Load =
  | { state: 'loading' }
  | { state: 'error'; error: TripAdminError | null }
  | { state: 'ready'; data: PlannedTripsPanel }

const ANSWERS = ['planned', 'now', 'unsure'] as const
const KNOWN_STATES = ['pending', 'confirmed', 'no_channel', 'undeliverable']

export function TripPanel() {
  const t = useTranslations('TripReminder')
  const [load, setLoad] = useState<Load>({ state: 'loading' })

  const fetchPanel = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/trip-reminder/panel', { cache: 'no-store' })
      const envelope = await response.json().catch(() => null)
      if (!response.ok) {
        setLoad({ state: 'error', error: envelope?.error ?? null })
        return
      }
      setLoad({ state: 'ready', data: envelope as PlannedTripsPanel })
    } catch {
      setLoad({ state: 'error', error: null })
    }
  }, [])

  useEffect(() => {
    void fetchPanel()
  }, [fetchPanel])

  if (load.state === 'loading') return <p className={`text-sm ${DIM}`}>{t('loading')}</p>
  if (load.state === 'error') {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
        <span>
          {t('load_error')} {errorText(t, load.error)}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setLoad({ state: 'loading' })
            void fetchPanel()
          }}>
          {t('reload')}
        </Button>
      </div>
    )
  }

  const { totals, answers, by_destination_month: rows, contacts_by_channel: contacts } = load.data
  const n = (value: number | undefined) => countFormat.format(Number(value ?? 0))

  return (
    <div className="space-y-8">
      <StatCardRow columns={6}>
        <StatCard icon={CalendarClock} label={t('panel.trips')} value={n(totals?.trips)} size="compact" />
        <StatCard icon={CalendarDays} label={t('panel.with_date')} value={n(totals?.with_date)} size="compact" />
        <StatCard icon={MapPin} label={t('panel.with_destination')} value={n(totals?.with_destination)} size="compact" />
        <StatCard icon={Users} label={t('panel.accounts')} value={n(totals?.accounts)} size="compact" />
        <StatCard
          icon={Hourglass}
          label={t('panel.trip_hours_credited')}
          value={n(totals?.trip_hours_credited)}
          subtitle={t('panel.trip_hours_hint')}
          size="compact"
        />
        <StatCard icon={MailX} label={t('panel.email_stopped')} value={n(load.data.email_reminders_stopped)} size="compact" />
      </StatCardRow>

      <section aria-labelledby="trip-answers">
        <h2 id="trip-answers" className="mb-2 text-lg font-bold text-gray-900 dark:text-gray-100">
          {t('panel.answers_heading')}
        </h2>
        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {ANSWERS.map((answer) => (
            <div key={answer} className="rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-gray-800 dark:bg-gray-900">
              <dt className={`text-xs ${DIM}`}>{t(`panel.answers.${answer}`)}</dt>
              <dd className="text-xl font-bold tabular-nums text-gray-900 dark:text-gray-100">{n(answers?.[answer])}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="trip-destinations">
        <h2 id="trip-destinations" className="text-lg font-bold text-gray-900 dark:text-gray-100">
          {t('panel.by_destination_heading')}
        </h2>
        <p className={`mb-2 text-sm ${DIM}`}>{t('panel.by_destination_intro')}</p>
        {rows?.length ? (
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={HEAD_SOLO}>{t('panel.month')}</th>
                  <th className={HEAD_SOLO}>{t('panel.destination')}</th>
                  <th className={HEAD_SOLO_NUM}>{t('panel.trips_column')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={`${row.month}-${row.country_code}-${row.city}-${index}`} className="border-t border-gray-100 dark:border-gray-800">
                    <td className={`${CELL} whitespace-nowrap`}>{formatMonth(row.month) ?? <span className={DIM}>{t('panel.no_date')}</span>}</td>
                    <td className={CELL}>
                      {row.country_code ? (
                        <span className="inline-flex flex-wrap items-center gap-x-2">
                          <CountryFlag code={row.country_code} withName />
                          {row.city ? <span>· {row.city}</span> : null}
                        </span>
                      ) : (
                        <span className={DIM}>{t('panel.no_destination')}</span>
                      )}
                    </td>
                    <td className={NUM}>{n(row.trips)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={`text-sm ${DIM}`}>{t('panel.empty')}</p>
        )}
      </section>

      <section aria-labelledby="trip-contacts">
        <h2 id="trip-contacts" className="text-lg font-bold text-gray-900 dark:text-gray-100">
          {t('panel.contacts_heading')}
        </h2>
        <p className={`mb-2 text-sm ${DIM}`}>{t('panel.contacts_intro')}</p>
        {contacts?.length ? (
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={HEAD_SOLO}>{t('panel.channel')}</th>
                  <th className={HEAD_SOLO}>{t('panel.state')}</th>
                  <th className={HEAD_SOLO}>{t('panel.stopped')}</th>
                  <th className={HEAD_SOLO_NUM}>{t('panel.contacts')}</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((row, index) => (
                  <tr key={`${row.channel}-${row.delivery_state}-${row.stopped}-${index}`} className="border-t border-gray-100 dark:border-gray-800">
                    <td className={CELL}>
                      {row.channel ? (t.has(`channels.${row.channel}`) ? t(`channels.${row.channel}`) : row.channel) : t('panel.no_channel_yet')}
                    </td>
                    <td className={CELL}>
                      {KNOWN_STATES.includes(row.delivery_state) ? t(`panel.states.${row.delivery_state}`) : row.delivery_state}
                    </td>
                    <td className={CELL}>{row.stopped ? t('panel.yes') : t('panel.no')}</td>
                    <td className={NUM}>{n(row.contacts)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={`text-sm ${DIM}`}>{countFormat.format(0)}</p>
        )}
      </section>
    </div>
  )
}
