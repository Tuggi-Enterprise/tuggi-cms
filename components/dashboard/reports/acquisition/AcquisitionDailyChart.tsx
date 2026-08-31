'use client'

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import type { AcquisitionDay } from '@/lib/services/acquisition-service'

/**
 * Contas novas por dia do mês, cada barra partida entre o que tem parceiro
 * atribuído e o que não tem.
 *
 * Vive em módulo próprio para a página puxar com next/dynamic: recharts é
 * ~314 KB do JS inicial da rota. O split tem de ser no gráfico inteiro —
 * recharts inspeciona o tipo concreto dos filhos, então envolver Bar/XAxis
 * em dynamic() quebra a renderização.
 *
 * O acumulado NÃO entra aqui. Contas por dia e total do mês têm escalas de
 * ordem diferente (dezenas contra centenas); no mesmo eixo, a série menor vira
 * uma linha rente ao chão. Ele mora em AcquisitionCumulativeChart, alinhado
 * pelo mesmo eixo de dias.
 */
interface Props {
  data: AcquisitionDay[]
  colorPartner: string
  colorRest: string
  labels: { withPartner: string; withoutPartner: string }
}

export function AcquisitionDailyChart({ data, colorPartner, colorRest, labels }: Props) {
  const rows = data.map((d) => ({
    day: String(Number(d.day.slice(8, 10))),
    [labels.withPartner]: d.withPartner,
    [labels.withoutPartner]: d.total - d.withPartner,
  }))

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} strokeOpacity={0.4} />
        <XAxis dataKey="day" tick={{ fill: '#9ca3af', fontSize: 10, fontWeight: 700 }} axisLine={false} tickLine={false} interval={1} />
        <YAxis tick={{ fill: '#9ca3af', fontSize: 11, fontWeight: 700 }} axisLine={false} tickLine={false} width={30} allowDecimals={false} />
        <Tooltip
          cursor={{ fill: 'rgba(0,168,232,0.03)' }}
          contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }}
        />
        <Legend wrapperStyle={{ fontSize: 11, fontWeight: 700 }} iconType="circle" iconSize={8} />
        <Bar dataKey={labels.withPartner} stackId="d" fill={colorPartner} radius={[0, 0, 0, 0]} maxBarSize={22} />
        <Bar dataKey={labels.withoutPartner} stackId="d" fill={colorRest} radius={[6, 6, 0, 0]} maxBarSize={22} />
      </BarChart>
    </ResponsiveContainer>
  )
}

export default AcquisitionDailyChart
