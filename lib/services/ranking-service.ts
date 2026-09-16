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
  hasAnchoredStart,
  periodKey,
  type KmCalibrationSeries,
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
  /**
   * THE 13 WEEKS OF THE CALIBRATION PANEL, aggregated in the route — the same series whatever
   * period is selected (spec §3.2). It travels in THIS payload and not in a second request
   * because the route already reads the whole view once, and a second read would cost another
   * ~2,8 s of a view whose ceiling is an 8 s `statement_timeout` (contract, Parte 7).
   */
  calibration: KmCalibrationSeries
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
    // The three anchored kinds carry their `start`; the two rolling ones have none to carry. The
    // predicate is the one `periodKey` and `parsePeriodParam` already read, so `month` and `year`
    // could not arrive here as a week-shaped special case somebody forgot to extend (spec §2.3).
    const query =
      hasAnchoredStart(period.kind) && period.start
        ? `?period=${period.kind}&start=${encodeURIComponent(period.start)}`
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
export type { KmCalibrationSeries, PeriodOption, RankingRow, SessionMeteringRow, PeriodKind }
