'use client'

/**
 * The month chart of a question block (#1161, spec Parte E §E4): six months as bars, stacked to 100 %
 * (`expand`), stacked as counts (`stack`) or side by side (`group`). Module of its own, loaded by
 * `next/dynamic` (recharts inspects the concrete type of its children). A month with no number draws no
 * bar and keeps its tick; the tooltip says why (DS-COMPONENTE-084 item 1).
 */

import { Bar, BarChart, CartesianGrid, Cell, DefaultZIndexes, ResponsiveContainer, Tooltip, XAxis, YAxis, ZIndexLayer, usePlotArea, useXAxisScale, useYAxisScale } from 'recharts'
import { UNKNOWN_VALUE } from '@/lib/format/unknown'
import { LABEL_FONT_MIN, centredBaseline, clampCentre, dropColliding, fitFont, labelHeight, labelWidth, type LabelBox } from '@/lib/dashboard/chart-labels'
import { useWide } from '@/components/dashboard/reports/engagement/useWide'
import {
  MONTH_BARS_PX,
  PARTIAL_OPACITY,
  type MonthBarsRow,
  type MonthBarsSeries,
  type MonthBarsTooltip,
} from '@/components/dashboard/reports/engagement/question-charts'

const TICK = { fill: '#6b7280', fontSize: 10, fontWeight: 700 }

/** `primary.800`, 5.44:1 over white: the total over a stack. */
const VALUE_INK = '#00719F'
/** Inside a running month's segment (drawn at 0.45), white would vanish: `gray-800`. */
const PARTIAL_INK = '#1f2937'
/** recharts' default `barCategoryGap` is 10 % of the band on each side. */
const BAR_SHARE = 0.8
/** Room the total needs above the tallest bar, px. */
const VALUES_TOP_PX = 18

type ValueLabel = LabelBox & { key: string; text: string; inside: boolean; partial: boolean; fontSize: number }

/**
 * The numbers of a `stack` chart (#1204, "numbers always visible"): the total over each bar, and each
 * segment's value inside it, in white, when the segment has room and the bar has two segments or more
 * (one segment is the total already). Positions come from recharts' scales, never from `LabelList`,
 * whose index is not the row's in recharts 3.10 (fato-recharts3-labellist).
 */
function StackValues({
  rows,
  series,
  text,
  maxBarSize,
}: {
  rows: MonthBarsRow[]
  series: MonthBarsSeries[]
  text: (v: number, row: MonthBarsRow) => string
  maxBarSize: number
}) {
  const x = useXAxisScale()
  const y = useYAxisScale()
  const area = usePlotArea()
  if (!x || !y || !area) return null

  const bars = rows.flatMap((row) => {
    const start = x(row.month, { position: 'start' })
    const end = x(row.month, { position: 'end' })
    const segments = series.map((s) => ({ key: s.key, value: row.values[s.key] })).filter((s): s is { key: string; value: number } => typeof s.value === 'number' && s.value > 0)
    if (start === undefined || end === undefined || segments.length === 0) return []
    const total = segments.reduce((sum, s) => sum + s.value, 0)
    return [{ row, centre: (start + end) / 2, band: end - start, segments, total }]
  })
  if (bars.length === 0) return null

  const band = Math.min(...bars.map((b) => b.band))
  const barWidth = Math.min(band * BAR_SHARE, maxBarSize)
  const fontSize = fitFont(bars.map((b) => text(b.total, b.row)), band - 2) ?? LABEL_FONT_MIN
  const height = labelHeight(fontSize)

  const labels: ValueLabel[] = []
  for (const b of bars) {
    const top = y(b.total)
    if (top === undefined) continue
    const totalText = text(b.total, b.row)
    const totalWidth = labelWidth(totalText, fontSize)
    labels.push({ key: `${b.row.month}-total`, text: totalText, x: clampCentre(b.centre, totalWidth, area.x, area.x + area.width), y: top - 4, width: totalWidth, height, priority: 2, inside: false, partial: !!b.row.partial, fontSize })
    if (b.segments.length < 2) continue
    let base = 0
    for (const s of b.segments) {
      const lo = y(base)
      const hi = y(base + s.value)
      base += s.value
      if (lo === undefined || hi === undefined) continue
      const segText = text(s.value, b.row)
      const width = labelWidth(segText, fontSize)
      if (lo - hi < fontSize + 4 || width > barWidth - 2) continue
      labels.push({ key: `${b.row.month}-${s.key}`, text: segText, x: b.centre, y: centredBaseline((lo + hi) / 2, fontSize), width, height, priority: 1, inside: true, partial: !!b.row.partial, fontSize })
    }
  }

  return (
    <ZIndexLayer zIndex={DefaultZIndexes.label}>
      <g data-testid="month-bars-values">
        {dropColliding(labels).map((l) => (
          <text
            key={l.key}
            data-value={l.inside ? 'segment' : 'total'}
            x={l.x}
            y={l.y}
            textAnchor="middle"
            fontSize={l.fontSize}
            fontWeight={l.inside ? 800 : 900}
            fill={l.inside ? (l.partial ? PARTIAL_INK : '#fff') : VALUE_INK}
          >
            {l.text}
          </text>
        ))}
      </g>
    </ZIndexLayer>
  )
}

function TooltipBox({
  active,
  payload,
  series,
  format,
  tooltip,
}: {
  active?: boolean
  payload?: Array<{ payload: MonthBarsRow & Record<string, unknown> }>
  series: MonthBarsSeries[]
  format: (v: number, row: MonthBarsRow) => string
  tooltip?: (row: MonthBarsRow) => MonthBarsTooltip
}) {
  const d = payload?.[0]?.payload
  if (!active || !d) return null
  if (tooltip) {
    const box = tooltip(d)
    return (
      <div className="max-w-xs rounded-xl bg-white px-3 py-2 text-xs text-gray-800 shadow-lg">
        <p className="font-semibold">{box.title}</p>
        {box.lines.map((line, i) => (
          <p key={i}>{line}</p>
        ))}
      </div>
    )
  }
  const shown = series.filter((s) => d.values[s.key] !== undefined)
  return (
    <div className="max-w-xs rounded-xl bg-white px-3 py-2 text-xs text-gray-800 shadow-lg">
      <p className="font-semibold">{d.label}</p>
      {d.reason ? (
        <p>
          {UNKNOWN_VALUE} {d.reason}
        </p>
      ) : (
        shown.map((s) => (
          <p key={s.key}>
            {s.label}: {d.values[s.key] === null ? UNKNOWN_VALUE : format(d.values[s.key] as number, d)}
          </p>
        ))
      )}
    </div>
  )
}

export function MonthBars({
  label,
  rows,
  series,
  mode,
  format,
  axis,
  tooltip,
  values,
}: {
  label: string
  rows: MonthBarsRow[]
  series: MonthBarsSeries[]
  mode: 'expand' | 'stack' | 'group'
  /** A value in the tooltip. */
  format: (v: number, row: MonthBarsRow) => string
  /** The y tick. */
  axis: (v: number) => string
  /** The whole tooltip, when one line per series is not enough. */
  tooltip?: (row: MonthBarsRow) => MonthBarsTooltip
  /** Writes the numbers on the chart (`stack` only): the text of a total or a segment. Off by default, so the engagement report keeps its tooltip-only bars. */
  values?: (v: number, row: MonthBarsRow) => string
}) {
  const wide = useWide()
  const data = rows.map((r) => ({ ...r, ...Object.fromEntries(series.map((s) => [s.key, r.values[s.key] ?? null])) }))
  const stacked = mode !== 'group'
  const maxBarSize = mode === 'group' ? 14 : 40
  const withValues = !!values && mode === 'stack'
  return (
    <div role="img" aria-label={label} data-testid="month-bars">
      <ResponsiveContainer width="100%" height={MONTH_BARS_PX}>
        <BarChart data={data} margin={{ top: withValues ? VALUES_TOP_PX : 8, right: 8, bottom: 0, left: 0 }} stackOffset={mode === 'expand' ? 'expand' : undefined}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} strokeOpacity={0.4} />
          <XAxis dataKey="month" tickFormatter={(m: string) => (wide ? rows.find((r) => r.month === m)?.label : rows.find((r) => r.month === m)?.short) ?? m} tick={TICK} axisLine={false} tickLine={false} height={22} interval={0} />
          <YAxis tick={TICK} axisLine={false} tickLine={false} width={40} tickFormatter={axis} allowDecimals={mode === 'expand'} />
          <Tooltip cursor={{ fill: 'rgba(0,168,232,0.03)' }} content={<TooltipBox series={series} format={format} tooltip={tooltip} />} isAnimationActive={false} />
          {series.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label}
              fill={s.color}
              stackId={stacked ? 'm' : undefined}
              stroke="#fff"
              strokeWidth={stacked ? 2 : 0}
              radius={!stacked || i === series.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
              maxBarSize={maxBarSize}
              isAnimationActive={false}
            >
              {rows.map((r) => (
                <Cell key={r.month} fillOpacity={r.partial ? PARTIAL_OPACITY : 1} />
              ))}
            </Bar>
          ))}
          {withValues && values && <StackValues rows={rows} series={series} text={values} maxBarSize={maxBarSize} />}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export default MonthBars
