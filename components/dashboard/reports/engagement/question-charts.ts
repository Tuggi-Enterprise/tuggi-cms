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

/**
 * The legend of a month chart (DS-A11Y-007): once the chart defines two series or more, every series it
 * draws is named, even when only one has a number (block 2 before the split by mode draws only the grey
 * total). A chart of one series needs no legend.
 */
export function drawnLegend<T extends { key: string }>(series: T[], rows: { values: Record<string, number | null> }[]): T[] {
  if (series.length < 2) return []
  return series.filter((x) => rows.some((r) => r.values[x.key] !== undefined && r.values[x.key] !== null))
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
  /** The badge of a hollow row when it is not the funnel's default (`ga4`): two instruments, two badges (#1171). */
  badge?: string
}

/** Height of a row and the room around the bars, px (spec §E4). */
export const STEP_ROW_PX = 36
export const STEP_PAD_PX = 16

export function stepFunnelHeight(rows: number): number {
  return rows * STEP_ROW_PX + STEP_PAD_PX
}

export interface HorizontalBarsRow {
  key: string
  label: string
  /** The length of the bar, 0 when unknown. */
  value: number
  /** The text right of the bar: "5 · 22%". */
  display: string
  muted: boolean
  /** Tooltip and screen reader. */
  title: string
}

export interface HorizontalBarsMark {
  /** The row the dashed line sits on top of (`ReferenceLine` at the start of its band). */
  before: string
  label: string
}

/** Histogram rows of block 5 and permission rows (spec §E4: 6 × 32 + 16, 3 × 36 + 16). */
export const HISTOGRAM_ROW_PX = 32
export const PERMISSION_ROW_PX = 36

export function horizontalBarsHeight(rows: number, rowPx: number): number {
  return rows * rowPx + STEP_PAD_PX
}

export interface LinesSeries {
  key: string
  label: string
  color: string
  /** The market: grey and dashed, connected over the days with no published value. */
  dashed?: boolean
}

export interface LinesRow {
  key: string
  /** The tick at 1440 (`out 2026`, `D1`). */
  label: string
  /** The tick at 390. */
  short: string
  values: Record<string, number | null>
  /** Why the point is not drawn. */
  reason: string | null
}

/** Plot plus axis of a line chart, px (spec §E4: 176 + 22; the active halves 140 + 22). */
export const LINES_PX = 198
export const ACTIVE_LINES_PX = 162
