/**
 * The clicks card of the Engagement report (#1094, spec §5): one month of `button_clicked` at a
 * time, grouped by screen, every bar on one ruler, the most people of the month.
 */

import type { EngagementGa4Click } from '@/lib/engagement/report'

/** The latest month that has a click, or the latest month of the ruler. */
export function defaultClicksMonth(months: readonly string[], clicks: readonly EngagementGa4Click[] | undefined): string {
  const withClicks = new Set((clicks ?? []).map((c) => c.month))
  for (let i = months.length - 1; i >= 0; i--) if (withClicks.has(months[i])) return months[i]
  return months[months.length - 1]
}

/** One month of `button_clicked`, grouped by screen, on one ruler: the most people of the month (spec §5). */
export function clickBlocks(clicks: readonly EngagementGa4Click[], month: string) {
  const of = clicks.filter((c) => c.month === month)
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
