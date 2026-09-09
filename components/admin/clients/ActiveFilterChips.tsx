'use client'

/**
 * WHAT IS APPLIED, VISIBLE WITHOUT OPENING ANYTHING.
 *
 * This is the one thing the closed control takes away, and the reason `DS-LAYOUT-015` makes it
 * obligatory rather than optional. The old panel was a stack of buttons and the chosen option sat
 * there underlined and bold: the operator saw every narrowing at a glance, in the same sweep that
 * read the list. Eight `<select>`s show eight choices in eight closed labels, each one only while
 * you are looking straight at it — and a filter you forget you left on is a list that lies about
 * how much work there is.
 *
 * SO IT IS A FIXED LINE AND NOT A CONDITIONAL ONE. It renders with nothing but the total when no
 * filter is applied, because a control that appears and disappears is one the operator never
 * learns to look at.
 *
 * EACH CHIP CARRIES THE DIMENSION AND THE VALUE. `Minas` on its own does not say whether it is
 * the state of the registration or the state of the partnership — the screen has both, and they
 * answer different questions.
 *
 * THE COUNT IS NOT REPEATED ON THE CHIP. It is inside the option that set it and in the total
 * beside it; a third copy is a third thing to keep true.
 */

import { useTranslations } from 'next-intl'
import { X } from 'lucide-react'
import { EMPTY_FILTERS, type DirectoryFilters, type FacetKey } from '@/lib/clients/directory-filter'

/** The dimensions a chip can describe, in the order the panel offers them. */
const CHIP_FACETS: FacetKey[] = [
  'state',
  'plan',
  'contract',
  'status',
  'country',
  'region',
  'city',
  'clientType',
]

interface ActiveFilterChipsProps {
  filters: DirectoryFilters
  onFiltersChange: (next: DirectoryFilters) => void
  /** `{count} de {total}` — the size of what is on screen, which is what the chips explain. */
  result: string
}

export function ActiveFilterChips({ filters, onFiltersChange, result }: ActiveFilterChipsProps) {
  const t = useTranslations('Clients.directory')
  const p = useTranslations('Partnerships')

  /** The label of one applied value — the pipeline's vocabulary, never this component's. */
  function valueLabel(key: FacetKey, value: string): string {
    if (key === 'state') return value === 'in_progress' ? p('queue.inProgress') : p(`states.${value}`)
    if (key === 'contract') return t(`contractValues.${value}`)
    if (key === 'plan') return t(`planValues.${value}`)
    if (key === 'status') return t(`statusValues.${value}`)
    return value
  }

  const chips: { key: string; label: string; clear: () => void }[] = []

  if (filters.search.trim() !== '') {
    chips.push({
      key: 'search',
      label: `${t('activeFilters.searchLabel')}: ${filters.search.trim()}`,
      clear: () => onFiltersChange({ ...filters, search: '' }),
    })
  }

  for (const key of CHIP_FACETS) {
    const value = filters[key]
    // `state` is the one dimension whose "no filter" is a value (`all`) rather than `null`.
    if (value === null || value === 'all' || value === '') continue
    chips.push({
      key,
      label: `${t(`filters.${key}`)}: ${valueLabel(key, String(value))}`,
      clear: () =>
        onFiltersChange({ ...filters, [key]: key === 'state' ? 'all' : null } as DirectoryFilters),
    })
  }

  if (filters.onlyLate) {
    chips.push({
      key: 'onlyLate',
      label: t('filters.onlyLate'),
      clear: () => onFiltersChange({ ...filters, onlyLate: false }),
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="font-medium text-gray-900 dark:text-gray-200">{result}</span>

      {chips.map((chip) => (
        <span
          key={chip.key}
          className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2 py-1 text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
        >
          {chip.label}
          <button
            type="button"
            onClick={chip.clear}
            // Named with the filter it removes: a row of identical `Remover` buttons is a row a
            // screen reader cannot tell apart.
            aria-label={t('activeFilters.remove', { label: chip.label })}
            className="-mr-1 rounded p-0.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800"
          >
            <X className="h-3 w-3" aria-hidden="true" />
          </button>
        </span>
      ))}

      {chips.length > 0 && (
        <button
          type="button"
          onClick={() => onFiltersChange(EMPTY_FILTERS)}
          className="font-medium text-primary-800 underline underline-offset-4 dark:text-tuggi-blue"
        >
          {t('clear')}
        </button>
      )}
    </div>
  )
}
