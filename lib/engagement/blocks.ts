/**
 * The question blocks 1 to 4 and the two step funnels of the Engagement page (#1161, spec Parte E §E5
 * and §E6), resolved in plain TS so every number is tested without mounting. The components print what
 * this returns; the sentence of each block comes from `answers.ts`, the three lines on top from
 * `headlines.ts`.
 *
 * The promises that live here:
 *
 *  - **`null` is never `0`** (BR-COMUNICACAO-022 item 4; DS-COMPONENTE-084 item 1): every value is a
 *    `Cell` whose state says why it is empty. An incomplete registrar prints a floor.
 *  - **A share is printed only over a denominator of the same instrument and coverage**
 *    (DS-COMPONENTE-084 item 2): installs (GA4, devices) never divide entries (bank, people); their gap is
 *    a signed difference. A zero denominator prints no share.
 *  - **A change is coloured only as DS-COMPONENTE-100 allows**: every `delta` comes from `tileDelta`.
 *  - **Movement is the app's own classification** (BR-VIAGEM-008): the buckets are printed, never
 *    recomputed from speed.
 */

import { beforeSource, type Cell, type CellState } from '@/lib/engagement/cells'
import { addDays, addMonths } from '@/lib/engagement/months'
import { buildModeColumns, SUMMARY_MIN_BASE, tileDelta, type DeltaUnit, type TileDelta } from '@/lib/engagement/summary'
import { readStepFunnel, type ConversionFunnel, type StepFunnelView, type StepInput, type StepReason } from '@/lib/conversion/funnel'
import type { EngagementBankMonth, EngagementBankReport, EngagementGa4Month, EngagementGa4Report } from '@/lib/engagement/report'
import type { UsageMonth, UsageReport } from '@/lib/engagement/usage'

/** Months in each chart: the six that end on the month of the page (spec §E1 item 2). */
export const CHART_MONTHS = 6
/**
 * Below this share of trips with movement buckets, the registrar was still rolling out (August 2026:
 * 0.14; from September on, about 0.8): the medians of the month print as a floor (DS-COMPONENTE-084
 * item 1, contract Parte 27 §4 `movement.coverage`).
 */
export const MOVEMENT_FULL_COVERAGE = 0.5
/** The window of "took a 2nd trip": open until this many days after the month (spec §E6.1 step 7). */
export const SECOND_TRIP_WINDOW_DAYS = 30

export type StatKind = 'count' | 'minutes' | 'rate' | 'km'
export type BlockKey = 'block_1' | 'block_2' | 'block_3' | 'block_4'
export const BLOCK_KEYS: readonly BlockKey[] = ['block_1', 'block_2', 'block_3', 'block_4']

export interface Stat {
  /** The copy key of the label, under `questions`. */
  key: string
  source: 'bank' | 'ga4'
  kind: StatKind
  cell: Cell
  /** The share beside the count, of `pctOf`, same instrument and month; `null` when it does not print. */
  pct: number | null
  /** The copy key of the denominator of `pct` (`common.of_entered`). */
  pctOf: string | null
  /** The n behind the number: the small-sample badge and DS-COMPONENTE-100 read it. */
  base: number | null
  delta: TileDelta | null
  /** The base is under `SUMMARY_MIN_BASE`: the number prints with the small-sample badge. */
  small: boolean
  /** A difference printed with its sign on both sides (DS-COMPONENTE-084 item 3). */
  signed?: boolean
  /** The copy key of the hint of the label. */
  hint?: string
}

export interface ChartRow {
  month: string
  /** Series to value; a `null` draws nothing. */
  values: Record<string, number | null>
  /** Why the month draws nothing, when it does not. */
  reason: CellState | null
}

export type BlockStatus = 'loading' | 'failed' | 'no_source' | 'empty' | 'ready'

export interface QuestionBlock {
  key: BlockKey
  status: BlockStatus
  /** The number of the answer sentence, and the candidate of the three lines on top (copy §2). */
  headline: Stat
  stats: Stat[]
  /** Bottom to top. */
  series: string[]
  chart: ChartRow[]
  /** The other numbers the answer prints. */
  facts: Record<string, Cell>
  /** The first day of the block's source, for "measured since". */
  since: string | null
}

export interface QuestionsInput {
  /** The month of the page, `YYYY-MM`. */
  month: string
  months: readonly string[]
  /** Today in Sao Paulo, `YYYY-MM-DD`. */
  today: string
  bank?: EngagementBankReport
  bankFailed: boolean
  ga4?: EngagementGa4Report
  ga4Failed: boolean
  /** A filter GA4 does not have (source, account). */
  ga4Filtered: boolean
  usage?: UsageReport
  usageFailed: boolean
  conversion?: ConversionFunnel
  conversionFailed: boolean
  /** Any filter of the bar. */
  filtered: boolean
}

const cell = (state: CellState, value: number | null = null, extra: Partial<Cell> = {}): Cell => ({ state, value, share: null, since: null, due: null, ...extra })
const hasValue = (c: Cell) => (c.state === 'measured' || c.state === 'floor') && c.value !== null
const valueOf = (c: Cell) => (hasValue(c) ? (c.value as number) : null)
const share = (num: number | null, den: number | null) => (num === null || den === null || den <= 0 ? null : num / den)

/** The months of a chart: six ending on `month`, oldest first. */
export function chartMonths(month: string): string[] {
  return Array.from({ length: CHART_MONTHS }, (_, i) => addMonths(month, i - (CHART_MONTHS - 1)))
}

type UsageSince = keyof UsageReport['data_since']

/** A number of `cms_get_usage_monthly` with the reason it is empty. */
function usageCell(input: QuestionsInput, month: string, since: UsageSince, pick: (m: UsageMonth) => number | null | undefined): Cell {
  if (input.usageFailed) return cell('source_failed')
  if (!input.usage) return cell('loading')
  const start = input.usage.data_since[since]
  const m = input.usage.months.find((x) => x.month === month)
  // A month the function did not return can only be one its sources did not cover (as in `cells.ts`).
  if (!m) return cell('before_source', null, { since: start })
  const v = pick(m)
  if (v !== null && v !== undefined) return cell('measured', v)
  if (start === null || month < start.slice(0, 7)) return cell('before_source', null, { since: start })
  return cell('no_source')
}

type BankSince = 'open' | 'trip' | 'audio'

/** A number of `cms_get_engagement_monthly` with the reason it is empty. */
function bankCell(input: QuestionsInput, month: string, since: BankSince, pick: (m: EngagementBankMonth) => number | null): Cell {
  if (input.bankFailed) return cell('source_failed')
  if (!input.bank) return cell('loading')
  const start = input.bank.data_since[since]
  const m = input.bank.months.find((x) => x.month === month)
  const v = m ? pick(m) : null
  if (v !== null) return cell('measured', v)
  if (beforeSource(month, start, since)) return cell('before_source', null, { since: start })
  return cell('no_source')
}

/** A number of the GA4 half with the reason it is empty. */
function ga4Cell(input: QuestionsInput, month: string, pick: (m: EngagementGa4Month) => number | null): Cell {
  if (input.ga4Filtered) return cell('ga4_filter')
  if (input.ga4Failed) return cell('source_failed')
  if (!input.ga4) return cell('loading')
  const m = input.ga4.months.find((x) => x.month === month)
  const v = m ? pick(m) : null
  return v === null ? cell('before_source') : cell('measured', v)
}

/** A rate of two cells of one instrument: a floor if either is, no rate over zero (DS-COMPONENTE-084 item 2). */
function rateCell(num: Cell, den: Cell): Cell {
  if (!hasValue(num)) return num
  if (!hasValue(den)) return den
  const r = share(num.value, den.value)
  if (r === null) return cell('no_source')
  return cell(num.state === 'floor' || den.state === 'floor' ? 'floor' : 'measured', r)
}

interface StatSpec {
  key: string
  source: 'bank' | 'ga4'
  kind: StatKind
  unit: DeltaUnit | null
  /** The value and its base in a month. */
  at: (month: string) => { cell: Cell; base: Cell; pct?: number | null }
  pctOf?: string
  signed?: boolean
  hint?: string
}

function statOf(spec: StatSpec, input: QuestionsInput): Stat {
  const current = input.today.slice(0, 7)
  const now = spec.at(input.month)
  const base = valueOf(now.base)
  let delta: TileDelta | null = null
  if (spec.unit) {
    const prevMonth = addMonths(input.month, -1)
    const prev = spec.at(prevMonth)
    delta = tileDelta({ month: input.month, cell: now.cell, base }, { month: prevMonth, cell: prev.cell, base: valueOf(prev.base) }, spec.unit, current)
    // A month before the ruler was never read: calling the number "new" would be a guess.
    if (delta.state === 'new' && !input.months.includes(prevMonth)) delta = { ...delta, state: 'unknown' }
  }
  return {
    key: spec.key,
    source: spec.source,
    kind: spec.kind,
    cell: now.cell,
    pct: now.pct ?? null,
    pctOf: spec.pctOf ?? null,
    base,
    delta,
    small: base !== null && base < SUMMARY_MIN_BASE,
    signed: spec.signed,
    hint: spec.hint,
  }
}

/** The state of a whole block from the sources it reads. */
function statusOf(input: QuestionsInput, sources: ('usage' | 'bank')[], headline: Cell): BlockStatus {
  if (sources.some((s) => (s === 'usage' ? input.usageFailed : input.bankFailed))) return 'failed'
  if (sources.some((s) => (s === 'usage' ? !input.usage : !input.bank))) return 'loading'
  if (headline.state === 'before_source') return 'no_source'
  return 'ready'
}

// ── Block 1: who installs, and what do they do (spec §E5.2) ──────────────────────────────────

/** The four parts of the first day, exclusive in this order (spec §E12 item 3), and the rest before opens. */
export const FIRST_DAY_SERIES = ['guide', 'story_only', 'explore_only', 'nothing', 'rest'] as const

/** Installs of the month (GA4 through `social.funnel_daily`): only for the month the conversion read is of. */
function installsCell(input: QuestionsInput, month: string): Cell {
  if (month !== input.month) return cell('before_source')
  // The conversion read has no filter: under one, its installs are not of the slice.
  if (input.filtered) return cell('ga4_filter')
  if (input.conversionFailed) return cell('source_failed')
  if (!input.conversion) return cell('loading')
  const t = input.conversion.installs.total
  return t === null ? cell('before_source') : cell('measured', t)
}

export function buildBlock1(input: QuestionsInput): QuestionBlock {
  const entered = (m: string) => usageCell(input, m, 'trip', (u) => u.first_day.entered)
  const guide = (m: string) => usageCell(input, m, 'trip', (u) => u.first_day.guide)
  const headline = statOf(
    {
      key: 'questions.block_1.day_guide',
      source: 'bank',
      kind: 'rate',
      unit: 'points',
      at: (m) => ({ cell: rateCell(guide(m), entered(m)), base: entered(m) }),
      pctOf: 'questions.common.of_entered',
    },
    input,
  )
  const installs = installsCell(input, input.month)
  const enteredNow = entered(input.month)
  const i = valueOf(installs)
  const e = valueOf(enteredNow)
  // Installs under entries: GA4 lost events, the installs are a floor and the gap does not print.
  const installsFloor = i !== null && e !== null && i < e
  const gap: Cell = i === null ? installs : e === null ? enteredNow : installsFloor ? cell('floor', null) : cell('measured', i - e)
  const stats: Stat[] = [
    statOf({ key: 'questions.block_1.installed', source: 'ga4', kind: 'count', unit: null, hint: 'questions.block_1.installed_hint', at: () => ({ cell: installsFloor ? { ...installs, state: 'floor' } : installs, base: installs }) }, input),
    statOf({ key: 'questions.block_1.entered', source: 'bank', kind: 'count', unit: 'relative', at: (m) => ({ cell: entered(m), base: entered(m) }) }, input),
    statOf({ key: 'questions.block_1.gap', source: 'bank', kind: 'count', unit: null, signed: true, hint: installsFloor ? 'questions.block_1.floor_hint' : 'questions.block_1.difference_hint', at: () => ({ cell: gap, base: cell('no_source') }) }, input),
    statOf(
      {
        key: 'questions.extra_first_story.title',
        source: 'bank',
        kind: 'minutes',
        unit: 'relative',
        hint: 'questions.extra_first_story.hint',
        at: (m) => ({ cell: usageCell(input, m, 'audio', (u) => u.time_to_first_story.minutes_median), base: usageCell(input, m, 'audio', (u) => u.time_to_first_story.people) }),
      },
      input,
    ),
  ]
  const chart = chartMonths(input.month).map((month): ChartRow => {
    const u = input.usage?.months.find((x) => x.month === month)
    const fd = u?.first_day
    const reason = entered(month)
    if (!fd || fd.entered === null || fd.guide === null || fd.guide_or_story === null) {
      return { month, values: {}, reason: hasValue(reason) ? 'no_source' : reason.state }
    }
    const split = fd.explore_only !== null && fd.nothing !== null
    return {
      month,
      reason: null,
      values: {
        guide: fd.guide,
        story_only: fd.guide_or_story - fd.guide,
        explore_only: split ? fd.explore_only : null,
        nothing: split ? fd.nothing : null,
        rest: split ? null : fd.entered - fd.guide_or_story,
      },
    }
  })
  const nothing = usageCell(input, input.month, 'open', (u) => u.first_day.nothing)
  const status = statusOf(input, ['usage'], headline.cell)
  return {
    key: 'block_1',
    status: status === 'ready' && e === 0 ? 'empty' : status,
    headline,
    stats,
    series: [...FIRST_DAY_SERIES],
    chart,
    facts: { nothing },
    since: input.usage?.data_since.trip ?? null,
  }
}

// ── Block 2: who turns the guide on and moves (spec §E5.3) ───────────────────────────────────

/** The modes, bottom to top, and the grey of a month not split yet (spec §E4, §C4 item 1). */
export const MODE_SERIES = ['drive_only', 'both', 'explore_only', 'trip_total'] as const

export function buildBlock2(input: QuestionsInput): QuestionBlock {
  const guidePeople = (m: string) => usageCell(input, m, 'trip', (u) => u.guide?.people)
  const opened = (m: string) => bankCell(input, m, 'open', (b) => b.active.open)
  const opensKnown = hasValue(opened(input.month))
  // With app opens measured the answer compares the share of those who opened; without, the count.
  const headline = statOf(
    opensKnown
      ? { key: 'questions.block_2.turned_on', source: 'bank', kind: 'rate', unit: 'points', pctOf: 'questions.common.of_opened', at: (m) => ({ cell: rateCell(guidePeople(m), opened(m)), base: opened(m) }) }
      : { key: 'questions.block_2.turned_on', source: 'bank', kind: 'count', unit: 'relative', at: (m) => ({ cell: guidePeople(m), base: guidePeople(m) }) },
    input,
  )
  const withShare = (key: string, pick: (m: string) => Cell, hint?: string): Stat =>
    statOf(
      {
        key,
        source: 'bank',
        kind: 'count',
        unit: 'relative',
        pctOf: 'questions.common.of_opened',
        hint,
        at: (m) => ({ cell: pick(m), base: pick(m), pct: share(valueOf(pick(m)), valueOf(opened(m))) }),
      },
      input,
    )
  const stats: Stat[] = [
    withShare('questions.block_2.turned_on', guidePeople),
    statOf(
      {
        key: 'questions.block_2.km',
        source: 'bank',
        kind: 'km',
        unit: 'relative',
        pctOf: 'questions.common.of_guide',
        hint: 'questions.block_2.km_hint',
        at: (m) => ({ cell: usageCell(input, m, 'trip', (u) => u.km?.per_person_median), base: usageCell(input, m, 'trip', (u) => u.km?.people) }),
      },
      input,
    ),
    withShare('summary.modes.drive_only', (m) => bankCell(input, m, 'open', (b) => b.modes.drive_only), 'summary.modes.help_drive_only'),
    withShare('summary.modes.both', (m) => bankCell(input, m, 'open', (b) => b.modes.both), 'summary.modes.help_both'),
  ]
  // The columns of the modes card of before, one ruler of truth for the split (§C4 item 1).
  const window = chartMonths(input.month)
  const columns = input.bank ? buildModeColumns({ months: window, today: input.today, use: 'trip', bank: input.bank, bankFailed: input.bankFailed, ga4Failed: false, ga4Filtered: false }).columns : []
  const chart = window.map((month): ChartRow => {
    const col = columns.find((c) => c.month === month)
    const values: Record<string, number | null> = {}
    let reason: CellState | null = null
    for (const seg of col?.segments ?? []) {
      values[seg.key] = valueOf(seg.cell)
      if (!hasValue(seg.cell)) reason = seg.cell.state
    }
    const drawn = Object.values(values).some((v) => v !== null)
    return { month, values, reason: drawn ? null : (reason ?? (input.bankFailed ? 'source_failed' : 'loading')) }
  })
  const km = usageCell(input, input.month, 'trip', (u) => u.km?.per_person_median)
  const status = statusOf(input, ['usage', 'bank'], headline.cell)
  return {
    key: 'block_2',
    status: status === 'ready' && valueOf(guidePeople(input.month)) === 0 ? 'empty' : status,
    headline,
    stats,
    series: [...MODE_SERIES],
    chart,
    facts: { km, people: guidePeople(input.month), opened: opened(input.month) },
    since: input.usage?.data_since.trip ?? null,
  }
}

// ── Block 3: how long the guide stays on (spec §E5.4) ────────────────────────────────────────

export const SCREEN_SERIES = ['on_screen', 'off_screen'] as const

export function buildBlock3(input: QuestionsInput): QuestionBlock {
  const trip = (m: string) => bankCell(input, m, 'trip', (b) => b.active.trip)
  const median = statOf({ key: 'questions.block_3.median', source: 'bank', kind: 'minutes', unit: 'relative', hint: 'rows.guide_median_hint', at: (m) => ({ cell: bankCell(input, m, 'trip', (b) => b.guide_minutes_median), base: trip(m) }) }, input)
  const stats: Stat[] = [
    median,
    statOf({ key: 'questions.block_3.p75', source: 'bank', kind: 'minutes', unit: 'relative', hint: 'rows.guide_p75_hint', at: (m) => ({ cell: bankCell(input, m, 'trip', (b) => b.guide_minutes_p75), base: trip(m) }) }, input),
    statOf(
      {
        key: 'questions.block_3.off_screen',
        source: 'bank',
        kind: 'rate',
        unit: 'points',
        pctOf: 'questions.common.of_guide_time',
        hint: 'questions.block_3.screen_hint',
        // The heartbeats of #1098 start with app opens: before them the split is not recorded.
        at: (m) => ({ cell: bankCell(input, m, 'open', (b) => b.guide_background_share), base: trip(m) }),
      },
      input,
    ),
  ]
  const chart = chartMonths(input.month).map((month): ChartRow => {
    const bg = bankCell(input, month, 'open', (b) => b.guide_background_share)
    const v = valueOf(bg)
    return v === null ? { month, values: {}, reason: bg.state } : { month, values: { on_screen: 1 - v, off_screen: v }, reason: null }
  })
  const status = statusOf(input, ['bank'], median.cell)
  return {
    key: 'block_3',
    status: status === 'ready' && valueOf(trip(input.month)) === 0 ? 'empty' : status,
    headline: median,
    stats,
    series: [...SCREEN_SERIES],
    chart,
    facts: { p75: stats[1].cell, bg: stats[2].cell },
    since: input.bank?.data_since.trip ?? null,
  }
}

// ── Block 4: how long the guide stays on while moving (spec §E5.5) ───────────────────────────

/** The buckets the app records, darker for faster (spec §E4); cycling prints as a number only. */
export const MOVEMENT_SERIES = ['vehicle', 'walking', 'stopped'] as const
const MOVEMENT_FIELD = {
  vehicle: 'vehicle_minutes_median',
  walking: 'walking_minutes_median',
  stopped: 'stopped_minutes_median',
  cycling: 'cycling_minutes_median',
} as const

/** A movement median of a month: a floor while the registrar covered under `MOVEMENT_FULL_COVERAGE` of the trips. */
function movementCell(input: QuestionsInput, month: string, field: (typeof MOVEMENT_FIELD)[keyof typeof MOVEMENT_FIELD]): Cell {
  const c = usageCell(input, month, 'movement', (u) => u.movement?.[field])
  const coverage = input.usage?.months.find((x) => x.month === month)?.movement?.coverage ?? null
  return hasValue(c) && coverage !== null && coverage < MOVEMENT_FULL_COVERAGE ? { ...c, state: 'floor' } : c
}

export function buildBlock4(input: QuestionsInput): QuestionBlock {
  const people = (m: string) => usageCell(input, m, 'movement', (u) => u.movement?.people)
  const stat = (key: keyof typeof MOVEMENT_FIELD) =>
    statOf({ key: `questions.block_4.${key}`, source: 'bank', kind: 'minutes', unit: 'relative', hint: 'questions.block_4.hint_buckets', at: (m) => ({ cell: movementCell(input, m, MOVEMENT_FIELD[key]), base: people(m) }) }, input)
  const stats = [stat('vehicle'), stat('walking'), stat('stopped'), stat('cycling')]
  const chart = chartMonths(input.month).map((month): ChartRow => {
    const cells = MOVEMENT_SERIES.map((k) => movementCell(input, month, MOVEMENT_FIELD[k]))
    if (cells.every((c) => !hasValue(c))) return { month, values: {}, reason: cells[0].state }
    return { month, values: Object.fromEntries(MOVEMENT_SERIES.map((k, i) => [k, valueOf(cells[i])])), reason: null }
  })
  const status = statusOf(input, ['usage'], stats[0].cell)
  const coverage = input.usage?.months.find((x) => x.month === input.month)?.movement?.coverage ?? null
  return {
    key: 'block_4',
    status: status === 'ready' && valueOf(people(input.month)) === 0 ? 'empty' : status,
    headline: stats[0],
    stats,
    series: [...MOVEMENT_SERIES],
    chart,
    facts: { walking: stats[1].cell, stopped: stats[2].cell, coverage: coverage === null ? cell('no_source') : cell('measured', coverage) },
    since: input.usage?.data_since.movement ?? null,
  }
}

export function buildBlocks(input: QuestionsInput): QuestionBlock[] {
  return [buildBlock1(input), buildBlock2(input), buildBlock3(input), buildBlock4(input)]
}

// ── Funnels (spec §E6) ───────────────────────────────────────────────────────────────────────

const reasonOf = (c: Cell): StepReason | undefined =>
  c.state === 'before_source' ? 'before_source' : c.state === 'source_failed' ? 'source_failed' : c.state === 'ga4_filter' ? 'filter' : c.state === 'loading' ? 'loading' : hasValue(c) ? undefined : 'no_source'

const step = (key: string, source: 'bank' | 'ga4', c: Cell, extra: Partial<StepInput> = {}): StepInput => ({
  key,
  source,
  value: valueOf(c),
  floor: c.state === 'floor',
  reason: reasonOf(c),
  ...extra,
})

/** The day the 2nd-trip window of a month closes: the first day complete (spec §E6.1 step 7). */
export function secondTripDue(month: string): string {
  return addDays(`${addMonths(month, 1)}-01`, SECOND_TRIP_WINDOW_DAYS)
}

/**
 * The use funnel of the month (spec §E6.1): installs and location are GA4 and hollow; entered, guide,
 * first story, 1 hour and the 2nd trip are the bank's cohort, each a share of entered (BR-USUARIO-037
 * item 3.j).
 */
export function buildUseFunnel(input: QuestionsInput): StepFunnelView {
  const m = input.month
  const u = (pick: (x: UsageMonth) => number | null, since: UsageSince = 'trip') => usageCell(input, m, since, pick)
  const ledgerPartial = input.usage?.months.find((x) => x.month === m)?.ledger_coverage === 'partial'
  const used1h = u((x) => x.usage_funnel.used_1h, 'ledger')
  const second = u((x) => x.usage_funnel.second_trip, 'ledger')
  const due = secondTripDue(m)
  const open = input.today < due
  return readStepFunnel('bank', [
    step('step_1', 'ga4', installsCell(input, m)),
    step('step_2', 'bank', u((x) => x.usage_funnel.entered)),
    step('step_3', 'ga4', ga4Cell(input, m, (g) => g.permissions.location?.allowed ?? null)),
    step('step_4', 'bank', u((x) => x.usage_funnel.guide_on)),
    step('step_5', 'bank', u((x) => x.usage_funnel.first_story, 'audio')),
    step('step_6', 'bank', ledgerPartial && hasValue(used1h) ? { ...used1h, state: 'floor' } : used1h),
    step('step_7', 'bank', open && hasValue(second) ? { ...second, state: 'floor' } : second, { due: open ? due : null }),
  ])
}

/** The GA4 half of the purchase funnel (spec §E6.2): saw, tapped a plan, bought; all shares of who saw. */
export function buildPaywallFunnel(input: QuestionsInput): { view: StepFunnelView; closed: Cell; failed: Cell } {
  const g = (pick: (x: EngagementGa4Month) => number | null) => ga4Cell(input, input.month, pick)
  return {
    view: readStepFunnel('ga4', [
      step('step_1', 'ga4', g((x) => x.paywallViewedUsers)),
      step('step_2', 'ga4', g((x) => x.paywallPlanTappedUsers)),
      step('step_3', 'ga4', g((x) => x.paywallConvertedUsers)),
    ]),
    closed: g((x) => x.paywallDismissedUsers),
    failed: g((x) => x.paywallPurchaseFailedUsers),
  }
}

/** The free minutes the cohort's buyers used before buying (spec §E6.2), when the function sends it. */
export function freeBeforeCell(input: QuestionsInput): Cell {
  return usageCell(input, input.month, 'ledger', (u) => u.purchase.free_minutes_before_median)
}
