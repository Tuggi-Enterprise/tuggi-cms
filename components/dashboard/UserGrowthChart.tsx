'use client'

import { Bar, BarChart, DefaultZIndexes, ResponsiveContainer, Tooltip, XAxis, YAxis, ZIndexLayer, usePlotArea, useXAxisScale, useYAxisScale } from 'recharts'
import { useWide } from '@/components/dashboard/reports/engagement/useWide'
import { CHART_COLORS } from '@/lib/constants/chart-colors'
import { LABEL_FONT_MIN, clampCentre, dropColliding, fitFont, labelHeight, labelWidth, narrowerFormat } from '@/lib/dashboard/chart-labels'

/**
 * The total base of the dashboard Overview, compact (#1204, spec-cms-dashboard-uso §3): the same twelve
 * months as the monthly use chart beside it, no y axis and no grid. Every bar carries its value
 * (operator 2026-11-19, "numbers always visible"); the last one equals the "Users" KPI at the top.
 *
 * Lives in its own module so the dashboard page can pull it in with next/dynamic: recharts is ~314 KB
 * raw of the route's initial JS and nothing above the fold depends on it. Recharts inspects the concrete
 * type of its children, so the split has to happen at the whole-chart level.
 *
 * The values ride on recharts' scales, not on a `LabelList`: recharts 3.10 hands `LabelList` an index
 * that is not the row's (fato-recharts3-labellist). A month at zero (before the first sign-up) has no bar
 * and no number.
 */
interface UserGrowthChartProps {
  /** One row per month, oldest first, already cut to the months shown (`compactGrowth`). */
  data: Array<{ month: string; count: number }>
  /** The tick of a month, short ("nov"). */
  monthShort: (month: string) => string
  /** The tooltip title of a month. */
  monthLabel: (month: string) => string
  /** The series name in the tooltip. */
  seriesLabel: string
  locale: string
}

/** `primary.800`, 5.44:1 over white (spec §3). */
const VALUE_INK = '#00719F'
const TICK = { fill: '#6b7280', fontSize: 10, fontWeight: 700 }

/**
 * Every bar's value over it. When the full numbers do not fit the band at 9 px, the compact notation of
 * the locale is used if it is narrower ("2.1K" in en); a label that still collides is dropped, the most
 * recent month staying first.
 */
function GrowthValues({ data, locale }: { data: Array<{ month: string; count: number }>; locale: string }) {
  const x = useXAxisScale()
  const y = useYAxisScale()
  const area = usePlotArea()
  if (!x || !y || !area) return null

  const bars = data.flatMap((d, i) => {
    const start = x(d.month, { position: 'start' })
    const end = x(d.month, { position: 'end' })
    const top = y(d.count)
    if (d.count <= 0 || start === undefined || end === undefined || top === undefined) return []
    return [{ d, i, centre: (start + end) / 2, band: end - start, top }]
  })
  if (bars.length === 0) return null

  const room = Math.min(...bars.map((b) => b.band)) - 2
  const full = new Intl.NumberFormat(locale)
  const compact = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 })
  const format = narrowerFormat(
    bars.map((b) => b.d.count),
    room,
    (v) => full.format(v),
    (v) => compact.format(v)
  )
  const fontSize = fitFont(bars.map((b) => format(b.d.count)), room, 11) ?? LABEL_FONT_MIN
  const height = labelHeight(fontSize)
  const labels = bars.map((b) => {
    const text = format(b.d.count)
    const width = labelWidth(text, fontSize)
    return { key: b.d.month, text, x: clampCentre(b.centre, width, area.x, area.x + area.width), y: b.top - 6, width, height, priority: b.i }
  })

  return (
    <ZIndexLayer zIndex={DefaultZIndexes.label}>
      <g data-testid="total-base-values">
        {dropColliding(labels).map((l) => (
          <text key={l.key} x={l.x} y={l.y} textAnchor="middle" fill={VALUE_INK} fontSize={fontSize} fontWeight={900}>
            {l.text}
          </text>
        ))}
      </g>
    </ZIndexLayer>
  )
}

export function UserGrowthChart({ data, monthShort, monthLabel, seriesLabel, locale }: UserGrowthChartProps) {
  const wide = useWide()
  const number = new Intl.NumberFormat(locale)

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 20, right: 4, bottom: 0, left: 4 }}>
        <XAxis
          dataKey="month"
          interval={0}
          // Under `lg`, every other month, ending at the current one.
          tickFormatter={(m: string, i: number) => (wide || (data.length - 1 - i) % 2 === 0 ? monthShort(m) : '')}
          tick={TICK}
          axisLine={{ stroke: '#e5e7eb' }}
          tickLine={false}
          height={22}
        />
        <Tooltip
          cursor={{ fill: 'rgba(0,168,232,0.03)' }}
          labelFormatter={(m) => monthLabel(String(m))}
          formatter={(v) => number.format(Number(v))}
          contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)', fontSize: 12 }}
          isAnimationActive={false}
        />
        <YAxis hide />
        <Bar dataKey="count" name={seriesLabel} fill={CHART_COLORS.blue} barSize={14} radius={[3, 3, 0, 0]} isAnimationActive={false} />
        <GrowthValues data={data} locale={locale} />
      </BarChart>
    </ResponsiveContainer>
  )
}
