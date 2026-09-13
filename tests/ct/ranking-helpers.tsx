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
import type { PeriodOption, RankingRow } from '@/lib/ranking/scoreboard'
import { ROWS, WEEK } from './ranking-fixtures'

export function RankingScoreboardHarness({
  rows = ROWS,
  period = WEEK,
  internalAccounts = 1,
}: {
  rows?: RankingRow[]
  period?: PeriodOption
  internalAccounts?: number
}) {
  /** The page's initial state, reproduced: the switch is born OFF. */
  const [includeInternal, setIncludeInternal] = useState(false)

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
        periodLabel="Semana de 31/08 a 06/09 · UTC"
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
