'use client'

/**
 * ROUTE PROGRESS — `/dashboard/reports/route-progress` (#794).
 *
 * Per route: how many users started, are in progress and completed it; pick a route and the list
 * per user comes below. Completion is "all stops", decided in the database — this screen only
 * prints what `core.admin_get_custom_route_progress_*` return, through
 * `app/api/dashboard/route-progress` (admin gate + session client).
 *
 * The tourist is identified by `appUserLabel` — BR-USUARIO-042: nickname, never the e-mail.
 * Access needs nothing new: `/dashboard/*` is admin in `lib/navigation/access.ts`.
 */

import { useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Flag } from 'lucide-react'
import { CELL, DenseTableScroller, DIM, HEAD, HEAD_NUM, NUM } from '@/components/ui/dense-table'
import { AppUserLink } from '@/components/dashboard/AppUserLink'
import { fetchDashboardRoute, type RpcError } from '@/lib/api/dashboard-fetch'
import { UNKNOWN_VALUE } from '@/lib/format/unknown'
import type { RouteProgressSummaryRow, RouteProgressUserRow } from '@/lib/routes/route-progress'

const CARD =
  'overflow-hidden rounded-3xl border border-gray-200 bg-white/70 shadow-2xl shadow-black/5 backdrop-blur-xl dark:border-gray-800 dark:bg-gray-900/70'

function ErrorLine({ error, t }: { error: RpcError; t: (key: string) => string }) {
  return (
    <p role="alert" className="px-5 py-4 text-sm text-red-700 dark:text-red-400">
      {error.code === '42501' ? t('error_forbidden') : `${t('error_generic')}: ${error.message}`}
    </p>
  )
}

export default function RouteProgressReportPage() {
  const t = useTranslations('Pages.Dashboard.route_progress')
  const locale = useLocale()

  const [summary, setSummary] = useState<RouteProgressSummaryRow[]>([])
  const [summaryError, setSummaryError] = useState<RpcError | null>(null)
  const [isLoadingSummary, setIsLoadingSummary] = useState(true)

  const [selected, setSelected] = useState<RouteProgressSummaryRow | null>(null)
  const [users, setUsers] = useState<RouteProgressUserRow[]>([])
  const [usersError, setUsersError] = useState<RpcError | null>(null)
  const [isLoadingUsers, setIsLoadingUsers] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchDashboardRoute<{ summary: RouteProgressSummaryRow[] }>('/api/dashboard/route-progress').then(
      ({ data, error }) => {
        if (cancelled) return
        setSummary(data?.summary ?? [])
        setSummaryError(error)
        setIsLoadingSummary(false)
      }
    )
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!selected) return
    let cancelled = false
    fetchDashboardRoute<{ users: RouteProgressUserRow[] }>(
      `/api/dashboard/route-progress?routeId=${encodeURIComponent(selected.route_id)}`
    ).then(({ data, error }) => {
      if (cancelled) return
      setUsers(data?.users ?? [])
      setUsersError(error)
      setIsLoadingUsers(false)
    })
    return () => {
      cancelled = true
    }
  }, [selected])

  const date = (value: string | null) =>
    value == null
      ? UNKNOWN_VALUE
      : new Intl.DateTimeFormat(locale, {
          day: '2-digit',
          month: '2-digit',
          year: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        }).format(new Date(value))

  return (
    <div className="cms-width p-6 space-y-4 min-h-screen bg-gray-50 dark:bg-gray-950">
      <h1 className="flex items-center text-lg font-semibold text-gray-900 dark:text-white">
        <Flag className="mr-2 h-5 w-5 text-tuggi-purple" />
        {t('title')}
      </h1>
      <p className={`text-[11px] ${DIM}`}>{t('caption')}</p>

      <section className={CARD}>
        {summaryError ? (
          <ErrorLine error={summaryError} t={t} />
        ) : (
          <DenseTableScroller maxHeightClassName="max-h-[40vh]">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th scope="col" className={HEAD}>{t('route')}</th>
                  <th scope="col" className={HEAD_NUM}>{t('started')}</th>
                  <th scope="col" className={HEAD_NUM}>{t('in_progress')}</th>
                  <th scope="col" className={HEAD_NUM}>{t('completed')}</th>
                </tr>
              </thead>
              <tbody>
                {isLoadingSummary ? (
                  <tr><td colSpan={4} className={`${CELL} ${DIM}`}>{t('loading')}</td></tr>
                ) : summary.length === 0 ? (
                  <tr><td colSpan={4} className={`${CELL} ${DIM}`}>{t('empty_summary')}</td></tr>
                ) : (
                  summary.map((row) => {
                    const isSelected = selected?.route_id === row.route_id
                    return (
                      <tr
                        key={row.route_id}
                        className={`border-t border-gray-100 dark:border-gray-800 ${
                          isSelected ? 'bg-tuggi-blue/10' : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
                        }`}
                      >
                        <td className={CELL}>
                          <button
                            type="button"
                            onClick={() => {
                              if (isSelected) return
                              setIsLoadingUsers(true)
                              setSelected(row)
                            }}
                            aria-pressed={isSelected}
                            className="min-h-[24px] text-left font-medium underline-offset-2 hover:underline"
                          >
                            {row.route_name}
                          </button>
                        </td>
                        <td className={NUM}>{row.started_count}</td>
                        <td className={NUM}>{row.in_progress_count}</td>
                        <td className={NUM}>{row.completed_count}</td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </DenseTableScroller>
        )}
      </section>

      {selected && (
        <section className={CARD}>
          <header className="border-b border-gray-200 px-5 py-3 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:text-white">
            {t('users_of', { route: selected.route_name })}
          </header>
          {usersError ? (
            <ErrorLine error={usersError} t={t} />
          ) : (
            <DenseTableScroller>
              <table className="w-full min-w-[860px] border-collapse">
                <thead>
                  <tr>
                    <th scope="col" className={HEAD}>{t('person')}</th>
                    <th scope="col" className={HEAD}>{t('status')}</th>
                    <th scope="col" className={HEAD_NUM}>{t('stops')}</th>
                    <th scope="col" className={HEAD}>{t('started_at')}</th>
                    <th scope="col" className={HEAD}>{t('last_activity_at')}</th>
                    <th scope="col" className={HEAD}>{t('completed_at')}</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoadingUsers ? (
                    <tr><td colSpan={6} className={`${CELL} ${DIM}`}>{t('loading')}</td></tr>
                  ) : users.length === 0 ? (
                    <tr><td colSpan={6} className={`${CELL} ${DIM}`}>{t('empty_users')}</td></tr>
                  ) : (
                    users.map((row) => (
                      <tr key={row.user_id} className="border-t border-gray-100 dark:border-gray-800">
                        <td className={CELL}>
                          <AppUserLink user={row} />
                        </td>
                        <td className={CELL}>
                          {row.status === 'completed' ? t('status_completed') : t('status_in_progress')}
                        </td>
                        <td className={NUM}>
                          {row.reached_count}/{row.total_waypoints}
                        </td>
                        <td className={`${CELL} whitespace-nowrap`}>{date(row.started_at)}</td>
                        <td className={`${CELL} whitespace-nowrap`}>{date(row.last_activity_at)}</td>
                        <td className={`${CELL} whitespace-nowrap`}>{date(row.completed_at)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </DenseTableScroller>
          )}
        </section>
      )}
    </div>
  )
}
