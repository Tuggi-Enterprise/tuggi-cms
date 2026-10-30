'use client'

/**
 * The three strips of the account growth (#1063, spec G1 to G3): the followers line, the day's net
 * as bars up (gain) and down (loss) from zero, and the posts of the day. Module of its own, loaded by
 * `next/dynamic` whole, for the reason of `FunnelBars` (recharts inspects its children's types).
 *
 * The three charts share `STRIP_MARGIN`, `STRIP_Y_AXIS_PX` and a `band` X scale, so the point of the
 * line sits over the bars of the same day. No `syncId`: with it recharts opens one tooltip per chart,
 * three boxes for one day. The tooltip is the same five lines in any strip, built by the card.
 */

import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CHART_COLORS, CHART_NEUTRAL } from '@/lib/constants/chart-colors'
import { fmtInt, fmtSigned } from '@/lib/social/format'
import { lineDomain, stripTop } from '@/lib/social/funnel'
import { STRIP_AXIS_PX, STRIP_MARGIN, STRIP_PLOT_PX, STRIP_Y_AXIS_PX } from './FunnelBars'

export type GrowthBandKey = 'total' | 'net' | 'posts'

export interface GrowthTip {
  title: string
  rows: Array<[string, string]>
  notes: string[]
}

export interface GrowthDatum {
  x: string
  tick: string
  total: number | null
  /** The net when positive, else null: the bar that rises from zero. */
  gain: number | null
  /** The net when negative, else null: the bar that falls from zero. */
  loss: number | null
  posts: number
  muted: boolean
  tip: GrowthTip
}

/** Plot heights of the three strips (spec G1); the last one adds the X axis. */
export const GROWTH_PLOT_PX: Record<GrowthBandKey, number> = { total: 96, net: 64, posts: STRIP_PLOT_PX }

const TICK = { fill: '#6b7280', fontSize: 10, fontWeight: 700 }

function GrowthTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: GrowthDatum }> }) {
  const d = payload?.[0]?.payload
  if (!active || !d) return null
  return (
    <div className="max-w-xs rounded-xl bg-white px-3 py-2 text-xs text-gray-800 shadow-lg">
      <p className="font-semibold">{d.tip.title}</p>
      {d.tip.rows.map(([label, value]) => (
        <p key={label}>{label ? `${label}: ${value}` : value}</p>
      ))}
      {d.tip.notes.map((note) => (
        <p key={note} className="text-gray-600">
          {note}
        </p>
      ))}
    </div>
  )
}

export function GrowthBand({ band, data, showAxis }: { band: GrowthBandKey; data: GrowthDatum[]; showAxis: boolean }) {
  const height = GROWTH_PLOT_PX[band] + (showAxis ? STRIP_AXIS_PX : 0)
  const xAxis = (
    <XAxis
      dataKey="x"
      scale="band"
      hide={!showAxis}
      height={showAxis ? STRIP_AXIS_PX : 0}
      tickFormatter={(x: string) => data.find((d) => d.x === x)?.tick ?? ''}
      tick={TICK}
      axisLine={false}
      tickLine={false}
      interval="preserveStartEnd"
    />
  )
  // The box is pinned near the top of the strip and may leave it upward: under the last strip the
  // card's scroll box would cut it.
  const tooltip = (
    <Tooltip
      cursor={{ fill: 'rgba(0,168,232,0.03)' }}
      content={<GrowthTooltip />}
      position={{ y: band === 'posts' ? -64 : 0 }}
      allowEscapeViewBox={{ x: false, y: true }}
    />
  )
  // Room under the floor label of the line and the net, which have no X axis below them.
  const margin = showAxis ? STRIP_MARGIN : { ...STRIP_MARGIN, bottom: 6 }
  const grid = <CartesianGrid strokeDasharray="3 3" vertical={false} strokeOpacity={0.4} />

  if (band === 'total') {
    const [lo, hi] = lineDomain(data.map((d) => d.total))
    return (
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={margin}>
          {grid}
          {xAxis}
          <YAxis interval={0} domain={[lo, hi]} ticks={[lo, hi]} allowDataOverflow tickFormatter={(v: number) => fmtInt(v)} tick={TICK} axisLine={false} tickLine={false} width={STRIP_Y_AXIS_PX} allowDecimals={false} />
          {tooltip}
          <Line type="monotone" dataKey="total" stroke={CHART_COLORS.blue} strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    )
  }

  if (band === 'net') {
    const top = stripTop(data.map((d) => Math.abs(d.gain ?? d.loss ?? 0)))
    return (
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={margin} stackOffset="sign">
          {grid}
          {xAxis}
          <YAxis interval={0} domain={[-top, top]} ticks={[-top, 0, top]} allowDataOverflow tickFormatter={(v: number) => (v === 0 ? '' : fmtSigned(v))} tick={TICK} axisLine={false} tickLine={false} width={STRIP_Y_AXIS_PX} allowDecimals={false} />
          {tooltip}
          <ReferenceLine y={0} stroke={CHART_NEUTRAL} strokeWidth={1} />
          <Bar dataKey="gain" stackId="n" fill={CHART_COLORS.green} radius={[6, 6, 0, 0]} maxBarSize={22} isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.x} fill={d.muted ? CHART_NEUTRAL : CHART_COLORS.green} />
            ))}
          </Bar>
          <Bar dataKey="loss" stackId="n" fill={CHART_COLORS.red} radius={[0, 0, 6, 6]} maxBarSize={22} isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.x} fill={d.muted ? CHART_NEUTRAL : CHART_COLORS.red} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    )
  }

  const top = stripTop(data.map((d) => d.posts))
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={margin}>
        {grid}
        {xAxis}
        <YAxis interval={0} domain={[0, top]} ticks={[0, top]} allowDataOverflow tickFormatter={(v: number) => (v === 0 ? '' : fmtInt(v))} tick={TICK} axisLine={false} tickLine={false} width={STRIP_Y_AXIS_PX} allowDecimals={false} />
        {tooltip}
        <Bar dataKey="posts" fill={CHART_COLORS.blue} radius={[6, 6, 0, 0]} maxBarSize={22} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  )
}

export default GrowthBand
