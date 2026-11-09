/**
 * The executive summary on top of the Engagement report (#1099, spec-cms-relatorio-engajamento-2026-11
 * Parte B). Pure TS, so every number of the summary is tested without mounting; the components print
 * what this returns.
 *
 * The promises that live here:
 *
 *  - **A change is coloured only over a base of `SUMMARY_MIN_BASE` or more in both months**, the
 *    current month never compares with a whole one, a rate changes in points and a count in percent,
 *    a month with nothing before it is "new", and a tile always shows the month of the page, saying
 *    when its window closes when it has not (DS-COMPONENTE-100, #1154).
 *  - **`null` is never `0`** (BR-COMUNICACAO-022 item 4): every value is a `Cell` from `cells.ts`,
 *    with the state that says why it is empty.
 *  - **No fraction crosses instruments** (DS-COMPONENTE-084 item 2): the divisions below are GA4 by
 *    GA4 (`engagedShare`) and bank by bank (the frequency bands). The two funnels of the page (#1101)
 *    live in `lib/conversion/funnel.ts`.
 */

import { GRID_CARDS, resolveCell, screenMinutes, type Cell, type GridCard, type GridInput, type RowDef } from '@/lib/engagement/cells'
import { addMonths } from '@/lib/engagement/months'
import { stripTop } from '@/lib/social/funnel'
import type { EngagementBankMonth } from '@/lib/engagement/report'

/** Under this many people in either month a change is printed without arrow or colour (DS-COMPONENTE-100 item 1). */
export const SUMMARY_MIN_BASE = 30
/** Slots of the tile line, the tile's month on the right (spec §B4.3). */
export const SPARK_SLOTS = 6
/** Plot height of the month columns, px (spec §B5). */
export const COLUMN_PLOT_PX = 160
/** An inner label prints only on a segment this tall or taller, px (spec §B7). */
export const INNER_LABEL_MIN_PX = 18
/** The cohort curve draws from this many closed cohorts on (spec §B8). */
export const CURVE_MIN_COHORTS = 6
/** U+2212, the minus sign of every signed number the CMS prints (DS-COMPONENTE-084 item 3). */
export const MINUS = '−'

// ── Month ─────────────────────────────────────────────────────────────────────────────────────

/**
 * The month of the page: `?month=` when it is on the ruler, else the last closed month (the one
 * before today's in Sao Paulo), else the current one, as in the first month of the ruler (#1101 §C8).
 */
export function summaryMonthOf(param: string | null, months: readonly string[], today: string): string {
  if (param && months.includes(param)) return param
  const previous = addMonths(today.slice(0, 7), -1)
  return months.includes(previous) ? previous : months[months.length - 1]
}

// ── Change against the previous month ───────────────────────────────────────────────────────

/**
 * `new`: no measured month before to compare with (#1154). `closes`: the tile's window is still open,
 * `TileDelta.due` says when it closes (#1154).
 */
export type DeltaState = 'up' | 'down' | 'flat' | 'small_base' | 'partial' | 'new' | 'closes' | 'unknown'
/** `relative`: counts and durations, percent of the previous; `points`: rates, percentage points. */
export type DeltaUnit = 'relative' | 'points'

export interface TilePoint {
  month: string
  cell: Cell
  /** The n behind the value (spec §B3), `null` when it is not known. */
  base: number | null
}

export interface TileDelta {
  state: DeltaState
  unit: DeltaUnit
  /**
   * Percent for `relative`, points for `points`, computed from the values as sent (never from the
   * rounded ones the tile prints) and rounded to one decimal (#1154); `null` when nothing is printed.
   */
  rounded: number | null
  /** `closes`: the first day the window is complete, `YYYY-MM-DD`. */
  due: string | null
  prev: TilePoint
  curr: TilePoint
}

const hasValue = (c: Cell) => (c.state === 'measured' || c.state === 'floor') && c.value !== null

/** One decimal, and never `-0`. */
const oneDecimal = (x: number) => {
  const r = Math.round(x * 10) / 10
  return r === 0 ? 0 : r
}

/** The month before had nothing measured: no source yet, or fewer than 5 people. Not a failure or a pending read. */
const nothingBefore = (c: Cell) => c.state === 'before_source' || c.state === 'suppressed'

/**
 * The change of a tile against the month before (DS-COMPONENTE-100). `closes` when the tile's own
 * window is open (it says when it closes, #1154); `partial` when the month is the current one or the
 * month before is a floor (a window still open is a different coverage); `new` when the month before
 * has nothing measured (#1154).
 */
export function tileDelta(curr: TilePoint, prev: TilePoint, unit: DeltaUnit, currentMonth: string): TileDelta {
  const out = (state: DeltaState, rounded: number | null = null): TileDelta => ({ state, unit, rounded, due: null, prev, curr })
  if ((curr.cell.state === 'not_due' || curr.cell.state === 'floor') && curr.cell.due) return { ...out('closes'), due: curr.cell.due }
  if (curr.month === currentMonth) return out('partial')
  if (!hasValue(curr.cell)) return out('unknown')
  if (!hasValue(prev.cell)) return out(nothingBefore(prev.cell) ? 'new' : 'unknown')
  if (prev.cell.state === 'floor') return out('partial')
  const c = curr.cell.value as number
  const p = prev.cell.value as number
  let rounded: number
  if (unit === 'points') rounded = oneDecimal((c - p) * 100)
  else if (p === 0) {
    // No ratio over zero: from a measured zero, a value is new and a zero is steady.
    if (c !== 0) return out('new')
    rounded = 0
  } else rounded = oneDecimal(((c - p) / p) * 100)
  const small = curr.base === null || prev.base === null || curr.base < SUMMARY_MIN_BASE || prev.base < SUMMARY_MIN_BASE
  if (small) return out('small_base', rounded)
  return out(rounded > 0 ? 'up' : rounded < 0 ? 'down' : 'flat', rounded)
}

/**
 * `+8.0%`, `−5.3%`, `+2.0 pt`: one decimal (#1154), the sign on both sides and U+2212 on the negative
 * (DS-COMPONENTE-100 item 2).
 */
export function formatDelta(d: TileDelta, locale: string, pointsTemplate: (n: string) => string): string | null {
  if (d.rounded === null) return null
  const sign = d.rounded > 0 ? '+' : d.rounded < 0 ? MINUS : ''
  const abs = Math.abs(d.rounded)
  const digits = { minimumFractionDigits: 1, maximumFractionDigits: 1 }
  if (d.unit === 'points') return pointsTemplate(`${sign}${new Intl.NumberFormat(locale, digits).format(abs)}`)
  return `${sign}${new Intl.NumberFormat(locale, { style: 'percent', ...digits }).format(abs / 100)}`
}

// ── Tiles ────────────────────────────────────────────────────────────────────────────────────

export interface SummaryInput extends GridInput {
  summaryMonth: string
}

export type TileKey = 'engaged' | 'guide_median' | 'screen_minutes' | 'returned'

export interface SummaryTileData {
  key: TileKey
  source: 'bank' | 'ga4'
  /** The month the value is of: the summary month, on every tile (#1154). */
  month: string
  point: TilePoint
  delta: TileDelta
  /** Six slots, oldest first, the tile's month last; `null` is a gap. */
  spark: { month: string; value: number | null }[]
  /** `engaged` only: GA4 engaged over GA4 active, `null` when it does not print. */
  share: number | null
  /** `engaged` only: GA4 counted more engaged than active people this month. */
  over: boolean
}

/** Engaged people of a GA4 month; the version of the function that does not send them yet is `no_source`. */
const ENGAGED_ROW: RowDef = { key: 'engaged_ga4', source: 'ga4', kind: 'count', ga4: (m) => m.engagedUsers }
/** Engaged people of the month's cohort, the "interacted" band of the use funnel (#1101 §C15.1). */
const NEW_ENGAGED_ROW: RowDef = { key: 'new_engaged_ga4', source: 'ga4', kind: 'count', ga4: (m) => m.newEngagedUsers }
/** GA4 fields a deployed function may not send yet: a month answered without them is `no_source`. */
const LATE_GA4_FIELDS: readonly RowDef[] = [ENGAGED_ROW, NEW_ENGAGED_ROW]
const GA4_ACTIVE_ROW: RowDef = { key: 'active_ga4', source: 'ga4', kind: 'count', ga4: (m) => m.activeUsers }
const SCREEN_ROW: RowDef = { key: 'screen_minutes', source: 'ga4', kind: 'minutes', ga4: screenMinutes }
/**
 * Tile 2, Tech Lead 2026-11-04 (spec §B14.2, the one-line alternative): the median of guide time per
 * person, which the database already sends, over `active.trip`. Hours in total need two fields the
 * database does not send.
 */
const GUIDE_ROW: RowDef = { key: 'guide_median', source: 'bank', kind: 'minutes', since: 'trip', bank: (m) => m.guide_minutes_median }
const TRIP_ROW: RowDef = { key: 'active_trip', source: 'bank', kind: 'count', since: 'trip', bank: (m) => m.active.trip }
const ACTIVE_ROW: RowDef = { key: 'active_by', source: 'bank', kind: 'count', since: 'use', bank: (m, u) => m.active[u] }
/** The grid's row itself, so the tile and the table can never define the return in two ways. */
const RETURNED_ROW: RowDef = GRID_CARDS.flatMap((c) => c.groups.flatMap((g) => g.rows)).find((r) => r.key === 'returned_next')!

/** `resolveCell`, plus `no_source` where the source answered the month without the field. */
function cellOf(row: RowDef, month: string, input: GridInput): Cell {
  const cell = resolveCell(row, month, input)
  if (LATE_GA4_FIELDS.includes(row) && cell.state === 'suppressed' && input.ga4?.months.some((m) => m.month === month && row.ga4!(m) === null)) {
    return { ...cell, state: 'no_source' }
  }
  return cell
}

const valueOf = (c: Cell) => (hasValue(c) ? (c.value as number) : null)

function sparkOf(row: RowDef, month: string, input: GridInput) {
  return Array.from({ length: SPARK_SLOTS }, (_, i) => {
    const m = addMonths(month, i - (SPARK_SLOTS - 1))
    return { month: m, value: input.months.includes(m) ? valueOf(cellOf(row, m, input)) : null }
  })
}

function tileOf(key: TileKey, row: RowDef, baseRow: RowDef, unit: DeltaUnit, month: string, input: SummaryInput): SummaryTileData {
  const point = (m: string): TilePoint => ({
    month: m,
    cell: input.months.includes(m) ? cellOf(row, m, input) : { state: 'before_source', value: null, share: null, since: null, due: null },
    base: input.months.includes(m) ? valueOf(cellOf(baseRow, m, input)) : null,
  })
  const curr = point(month)
  const current = input.today.slice(0, 7)
  // The current month selected: no tile compares (spec §B1 item 1), not even the one that falls back.
  const prevMonth = addMonths(month, -1)
  let delta = tileDelta(curr, point(prevMonth), unit, input.summaryMonth === current ? month : current)
  // A month before the ruler was never read: calling the tile "new" would be a guess.
  if (delta.state === 'new' && !input.months.includes(prevMonth)) delta = { ...delta, state: 'unknown' }
  return { key, source: row.source, month, point: curr, delta, spark: sparkOf(row, month, input), share: null, over: false }
}

export function buildTiles(input: SummaryInput): SummaryTileData[] {
  const month = input.summaryMonth
  const engaged = tileOf('engaged', ENGAGED_ROW, GA4_ACTIVE_ROW, 'relative', month, input)
  const e = valueOf(engaged.point.cell)
  const a = engaged.point.base
  if (e !== null && a !== null && a > 0) {
    if (e > a) engaged.over = true
    else engaged.share = e / a
  }
  return [
    engaged,
    tileOf('guide_median', GUIDE_ROW, TRIP_ROW, 'relative', month, input),
    tileOf('screen_minutes', SCREEN_ROW, GA4_ACTIVE_ROW, 'relative', month, input),
    // The month of the page, never an older one under its name: while the window is open the tile
    // says when it closes (#1154; DS-COMPONENTE-100 item 4 allows, does not require, the fallback).
    tileOf('returned', RETURNED_ROW, ACTIVE_ROW, 'points', month, input),
  ]
}

// ── Month columns: modes and frequency ───────────────────────────────────────────────────────

export interface ColumnSegment {
  key: string
  cell: Cell
  /** Height as a fraction of the plot; 0 when it draws nothing. */
  fraction: number
  /** `share` columns: the fraction of the month's base. */
  share: number | null
}

export interface MonthColumn {
  month: string
  /** Bottom to top. */
  segments: ColumnSegment[]
  /** `share` columns whose base is unknown: the column draws nothing and says why. */
  empty: Cell | null
}

export const MODE_KEYS = ['drive_only', 'both', 'explore_only'] as const
export type ModeKey = (typeof MODE_KEYS)[number]

const modeRow = (key: ModeKey): RowDef => ({ key: `mode_${key}`, source: 'bank', kind: 'count', since: 'open', bank: (m) => m.modes[key] })

/** The fields of #1098 the database does not send yet are `no_source`, not a reason that is not the real one. */
function modeCell(row: RowDef, month: string, input: GridInput): Cell {
  const cell = resolveCell(row, month, input)
  if (input.bank && !input.bank.has_mode_fields && cell.state !== 'source_failed' && cell.state !== 'loading') {
    return { state: 'no_source', value: null, share: null, since: null, due: null }
  }
  return cell
}

/** The grey segment of a month the database cannot split by mode yet (#1101 §C4.1). */
export const UNSPLIT_SEGMENT = 'trip_total'

const unsplit = (c: Cell) => c.state === 'before_source' || c.state === 'no_source'

/**
 * Counted columns of the modes card: one ruler, `stripTop` of the tallest month (spec §B5). A month
 * whose three modes are before their source or not sent draws one neutral segment, the people who
 * used the guide (`active.trip`), so August to October are not empty (§C4.1). Without that number
 * the column stays empty with the modes' reason; a month with any mode measured draws the three.
 */
export function buildModeColumns(input: GridInput): { columns: MonthColumn[]; top: number } {
  const raw = input.months.map((month) => {
    const cells = MODE_KEYS.map((k) => modeCell(modeRow(k), month, input))
    const trip = cellOf(TRIP_ROW, month, input)
    const segments = cells.every(unsplit) && hasValue(trip) ? [{ key: UNSPLIT_SEGMENT, cell: trip }] : cells.map((cell, i) => ({ key: MODE_KEYS[i] as string, cell }))
    return { month, segments }
  })
  const totals = raw.map((r) => r.segments.reduce((s, x) => s + (valueOf(x.cell) ?? 0), 0))
  const top = stripTop(totals)
  return {
    top,
    columns: raw.map((r) => ({
      month: r.month,
      empty: null,
      segments: r.segments.map(({ key, cell }) => ({ key, cell, fraction: (valueOf(cell) ?? 0) / top, share: null })),
    })),
  }
}

/** The first month the database splits by mode, for the card's header; `null` with none yet (§C4.3). */
export function modesSplitSince(input: GridInput): string | null {
  if (!input.bank || input.bankFailed) return null
  return input.months.find((m) => !unsplit(modeCell(modeRow('drive_only'), m, input))) ?? null
}

/** The "interacted" cell of the use funnel for one month: GA4, the month's cohort (§C5). */
export function newEngagedCell(month: string, input: GridInput): Cell {
  return cellOf(NEW_ENGAGED_ROW, month, input)
}

export interface ModesPanel {
  drive_only: Cell
  explore_only: Cell
  both: Cell
  fg: Cell
  bg: Cell
  bg_share: Cell
}

const fieldRow = (key: string, pick: (m: EngagementBankMonth) => number | null): RowDef => ({
  key,
  source: 'bank',
  kind: 'minutes',
  since: 'trip',
  bank: pick,
})

export function buildModesPanel(month: string, input: GridInput): ModesPanel {
  const [drive_only, both, explore_only] = MODE_KEYS.map((k) => modeCell(modeRow(k), month, input))
  return {
    drive_only,
    explore_only,
    both,
    fg: modeCell(fieldRow('fg', (m) => m.guide_foreground_minutes_median), month, input),
    bg: modeCell(fieldRow('bg', (m) => m.guide_background_minutes_median), month, input),
    bg_share: modeCell(fieldRow('bg_share', (m) => m.guide_background_share), month, input),
  }
}

export const BAND_KEYS = ['d1', 'd2', 'd3_5', 'd6_plus'] as const
export type BandKey = (typeof BAND_KEYS)[number]
/** The segment of the bands that came suppressed while the month's base is known (spec §B7). */
export const SUPPRESSED_SEGMENT = 'suppressed'

/** Share columns of the frequency card: each column is 100 % of `active[use]` of its month. */
export function buildFrequencyColumns(input: GridInput): MonthColumn[] {
  return input.months.map((month) => {
    const base = cellOf(ACTIVE_ROW, month, input)
    const active = valueOf(base)
    // No base, or a measured zero: the column draws nothing and prints the base's state or its 0.
    if (active === null || active <= 0) return { month, segments: [], empty: base }
    const segments: ColumnSegment[] = BAND_KEYS.map((key) => {
      const cell = cellOf({ key: `band_${key}`, source: 'bank', kind: 'countShare', since: 'use', bank: (m, u) => m.days_used[u][key] }, month, input)
      const v = valueOf(cell)
      return { key, cell, fraction: v === null ? 0 : v / active, share: v === null ? null : v / active }
    })
    const known = segments.reduce((s, x) => s + (valueOf(x.cell) ?? 0), 0)
    const rest = active - known
    if (rest > 0 && segments.some((x) => valueOf(x.cell) === null)) {
      segments.push({
        key: SUPPRESSED_SEGMENT,
        cell: { state: 'suppressed', value: rest, share: null, since: null, due: null },
        fraction: rest / active,
        share: rest / active,
      })
    }
    return { month, segments, empty: null }
  })
}

// ── Cohorts ──────────────────────────────────────────────────────────────────────────────────

/** Lower bounds of the five steps of the heat map, fixed and absolute (spec §B8). */
export const HEAT_STEPS = [0, 0.05, 0.1, 0.2, 0.35] as const

/**
 * The step of a cohort rate on the heat scale, 0 to 4; `null` (any reason) has none. The classes of
 * each step live in the component (`HEAT_TONES`): Tailwind does not scan `lib/`.
 */
export function heatStep(value: number | null): number | null {
  if (value === null) return null
  let i = 0
  for (let s = 0; s < HEAT_STEPS.length; s++) if (value >= HEAT_STEPS[s]) i = s
  return i
}

const CURVE_DAYS = [1, 7, 30, 60, 90] as const

/** The median of a list of numbers. */
function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/**
 * The typical retention curve: the median of the closed cohorts at D1, D7, D30, D60 and D90, drawn
 * only from `CURVE_MIN_COHORTS` cohorts whose D30 is measured; a point with fewer closed is `null`.
 */
export function cohortCurve(afterFirst: GridCard): { closed: number; points: (number | null)[] | null } {
  const rows = new Map(afterFirst.groups.flatMap((g) => g.rows).map((r) => [r.key, r]))
  const d30 = rows.get('ret_d30')?.cells ?? []
  const closed = d30.filter((c) => c.state === 'measured').length
  if (closed < CURVE_MIN_COHORTS) return { closed, points: null }
  const points = CURVE_DAYS.map((d) => {
    const vals = (rows.get(`ret_d${d}`)?.cells ?? []).filter((c) => c.state === 'measured' && c.value !== null).map((c) => c.value as number)
    return vals.length >= CURVE_MIN_COHORTS ? median(vals) : null
  })
  return { closed, points }
}

// ── All of it ────────────────────────────────────────────────────────────────────────────────

export interface Summary {
  month: string
  tiles: SummaryTileData[]
  modes: { columns: MonthColumn[]; top: number }
  panel: ModesPanel
  frequency: MonthColumn[]
}

export function buildSummary(input: SummaryInput): Summary {
  return {
    month: input.summaryMonth,
    tiles: buildTiles(input),
    modes: buildModeColumns(input),
    panel: buildModesPanel(input.summaryMonth, input),
    frequency: buildFrequencyColumns(input),
  }
}
