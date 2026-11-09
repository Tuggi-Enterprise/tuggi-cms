'use client'

/**
 * Horizontal bars on one ruler (#1162, spec Parte E §E4): the free minutes histogram of block 5, with the
 * 15 min, 1 h and 3 h borders as dashed `ReferenceLine`s at the start of the next band, and the
 * permissions card, each bar on a gray track. Module of its own, loaded by `next/dynamic`. The rows
 * arrive resolved; this only draws, and the number of every row is printed beside its bar, so the colour
 * is never the only carrier (DS-A11Y-007).
 */

import { Bar, BarChart, LabelList, ReferenceLine, ResponsiveContainer, Text, Tooltip, XAxis, YAxis, type YAxisTickContentProps } from 'recharts'
import { CHART_COLORS } from '@/lib/constants/chart-colors'
import { useWide } from '@/components/dashboard/reports/engagement/useWide'
import { horizontalBarsHeight, type HorizontalBarsMark, type HorizontalBarsRow } from '@/components/dashboard/reports/engagement/question-charts'

const TRACK = '#f3f4f6'

function Tick({ y, payload, width, rows }: { y?: number | string; payload?: { value: unknown }; width: number; rows: HorizontalBarsRow[] }) {
  const row = rows.find((r) => r.key === payload?.value)
  if (!row) return null
  return (
    <Text x={0} y={y} width={width - 8} maxLines={2} textAnchor="start" verticalAnchor="middle" fill="#374151" fontSize={11} fontWeight={600}>
      {row.label}
    </Text>
  )
}

function TooltipBox({ active, payload }: { active?: boolean; payload?: Array<{ payload: HorizontalBarsRow }> }) {
  const d = payload?.[0]?.payload
  if (!active || !d) return null
  return <div className="max-w-xs rounded-xl bg-white px-3 py-2 text-xs text-gray-800 shadow-lg">{d.title}</div>
}

export function HorizontalBars({
  label,
  rows,
  max,
  rowPx,
  marks = [],
  track = false,
  testId,
}: {
  label: string
  rows: HorizontalBarsRow[]
  /** The end of the ruler: the widest row, or 1 for shares on a track. */
  max: number
  rowPx: number
  marks?: HorizontalBarsMark[]
  track?: boolean
  testId: string
}) {
  const wide = useWide()
  const axis = wide ? 128 : 96
  const end = Math.max(max, Number.EPSILON)
  return (
    <div role="img" aria-label={label} data-testid={testId}>
      <ResponsiveContainer width="100%" height={horizontalBarsHeight(rows.length, rowPx)}>
        <BarChart data={rows} layout="vertical" margin={{ top: 8, right: 96, bottom: 8, left: 0 }} barCategoryGap={8}>
          <XAxis type="number" hide domain={[0, end]} />
          <YAxis
            type="category"
            dataKey="key"
            width={axis}
            axisLine={false}
            tickLine={false}
            interval={0}
            tick={(props: YAxisTickContentProps) => <Tick y={props.y} payload={props.payload} width={axis} rows={rows} />}
          />
          <Tooltip cursor={{ fill: 'rgba(0,168,232,0.03)' }} content={<TooltipBox />} isAnimationActive={false} />
          {marks.map((m) => (
            <ReferenceLine
              key={m.before}
              y={m.before}
              position="start"
              stroke="#9ca3af"
              strokeDasharray="4 4"
              ifOverflow="extendDomain"
              label={{ value: m.label, position: 'insideTopRight', fill: '#6b7280', fontSize: 10, fontWeight: 700 }}
            />
          ))}
          <Bar dataKey="value" fill={CHART_COLORS.blue} radius={[0, 4, 4, 0]} isAnimationActive={false} background={track ? { fill: TRACK } : undefined}>
            <LabelList
              dataKey="key"
              content={(p: { x?: number | string; y?: number | string; width?: number | string; height?: number | string; value?: unknown }) => {
                const r = rows.find((x) => x.key === p.value)
                if (!r) return null
                const x = Number(p.x ?? 0) + Number(p.width ?? 0) + 6
                const y = Number(p.y ?? 0) + Number(p.height ?? 0) / 2
                return (
                  <text x={x} y={y} dominantBaseline="middle" fontSize={11} fontWeight={700} fontFamily="ui-monospace, monospace" fill={r.muted ? '#6b7280' : '#111827'} data-testid={`${testId}-value-${r.key}`}>
                    {r.display}
                  </text>
                )
              }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <ul className="sr-only">
        {rows.map((r) => (
          <li key={r.key}>{r.title}</li>
        ))}
      </ul>
    </div>
  )
}

export default HorizontalBars
