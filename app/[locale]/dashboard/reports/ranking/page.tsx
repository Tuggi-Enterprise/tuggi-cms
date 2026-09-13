'use client'

/**
 * THE SCORING SCOREBOARD — `/dashboard/reports/ranking` (#741, phase 1 of epic #737).
 *
 * The screen the operator uses to decide whether the scoring design produces an order that makes
 * sense. It only serves that purpose if the three comparisons the server already brings for free
 * sit next to the official number, and if the fragile labels do not lie.
 *
 * THE FRAME IS THE FIRST THING, and it is what prevents the error the contract predicts by name:
 * aggregating without filtering `period_kind`. Exactly one period is selected, always, and there
 * is no aggregating option — `DS-COMPONENTE-082` item 1. The selection travels in the URL because
 * the operator has to be able to paste the address of the week he is checking.
 *
 * THE INTERNAL-ACCOUNT FILTER IS THE DEFAULT AND IT IS ON. Without it the first thing he sees is
 * himself in first place with 22,1% of the points (#740). The switch is `Incluir contas internas`
 * and it is born OFF; the exclusion is the mark on the profile, never a list of ids
 * (#740: *"filtrar IDs é um erro"*).
 *
 * Access needs nothing new: `/dashboard/*` is already admin in `lib/navigation/access.ts`, and
 * the two routes carry `withAuth({ roles: ['admin'] })` plus the service client, which is the
 * only client the views answer.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { Gauge, Trophy } from 'lucide-react'
import { ReportTabs } from '@/components/dashboard/ReportTabs'
import { RankingScoreboard } from '@/components/dashboard/reports/RankingScoreboard'
import { RankingSessionMetering } from '@/components/dashboard/reports/RankingSessionMetering'
import { rankingService, type ScoreboardPayload } from '@/lib/services/ranking-service'
import type { RpcError } from '@/lib/api/dashboard-fetch'
import { appUserLabel } from '@/lib/format/user-identity'
import {
  isCurrentPeriod,
  matchesPeriod,
  parsePeriodParam,
  periodBounds,
  periodKey,
  type PeriodKind,
  type PeriodOption,
  type SessionMeteringRow,
} from '@/lib/ranking/scoreboard'

type Tab = 'scoreboard' | 'metering'

export default function RankingReportPage() {
  const t = useTranslations('Pages.Dashboard')
  const tr = useTranslations('Pages.Dashboard.ranking')
  const locale = useLocale()
  const router = useRouter()
  const searchParams = useSearchParams()

  const [tab, setTab] = useState<Tab>(
    searchParams.get('tab') === 'metering' ? 'metering' : 'scoreboard'
  )
  const [period, setPeriod] = useState(() =>
    parsePeriodParam(searchParams.get('period'), searchParams.get('start'))
  )
  const [includeInternal, setIncludeInternal] = useState(false)

  const [payload, setPayload] = useState<ScoreboardPayload | null>(null)
  const [scoreboardError, setScoreboardError] = useState<RpcError | null>(null)
  const [isLoadingScoreboard, setIsLoadingScoreboard] = useState(true)

  const [sessions, setSessions] = useState<SessionMeteringRow[]>([])
  const [sessionsError, setSessionsError] = useState<RpcError | null>(null)
  const [isLoadingSessions, setIsLoadingSessions] = useState(false)
  const [personFilter, setPersonFilter] = useState<{ userId: string; label: string } | null>(null)

  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setIsLoadingScoreboard(true)
      const { data, error } = await rankingService.getScoreboard(period)
      if (cancelled) return
      setPayload(data)
      // The WHOLE failure goes down, not its text: the phrase that names `42501` is chosen by
      // the SQLSTATE, which a `PostgrestError` keeps in `code` and never in `message` (#755).
      setScoreboardError(error)
      setIsLoadingScoreboard(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [period, reloadToken])

  useEffect(() => {
    if (tab !== 'metering') return
    let cancelled = false

    const load = async () => {
      setIsLoadingSessions(true)
      const { data, error } = await rankingService.getSessionMetering(personFilter?.userId ?? null)
      if (cancelled) return
      setSessions(data?.rows ?? [])
      setSessionsError(error)
      setIsLoadingSessions(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [tab, personFilter, reloadToken])

  /** The URL carries the reading, so it can be pasted — `reports/users` already does it with `?tab=`. */
  const syncUrl = useCallback(
    (next: { tab: Tab; period: { kind: PeriodKind; start: string | null } }) => {
      const params = new URLSearchParams()
      if (next.tab === 'metering') params.set('tab', 'metering')
      params.set('period', next.period.kind)
      if (next.period.kind === 'week' && next.period.start) params.set('start', next.period.start)
      router.replace(`?${params.toString()}`, { scroll: false })
    },
    [router]
  )

  /** Its own memo: a fresh `[]` on every render would re-run the memo that reads it. */
  const options = useMemo(() => payload?.periods ?? [], [payload])

  const selected = useMemo(
    () => options.find((option) => matchesPeriod(option.kind, option.start, period)) ?? null,
    [options, period]
  )

  const label = useCallback(
    (option: PeriodOption) => {
      if (option.kind !== 'week') return tr(`period.${option.kind}`)

      const { start, endInclusive } = periodBounds(option)
      // UTC in the formatter AND in the label: the boundary of the week is UTC by decision, with
      // a known edge (22h in São Paulo counts on the next UTC day). While the timezone is an open
      // question for the operator, the marker is what stops the screen claiming a zone it does
      // not use (contract, Parte 7).
      const date = new Intl.DateTimeFormat(locale, {
        day: '2-digit',
        month: '2-digit',
        timeZone: 'UTC',
      })

      return tr(isCurrentPeriod(option) ? 'period.week_current' : 'period.week', {
        start: date.format(start),
        end: date.format(endInclusive),
      })
    },
    [locale, tr]
  )

  const selectedLabel = selected ? label(selected) : tr(`period.${period.kind}`)

  const openSessions = (row: { user_id: string; nickname: string | null }) => {
    setPersonFilter({ userId: row.user_id, label: appUserLabel(row) })
    setTab('metering')
    syncUrl({ tab: 'metering', period })
  }

  return (
    <div className="cms-width p-6 lg:p-8 space-y-6 min-h-screen bg-gray-50 dark:bg-gray-950">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center">
          <Trophy className="mr-3 h-8 w-8 text-tuggi-purple" />
          {t('reports.ranking.title')}
        </h1>
        <p className="text-gray-500">{t('reports.ranking.subtitle')}</p>
      </div>

      {/* The frame sits at the height of the tabs: one period, always exactly one, and the
          switch that is already on. Neither depends on the response, so both stay live while
          the table is loading. */}
      <div className="flex flex-wrap items-center gap-4">
        <ReportTabs
          tabs={[
            { key: 'scoreboard', label: tr('tabs.scoreboard'), icon: Trophy },
            { key: 'metering', label: tr('tabs.metering'), icon: Gauge },
          ]}
          active={tab}
          onChange={(key) => {
            const next = key === 'metering' ? 'metering' : 'scoreboard'
            setTab(next)
            syncUrl({ tab: next, period })
          }}
        />

        <div className="ml-auto flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-[11px] font-medium text-gray-600 dark:text-gray-400">
            {tr('period.label')}
            <select
              value={periodKey(period)}
              onChange={(event) => {
                const [kind, start] = event.target.value.split(':')
                const next = { kind: kind as PeriodKind, start: start ?? null }
                setPeriod(next)
                syncUrl({ tab, period: next })
              }}
              className="min-h-[28px] rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            >
              {/* No aggregating option exists, and that is the rule, not an omission. */}
              {options.length === 0 && (
                <option value={periodKey(period)}>{selectedLabel}</option>
              )}
              {options.map((option) => (
                <option key={periodKey(option)} value={periodKey(option)}>
                  {label(option)}
                </option>
              ))}
            </select>
          </label>

          {/* The line that says the indicators ignore internal accounts is NOT here any more:
              it is the ruler of the six numbers, so it lives glued to them, inside
              `RankingScoreboard` right above `StatCardRow` (#753, `DS-COPY-062` item 3). Next
              to this switch it sat ~200px from the contradiction it explains. */}
          <label className="flex items-center gap-2 text-[11px] font-medium text-gray-600 dark:text-gray-400">
            <input
              type="checkbox"
              checked={includeInternal}
              onChange={(event) => setIncludeInternal(event.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-tuggi-blue focus:ring-tuggi-blue dark:border-gray-700"
            />
            {tr('internal.toggle')}
            {/* The SWITCH does not depend on the response and stays live (spec §7.1); the count
                beside it does — it reads `N contas marcadas nesta consulta`, and with the read
                failed there is no consulta, while `?? 0` asserts one anyway (#741). The switch
                without the count is honest; the count is the sentence that has to go. */}
            {!scoreboardError && (
              <span className="text-gray-500 dark:text-gray-400">
                {tr('internal.marked', { count: payload?.internalAccounts ?? 0 })}
              </span>
            )}
          </label>
        </div>
      </div>

      {tab === 'scoreboard' ? (
        <RankingScoreboard
          rows={payload?.rows ?? []}
          period={selected}
          periodLabel={selectedLabel}
          includeInternal={includeInternal}
          internalAccounts={payload?.internalAccounts ?? 0}
          isLoading={isLoadingScoreboard}
          error={scoreboardError}
          onRetry={() => setReloadToken((token) => token + 1)}
          onOpenSessions={openSessions}
        />
      ) : (
        <RankingSessionMetering
          rows={sessions}
          includeInternal={includeInternal}
          isLoading={isLoadingSessions}
          error={sessionsError}
          onRetry={() => setReloadToken((token) => token + 1)}
          personFilter={personFilter}
          onClearPerson={() => setPersonFilter(null)}
        />
      )}
    </div>
  )
}
