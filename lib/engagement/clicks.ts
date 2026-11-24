/**
 * The clicks card of the Engagement report (#1094, spec §5): one month of `button_clicked` at a
 * time, grouped by screen, every bar on one ruler, the most people of the month.
 */

import { CHART_COLORS, CHART_NEUTRAL } from '@/lib/constants/chart-colors'
import type { EngagementGa4Click } from '@/lib/engagement/report'

/**
 * A `button_clicked` that is not a tap: the app logs what it showed and what the system answered
 * on the same event (#1096). Decided by the raw name, never by the label, so a copy change cannot
 * turn a banner view into a tap.
 */
export function isNonTap(button: string): boolean {
  return button === 'discovery_banner_shown' || button === 'region_waitlist_viewed' || button.includes('_permission_')
}

/**
 * An old screen name and the name it became (#1096, #1154). GA4 does not merge the rows, so the card
 * does: the old rows add up on the line of the new name, and the color reads the new name too. One
 * table, so the sum and the color can never disagree. The new names are the app SSOT
 * (`tuggi-drive-v2` `features/analytics/screenNames.ts`).
 */
export const SCREEN_RENAMES: Readonly<Record<string, string>> = {
  guide_map: 'guide_map_screen',
  route_explorer: 'route_explorer_sheet',
}

/** The name a screen has today: the new one for an old name, itself otherwise. */
export const currentScreen = (screen: string): string => SCREEN_RENAMES[screen] ?? screen

/**
 * The screens the app sends today, one color each. The onboarding screens share one color: they
 * never compete in the same month of a returning user.
 */
const SCREEN_COLORS: Readonly<Record<string, string>> = {
  guide_map_screen: CHART_COLORS.blue,
  single_detail: CHART_COLORS.orange,
  route_explorer_sheet: CHART_COLORS.green,
  home_screen: CHART_COLORS.purple,
  welcome_screen: CHART_COLORS.purple,
  terms_screen: CHART_COLORS.purple,
  permission_screen: CHART_COLORS.purple,
  completion_modal: CHART_COLORS.red,
}

const SCREEN_PALETTE: readonly string[] = Object.values(CHART_COLORS)

/** The color of a screen group, the same in every month: the table above, or a hash of the raw name for a screen it does not know. */
export function screenColor(raw: string): string {
  const screen = currentScreen(raw)
  const known = SCREEN_COLORS[screen]
  if (known) return known
  let h = 0
  for (let i = 0; i < screen.length; i++) h = (h * 31 + screen.charCodeAt(i)) >>> 0
  return SCREEN_PALETTE[h % SCREEN_PALETTE.length]
}

/** The bar of one click: grey when it is not a tap, the screen color otherwise. */
export const clickColor = (screen: string, button: string) => (isNonTap(button) ? CHART_NEUTRAL : screenColor(screen))

/** A screen group is grey when none of its clicks is a tap. */
export const screenGroupColor = (screen: string, buttons: readonly string[]) =>
  buttons.length > 0 && buttons.every(isNonTap) ? CHART_NEUTRAL : screenColor(screen)

/**
 * One month of `button_clicked`, grouped by screen, on one ruler: the most people of the month (spec §5).
 * An old screen name adds up on the line of its new name, button by button (`SCREEN_RENAMES`). GA4 counts
 * people per row, so a person who tapped under both names in one month counts twice on that line.
 */
export function clickBlocks(clicks: readonly EngagementGa4Click[], month: string) {
  const merged = new Map<string, EngagementGa4Click>()
  for (const c of clicks) {
    if (c.month !== month) continue
    const screen = currentScreen(c.screen)
    const key = `${screen}\u0000${c.button}`
    const prev = merged.get(key)
    merged.set(key, prev ? { ...prev, events: prev.events + c.events, users: prev.users + c.users } : { ...c, screen })
  }
  const of = Array.from(merged.values())
  const byScreen = new Map<string, EngagementGa4Click[]>()
  for (const c of of) byScreen.set(c.screen, [...(byScreen.get(c.screen) ?? []), c])
  const blocks = Array.from(byScreen, ([screen, rows]) => ({
    screen,
    users: rows.reduce((s, r) => s + r.users, 0),
    rows: [...rows].sort((a, b) => b.users - a.users || a.button.localeCompare(b.button)),
  })).sort((a, b) => b.users - a.users || a.screen.localeCompare(b.screen))
  const max = of.reduce((m, c) => Math.max(m, c.users), 0)
  return { blocks, max }
}
