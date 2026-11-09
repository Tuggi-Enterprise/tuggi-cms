'use client'

/**
 * A line chart of a question block (#1162, spec Parte E §E4): the paywall rates of block 7 by month, the
 * cohort curve of block 8 with the market as a dashed grey line, and DAU/MAU of each active half with the
 * market as a dashed `ReferenceLine`. One instrument per chart, always. Module of its own, loaded by
 * `next/dynamic`. A point with no number is not drawn; the tooltip says why (DS-COMPONENTE-084 item 1).
 */

import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { UNKNOWN_VALUE } from '@/lib/format/unknown'
import { CHART_NEUTRAL } from '@/lib/constants/chart-colors'
import { useWide } from '@/components/dashboard/reports/engagement/useWide'
import type { LinesRow, LinesSeries } from '@/components/dashboard/reports/engagement/question-charts'

const TICK = { fill: '#6b7280', fontSize: 10, fontWeight: 700 }

function TooltipBox({ active, payload, series, format }: { active?: boolean; payload?: Array<{ payload: LinesRow }>; series: LinesSeries[]; format: (v: number) => string }) {
  const d = payload?.[0]?.payload
  if (!active || !d) return null
  return (
    <div className="max-w-xs rounded-xl bg-white px-3 py-2 text-xs text-gray-800 shadow-lg">
      <p className="font-semibold">{d.label}</p>
      {series.map((s) => {
        const v = d.values[s.key]
        if (s.dashed && (v === null || v === undefined)) return null
        return (
          <p key={s.key}>
            {s.label}: {v === null || v === undefined ? `${UNKNOWN_VALUE}${d.reason ? ` ${d.reason}` : ''}` : format(v)}
          </p>
        )
      })}
    </div>
  )
}

export function QuestionLines({
  label,
  rows,
  series,
  height,
  format,
  reference,
  testId,
}: {
  label: string
  rows: LinesRow[]
  series: LinesSeries[]
  height: number
  /** A value in the tooltip and on the y axis: these are shares. */
  format: (v: number) => string
  /** A dashed market line across the chart, with its label. */
  reference?: { y: number; label: string }
  testId: string
}) {
  const wide = useWide()
  const data = rows.map((r) => ({ ...r, ...Object.fromEntries(series.map((s) => [s.key, r.values[s.key] ?? null])) }))
  const top = Math.max(reference?.y ?? 0, ...rows.flatMap((r) => series.map((s) => r.values[s.key] ?? 0)))
  // A little room over the highest point, in steps of ten points, never past 100 %.
  const domainTop = Math.min(1, Math.max(0.1, Math.ceil((top * 1.15) / 0.1) * 0.1))
  return (
    <div role="img" aria-label={label} data-testid={testId}>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} strokeOpacity={0.4} />
          <XAxis dataKey="key" tickFormatter={(k: string) => (wide ? rows.find((r) => r.key === k)?.label : rows.find((r) => r.key === k)?.short) ?? k} tick={TICK} axisLine={false} tickLine={false} height={22} interval={0} padding={{ left: 12, right: 12 }} />
          <YAxis tick={TICK} axisLine={false} tickLine={false} width={40} tickFormatter={format} domain={[0, domainTop]} />
          <Tooltip content={<TooltipBox series={series} format={format} />} isAnimationActive={false} />
          {reference && (
            <ReferenceLine y={reference.y} ifOverflow="extendDomain" stroke={CHART_NEUTRAL} strokeDasharray="4 4" label={{ value: reference.label, position: 'insideTopRight', fill: '#6b7280', fontSize: 10, fontWeight: 700 }} />
          )}
          {series.map((s) => (
            <Line
              key={s.key}
              dataKey={s.key}
              name={s.label}
              stroke={s.dashed ? CHART_NEUTRAL : s.color}
              strokeWidth={2}
              strokeDasharray={s.dashed ? '4 4' : undefined}
              connectNulls={!!s.dashed}
              dot={s.dashed ? { r: 3, fill: CHART_NEUTRAL, strokeWidth: 0 } : { r: 4, fill: s.color, stroke: '#fff', strokeWidth: 2 }}
              activeDot={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export default QuestionLines
