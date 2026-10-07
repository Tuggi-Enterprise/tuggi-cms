'use client'

/**
 * Opening hours by weekday, in the `core.is_poi_open_now` shape that `parseOpeningHours` accepts
 * (`Record<day, {open, close}[]>`) — #886. A day with no range is closed and is left out of the
 * JSON. Validation is the caller's, at save, through `parseOpeningHours`.
 *
 * Empty `value` is NOT "closed every day": `core.is_poi_open_now` treats null as open, so the
 * editor says so in one line instead of seven "Fechado". "Closed" per day only once some day has a
 * range — that is when the app reads a missing day as closed. `unreadable` is a stored value the
 * editor cannot parse (Google `weekday_text` array from `poi-import-service.ts`), shown read-only
 * so the operator can retype it.
 */

import { useTranslations } from 'next-intl'
import { Plus, X } from 'lucide-react'
import { OPENING_HOURS_WEEKDAYS, type OpeningHours } from '@/lib/partner-form/place-prefill'

interface Props {
  value: OpeningHours
  onChange: (value: OpeningHours) => void
  disabled?: boolean
  unreadable?: string | null
}

const timeInput =
  'px-2 py-1.5 bg-gray-50 dark:bg-gray-900/50 border border-transparent rounded-lg text-sm font-medium dark:text-white outline-none focus:ring-2 focus:ring-tuggi-blue disabled:opacity-60'

export function OpeningHoursEditor({ value, onChange, disabled, unreadable }: Props) {
  const t = useTranslations('Modals.PlaceDetails.hours')
  const isEmpty = Object.keys(value).length === 0

  const setDay = (day: string, ranges: { open: string; close: string }[]) => {
    const next = { ...value }
    if (ranges.length === 0) delete next[day]
    else next[day] = ranges
    onChange(next)
  }

  return (
    <div className="space-y-2">
      {isEmpty && <p className="text-sm italic text-gray-500 dark:text-gray-400">{t('empty')}</p>}
      {unreadable && (
        <pre className="whitespace-pre-wrap rounded-lg bg-gray-50 px-3 py-2 font-sans text-xs text-gray-600 dark:bg-gray-900/50 dark:text-gray-300">
          {unreadable}
        </pre>
      )}
      {OPENING_HOURS_WEEKDAYS.map((day) => {
        const ranges = value[day] ?? []
        return (
          <div key={day} className="flex items-start gap-3">
            <span className="w-10 pt-1.5 text-xs font-black text-gray-500 uppercase">{t(`days.${day}`)}</span>
            <div className="flex flex-1 flex-wrap items-center gap-2">
              {ranges.length === 0 && !isEmpty && (
                <span className="pt-1 text-sm italic text-gray-400 dark:text-gray-500">{t('closed')}</span>
              )}
              {ranges.map((range, i) => (
                <span key={i} className="inline-flex items-center gap-1">
                  <input
                    type="time"
                    aria-label={t('open')}
                    className={timeInput}
                    value={range.open}
                    disabled={disabled}
                    onChange={(e) => setDay(day, ranges.map((r, j) => (j === i ? { ...r, open: e.target.value } : r)))}
                  />
                  <span className="text-gray-400">–</span>
                  <input
                    type="time"
                    aria-label={t('close')}
                    className={timeInput}
                    value={range.close}
                    disabled={disabled}
                    onChange={(e) => setDay(day, ranges.map((r, j) => (j === i ? { ...r, close: e.target.value } : r)))}
                  />
                  {!disabled && (
                    <button
                      type="button"
                      aria-label={t('remove')}
                      onClick={() => setDay(day, ranges.filter((_, j) => j !== i))}
                      className="p-1 text-gray-400 hover:text-red-500"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </span>
              ))}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => setDay(day, [...ranges, { open: '', close: '' }])}
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs font-bold text-tuggi-blue hover:underline"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t('add')}
                </button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
