/**
 * The three signal cards under the question blocks of the Engagement page (#1162, spec Parte E §E7):
 * active people and devices, the permissions, and where they use it. Pure, like `blocks.ts`, so every
 * number is tested without mounting; the component translates and lays out.
 *
 *  - **Two rulers that never mix** (DS-COMPONENTE-084 item 2): the database counts people
 *    (`cms_get_active_users_monthly`), GA4 counts devices; each half has its own numbers, its own chart
 *    and its own base line. DAU/MAU is always a ratio inside one ruler.
 *  - **Coverage of app opens** (contract Parte 27 §5): `partial` prints the database numbers as a floor
 *    and keeps the month off the chart; `none` is "no data", never 0 (BR-COMUNICACAO-022 item 4).
 *  - **Permissions are GA4 over GA4**, the same event: devices that allowed over devices that answered.
 */

import { cell, ga4Cell, hasValue, rateCell, share, statOf, statusOf, usageCell, valueOf, chartMonths, type BlockStatus, type ChartRow, type QuestionsInput, type Stat } from '@/lib/engagement/blocks'
import { comparisonOf, type Answer, type AnswerValue } from '@/lib/engagement/answers'
import { GA4_PERMISSION_TYPES, type EngagementGa4Month, type Ga4PermissionType } from '@/lib/engagement/report'
import type { Cell } from '@/lib/engagement/cells'
import type { ActiveRuler } from '@/lib/engagement/active-users'

export interface SignalCard {
  status: BlockStatus
  stats: Stat[]
  answer: Answer | null
}

const has = hasValue
const pct = (c: Cell): AnswerValue => ({ kind: 'pct', value: c.value as number })
const int = (c: Cell): AnswerValue => ({ kind: 'int', value: c.value as number })

const failedAnswer: Answer = { key: 'questions.common.answer_failed', values: {}, cmp: null, floor: false, retry: true }

// ── Active per day, week and month (spec §E7.5) ──────────────────────────────────────────────

export interface ActiveHalf extends SignalCard {
  /** DAU/MAU by month, the six of the page; a month off the ruler draws nothing and says why. */
  chart: ChartRow[]
}

/**
 * A number of the database half. `all_sources` reads the app opens: `partial` is a floor, `none` is before
 * the source. A month the function did not return, or a `null`, says why without printing 0.
 */
function activeCell(input: QuestionsInput, month: string, key: keyof ActiveRuler): Cell {
  if (input.activeFailed) return cell('source_failed')
  if (!input.active) return cell('loading')
  const since = input.active.data_since.open
  const m = input.active.months.find((x) => x.month === month)
  const all = m?.all_sources
  if (!all || all.open_coverage === 'none' || all.open_coverage === null) return cell('before_source', null, { since })
  const v = all[key]
  if (v === null) return cell('no_source')
  return cell(all.open_coverage === 'partial' ? 'floor' : 'measured', v)
}

export function buildActiveBank(input: QuestionsInput): ActiveHalf {
  const stat = (key: keyof ActiveRuler, label: string, kind: 'count' | 'rate', hint?: string) =>
    statOf({ key: label, source: 'bank', kind, unit: kind === 'rate' ? 'points' : 'relative', hint, at: (m) => ({ cell: activeCell(input, m, key), base: activeCell(input, m, 'mau') }) }, input)
  const stats = [
    stat('dau', 'questions.extra_active.dau', 'count', 'questions.extra_active.dau_hint'),
    stat('wau', 'questions.extra_active.wau', 'count', 'questions.extra_active.wau_hint'),
    stat('mau', 'questions.extra_active.mau', 'count'),
    stat('dau_mau', 'questions.extra_active.ratio', 'rate', 'questions.extra_active.ratio_hint'),
  ]
  // A floor month is a different coverage: it stays off the chart, the numbers above say "at least" (DS-COMPONENTE-084 item 2).
  const chart = chartMonths(input.month).map((month): ChartRow => {
    const c = activeCell(input, month, 'dau_mau')
    return c.state === 'measured' ? { month, values: { ratio: c.value }, reason: null } : { month, values: {}, reason: c.state === 'floor' ? 'before_source' : c.state }
  })
  const status = statusOf(input, ['active'], stats[0].cell)
  const [dau, , mau, ratio] = stats.map((s) => s.cell)
  let answer: Answer | null = null
  if (status === 'failed') answer = failedAnswer
  else if (has(dau) && has(mau) && has(ratio) && ratio.state === 'measured') {
    answer = { key: 'questions.extra_active.answer', values: { dau: int(dau), mau: int(mau), ratio: pct(ratio), month: { kind: 'month', value: input.month } }, cmp: comparisonOf(stats[3].delta, 'rate'), floor: false, retry: false }
  }
  return { status, stats, answer, chart }
}

/** The GA4 half, devices: the daily and weekly windows averaged over the month, and the month's active devices. */
export function buildActiveGa4(input: QuestionsInput): ActiveHalf {
  const g = (m: string, pick: (x: EngagementGa4Month) => number | null) => ga4Cell(input, m, pick)
  const dau = (m: string) => g(m, (x) => x.active1DayAvg)
  const mau = (m: string) => g(m, (x) => x.activeUsers)
  const stat = (label: string, at: (m: string) => Cell, kind: 'count' | 'rate', hint?: string) =>
    statOf({ key: label, source: 'ga4', kind, unit: kind === 'rate' ? 'points' : 'relative', hint, at: (m) => ({ cell: at(m), base: mau(m) }) }, input)
  const ratio = (m: string) => rateCell(dau(m), mau(m))
  const stats = [
    stat('questions.extra_active.dau', dau, 'count', 'questions.extra_active.dau_hint'),
    stat('questions.extra_active.wau', (m) => g(m, (x) => x.active7DayAvg), 'count', 'questions.extra_active.wau_hint'),
    stat('questions.extra_active.mau', mau, 'count'),
    stat('questions.extra_active.ratio', ratio, 'rate', 'questions.extra_active.ratio_hint'),
  ]
  const chart = chartMonths(input.month).map((month): ChartRow => {
    const c = ratio(month)
    return has(c) ? { month, values: { ratio: c.value }, reason: null } : { month, values: {}, reason: c.state }
  })
  const status = statusOf(input, ['ga4'], stats[0].cell)
  const [d, , m, r] = stats.map((s) => s.cell)
  let answer: Answer | null = null
  if (status === 'failed') answer = failedAnswer
  else if (has(d) && has(m) && has(r)) {
    answer = { key: 'questions.extra_active.answer_ga4', values: { dau: int(d), mau: int(m), ratio: pct(r), month: { kind: 'month', value: input.month } }, cmp: comparisonOf(stats[3].delta, 'rate'), floor: false, retry: false }
  }
  return { status, stats, answer, chart }
}

// ── Permissions (spec §E7.2) ─────────────────────────────────────────────────────────────────

export interface PermissionRow {
  type: Ga4PermissionType
  asked: Cell
  allowed: Cell
  /** `allowed / asked`, one event of one instrument; `null` with no positive base. */
  share: number | null
}

export interface PermissionsCard extends SignalCard {
  rows: PermissionRow[]
}

export function buildPermissions(input: QuestionsInput): PermissionsCard {
  const asked = (m: string, t: Ga4PermissionType) => ga4Cell(input, m, (x) => x.permissions[t]?.asked ?? null)
  const allowed = (m: string, t: Ga4PermissionType) => ga4Cell(input, m, (x) => x.permissions[t]?.allowed ?? null)
  const rows = GA4_PERMISSION_TYPES.map((type): PermissionRow => {
    const a = asked(input.month, type)
    const g = allowed(input.month, type)
    return { type, asked: a, allowed: g, share: share(valueOf(g), valueOf(a)) }
  })
  const location = statOf(
    { key: 'questions.extra_permissions.location', source: 'ga4', kind: 'rate', unit: 'points', at: (m) => ({ cell: rateCell(allowed(m, 'location'), asked(m, 'location')), base: asked(m, 'location') }) },
    input,
  )
  const status = statusOf(input, ['ga4'], location.cell)
  let answer: Answer | null = null
  if (status === 'failed') answer = failedAnswer
  else if (status === 'no_source') answer = { key: 'questions.common.answer_no_data_ga4', values: { month: { kind: 'month', value: input.month } }, cmp: null, floor: false, retry: false }
  else if (has(location.cell)) answer = { key: 'questions.extra_permissions.answer', values: { pct: pct(location.cell) }, cmp: comparisonOf(location.delta, 'rate'), floor: false, retry: false }
  return { status, stats: [location], answer, rows }
}

// ── Where they use it, trips with no story and stories per hour (spec §E7.4) ─────────────────

export interface CityRow {
  id: number
  name: string
  trips: number
  /** In the list of trips with no story: those trips. */
  withoutStory?: number
}

export interface WhereCard extends SignalCard {
  byTrips: CityRow[]
  /** `null` before the audio source. */
  byNoStory: CityRow[] | null
}

export function buildWhere(input: QuestionsInput): WhereCard {
  const u = (m: string, pick: Parameters<typeof usageCell>[3]) => usageCell(input, m, 'audio', pick)
  const trips = (m: string) => u(m, (x) => x.stories?.trips)
  const noStory = (m: string) => u(m, (x) => x.stories?.trips_without_story)
  const noStoryStat = statOf(
    {
      key: 'questions.extra_no_story.title',
      source: 'bank',
      kind: 'count',
      unit: 'relative',
      pctOf: 'questions.common.of_trips',
      hint: 'questions.extra_no_story.hint',
      at: (m) => ({ cell: noStory(m), base: trips(m), pct: share(valueOf(noStory(m)), valueOf(trips(m))) }),
    },
    input,
  )
  const perHour = statOf({ key: 'questions.extra_per_hour.title', source: 'bank', kind: 'km', unit: 'relative', hint: 'questions.extra_per_hour.hint', at: (m) => ({ cell: u(m, (x) => x.stories?.per_guide_hour), base: trips(m) }) }, input)
  const status = statusOf(input, ['usage'], noStoryStat.cell)
  const n = noStory(input.month)
  const t = trips(input.month)
  let answer: Answer | null = null
  if (status === 'failed') answer = failedAnswer
  else if (has(n) && has(t) && (t.value as number) > 0) {
    answer = { key: 'questions.extra_no_story.answer', values: { pct: { kind: 'pct', value: (n.value as number) / (t.value as number) }, n: int(n), total: int(t) }, cmp: comparisonOf(noStoryStat.delta, 'count'), floor: false, retry: false }
  }
  const m = input.usage?.months.find((x) => x.month === input.month)
  const byTrips = (m?.top_cities?.by_trips ?? []).map((c) => ({ id: c.city_id, name: c.city, trips: c.trips }))
  const ns = m?.top_cities?.by_trips_without_story
  return { status, stats: [noStoryStat, perHour], answer, byTrips, byNoStory: ns ? ns.map((c) => ({ id: c.city_id, name: c.city, trips: c.trips, withoutStory: c.trips_without_story })) : null }
}
