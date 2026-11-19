'use client'

import { Bar, BarChart, Rectangle, ResponsiveContainer, Tooltip, XAxis } from 'recharts'
import { useWide } from '@/components/dashboard/reports/engagement/useWide'
import { CHART_COLORS } from '@/lib/constants/chart-colors'

/**
 * The total base of the dashboard Overview, compact (#1204, spec-cms-dashboard-uso §3): the same twelve
 * months as the monthly use chart beside it, no y axis and no grid, and only the last bar carries its
 * value. The number itself is the "Users" KPI at the top (the last point equals `total_users`), so the
 * card adds the shape of the curve, not the number again.
 *
 * Lives in its own module so the dashboard page can pull it in with next/dynamic: recharts is ~314 KB
 * raw of the route's initial JS and nothing above the fold depends on it. Recharts inspects the concrete
 * type of its children, so the split has to happen at the whole-chart level.
 *
 * The value rides on the bar `shape`, not on a `LabelList`: recharts 3.10 hands `LabelList` an index
 * that is not the row's (fato-recharts3-labellist), and the last bar is found by its month.
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

interface BarShapeProps {
  x?: number
  y?: number
  width?: number
  height?: number
  payload?: { month: string; count: number }
}

export function UserGrowthChart({ data, monthShort, monthLabel, seriesLabel, locale }: UserGrowthChartProps) {
  const wide = useWide()
  const last = data.length > 0 ? data[data.length - 1] : null
  const number = new Intl.NumberFormat(locale)

  const shape = (props: unknown) => {
    const { x = 0, y = 0, width = 0, height = 0, payload } = props as BarShapeProps
    return (
      <g>
        <Rectangle x={x} y={y} width={width} height={height} radius={[3, 3, 0, 0]} fill={CHART_COLORS.blue} />
        {last && payload?.month === last.month && (
          <text x={x + width / 2} y={y - 6} textAnchor="middle" fill={VALUE_INK} fontSize={11} fontWeight={900}>
            {number.format(payload.count)}
          </text>
        )}
      </g>
    )
  }

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
        <Bar dataKey="count" name={seriesLabel} fill={CHART_COLORS.blue} barSize={14} shape={shape} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  )
}
