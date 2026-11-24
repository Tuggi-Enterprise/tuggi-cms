/**
 * A `YYYY-MM` month as a screen of the CMS prints it.
 *
 * It lived as a private function of the Engagement report (#1094). The dashboard's monthly use
 * chart (#1204) prints the same ticks, so the function moved here and both import it: a second
 * copy would be a second definition of how a month reads (CLAUDE.md §6).
 */

const middleOf = (month: string) => new Date(`${month}-15T12:00:00Z`)

/** `ago 2026`: the month and year without a preposition (spec-cms-relatorio-engajamento §3). */
export function monthHeader(month: string, locale: string): string {
  const parts = new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric', timeZone: 'UTC' }).formatToParts(middleOf(month))
  const m = parts.find((p) => p.type === 'month')?.value.replace('.', '') ?? month
  const y = parts.find((p) => p.type === 'year')?.value ?? ''
  return `${m} ${y}`
}

/** `ago`: the tick of a month axis under `lg`. */
export function monthShort(month: string, locale: string): string {
  return monthHeader(month, locale).split(' ')[0]
}

/** `outubro de 2026`: the month written out, for a tooltip title. */
export function monthLong(month: string, locale: string): string {
  return middleOf(month).toLocaleDateString(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' })
}
