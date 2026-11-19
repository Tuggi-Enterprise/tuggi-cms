'use client'

import type { ReactNode } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  DefaultZIndexes,
  Line,
  Rectangle,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ZIndexLayer,
  usePlotArea,
  useXAxisScale,
  useYAxisScale,
} from 'recharts'
import { CHART_COLORS } from '@/lib/constants/chart-colors'
import { useWide } from '@/components/dashboard/reports/engagement/useWide'
import { PARTIAL_OPACITY } from '@/components/dashboard/reports/engagement/question-charts'
import type { DayPoint, HourUsage } from '@/lib/dashboard/usage'
import { DAILY_PX, HOURLY_PX, peakHour } from '@/lib/dashboard/usage'
import { LABEL_FONT_MIN, clampCentre, dropColliding, fitFont, labelHeight, labelWidth } from '@/lib/dashboard/chart-labels'

/**
 * The two charts of the "use by hour" card (#1204, spec-cms-dashboard-uso §4): by hour (average people
 * per day as bars, peak concurrent as a line, one scale, both count people) and by day under it. One
 * module because both come from the same call and the same period; loaded with next/dynamic, since
 * recharts inspects the concrete type of its children.
 *
 * Values ride on bar shapes and on recharts' scales, never on `LabelList`: recharts 3.10 hands
 * `LabelList` an index that is not the row's (fato-recharts3-labellist).
 */

/** `primary.800`, 5.44:1 over white. */
const VALUE_INK = '#00719F'
const TICK = { fill: '#6b7280', fontSize: 10, fontWeight: 700 }
const TOOLTIP = 'max-w-xs rounded-xl bg-white px-3 py-2 text-xs text-gray-800 shadow-lg'

export interface UsageByHourLabels {
  hourTick: (hour: number) => string
  hourRange: (hour: number) => string
  peak: string
  avg: string
  dayPeople: string
  peakTime: string
  noPeak: string
  soFar: string
}

interface HourTooltipProps {
  active?: boolean
  payload?: Array<{ payload: HourUsage }>
}

interface DayTooltipProps {
  active?: boolean
  payload?: Array<{ payload: DayPoint }>
}

interface ShapeProps {
  x?: number
  y?: number
  width?: number
  height?: number
  payload?: DayPoint
}

function HourTooltip({ active, payload, labels, locale }: HourTooltipProps & { labels: UsageByHourLabels; locale: string }) {
  const h = payload?.[0]?.payload
  if (!active || !h) return null
  return (
    <div className={TOOLTIP}>
      <p className="font-semibold">{labels.hourRange(h.hour)}</p>
      <p>
        {labels.peak}: {new Intl.NumberFormat(locale).format(h.peak_concurrent)}
      </p>
      <p>
        {labels.avg}: {new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(h.avg_unique_users)}
      </p>
    </div>
  )
}

function DayTooltip({ active, payload, labels, locale }: DayTooltipProps & { labels: UsageByHourLabels; locale: string }) {
  const d = payload?.[0]?.payload
  if (!active || !d) return null
  const integer = new Intl.NumberFormat(locale)
  const long = new Date(`${d.day}T12:00:00Z`).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
  const clock = d.peak_at
    ? new Date(d.peak_at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
    : labels.noPeak
  return (
    <div className={TOOLTIP}>
      <p className="font-semibold">{d.today ? `${long} · ${labels.soFar}` : long}</p>
      <p>
        {labels.dayPeople}: {integer.format(d.unique_users)}
      </p>
      <p>
        {labels.peak}: {integer.format(d.peak_concurrent)}
      </p>
      <p>
        {labels.peakTime}: {clock}
      </p>
    </div>
  )
}

/**
 * The peak concurrent of every hour above it, in the line's orange (#1204, "numbers always visible"):
 * only where it is above zero, over the higher mark of the hour (bar or line). The highest peak keeps
 * the heavier weight. When 24 labels do not fit (390 px with wide numbers), the font shrinks to 9 px
 * first; a label that still collides is dropped, the lower peak first, and the highest always stays.
 */
function PeakValues({ hours, peakHourOf, format }: { hours: HourUsage[]; peakHourOf: number | null; format: (v: number) => string }) {
  const x = useXAxisScale()
  const y = useYAxisScale()
  const area = usePlotArea()
  if (!x || !y || !area) return null

  const points = hours.flatMap((h) => {
    const start = x(h.hour, { position: 'start' })
    const end = x(h.hour, { position: 'end' })
    const top = y(Math.max(h.peak_concurrent, h.avg_unique_users))
    if (h.peak_concurrent <= 0 || start === undefined || end === undefined || top === undefined) return []
    return [{ h, text: format(h.peak_concurrent), centre: (start + end) / 2, band: end - start, top }]
  })
  if (points.length === 0) return null

  const fontSize = fitFont(points.map((p) => p.text), Math.min(...points.map((p) => p.band)) - 4) ?? LABEL_FONT_MIN
  const height = labelHeight(fontSize)
  const labels = points.map((p) => {
    // The white halo (stroke 3) widens the ink by 1.5 px on each side.
    const width = labelWidth(p.text, fontSize) + 3
    return {
      key: p.h.hour,
      text: p.text,
      top: p.h.hour === peakHourOf,
      x: clampCentre(p.centre, width, area.x, area.x + area.width),
      y: p.top - 6,
      width,
      height,
      priority: p.h.peak_concurrent,
    }
  })

  return (
    <ZIndexLayer zIndex={DefaultZIndexes.label}>
      <g data-testid="hourly-peak-values">
        {dropColliding(labels).map((l) => (
          <text
            key={l.key}
            data-testid={l.top ? 'hourly-peak-value' : undefined}
            x={l.x}
            y={l.y}
            textAnchor="middle"
            fill={CHART_COLORS.orange}
            stroke="#fff"
            strokeWidth={3}
            fontSize={fontSize}
            fontWeight={l.top ? 900 : 600}
            style={{ paintOrder: 'stroke' }}
          >
            {l.text}
          </text>
        ))}
      </g>
    </ZIndexLayer>
  )
}

export function UsageByHourChart({
  hours,
  days,
  labels,
  locale,
  middle,
}: {
  hours: HourUsage[]
  days: DayPoint[]
  labels: UsageByHourLabels
  locale: string
  /** What sits between the two charts: the legend and the "by day" label, drawn by the card. */
  middle?: ReactNode
}) {
  const wide = useWide()
  const integer = new Intl.NumberFormat(locale)
  const peak = peakHour(hours)
  const dayTitle = (day: string, withWeekday: boolean) => {
    const d = new Date(`${day}T12:00:00Z`)
    const weekday = d.toLocaleDateString(locale, { weekday: 'short', timeZone: 'UTC' }).replace('.', '')
    const dayOfMonth = d.toLocaleDateString(locale, { day: 'numeric', timeZone: 'UTC' })
    return withWeekday ? `${weekday} ${dayOfMonth}` : dayOfMonth
  }
  const weekView = days.length <= 7

  const dayShape = (props: unknown) => {
    const { x = 0, y = 0, width = 0, height = 0, payload } = props as ShapeProps
    return (
      <g>
        <Rectangle
          x={x}
          y={y}
          width={width}
          height={height}
          radius={[3, 3, 0, 0]}
          fill={CHART_COLORS.blue}
          fillOpacity={payload?.today ? PARTIAL_OPACITY : 1}
        />
        {weekView && payload && (
          <text x={x + width / 2} y={y - 4} textAnchor="middle" fill={VALUE_INK} fontSize={10} fontWeight={900}>
            {integer.format(payload.unique_users)}
          </text>
        )}
      </g>
    )
  }

  return (
    <>
      <ResponsiveContainer width="100%" height={HOURLY_PX}>
        <ComposedChart data={hours} margin={{ top: 16, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} strokeOpacity={0.4} />
          <XAxis
            dataKey="hour"
            tickFormatter={(h: number) => labels.hourTick(h)}
            interval={wide ? 0 : 2}
            tick={TICK}
            axisLine={false}
            tickLine={false}
            height={22}
          />
          <YAxis tick={TICK} axisLine={false} tickLine={false} width={28} allowDecimals={false} />
          <Tooltip cursor={{ fill: 'rgba(0,168,232,0.05)' }} content={<HourTooltip labels={labels} locale={locale} />} isAnimationActive={false} />
          <Bar dataKey="avg_unique_users" name={labels.avg} fill={CHART_COLORS.blue} radius={[3, 3, 0, 0]} maxBarSize={20} isAnimationActive={false} />
          <Line
            dataKey="peak_concurrent"
            name={labels.peak}
            type="linear"
            stroke={CHART_COLORS.orange}
            strokeWidth={2}
            dot={{ r: 2.5, fill: CHART_COLORS.orange, stroke: '#fff', strokeWidth: 1 }}
            activeDot={{ r: 3.5, fill: CHART_COLORS.orange, stroke: '#fff', strokeWidth: 1 }}
            isAnimationActive={false}
          />
          <PeakValues hours={hours} peakHourOf={peak?.hour ?? null} format={(v) => integer.format(v)} />
        </ComposedChart>
      </ResponsiveContainer>
      {middle}
      <ResponsiveContainer width="100%" height={DAILY_PX}>
        <BarChart data={days} margin={{ top: weekView ? 14 : 4, right: 8, bottom: 0, left: 28 }}>
          <XAxis
            dataKey="day"
            interval={weekView ? 0 : 4}
            tickFormatter={(d: string) => dayTitle(d, weekView && wide)}
            tick={TICK}
            axisLine={{ stroke: '#e5e7eb' }}
            tickLine={false}
            height={18}
          />
          <Tooltip cursor={{ fill: 'rgba(0,168,232,0.05)' }} content={<DayTooltip labels={labels} locale={locale} />} isAnimationActive={false} />
          <Bar dataKey="unique_users" name={labels.dayPeople} maxBarSize={weekView ? 28 : 12} shape={dayShape} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </>
  )
}

export default UsageByHourChart
