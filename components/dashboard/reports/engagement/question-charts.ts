/**
 * The shapes and heights of the question charts (#1161, spec Parte E §E4), apart from the recharts
 * modules: the page imports these statically for its skeletons, and recharts stays behind
 * `next/dynamic` (`MonthBars`, `StepFunnel`).
 */

export interface MonthBarsSeries {
  key: string
  label: string
  color: string
}

export interface MonthBarsRow {
  month: string
  /** `out 2026` at 1440, `out` at 390. */
  label: string
  short: string
  values: Record<string, number | null>
  /** Why the month draws nothing. */
  reason: string | null
}

/** Plot plus the month axis, px (spec §E4: 176 + 22). */
export const MONTH_BARS_PX = 198

export interface StepFunnelRow {
  key: string
  label: string
  /** A step of the other instrument: outline, no rate. */
  hollow: boolean
  /** The value drawn, 0 when unknown. */
  kept: number
  /** The loss from the previous full step, drawn behind; 0 for none. */
  lost: number
  /** The loss of the biggest drop: orange. */
  highlight: boolean
  /** The text right of the bar: "35 · 29%". */
  display: string
  /** The value is unknown: the text recedes. */
  muted: boolean
  /** Tooltip and screen reader: what the row says in words. */
  title: string
}

/** Height of a row and the room around the bars, px (spec §E4). */
export const STEP_ROW_PX = 36
export const STEP_PAD_PX = 16

export function stepFunnelHeight(rows: number): number {
  return rows * STEP_ROW_PX + STEP_PAD_PX
}
