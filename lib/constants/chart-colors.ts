/**
 * Paleta dos gráficos do dashboard.
 *
 * SSOT: estes hex estavam declarados como const local em app/[locale]/dashboard/page.tsx,
 * app/[locale]/dashboard/reports/engagement/page.tsx e
 * components/dashboard/reports/GeoDemand.tsx — três cópias do mesmo fato.
 * Novos gráficos importam daqui.
 *
 * `blue` e `orange` são a marca (tailwind.config.js → tuggi.blue / tuggi.orange).
 * Os demais completam a série categórica.
 */
export const CHART_COLORS = {
  blue: '#00A8E8',
  orange: '#FF6F00',
  green: '#10B981',
  purple: '#8B5CF6',
  red: '#EF4444',
} as const

export type ChartColor = keyof typeof CHART_COLORS

/** Cinza para o que não é uma categoria de verdade: lacuna de dado, teste interno. */
export const CHART_NEUTRAL = '#a5a39c'

export default CHART_COLORS
