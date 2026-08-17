/**
 * Dates, formatted once for the queue and the review screen.
 *
 * NOBODY COUNTS DAYS IN THEIR HEAD ON THESE SCREENS, and the arithmetic that says "venceu há
 * 12 dias" is `daysUntil` in `lib/partner-form/regularity.ts` — beside the rule it serves
 * (BR-B2B-022 item 4, which treats an expired licence as an absent one). There used to be a
 * second copy of it here; two answers to "how many days" is how one of them goes wrong.
 *
 * The calendar day, not the instant: a licence valid until today is valid today whatever the
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

/**
 * The hour, in the shape spec §3.1 wrote it: `10h32`, never `10:32`.
 *
 * Built from the parts and not from a locale option because `pt-BR` renders `10:32` for every
 * combination of `hour`/`minute`, and the `h` is the form the operator reads on that column.
 */
export function formatClockTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `${hour}h${minute}`
}

/**
 * `18/08, 10h32` — the deadline of the 72-hour triage clock (BR-B2B-010, item 4), and the hour
 * is not decoration: 72 hours from an approval at 10h32 expires at 10h32, and a date alone would
 * make the operator believe he has the whole day.
 */
export function formatDeadline(value: string | null | undefined): string {
  if (!value) return '—'
  const day = formatShortDate(value)
  if (day === '—') return '—'
  return `${day}, ${formatClockTime(value)}`
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
