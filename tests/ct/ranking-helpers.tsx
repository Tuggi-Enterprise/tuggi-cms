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
import { hasAnchoredStart } from '@/lib/ranking/scoreboard'
import type {
  KmCalibrationSeries,
  PeriodOption,
  PeriodSelection,
  RankingRow,
} from '@/lib/ranking/scoreboard'
import { ROWS, WEEK } from './ranking-fixtures'

/**
 * NO PANEL UNLESS THE TEST ASKS FOR ONE — and that is a decision about the bench, not a shortcut.
 *
 * Since #742 the screen carries TWO dense tables, and the calibration panel renders FIRST: a bare
 * `table`, `tbody tr` or `.custom-scrollbar` in a spec about the scoreboard would reach the panel
 * instead. The harness therefore hands down an EMPTY series by default — the panel's own guard is
 * `weeks.length === 0` — so `ranking-scoreboard.spec.tsx` keeps measuring the table it is about,
 * and `ranking-cycles.spec.tsx` passes `CALIBRATION` explicitly to measure the panel.
 */
const NO_CALIBRATION: KmCalibrationSeries = {
  weeks: [],
  measuredWeeks: 0,
  pointsFromTriggers: 0,
  pointsFromKm: 0,
  kmShare: null,
}

const WEEK_LABEL = 'Semana de 31/08 a 06/09 · UTC'

/** The selection an option came from — the page holds the two separately (#741). */
function selectionOf(period: PeriodOption): PeriodSelection {
  // The THREE anchored kinds carry their start since #742: a month is pasteable for the same
  // reason a week is, and the two rolling windows have no boundary to carry.
  return { kind: period.kind, start: hasAnchoredStart(period.kind) ? period.start : null }
}

export function RankingScoreboardHarness({
  rows = ROWS,
  calibration = NO_CALIBRATION,
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
  calibration?: KmCalibrationSeries
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

  /**
   * The week the panel asked for, held HERE because the page holds it: clicking a week of the
   * calibration panel is a period change, and the assertion of critério 36 is that the selection
   * travels — not that a prop was called. Playwright reads it out of the DOM.
   */
  const [selectedWeek, setSelectedWeek] = useState<string | null>(null)

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
      <span data-testid="selected-week">{selectedWeek ?? ''}</span>
      <RankingScoreboard
        rows={rows}
        calibration={calibration}
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
        onSelectWeek={setSelectedWeek}
      />
    </div>
  )
}
