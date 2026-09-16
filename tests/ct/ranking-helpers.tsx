/**
 * The host of the scoreboard table, as `app/[locale]/dashboard/reports/ranking/page.tsx` is —
 * the switch in `useState`, the rows handed down, nothing else.
 *
 * A component mounted by Playwright CT has to be exported from a module (JSX declared inside a
 * `.spec` is not mountable), and the switch has to live in the harness because it is the page
 * that owns it: the assertion "the filter is the default" is about what the operator gets
 * WITHOUT touching anything, so the harness reproduces the page's initial state and not a prop.
 */

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Gauge, Trophy } from 'lucide-react'
import { ReportTabs } from '@/components/dashboard/ReportTabs'
import { RankingScoreboard } from '@/components/dashboard/reports/RankingScoreboard'
import type { RpcError } from '@/lib/api/dashboard-fetch'
import { hasAnchoredStart } from '@/lib/ranking/scoreboard'
import type {
  PeriodOption,
  PeriodSelection,
  RankingRow,
} from '@/lib/ranking/scoreboard'
import { FIELD_ROWS, ROWS, WEEK } from './ranking-fixtures'

const WEEK_LABEL = 'Semana de 31/08 a 06/09 · UTC'

/** The selection an option came from — the page holds the two separately (#741). */
function selectionOf(period: PeriodOption): PeriodSelection {
  // The THREE anchored kinds carry their start since #742: a month is pasteable for the same
  // reason a week is, and the two rolling windows have no boundary to carry.
  return { kind: period.kind, start: hasAnchoredStart(period.kind) ? period.start : null }
}

export function RankingScoreboardHarness({
  rows = ROWS,
  period = WEEK,
  /** What the operator ASKED for. Defaults to the selection the served option came from. */
  selection,
  /** What the query ANSWERED. `null` reproduces a read that has not landed or has failed. */
  served,
  periodLabel = WEEK_LABEL,
  internalAccounts = 1,
  isLoading = false,
  error = null,
}: {
  rows?: RankingRow[]
  /** `null` is the week older than the 13-week horizon: the reading has no option for it. */
  period?: PeriodOption | null
  selection?: PeriodSelection
  served?: { period: PeriodSelection; label: string } | null
  periodLabel?: string
  internalAccounts?: number
  isLoading?: boolean
  /** The failure as `fetchDashboardRoute` hands it over — `code` is what names `42501` (#755). */
  error?: RpcError | null
}) {
  /** The page's initial state, reproduced: the switch is born OFF. */
  const [includeInternal, setIncludeInternal] = useState(false)

  const asked = selection ?? selectionOf(period ?? WEEK)
  const answered =
    served === undefined ? { period: asked, label: periodLabel } : served

  return (
    <div className="p-4">
      <label>
        <input
          type="checkbox"
          data-testid="include-internal"
          checked={includeInternal}
          onChange={(event) => setIncludeInternal(event.target.checked)}
        />
        Incluir contas internas
      </label>
      <RankingScoreboard
        rows={rows}
        period={period}
        periodLabel={periodLabel}
        selection={asked}
        served={answered}
        includeInternal={includeInternal}
        internalAccounts={internalAccounts}
        isLoading={isLoading}
        error={error}
        onRetry={() => {}}
        onOpenSessions={() => {}}
      />
    </div>
  )
}

/**
 * THE WHOLE PAGE, AS THE OPERATOR MEETS IT — the bench of §11's single criterion.
 *
 * The criterion is geometric (`getBoundingClientRect().bottom ≤ 900` at 1440 × 900) and geometry
 * is a property of the PAGE, not of the scoreboard: the header, the tabs row and the period
 * control are above every pixel the criterion counts, so measuring `RankingScoreboard` alone
 * would answer a question nobody asked. There is no page navigation to be had here —
 * `playwright-ct.config.ts` says why — so this reproduces the frame of
 * `app/[locale]/dashboard/reports/ranking/page.tsx`: the same wrapper classes, the same `h1`, the
 * same `ReportTabs`, the same `<select>` and the same switch.
 *
 * IT IS A REPRODUCTION, AND THAT IS ITS ONE WEAKNESS. The four classes §11.2 changed in the page
 * — `space-y-4`, `p-6`, `text-lg`, `h-5 w-5` — are pinned against the page's own source in
 * `tests/api/ranking-surface.test.ts`, so the frame cannot drift here while the page keeps the
 * old one and the measurement keeps going green.
 */
export function RankingPageHarness({
  rows = FIELD_ROWS,
  period = WEEK,
  periodLabel = WEEK_LABEL,
  internalAccounts = 0,
}: {
  rows?: RankingRow[]
  period?: PeriodOption | null
  periodLabel?: string
  internalAccounts?: number
}) {
  const t = useTranslations('Pages.Dashboard')
  const tr = useTranslations('Pages.Dashboard.ranking')
  const [includeInternal, setIncludeInternal] = useState(false)

  const asked = selectionOf(period ?? WEEK)
  const served = { period: asked, label: periodLabel }

  return (
    <div className="cms-width p-6 lg:p-8 space-y-6 min-h-screen bg-gray-50">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center">
          <Trophy className="mr-3 h-8 w-8 text-tuggi-purple" />
          {t('reports.ranking.title')}
        </h1>
        <p className="text-gray-500">{t('reports.ranking.subtitle')}</p>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <ReportTabs
          tabs={[
            { key: 'scoreboard', label: tr('tabs.scoreboard'), icon: Trophy },
            { key: 'metering', label: tr('tabs.metering'), icon: Gauge },
          ]}
          active="scoreboard"
          onChange={() => {}}
        />
        <div className="ml-auto flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-[11px] font-medium text-gray-600">
            {tr('period.label')}
            <select
              value="scoreboard"
              onChange={() => {}}
              className="min-h-[28px] rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900"
            >
              <option value="scoreboard">{periodLabel}</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-[11px] font-medium text-gray-600">
            <input
              type="checkbox"
              data-testid="include-internal"
              checked={includeInternal}
              onChange={(event) => setIncludeInternal(event.target.checked)}
              className="h-4 w-4 rounded border-gray-300"
            />
            {tr('internal.toggle')}
            <span className="text-gray-500">
              {tr('internal.marked', { count: internalAccounts })}
            </span>
          </label>
        </div>
      </div>

      <RankingScoreboard
        rows={rows}
        period={period}
        periodLabel={periodLabel}
        selection={asked}
        served={served}
        includeInternal={includeInternal}
        internalAccounts={internalAccounts}
        isLoading={false}
        error={null}
        onRetry={() => {}}
        onOpenSessions={() => {}}
      />
    </div>
  )
}
