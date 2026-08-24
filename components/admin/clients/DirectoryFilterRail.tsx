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
 *
 * ── ON A PHONE THE RAIL IS NOT A RAIL ──────────────────────────────────────────────────────
 *
 * It was `w-[18%]` at every width, which on a 390px screen is 70px: the facet headings clipped
 * to nothing and the counts stacked into a column of naked numbers, while the 82% beside it
 * pushed the whole board off the right edge. The fix is not a narrower rail — 18% of a phone is
 * never a rail. Below `lg` the same panel moves into a sheet behind a `Filtros` button, and the
 * button wears the count of what is currently narrowed, because a filter you cannot see is a
 * filter you forget you left on.
 *
 * `FilterPanel` IS RENDERED ONCE AND MOUNTED TWICE — never duplicated. Two copies of the facet
 * markup is the same defect two copies of the predicate would be: they drift, and the drift
 * shows up as a phone that filters differently from a monitor. What differs between the two is
 * the container and nothing inside it.
 */

import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslations } from 'next-intl'
import { Filter, RotateCcw, Search, X } from 'lucide-react'
import {
  EMPTY_FILTERS,
  activeFilterCount,
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

/**
 * The desktop rail. `hidden` below `lg`, where `DirectoryFilterSheet` carries the same panel.
 *
 * The width stays a percentage rather than becoming a fixed `w-72`: on the wide monitor this
 * screen was built for, the rail growing with the window is what keeps the long city names of
 * the `cidade` facet from truncating, and that was a measured choice, not an accident.
 */
export function DirectoryFilterRail({
  view,
  filters,
  onFiltersChange,
  working,
}: DirectoryFilterRailProps) {
  return (
    <div className="hidden w-[18%] flex-shrink-0 lg:block">
      <div className="sticky top-24 rounded-3xl border border-gray-200 bg-white/70 shadow-2xl shadow-black/5 backdrop-blur-xl dark:border-gray-800 dark:bg-gray-900/70">
        <div className="p-6">
          <FilterPanel
            view={view}
            filters={filters}
            onFiltersChange={onFiltersChange}
            working={working}
          />
        </div>
      </div>
    </div>
  )
}

/**
 * The phone's door to the same panel: a button, and the sheet it opens.
 *
 * `lg:hidden` — above the breakpoint the rail is already on screen and a second way in would be
 * two controls for one state. The trigger belongs in the sticky header of whichever view mounts
 * it, which is why this is a component the caller places rather than a fragment of the rail.
 */
export function DirectoryFilterSheet({
  view,
  filters,
  onFiltersChange,
  working,
}: DirectoryFilterRailProps) {
  const t = useTranslations('Clients.directory')
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const active = activeFilterCount(filters)

  /**
   * A sheet over the list must not let the list behind it scroll, and must give the keyboard
   * somewhere to land. Focus goes to `Fechar` rather than to the search field: opening the
   * sheet on a phone with focus in a text input raises the software keyboard over the facets
   * the operator came here to read.
   */
  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)

    return () => {
      document.body.style.overflow = previous
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-controls={panelId}
        className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium text-primary-800 dark:border-gray-700 dark:text-tuggi-blue lg:hidden"
      >
        <Filter className="h-4 w-4" aria-hidden="true" />
        {/* The count is IN the accessible name and not only beside it: `Filtros` followed by a
            lone `2` reads as two separate things to a screen reader, and the number is the
            whole point of the control. */}
        {active > 0 ? t('filtersButtonActive', { count: active }) : t('filtersTitle')}
      </button>

      {/*
        THE SHEET IS PORTALLED TO `document.body`, AND IT HAS TO BE.
        `position: fixed` is relative to the viewport only while no ancestor establishes a
        containing block — and `transform`, `filter`, `backdrop-filter` and `will-change` all
        do. The sticky header this button sits in is `backdrop-blur-xl`, i.e. a `backdrop-filter`,
        so rendered in place the overlay was trapped inside a 356×177 box: the facets scrolled
        above the top of it and `Em andamento` could not be tapped at all. Caught by
        `client-board.mobile.spec.tsx`, which is why that test clicks the LAST option of the
        LAST dimension rather than the first thing it can find.
      */}
      {open && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[60] flex flex-col justify-end lg:hidden">
          <button
            type="button"
            aria-label={t('close')}
            onClick={() => setOpen(false)}
            className="absolute inset-0 h-full w-full bg-black/50 backdrop-blur-sm"
          />

          {/*
            `max-h-[85vh]` and its own `overflow-y-auto`: eight facets over a long city list is
            taller than a phone, and a sheet that grows past the viewport puts `Limpar` where no
            thumb reaches. `pb-[env(safe-area-inset-bottom)]` keeps the last option clear of the
            home indicator on an iPhone.
          */}
          <div
            id={panelId}
            role="dialog"
            aria-modal="true"
            aria-label={t('filtersTitle')}
            className="relative flex max-h-[85vh] flex-col rounded-t-3xl border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)] dark:border-gray-800 dark:bg-gray-900"
          >
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-gray-800">
              <h2 className="text-lg font-semibold tracking-tight text-gray-900 dark:text-white">
                {t('filtersTitle')}
              </h2>
              <button
                ref={closeRef}
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t('close')}
                className="rounded-xl p-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            {/*
              `min-h-0` IS LOAD-BEARING AND NOT A TIDYING CLASS. A flex item defaults to
              `min-height: auto`, which means it refuses to shrink below its content — so this
              `overflow-y-auto` never engaged, the sheet grew past `max-h-[85vh]`, and the last
              facets ended up above the top of the viewport with no scroll anywhere to reach
              them. `Em andamento` is the last option of the last dimension, which is why the
              test that clicks it is the one that caught this.
            */}
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
              <FilterPanel
                view={view}
                filters={filters}
                onFiltersChange={onFiltersChange}
                working={working}
                headless
              />
            </div>

            {/*
              THE SHEET CLOSES ITSELF AND SHOWS WHAT IT DID. Every facet applies on tap — there
              is no `Aplicar`, because the counts beside each option are only true of the set the
              filters already produce. What the operator needs instead is the way out and the
              size of the result, and this line is both.
            */}
            <div className="border-t border-gray-100 px-5 py-3 dark:border-gray-800">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="min-h-[44px] w-full rounded-xl bg-primary-800 px-4 py-3 text-sm font-semibold text-white"
              >
                {t('showResults', { count: view.rows.length })}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}

/**
 * The facets themselves — one implementation, two containers.
 *
 * `headless` drops the panel's own heading, which the sheet already prints in its title bar.
 * Everything else is identical by construction: the same options, the same counts, the same
 * `set` semantics, so nothing can behave differently on a phone than on a monitor.
 */
function FilterPanel({
  view,
  filters,
  onFiltersChange,
  working,
  headless,
}: DirectoryFilterRailProps & { headless?: boolean }) {
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
    <>
      {headless ? (
        // The sheet's title bar already names the panel, so what is left here is the one
        // control that has nowhere else to be. It keeps its place on the right so the two
        // renderings put `Limpar` under the same thumb.
        clearControl && <div className="mb-4 flex justify-end">{clearControl}</div>
      ) : (
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
      )}

      <div className="mb-6">
        <label htmlFor={`directory-search${headless ? '-sheet' : ''}`} className="sr-only">
          {t('searchLabel')}
        </label>
        <div className="group relative">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
            <Search
              className="h-4 w-4 text-gray-400 transition-colors group-focus-within:text-primary-800"
              aria-hidden="true"
            />
          </div>
          {/*
            `text-base` and not `text-sm` on the input, at every width. Safari on iOS zooms the
            whole page when a focused field measures under 16px, and the page it zooms into is
            one the operator then has to pinch back out of — the `text-sm` (14px) this field
            carried is exactly the trigger. `sm:text-sm` restores the smaller face above the
            phone breakpoint, where no browser does this.
          */}
          <input
            id={`directory-search${headless ? '-sheet' : ''}`}
            type="text"
            value={filters.search}
            placeholder={t('searchPlaceholder')}
            onChange={(event) => set('search', event.target.value)}
            className="w-full rounded-xl border border-gray-200 bg-gray-50/50 py-3 pl-10 pr-4 text-base outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-primary-800 dark:border-gray-700 dark:bg-gray-800/50 dark:text-white sm:text-sm"
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
            <section key={key} aria-labelledby={`facet-${key}${headless ? '-sheet' : ''}`}>
              <h3
                id={`facet-${key}${headless ? '-sheet' : ''}`}
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
          <label className="flex min-h-[44px] cursor-pointer items-center gap-2">
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
    </>
  )
}

/**
 * One option of the rail: the label, and the count it would open.
 *
 * `text-primary-800` on light and `text-tuggi-blue` on dark, which is not an inconsistency —
 * it is the same measurement read on two surfaces. The brand blue is 2.70:1 on white and fails
 * SC 1.4.3; on `gray-900` it is 6.57:1 and passes comfortably. The token that fails as ink in
 * daylight is the one that works at night.
 *
 * `min-h-[44px]` AND NOT `min-h-[24px]`. 24px is the floor WCAG 2.2 SC 2.5.8 sets for a pointer
 * target, and it was enough while this list only ever met a mouse. A facet is now tapped with a
 * thumb, and a 24px row in a list of 24px rows is the shape that opens `Brasil` when the finger
 * meant `Portugal`. 44px is the size both platform guidelines name and costs nothing here: the
 * options are stacked, so the height comes out of whitespace the rail already had.
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
      className={`flex min-h-[44px] w-full items-center justify-between gap-2 rounded-lg px-1 py-1 text-left text-sm underline-offset-4 transition-colors hover:underline lg:min-h-[32px] ${
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
