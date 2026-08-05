'use client'

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList } from 'recharts'

/**
 * Monthly migration volume/speed bar chart of the catalog report.
 *
 * Own module so the catalog page can load it with next/dynamic — see UserGrowthChart for why
 * the split has to be at the whole-chart level.
 */
interface MigrationSpeedChartProps {
  data: Array<{ month: string; volume: number; avg_seconds: number }>
  color: string
}

export function MigrationSpeedChart({ data, color }: MigrationSpeedChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 20, right: 0, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} strokeOpacity={0.4} />
        <XAxis
          dataKey="month"
          tick={{ fill: '#9ca3af', fontSize: 10, fontWeight: 700 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(val) => (val ? `${val.split('-')[1]}/${val.split('-')[0].slice(2)}` : '')}
        />
        <YAxis hide domain={[0, 'dataMax']} />
        <Tooltip cursor={{ fill: 'rgba(16,185,129,0.05)' }} contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)', fontSize: '11px', fontWeight: '900' }} />
        <Bar dataKey="volume" fill={color} radius={[4, 4, 0, 0]} barSize={28}>
          <LabelList dataKey="avg_seconds" position="top" formatter={(val: any) => `${val}s`} style={{ fill: '#9ca3af', fontSize: 10, fontWeight: '800' }} offset={6} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
