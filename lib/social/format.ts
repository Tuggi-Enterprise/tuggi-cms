/**
 * Numbers and dates of the social screen (#1059), `pt-BR` and Brasília (copy "Números e datas"):
 * `28/10/2026`, `28/10/2026 18:00`, `4,2%`, `12.400`, `+312`.
 */

import { SOCIAL_TIME_ZONE, dayAsDate } from './time'

const integer = new Intl.NumberFormat('pt-BR')
const signedInteger = new Intl.NumberFormat('pt-BR', { signDisplay: 'exceptZero' })
const percent1 = new Intl.NumberFormat('pt-BR', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 })
const percent2 = new Intl.NumberFormat('pt-BR', { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const signedPercent = new Intl.NumberFormat('pt-BR', {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
  signDisplay: 'exceptZero',
})
const decimal1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const shortDate = new Intl.DateTimeFormat('pt-BR', { timeZone: SOCIAL_TIME_ZONE, dateStyle: 'short' })
const dateTime = new Intl.DateTimeFormat('pt-BR', {
  timeZone: SOCIAL_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})
const longDate = new Intl.DateTimeFormat('pt-BR', { timeZone: SOCIAL_TIME_ZONE, weekday: 'long', day: 'numeric', month: 'long' })
const weekdayLong = new Intl.DateTimeFormat('pt-BR', { timeZone: SOCIAL_TIME_ZONE, weekday: 'long' })

export const fmtInt = (n: number) => integer.format(n)
export const fmtSigned = (n: number) => signedInteger.format(n)
export const fmtRate = (r: number) => percent1.format(r)
export const fmtRate2 = (r: number) => percent2.format(r)
export const fmtSignedRate = (r: number) => signedPercent.format(r)
export const fmtDecimal = (n: number) => decimal1.format(n)
/** A calendar day `YYYY-MM-DD` as `28/10/2026`. */
export const fmtDay = (day: string) => shortDate.format(dayAsDate(day))
/** An instant as `28/10/2026 18:00`, Brasília. */
export const fmtDateTime = (iso: string) => dateTime.format(new Date(iso)).replace(',', '')
/** A calendar day as "segunda-feira, 2 de novembro", for tooltips. */
export const fmtLongDay = (day: string) => longDate.format(dayAsDate(day))
/** ISO weekday 1..7 as "segunda-feira" (2026-11-02 is a Monday). */
export const fmtWeekday = (isoDay: number) => weekdayLong.format(dayAsDate(`2026-11-0${1 + isoDay}`))
