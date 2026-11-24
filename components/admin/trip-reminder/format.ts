/**
 * Formatting shared by the blocks of `/admin/trip-reminder` (#1233). Instants are shown in São
 * Paulo, like the rest of the CMS; a calendar month (`YYYY-MM-01`, a date and not an instant) is
 * read by its parts and formatted in UTC, so it never slides to the previous month.
 */

import type { useTranslations } from 'next-intl'
import { UNKNOWN_VALUE } from '@/lib/format/unknown'
import type { TripAdminError } from '@/lib/trip-reminder/settings'

type Translate = ReturnType<typeof useTranslations>

const instantFormat = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
})
const monthFormat = new Intl.DateTimeFormat('pt-BR', { month: 'short', year: 'numeric', timeZone: 'UTC' })
export const countFormat = new Intl.NumberFormat('pt-BR')

export function formatInstant(iso: string | null | undefined): string {
  if (!iso) return UNKNOWN_VALUE
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? UNKNOWN_VALUE : instantFormat.format(date)
}

/** `2027-01-01` → `jan. de 2027`; `null` when the value is not a calendar day. */
export function formatMonth(day: string | null | undefined): string | null {
  const parts = day ? /^(\d{4})-(\d{2})-\d{2}$/.exec(day) : null
  if (!parts) return null
  return monthFormat.format(new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, 1)))
}

/** The sentence of a refusal; an unexplained one names its SQLSTATE so the operator can report it. */
export function errorText(t: Translate, error: TripAdminError | null | undefined): string {
  const code = error?.code ?? 'unknown'
  if (code === 'unknown') {
    return error?.sqlstate ? t('errors.unknown_code', { code: error.sqlstate }) : t('errors.unknown')
  }
  return t(`errors.${code}`)
}
