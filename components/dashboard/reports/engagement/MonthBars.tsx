'use client'

/**
 * The month chart of a question block (#1161, spec Parte E §E4): six months as bars, stacked to 100 %
 * (`expand`), stacked as counts (`stack`) or side by side (`group`). Module of its own, loaded by
 * `next/dynamic` (recharts inspects the concrete type of its children). A month with no number draws no
 * bar and keeps its tick; the tooltip says why (DS-COMPONENTE-084 item 1).
 */

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { UNKNOWN_VALUE } from '@/lib/format/unknown'
import { useWide } from '@/components/dashboard/reports/engagement/useWide'
import { MONTH_BARS_PX, type MonthBarsRow, type MonthBarsSeries } from '@/components/dashboard/reports/engagement/question-charts'




const TICK = { fill: '#6b7280', fontSize: 10, fontWeight: 700 }

function TooltipBox({
  active,
  payload,
  series,
  format,
}: {
  active?: boolean
  payload?: Array<{ payload: MonthBarsRow & Record<string, unknown> }>
  series: MonthBarsSeries[]
  format: (v: number, row: MonthBarsRow) => string
}) {
  const d = payload?.[0]?.payload
  if (!active || !d) return null
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
}: {
  label: string
  rows: MonthBarsRow[]
  series: MonthBarsSeries[]
  mode: 'expand' | 'stack' | 'group'
  /** A value in the tooltip. */
  format: (v: number, row: MonthBarsRow) => string
  /** The y tick. */
  axis: (v: number) => string
}) {
  const wide = useWide()
  const data = rows.map((r) => ({ ...r, ...Object.fromEntries(series.map((s) => [s.key, r.values[s.key] ?? null])) }))
  const stacked = mode !== 'group'
  return (
    <div role="img" aria-label={label} data-testid="month-bars">
      <ResponsiveContainer width="100%" height={MONTH_BARS_PX}>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} stackOffset={mode === 'expand' ? 'expand' : undefined}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} strokeOpacity={0.4} />
          <XAxis dataKey="month" tickFormatter={(m: string) => (wide ? rows.find((r) => r.month === m)?.label : rows.find((r) => r.month === m)?.short) ?? m} tick={TICK} axisLine={false} tickLine={false} height={22} interval={0} />
          <YAxis tick={TICK} axisLine={false} tickLine={false} width={40} tickFormatter={axis} allowDecimals={mode === 'expand'} />
          <Tooltip cursor={{ fill: 'rgba(0,168,232,0.03)' }} content={<TooltipBox series={series} format={format} />} isAnimationActive={false} />
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
              maxBarSize={mode === 'group' ? 14 : 40}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export default MonthBars
