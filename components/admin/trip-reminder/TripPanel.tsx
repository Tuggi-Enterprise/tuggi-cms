'use client'

/**
 * Painel tab of `/admin/trip-reminder` (#1233): `drive.cms_get_planned_trips_panel()`, through
 * `normalizePlannedTripsPanel` on the route. BR-USUARIO-055 item 6.c: counts only. The read has no
 * person and no phone number, and this block prints nothing that is not a count, a month, a
 * destination, a length band or a channel. #1238: an account may have many trips, each counted, and
 * every row and total is split by the band the person picked (BR-MONETIZACAO-091 2.a).
 * #1275/#1276: the wished destinations (BR-USUARIO-055 item 11) are a block of their own, never mixed
 * with the trips: a wish is not a trip. #1281: by place and month (item 11.e). #1284: the wish of any
 * permanent account, with any answer or none, with a trip or none (item 11.a).
 *
 * The one exception to "counts only" is the last block, `TripNowCredits` (#1281, BR-MONETIZACAO-091
 * item 8.2): who got the hours of "estou viajando agora", by the email of the account. It has its own
 * route and read, so the counts and the list load and fail apart.
 */

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { CalendarClock, CalendarDays, Heart, Hourglass, MailX, MapPin, Users } from 'lucide-react'
import { CountryFlag } from '@/components/ui/CountryFlag'
import { StatCard, StatCardRow } from '@/components/ui/StatCard'
import { CELL, DIM, HEAD_SOLO, HEAD_SOLO_NUM, NUM } from '@/components/ui/dense-table'
import { DURATION_BANDS, type PlannedTripsPanel, type TripAdminError } from '@/lib/trip-reminder/settings'
import { bandName as nameOfBand, countFormat, formatMonth } from './format'
import { ReadFailure } from './ReadFailure'
import { TripNowCredits } from './TripNowCredits'

type Load =
  | { state: 'loading' }
  | { state: 'error'; error: TripAdminError | null }
  | { state: 'ready'; data: PlannedTripsPanel }

const ANSWERS = ['planned', 'now', 'unsure'] as const
const BAND_TOTALS = [...DURATION_BANDS, 'none'] as const
const KNOWN_STATES = ['pending', 'confirmed', 'no_channel', 'undeliverable']

export function TripPanel() {
  return (
    <div className="space-y-8">
      <PlannedTripsCounts />
      <TripNowCredits />
    </div>
  )
}

function PlannedTripsCounts() {
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
      <ReadFailure
        error={load.error}
        onRetry={() => {
          setLoad({ state: 'loading' })
          void fetchPanel()
        }}
      />
    )
  }

  const { totals, answers, by_destination_month: rows, contacts_by_channel: contacts, wishes_by_destination: wishes } = load.data
  const n = (value: number | undefined) => countFormat.format(Number(value ?? 0))
  const bandName = (band: string | null) => nameOfBand(t, band)

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

      <section aria-labelledby="trip-bands">
        <h2 id="trip-bands" className="mb-2 text-lg font-bold text-gray-900 dark:text-gray-100">
          {t('panel.by_duration_heading')}
        </h2>
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {BAND_TOTALS.map((band) => (
            <div key={band} className="rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-gray-800 dark:bg-gray-900">
              <dt className={`text-xs ${DIM}`}>{bandName(band)}</dt>
              <dd className="text-xl font-bold tabular-nums text-gray-900 dark:text-gray-100">{n(totals?.by_duration_band?.[band])}</dd>
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
                  <th className={HEAD_SOLO}>{t('panel.duration')}</th>
                  <th className={HEAD_SOLO_NUM}>{t('panel.trips_column')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={`${row.month}-${row.country_code}-${row.city}-${row.duration_band}-${index}`} className="border-t border-gray-100 dark:border-gray-800">
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
                    <td className={CELL}>
                      {row.duration_band === null ? <span className={DIM}>{bandName(null)}</span> : bandName(row.duration_band)}
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

      <section aria-labelledby="trip-wishes">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="trip-wishes" className="text-lg font-bold text-gray-900 dark:text-gray-100">
            {t('panel.wishes_heading')}
          </h2>
          <span className="inline-flex items-center gap-1 text-sm font-semibold tabular-nums text-gray-900 dark:text-gray-100">
            <Heart className="h-4 w-4" aria-hidden="true" />
            {t('panel.wishes')}: {n(totals?.wishes)}
          </span>
        </div>
        <p className={`mb-2 text-sm ${DIM}`}>{t('panel.wishes_intro')}</p>
        {wishes?.length ? (
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={HEAD_SOLO}>{t('panel.wishes_month')}</th>
                  <th className={HEAD_SOLO}>{t('panel.destination')}</th>
                  <th className={HEAD_SOLO_NUM}>{t('panel.wishes_column')}</th>
                </tr>
              </thead>
              <tbody>
                {wishes.map((row, index) => (
                  <tr key={`${row.month}-${row.country_code}-${row.city}-${index}`} className="border-t border-gray-100 dark:border-gray-800">
                    <td className={`${CELL} whitespace-nowrap`}>
                      {formatMonth(row.month) ?? <span className={DIM}>{t('panel.wishes_no_month')}</span>}
                    </td>
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
                    <td className={NUM}>{n(row.wishes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={`text-sm ${DIM}`}>{t('panel.wishes_empty')}</p>
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
