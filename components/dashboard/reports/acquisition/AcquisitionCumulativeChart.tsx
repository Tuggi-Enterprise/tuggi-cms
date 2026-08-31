'use client'

import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import type { AcquisitionDay } from '@/lib/services/acquisition-service'

/**
 * Total acumulado ao longo do mês. Fica ao lado do gráfico diário, alinhado
 * pelo mesmo eixo de dias, em vez de dividir o plot com ele: as duas séries têm
 * escalas de ordem diferente e um eixo duplo distorceria as duas leituras.
 *
 * Módulo próprio pelo mesmo motivo do AcquisitionDailyChart (next/dynamic).
 */
interface Props {
  data: AcquisitionDay[]
  color: string
  label: string
}

export function AcquisitionCumulativeChart({ data, color, label }: Props) {
  const rows = data.map((d) => ({
    day: String(Number(d.day.slice(8, 10))),
    [label]: d.cumulative,
  }))

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="acq-cum" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.28} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" vertical={false} strokeOpacity={0.4} />
        <XAxis dataKey="day" tick={{ fill: '#9ca3af', fontSize: 10, fontWeight: 700 }} axisLine={false} tickLine={false} interval={1} />
        <YAxis tick={{ fill: '#9ca3af', fontSize: 11, fontWeight: 700 }} axisLine={false} tickLine={false} width={34} allowDecimals={false} />
        <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }} />
        <Area
          type="monotone"
          dataKey={label}
          stroke={color}
          strokeWidth={2}
          fill="url(#acq-cum)"
          dot={false}
          activeDot={{ r: 4 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

export default AcquisitionCumulativeChart
