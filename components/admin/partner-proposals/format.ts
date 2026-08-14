/**
 * Dates and sizes, formatted once for both screens.
 *
 * NOBODY COUNTS DAYS IN THEIR HEAD HERE. `dayDelta` is the whole reason this file exists:
 * the review band has to say "venceu há 12 dias", not show a date and let the operator work
 * it out — BR-B2B-022 item 4 treats an expired licence as an absent one, and an operator
 * doing arithmetic on the fly is where that rule stops being applied.
 *
 * The calendar day, not the instant: a link that expires today expires today, whatever the
 * hour, and `pt-BR` is the operator's locale on every one of these screens.
 */

export const OPERATOR_LOCALE = 'pt-BR'

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString(OPERATOR_LOCALE, { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function formatShortDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString(OPERATOR_LOCALE, { day: '2-digit', month: '2-digit' })
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString(OPERATOR_LOCALE, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Whole calendar days from today to `value`. Negative is the past. */
export function dayDelta(value: string | null | undefined, now: Date = new Date()): number | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null

  const target = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return Math.round((target - today) / 86_400_000)
}

export function formatMegabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1).replace('.', ',')
}
