/**
 * The rules shared by every number of the Engagement page (#1099, #1162; spec Parte B and Parte E):
 * the month of the page, the change against the month before, the modes columns of block 2 and the
 * cohort heat steps. Pure TS, tested without mounting.
 *
 *  - **A change is coloured only over a base of `SUMMARY_MIN_BASE` or more in both months**, the
 *    current month never compares with a whole one, a rate changes in points and a count in percent,
 *    a month with nothing before it is "new" (DS-COMPONENTE-100, #1154).
 *  - **`null` is never `0`** (BR-COMUNICACAO-022 item 4): every value is a `Cell` from `cells.ts`,
 *    with the state that says why it is empty.
 */

import { resolveCell, type Cell, type GridInput, type RowDef } from '@/lib/engagement/cells'
import { addMonths } from '@/lib/engagement/months'
import { stripTop } from '@/lib/social/funnel'

/** Under this many people in either month a change is printed without arrow or colour (DS-COMPONENTE-100 item 1). */
export const SUMMARY_MIN_BASE = 30
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

/** The month before had nothing measured: no source yet. Not a failure, a missing number or a pending read. */
const nothingBefore = (c: Cell) => c.state === 'before_source'

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

// ── Month columns: modes ─────────────────────────────────────────────────────────────────────

const TRIP_ROW: RowDef = { key: 'active_trip', source: 'bank', kind: 'count', since: 'trip', bank: (m) => m.active.trip }
const valueOf = (c: Cell) => (hasValue(c) ? (c.value as number) : null)

export interface ColumnSegment {
  key: string
  cell: Cell
  /** Height as a fraction of the plot; 0 when it draws nothing. */
  fraction: number
  share: number | null
}

export interface MonthColumn {
  month: string
  /** Bottom to top. */
  segments: ColumnSegment[]
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
    const trip = resolveCell(TRIP_ROW, month, input)
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
