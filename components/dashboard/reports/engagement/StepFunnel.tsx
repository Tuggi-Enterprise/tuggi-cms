'use client'

/**
 * A funnel as horizontal bars on one ruler (#1161, spec Parte E §E6), replacing `FunnelBands`. Module of
 * its own, loaded by `next/dynamic`: recharts inspects the concrete type of its children, so the split is
 * the whole chart, never a `Bar` (the `FunnelBars` lesson).
 *
 * Each row stacks what the step kept and what it lost from the previous full step, drawn behind in gray;
 * the biggest drop paints its loss orange, and the card prints the drop in points with the badge, so it
 * is colour and word, never colour alone. A step of the other instrument is hollow, with no rate
 * (DS-COMPONENTE-084 item 2). The rows arrive resolved (`readStepFunnel`); this only draws.
 */

import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Text, Tooltip, XAxis, YAxis, type YAxisTickContentProps } from 'recharts'
import { CHART_COLORS } from '@/lib/constants/chart-colors'
import { useWide } from '@/components/dashboard/reports/engagement/useWide'
import { stepFunnelHeight, type StepFunnelRow } from '@/components/dashboard/reports/engagement/question-charts'


const LOST = '#e5e7eb'
const HOLLOW_STROKE = '#9ca3af'


/** The step's name, up to two lines, from the left edge of the chart (the axis is the label column). */
function Tick({ y, payload, width, rows }: { y?: number | string; payload?: { value: unknown }; width: number; rows: StepFunnelRow[] }) {
  const row = rows.find((r) => r.key === payload?.value)
  if (!row) return null
  return (
    <Text x={0} y={y} width={width - 8} maxLines={2} textAnchor="start" verticalAnchor="middle" fill="#374151" fontSize={11} fontWeight={600}>
      {row.label}
    </Text>
  )
}

function TooltipBox({ active, payload }: { active?: boolean; payload?: Array<{ payload: StepFunnelRow }> }) {
  const d = payload?.[0]?.payload
  if (!active || !d) return null
  return <div className="max-w-xs rounded-xl bg-white px-3 py-2 text-xs text-gray-800 shadow-lg">{d.title}</div>
}

/** Width of one character of the value text (11 px monospace) and of the badge (9 px plus letter spacing), px. */
const VALUE_CHAR_PX = 6.8
const BADGE_CHAR_PX = 6.5
const VALUE_GAP_PX = 6

/**
 * The room right of the bars, px: 88 by default, wider when the longest text would be cut, because the
 * text of the longest bar sits past its end ("≥ 1.020 · 24,3%" of a floor, #1171).
 */
export function valueMargin(rows: StepFunnelRow[], ga4: string): number {
  const need = Math.max(0, ...rows.map((r) => r.display.length * VALUE_CHAR_PX + (r.hollow ? VALUE_GAP_PX + (r.badge ?? ga4).length * BADGE_CHAR_PX : 0)))
  return Math.max(88, Math.ceil(need + 2 * VALUE_GAP_PX))
}

export function StepFunnel({ label, rows, max, ga4 }: { label: string; rows: StepFunnelRow[]; max: number; ga4: string }) {
  const wide = useWide()
  const axis = wide ? 128 : 96
  return (
    <div role="img" aria-label={label} data-testid="step-funnel">
      <ResponsiveContainer width="100%" height={stepFunnelHeight(rows.length)}>
        <BarChart data={rows.map((r) => ({ ...r, end: Math.max(1, max) / 1000 }))} layout="vertical" margin={{ top: 8, right: valueMargin(rows, ga4), bottom: 8, left: 0 }} barCategoryGap={8}>
          <XAxis type="number" hide domain={[0, Math.max(1, max)]} />
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
          <Bar dataKey="kept" stackId="f" isAnimationActive={false}>
            {rows.map((r) => (
              <Cell
                key={r.key}
                data-testid={`step-funnel-kept-${r.key}`}
                fill={r.hollow ? '#fff' : CHART_COLORS.blue}
                stroke={r.hollow ? HOLLOW_STROKE : undefined}
                strokeWidth={r.hollow ? 1.5 : 0}
              />
            ))}
          </Bar>
          <Bar dataKey="lost" stackId="f" isAnimationActive={false}>
            {rows.map((r) => (
              <Cell key={r.key} data-testid={`step-funnel-lost-${r.key}`} fill={r.highlight ? CHART_COLORS.orange : LOST} />
            ))}
          </Bar>
          {/* recharts draws no label on a zero-width bar: a hair at the end of every stack carries the value */}
          <Bar dataKey="end" stackId="f" fill="transparent" isAnimationActive={false}>
            <LabelList
              dataKey="key"
              content={(p: { x?: number | string; y?: number | string; width?: number | string; height?: number | string; value?: unknown }) => {
                const r = rows.find((x) => x.key === p.value)
                if (!r) return null
                const x = Number(p.x ?? 0) + Number(p.width ?? 0) + 6
                const y = Number(p.y ?? 0) + Number(p.height ?? 0) / 2
                return (
                  <text x={x} y={y} dominantBaseline="middle" fontSize={11} fontWeight={700} fontFamily="ui-monospace, monospace" fill={r.muted ? '#6b7280' : '#111827'} data-testid={`step-funnel-value-${r.key}`}>
                    {r.display}
                    {/* the other instrument says so beside its number, in the badge's grey (spec §E6) */}
                    {r.hollow && (
                      <tspan dx={6} fontSize={9} fontWeight={400} fill="#6b7280" letterSpacing={1}>
                        {r.badge ?? ga4}
                      </tspan>
                    )}
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

export default StepFunnel
