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
  formatMonthOfCycle,
  hasAnchoredStart,
  isCurrentPeriod,
  matchesPeriod,
  parsePeriodKey,
  parsePeriodParam,
  periodBounds,
  periodGroups,
  periodKey,
  periodNature,
  periodOfSelection,
  yearOfCycle,
  type PeriodSelection,
  type SessionMeteringRow,
} from '@/lib/ranking/scoreboard'
import { UNKNOWN_VALUE } from '@/lib/format/unknown'

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
    (next: { tab: Tab; period: PeriodSelection }) => {
      const params = new URLSearchParams()
      if (next.tab === 'metering') params.set('tab', 'metering')
      params.set('period', next.period.kind)
      // The three anchored kinds carry their start; `month` and `year` are pasteable for the same
      // reason a week is (spec §2.3) — `?period=month&start=2026-09-01`.
      if (hasAnchoredStart(next.period.kind) && next.period.start)
        params.set('start', next.period.start)
      router.replace(`?${params.toString()}`, { scroll: false })
    },
    [router]
  )

  /** Its own memo: a fresh `[]` on every render would re-run the memo that reads it. */
  const options = useMemo(() => payload?.periods ?? [], [payload])

  /**
   * THE TWO `<optgroup>`s — `DS-COMPONENTE-089` item 1, and no component is born for it.
   *
   * `<optgroup label>` is the HTML mechanism for "a group of `option` elements with a common
   * label" (HTML Living Standard) and it is what a screen reader announces together with the
   * option. A flat list of fifteen items in which `Últimos 30 dias` and `Setembro de 2026` are
   * neighbours of the same height says, by omission, that they are the same species of thing —
   * and the error that produces is not a misread number, it is calibrating the coefficient of
   * **BR-RANKING-004** on a window that has no roster, no floor and no podium.
   */
  const groups = useMemo(() => periodGroups(options), [options])

  const selected = useMemo(
    () => options.find((option) => matchesPeriod(option.kind, option.start, period)) ?? null,
    [options, period]
  )

  /**
   * The label of ANY period, and it takes the selection — `{ kind, start }` — rather than an
   * option out of the reading.
   *
   * It used to take a `PeriodOption`, which only exists after the round trip, and the selected
   * period fell back to `tr(\`period.${period.kind}\`)` while the reading was in flight. For a
   * week that is a key with two parameters called with none, and the screen died on the first
   * paint of a pasted `?period=week` (#741). Now there is no second path to label a period: the
   * two rolling keys take no parameters, the week keys take their two ALWAYS, and no future
   * parameterised key can fall into the same hole.
   */
  const label = useCallback(
    (selection: PeriodSelection) => {
      if (!hasAnchoredStart(selection.kind)) return tr(`period.${selection.kind}`)

      const cycle = periodOfSelection(selection)
      const current = cycle !== null && isCurrentPeriod(cycle)

      /* THE MONTH ARRIVES ALREADY FORMATTED AND ALREADY CAPITALISED — `formatMonthOfCycle` owns
         both, because the `<select>`, the stamp and the `<caption>` print the same month and a
         second `Intl.DateTimeFormat` typed here would be a second owner of it
         (`DS-COMPONENTE-085` item 4, spec §6.9). */
      if (selection.kind === 'month') {
        return tr(current ? 'period.month_current' : 'period.month', {
          month: formatMonthOfCycle(selection.start ?? '', locale),
        })
      }

      if (selection.kind === 'year') {
        return tr(current ? 'period.year_current' : 'period.year', {
          year: yearOfCycle(selection.start ?? ''),
        })
      }

      const week = cycle
      const bounds = week && periodBounds(week)
      // UTC in the formatter AND in the label: the boundary of the week is UTC by decision, with
      // a known edge (22h in São Paulo counts on the next UTC day). While the timezone is an open
      // question for the operator, the marker is what stops the screen claiming a zone it does
      // not use (contract, Parte 7).
      const date = new Intl.DateTimeFormat(locale, {
        day: '2-digit',
        month: '2-digit',
        timeZone: 'UTC',
      })

      return tr(current ? 'period.week_current' : 'period.week', {
        start: bounds ? date.format(bounds.start) : UNKNOWN_VALUE,
        end: bounds ? date.format(bounds.endInclusive) : UNKNOWN_VALUE,
      })
    },
    [locale, tr]
  )

  const selectedLabel = label(period)

  /**
   * THE PERIOD THE QUERY SERVED, which is not always the one the operator asked for.
   *
   * The route parses the parameter with the same ruler the screen does and falls back silently on
   * an unusable one (`parsePeriodParam`), then answers which period it settled on. This page read
   * that field nowhere: it labelled every number by the period in STATE — the request — so a
   * fallback, a stale response or a request still in flight all wore the label of the question.
   * `payload.period` is the answer, and the scoreboard stamps the answer (#741).
   */
  const served = useMemo(
    () => (payload ? { period: payload.period, label: label(payload.period) } : null),
    [payload, label]
  )

  const openSessions = (row: { user_id: string; nickname: string | null }) => {
    setPersonFilter({ userId: row.user_id, label: appUserLabel(row) })
    setTab('metering')
    syncUrl({ tab: 'metering', period })
  }

  return (
    <div className="cms-width p-6 space-y-4 min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* RELATÓRIO INTERNO NÃO TEM MANCHETE — §11.2. A régua tipográfica é que **o `h1` nunca é
          maior que o valor de um `StatCard`**: o maior tipo da tela é um dado, e era o contrário.
          O carimbo sobe para esta linha porque ele é legenda do título, e não um sexto bloco
          empilhado entre o cabeçalho e os números. */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="flex items-center text-lg font-semibold text-gray-900 dark:text-white">
          <Trophy className="mr-2 h-5 w-5 text-tuggi-purple" />
          {t('reports.ranking.title')}
        </h1>
        {/* O CARIMBO É DO PERÍODO QUE A CONSULTA SERVIU, não do que o `<select>` mostra: um
            controle lê como *o que eu pedi*, nunca como *o que eu recebi* (#741). E a NATUREZA
            viaja com ele — `DS-COMPONENTE-089` item 2 —, da mesma `periodNature` que agrupa o
            `<select>`, nunca de um `if` escrito uma segunda vez aqui.

            Precisa de uma leitura para carimbar: com nenhuma servida, ou com outra em voo, o
            período e a contagem seriam a resposta anterior vestindo a cara da nova. E só na aba
            do placar — a aba 2 é uma lista de sessões e não tem período. */}
        {tab === 'scoreboard' && scoreboardError === null && served && !isLoadingScoreboard && (
          <p className="text-[11px] font-medium text-gray-600 dark:text-gray-300">
            {tr('period.stamp', {
              period: served.label,
              nature: tr(`period.nature_${periodNature(served.period.kind)}`),
              count: payload?.rows.length ?? 0,
            })}
          </p>
        )}
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
                // The key is read by its OWNER and never cut open here: the week carries an ISO
                // instant, whose own colons made a split of the key keep `2026-08-17T00` as the
                // start — unreadable, so every week picked fell into the default window (#741).
                const next = parsePeriodKey(event.target.value)
                setPeriod(next)
                syncUrl({ tab, period: next })
              }}
              className="min-h-[28px] rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            >
              {/* No aggregating option exists, and that is the rule, not an omission.

                  The selection gets an option of its own whenever the reading does not contain
                  it — before the read lands, and for a week that is older than the 13-week
                  horizon the view serves. Without it the `<select>` has a `value` that matches
                  no option, and the browser shows the FIRST one: the control would say
                  `Últimos 30 dias` over a table filtered by the week in the URL. */}
              {selected === null && <option value={periodKey(period)}>{selectedLabel}</option>}
              {/* TWO GROUPS, COMPETITION FIRST — `DS-COMPONENTE-089` item 1. `week`, `month` and
                  `year` have a roster, a floor and a podium; the two rolling windows never were
                  competition (**BR-RANKING-001** item 5) and exist to check a number. The nature
                  of each has ONE owner, `periodNature` in `lib/ranking/scoreboard.ts`, which is
                  also what the stamp beside the numbers reads — an `if` on the two rolling keys
                  written a second time here is how the two surfaces start disagreeing. */}
              {groups.map((group) => (
                <optgroup key={group.nature} label={tr(`period.group_${group.nature}`)}>
                  {group.options.map((option) => (
                    <option key={periodKey(option)} value={periodKey(option)}>
                      {label(option)}
                    </option>
                  ))}
                </optgroup>
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
          selection={period}
          served={served}
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
