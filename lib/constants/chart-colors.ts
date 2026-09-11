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
import type { EntitlementState } from '@/lib/credit/entitlement'

export const CHART_COLORS = {
  blue: '#00A8E8',
  orange: '#FF6F00',
  green: '#10B981',
  purple: '#8B5CF6',
  red: '#EF4444',
} as const

export type ChartColor = keyof typeof CHART_COLORS

/**
 * The colour of each entitlement state (BR-MONETIZACAO-046), for every dashboard surface
 * that paints one.
 *
 * These two hexes were inline in `components/dashboard/PaidAccessCard.tsx` when the map pin
 * of #732 needed the same fact. Two widgets on the same screen disagreeing about which
 * colour means `unlimited` is worse than either choice, so the fact has an owner and the
 * card reads from it (CLAUDE.md §6).
 *
 * `free` was never painted before — the map used to say `is_premium ? orange : blue`, which
 * is why blue is the one that stays put.
 */
export const ENTITLEMENT_COLOR: Record<EntitlementState, string> = {
  unlimited: CHART_COLORS.purple,
  metered: CHART_COLORS.orange,
  free: CHART_COLORS.blue,
}

/** Cinza para o que não é uma categoria de verdade: lacuna de dado, teste interno. */
export const CHART_NEUTRAL = '#a5a39c'

export default CHART_COLORS
