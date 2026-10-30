'use client'

/**
 * The bars of ONE strip of the funnel (spec 2.3). Module of its own so the overview loads it with
 * `next/dynamic`: recharts is ~314 KB and inspects the concrete type of its children, so the split
 * has to be the whole chart, never a `Bar` (the `AcquisitionDailyChart` lesson).
 *
 * Every strip gets the same `margin` and Y axis width, so the bar of day 15 sits at the same x in
 * all five; only the last strip shows the X axis. The Y domain is the strip's own, 0 to `stripTop`,
 * with a fixed pixel height: a bar cannot leave its strip and a label cannot reach the one above
 * (the first production collection drew a 9 across two strips). Ticks are only the base and the
 * top, and the base label is left out so it never sits under the strip above. Muted bars (the last
 * two GA4 days, which can still change) paint in `CHART_NEUTRAL`; the strip prints what gray means.
 */

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CHART_NEUTRAL } from '@/lib/constants/chart-colors'
import { UNKNOWN_VALUE } from '@/lib/format/unknown'
import { fmtInt } from '@/lib/social/format'
import { stripTop } from '@/lib/social/funnel'

export interface FunnelBarDatum {
  x: string
  tick: string
  title: string
  a: number | null
  b?: number | null
  muted: boolean
  detail?: string[]
}

interface Props {
  data: FunnelBarDatum[]
  colorA: string
  labelA: string
  colorB?: string
  labelB?: string
  showAxis: boolean
  mutedNote: string
}

/** Shared with the growth chart (#1063), so its three strips line up with the same x per day. */
export const STRIP_MARGIN = { top: 8, right: 8, left: 0, bottom: 0 }
export const STRIP_Y_AXIS_PX = 34
/** Plot height of one strip, and the room the X axis adds under the last one. */
export const STRIP_PLOT_PX = 56
export const STRIP_AXIS_PX = 22

function TooltipBox({
  active,
  payload,
  labels,
  mutedNote,
}: {
  active?: boolean
  payload?: Array<{ payload: FunnelBarDatum }>
  labels: { a: string; b?: string }
  mutedNote: string
}) {
  const d = payload?.[0]?.payload
  if (!active || !d) return null
  return (
    <div className="max-w-xs rounded-xl bg-white px-3 py-2 text-xs text-gray-800 shadow-lg">
      <p className="font-semibold">{d.title}</p>
      <p>
        {labels.a}: {d.a ?? UNKNOWN_VALUE}
      </p>
      {labels.b && (
        <p>
          {labels.b}: {d.b ?? UNKNOWN_VALUE}
        </p>
      )}
      {d.detail?.map((line, i) => (
        <p key={i} className="truncate text-gray-600">
          {line}
        </p>
      ))}
      {d.muted && <p className="text-gray-600">{mutedNote}</p>}
    </div>
  )
}

export function FunnelBars({ data, colorA, labelA, colorB, labelB, showAxis, mutedNote }: Props) {
  const stacked = colorB !== undefined && labelB !== undefined
  const top = stripTop(data.map((d) => (d.a ?? 0) + (stacked ? (d.b ?? 0) : 0)))
  return (
    <ResponsiveContainer width="100%" height={STRIP_PLOT_PX + (showAxis ? STRIP_AXIS_PX : 0)}>
      <BarChart data={data} margin={STRIP_MARGIN}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} strokeOpacity={0.4} />
        <XAxis
          dataKey="x"
          hide={!showAxis}
          height={showAxis ? STRIP_AXIS_PX : 0}
          tickFormatter={(x: string) => data.find((d) => d.x === x)?.tick ?? ''}
          tick={{ fill: '#6b7280', fontSize: 10, fontWeight: 700 }}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          domain={[0, top]}
          ticks={[0, top]}
          allowDataOverflow
          tickFormatter={(v: number) => (v === 0 ? '' : fmtInt(v))}
          tick={{ fill: '#6b7280', fontSize: 10, fontWeight: 700 }}
          axisLine={false}
          tickLine={false}
          width={STRIP_Y_AXIS_PX}
          allowDecimals={false}
        />
        <Tooltip
          cursor={{ fill: 'rgba(0,168,232,0.03)' }}
          content={<TooltipBox labels={{ a: labelA, b: labelB }} mutedNote={mutedNote} />}
        />
        <Bar dataKey="a" name={labelA} stackId={stacked ? 's' : undefined} fill={colorA} radius={stacked ? [0, 0, 0, 0] : [6, 6, 0, 0]} maxBarSize={22} isAnimationActive={false}>
          {data.map((d) => (
            <Cell key={d.x} fill={d.muted ? CHART_NEUTRAL : colorA} />
          ))}
        </Bar>
        {stacked && (
          <Bar dataKey="b" name={labelB} stackId="s" fill={colorB} radius={[6, 6, 0, 0]} maxBarSize={22} isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.x} fill={d.muted ? CHART_NEUTRAL : colorB} />
            ))}
          </Bar>
        )}
      </BarChart>
    </ResponsiveContainer>
  )
}

export default FunnelBars
