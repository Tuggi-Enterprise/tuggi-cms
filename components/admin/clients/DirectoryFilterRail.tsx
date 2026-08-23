'use client'

/**
 * The facet rail of `/admin/clients` — the same one for the table and for the board.
 *
 * IT WAS THE TABLE'S until the board arrived (#409), and extracting it was not tidiness: the
 * rail's counts have to come from the SAME `buildDirectoryView` the rows come from, and two
 * copies of that rule would answer `3` in one view and `4` in the other for the same filter.
 * One rail, one predicate, two renderings of the result.
 *
 * WHY THE OPTIONS ARE DERIVED AND NOT DECLARED. `país`, `estado` and `cidade` are free text in
 * the registration, and on 2026-08-17 only 3 of 11 rows carried a country — a dropdown of 200
 * countries over 3 usable values costs more to read than the list it filters. A dimension with
 * nothing to choose from does not render, and every option carries the count it opens.
 */

import { useTranslations } from 'next-intl'
import { Filter, RotateCcw, Search } from 'lucide-react'
import {
  EMPTY_FILTERS,
  type DirectoryFilters,
  type DirectoryView,
  type FacetKey,
} from '@/lib/clients/directory-filter'

/** The rail, in the order an operator narrows: where, then who, then how far along. */
const FACETS: FacetKey[] = [
  'country',
  'region',
  'city',
  'clientType',
  'status',
  'contract',
  'plan',
  'state',
]

interface DirectoryFilterRailProps {
  view: DirectoryView
  filters: DirectoryFilters
  onFiltersChange: (next: DirectoryFilters) => void
  /** How many rows the working set holds — the count `Em andamento` carries. */
  working: number
}

export function DirectoryFilterRail({
  view,
  filters,
  onFiltersChange,
  working,
}: DirectoryFilterRailProps) {
  const t = useTranslations('Clients.directory')
  const p = useTranslations('Partnerships')

  function set<K extends keyof DirectoryFilters>(key: K, value: DirectoryFilters[K]) {
    onFiltersChange({ ...filters, [key]: value })
  }

  /** The label of one facet value — the vocabulary is the pipeline's, not this screen's. */
  function optionLabel(key: FacetKey, value: string): string {
    if (key === 'state') return p(`states.${value}`)
    if (key === 'contract') return t(`contractValues.${value}`)
    if (key === 'plan') return t(`planValues.${value}`)
    if (key === 'status') return t(`statusValues.${value}`)
    return value
  }

  const clearControl = view.filtering ? (
    <button
      type="button"
      onClick={() => onFiltersChange(EMPTY_FILTERS)}
      aria-label={t('clear')}
      title={t('clear')}
      className="rounded-lg p-2 text-gray-400 transition-all hover:bg-primary-800/5 hover:text-primary-800"
    >
      <RotateCcw className="h-4 w-4" aria-hidden="true" />
    </button>
  ) : null

  return (
    <div className="w-[18%] flex-shrink-0">
      <div className="sticky top-24 rounded-3xl border border-gray-200 bg-white/70 shadow-2xl shadow-black/5 backdrop-blur-xl dark:border-gray-800 dark:bg-gray-900/70">
        <div className="p-6">
          <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* The chip is a SURFACE tint and the icon inside it is decorative — the
                  heading beside it carries the meaning, so it is `aria-hidden` and exempt
                  from SC 1.4.11. That is what lets the brand blue stay here while never
                  painting a word. */}
              <div className="rounded-xl bg-tuggi-blue/10 p-2">
                <Filter className="h-5 w-5 text-tuggi-blue" aria-hidden="true" />
              </div>
              <h2 className="text-xl font-semibold tracking-tight text-gray-900 dark:text-white">
                {t('filtersTitle')}
              </h2>
            </div>
            {clearControl}
          </div>

          <div className="mb-6">
            <label htmlFor="directory-search" className="sr-only">
              {t('searchLabel')}
            </label>
            <div className="group relative">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                <Search
                  className="h-4 w-4 text-gray-400 transition-colors group-focus-within:text-primary-800"
                  aria-hidden="true"
                />
              </div>
              <input
                id="directory-search"
                type="text"
                value={filters.search}
                placeholder={t('searchPlaceholder')}
                onChange={(event) => set('search', event.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-gray-50/50 py-3 pl-10 pr-4 text-sm outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-primary-800 dark:border-gray-700 dark:bg-gray-800/50 dark:text-white"
              />
            </div>
          </div>

          <div className="space-y-5">
            {FACETS.map((key) => {
              const options = view.facets[key]
              // A dimension nobody filled in is not a filter — it is noise with a heading.
              if (options.length === 0) return null
              const selected = filters[key] as string | null

              return (
                <section key={key} aria-labelledby={`facet-${key}`}>
                  <h3
                    id={`facet-${key}`}
                    className="mb-3 px-1 text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400"
                  >
                    {t(`filters.${key}`)}
                  </h3>
                  <ul className="space-y-1">
                    {/*
                      THE WORKING SET, and it is the one thing `/admin/partnerships` had that
                      this list did not. A list that shows `Publicado`, `Descartado` and
                      `Recusado na triagem` alongside what still needs doing is noise the
                      operator learns to ignore (criterion 4, DS-COPY-020, point 5). An
                      option and not the default: this is the client list too, and somebody
                      fixing the fiscal data of a partner already on air must find them.
                    */}
                    {key === 'state' && (
                      <li>
                        <FacetOptionButton
                          label={p('queue.inProgress')}
                          count={working}
                          active={filters.state === 'in_progress'}
                          onToggle={() =>
                            set('state', filters.state === 'in_progress' ? 'all' : 'in_progress')
                          }
                        />
                      </li>
                    )}
                    {options.map((option) => (
                      <li key={option.value}>
                        <FacetOptionButton
                          label={optionLabel(key, option.value)}
                          count={option.count}
                          active={selected === option.value}
                          onToggle={() =>
                            // Clearing a dimension means `null` for every one of them EXCEPT
                            // `state`, whose "no filter" value is `all` — `null` is not one
                            // of its values, and setting it matched no row at all.
                            set(
                              key as keyof DirectoryFilters,
                              (selected === option.value
                                ? key === 'state'
                                  ? 'all'
                                  : null
                                : option.value) as never
                            )
                          }
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              )
            })}

            <div className="border-t border-gray-100 pt-4 dark:border-gray-800">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={filters.onlyLate}
                  onChange={(event) => set('onlyLate', event.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-primary-800 focus:ring-primary-800"
                />
                <span className="text-sm text-gray-900 dark:text-gray-200">
                  {t('filters.onlyLate')}
                </span>
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * One option of the rail: the label, and the count it would open.
 *
 * `text-primary-800` on light and `text-tuggi-blue` on dark, which is not an inconsistency —
 * it is the same measurement read on two surfaces. The brand blue is 2.70:1 on white and fails
 * SC 1.4.3; on `gray-900` it is 6.57:1 and passes comfortably. The token that fails as ink in
 * daylight is the one that works at night.
 */
function FacetOptionButton({
  label,
  count,
  active,
  onToggle,
}: {
  label: string
  count: number
  active: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onToggle}
      className={`flex min-h-[24px] w-full items-center justify-between gap-2 rounded-lg px-1 py-1 text-left text-sm underline-offset-4 transition-colors hover:underline ${
        active
          ? 'font-semibold text-gray-900 underline dark:text-white'
          : 'text-primary-800 dark:text-tuggi-blue'
      }`}
    >
      <span className="truncate">{label}</span>
      <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">{count}</span>
    </button>
  )
}
