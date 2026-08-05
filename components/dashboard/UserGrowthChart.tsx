'use client'

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList } from 'recharts'

/**
 * Monthly active-base bar chart of the main dashboard.
 *
 * Lives in its own module so the dashboard page can pull it in with next/dynamic: recharts is
 * ~314 KB raw of the route's initial JS and nothing above the fold depends on it. Recharts
 * inspects the concrete type of its children, so the split has to happen at the whole-chart
 * level — wrapping Bar/XAxis individually in dynamic() breaks rendering.
 */
interface UserGrowthChartProps {
  data: Array<{ month: string; count: number }>
  color: string
}

export function UserGrowthChart({ data, color }: UserGrowthChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} strokeOpacity={0.4} />
        <XAxis dataKey="month" tick={{ fill: '#9ca3af', fontSize: 11, fontWeight: 700 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fill: '#9ca3af', fontSize: 11, fontWeight: 700 }} axisLine={false} tickLine={false} width={30} />
        <Tooltip cursor={{ fill: 'rgba(0,168,232,0.03)' }} contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }} />
        <Bar dataKey="count" fill={color} radius={[8, 8, 0, 0]} barSize={28}>
          <LabelList dataKey="count" position="top" style={{ fill: color, fontSize: 10, fontWeight: '900' }} offset={8} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
