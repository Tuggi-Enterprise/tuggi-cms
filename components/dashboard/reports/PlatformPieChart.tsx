'use client'

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts'

/**
 * Device-access donut of the engagement report.
 *
 * Own module so the engagement page can load it with next/dynamic — see UserGrowthChart for why
 * the split has to be at the whole-chart level.
 */
interface PlatformPieChartProps {
  data: Array<{ name: string; value: number; color: string }>
}

export function PlatformPieChart({ data }: PlatformPieChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
        <Pie data={data} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
          {data.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={entry.color} />
          ))}
        </Pie>
        <Tooltip />
        <Legend layout="vertical" verticalAlign="middle" align="right" />
      </PieChart>
    </ResponsiveContainer>
  )
}
