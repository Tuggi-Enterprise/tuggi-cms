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
import { RankingScoreboard } from '@/components/dashboard/reports/RankingScoreboard'
import type { RpcError } from '@/lib/api/dashboard-fetch'
import type { PeriodOption, PeriodSelection, RankingRow } from '@/lib/ranking/scoreboard'
import { ROWS, WEEK } from './ranking-fixtures'

const WEEK_LABEL = 'Semana de 31/08 a 06/09 · UTC'

/** The selection an option came from — the page holds the two separately (#741). */
function selectionOf(period: PeriodOption): PeriodSelection {
  return { kind: period.kind, start: period.kind === 'week' ? period.start : null }
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
