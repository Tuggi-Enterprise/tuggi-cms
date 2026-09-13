/**
 * The screen's half of the ranking read (#741) — transport only.
 *
 * It mirrors `dashboard-service.ts`: the route holds the gate and the service key, this module
 * parses what came back. A column that did not come back stays `null` and NEVER becomes `0` —
 * the views belong to `data` and gain columns before the migration reaches this repo, and on a
 * screen `0` is an assertion ("nobody scored", "nobody was charged") while `null` prints as an
 * em dash (`lib/format/unknown.ts`, `DS-COMPONENTE-084` item 1).
 */

import { fetchDashboardRoute, type RpcResult } from '@/lib/api/dashboard-fetch'
import {
  periodKey,
  type PeriodKind,
  type PeriodOption,
  type RankingRow,
  type SessionMeteringRow,
} from '@/lib/ranking/scoreboard'

export interface ScoreboardPayload {
  /** Every period the view produced — the `<select>` is built from this, never from a calendar. */
  periods: PeriodOption[]
  /** The period the route actually served, after falling back on an unusable parameter. */
  period: { kind: PeriodKind; start: string | null }
  /** Accounts carrying the #740 mark anywhere in the view — `0` is the state that must warn. */
  internalAccounts: number
  /** Rows of EXACTLY that period. */
  rows: RankingRow[]
}

export const rankingService = {
  /**
   * The scoreboard of one period. `start` is required for `week` and ignored otherwise.
   *
   * The period travels as a query parameter rather than being filtered here, so the answer can
   * never mix two periods even if a caller forgets to filter — the contract names that as the
   * number-one suspect when the screen disagrees with the reference measurement.
   */
  async getScoreboard(period: {
    kind: PeriodKind
    start: string | null
  }): Promise<RpcResult<ScoreboardPayload>> {
    const query =
      period.kind === 'week' && period.start
        ? `?period=week&start=${encodeURIComponent(period.start)}`
        : `?period=${period.kind}`

    return fetchDashboardRoute<ScoreboardPayload>(`/api/dashboard/ranking${query}`)
  },

  /** Tab 2: one row per session, ordered by the largest metering difference. */
  async getSessionMetering(userId?: string | null): Promise<RpcResult<{ rows: SessionMeteringRow[] }>> {
    const query = userId ? `?userId=${encodeURIComponent(userId)}` : ''
    return fetchDashboardRoute<{ rows: SessionMeteringRow[] }>(`/api/dashboard/ranking/sessions${query}`)
  },
}

/** Re-exported so a component that already imports the service does not need a second import. */
export { periodKey }
export type { PeriodOption, RankingRow, SessionMeteringRow, PeriodKind }
