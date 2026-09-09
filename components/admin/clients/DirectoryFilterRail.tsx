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
import { useDialogShell } from '@/lib/hooks/use-dialog-shell'
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

/**
 * THE PANEL, IN THE ORDER THE OPERATOR WORKS — not in the order the columns happen to sit in the
 * table. `Estado da parceria` carries the cut between queue and archive and is what the screen is
 * opened to use; it was the last control of the last section.
 *
 * `onlyLate` is a checkbox and not a dimension, so it is named on the section rather than in the
 * facet list — it belongs with the work and nowhere else.
 */
interface PanelSection {
  id: 'work' | 'commercial' | 'where' | 'type'
  facets: FacetKey[]
  onlyLate?: boolean
}

const SECTIONS: PanelSection[] = [
  { id: 'work', facets: ['state'], onlyLate: true },
  { id: 'commercial', facets: ['plan', 'contract', 'status'] },
  { id: 'where', facets: ['country', 'region', 'city'] },
  { id: 'type', facets: ['clientType'] },
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
 * `lg:hidden` BY DEFAULT, and `everyWidth` in the board. In the TABLE the rail is on screen above
 * the breakpoint and a second way in would be two controls for one state. The BOARD has no rail
 * at any width — a 288px lane there costs a whole column of the workbench (DS-LAYOUT-014) — so
 * this is its only door to the panel, at every width.
 *
 * The trigger belongs in the sticky header of whichever view mounts it, which is why this is a
 * component the caller places rather than a fragment of the rail.
 */
export function DirectoryFilterSheet({
  view,
  filters,
  onFiltersChange,
  working,
  everyWidth,
}: DirectoryFilterRailProps & { everyWidth?: boolean }) {
  const t = useTranslations('Clients.directory')
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const active = activeFilterCount(filters)

  /**
   * Scroll lock, `Escape`, focus in and focus back — the four this sheet had three of, written
   * inline, until the client record needed the same four and had none. One hook now
   * (`useDialogShell`), and the fourth — returning focus to the `Filtros` button — comes free.
   *
   * Focus goes to `Fechar` rather than to the search field: opening the sheet on a phone with
   * focus in a text input raises the software keyboard over the facets the operator came here
   * to read.
   */
  const closeRef = useDialogShell(open, () =>
    setOpen(false)
  ) as React.RefObject<HTMLButtonElement | null>

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-controls={panelId}
        className={`inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium text-primary-800 dark:border-gray-700 dark:text-tuggi-blue ${
          everyWidth ? '' : 'lg:hidden'
        }`}
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
        <div className={`fixed inset-0 z-[60] flex flex-col justify-end ${everyWidth ? '' : 'lg:hidden'}`}>
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
 * THE SEARCH BOX, AND WHY IT KEEPS ITS OWN COPY OF THE TERM.
 *
 * The operator's first complaint about this screen, on 2026-09-09, was that the search "é lenta e
 * não responde corretamente". The field was bound straight to `filters.search`, which lives in
 * the URL, so every keystroke ran `router.replace()` — an App Router navigation, one per
 * character, each fetching the route's RSC payload. Characters arrived late and out of order
 * because the value on screen was whatever the last navigation had committed.
 *
 * So the letters are LOCAL and the URL is the destination, reached once the typing stops. The
 * URL stays the owner of the filter — `Minas, sem contrato` has to remain a link somebody can
 * send (DS-LAYOUT-003) — it simply stops being written mid-word.
 *
 * The other half of that complaint was the MATCHING, and it is fixed where it belongs, in
 * `lib/clients/directory-filter`: the predicate now reuses `namePattern` instead of comparing
 * bytes, so `buzios` finds `Búzios`.
 */
function SearchField({
  id,
  value,
  placeholder,
  onCommit,
}: {
  id: string
  value: string
  placeholder: string
  onCommit: (next: string) => void
}) {
  const [text, setText] = useState(value)
  const [known, setKnown] = useState(value)

  /**
   * The URL still wins when it changes from anywhere else: `Limpar filtros`, a link somebody
   * pasted, or the other mounting of this panel — the rail and the sheet are two boxes over one
   * filter and must not disagree about what is typed in it.
   *
   * ADJUSTED DURING RENDER AND NOT IN AN EFFECT. React re-runs this component immediately, before
   * anything paints and without re-rendering a child in between; the effect version renders the
   * stale term once first, which is the cascading render `react-hooks/set-state-in-effect`
   * warns about.
   */
  if (known !== value) {
    setKnown(value)
    setText(value)
  }

  /**
   * `onCommit` is rebuilt on every render of the panel — it closes over `filters` — so it is
   * held in a ref rather than declared as a dependency. As a dependency it would restart the
   * timer on every render and the term would never be committed at all. The ref is written in an
   * effect, because a ref written during render is one React may not have committed yet.
   */
  const commit = useRef(onCommit)
  useEffect(() => {
    commit.current = onCommit
  })

  useEffect(() => {
    if (text === value) return
    const timer = setTimeout(() => commit.current(text), 250)
    return () => clearTimeout(timer)
  }, [text, value])

  return (
    <input
      id={id}
      type="text"
      value={text}
      placeholder={placeholder}
      onChange={(event) => setText(event.target.value)}
      className="w-full rounded-xl border border-gray-200 bg-gray-50/50 py-3 pl-10 pr-4 text-base outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-primary-800 dark:border-gray-700 dark:bg-gray-800/50 dark:text-white sm:text-sm"
    />
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
  /** `FilterPanel` is mounted twice — rail and sheet — so every id it prints has to differ. */
  const suffix = headless ? '-sheet' : ''

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
        /*
          `Limpar filtros` EXISTS HERE AND NOT IN THE RAIL.
          
          It used to be in both, and once the chip line arrived (DS-LAYOUT-015, point 5) that made
          THREE controls doing one thing on the table: this icon, the chip line's own word, and
          the empty state's call to action. The chip line is where the spec puts it, and on the
          table it is on screen right next to the panel.
          
          The sheet keeps it because the sheet COVERS the chip line: closing the sheet to clear a
          filter and reopening it to set another is the loop this button removes.
        */
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
        </div>
      )}

      <div className="mb-6">
        <label htmlFor={`directory-search${suffix}`} className="sr-only">
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
          <SearchField
            id={`directory-search${suffix}`}
            value={filters.search}
            placeholder={t('searchPlaceholder')}
            onCommit={(next) => set('search', next)}
          />
        </div>
      </div>

      <div className="space-y-5">
        {/*
          FOUR SECTIONS, AND THE WORK COMES FIRST.

          The order used to be `país, estado, cidade, tipo, situação, contrato, plano, estado da
          parceria`, which put `Em andamento` — the cut that separates the queue from the archive,
          and the most used control on the screen — as the first option of the LAST section. What
          the operator reaches for most was the furthest thing down.
        */}
        {SECTIONS.map((section) => {
          const fields = section.facets.filter((key) => view.facets[key].length > 0)
          // A section whose every dimension is empty is a heading with nothing under it.
          if (fields.length === 0 && !section.onlyLate) return null

          return (
            <section key={section.id} aria-labelledby={`section-${section.id}${suffix}`}>
              <h3
                id={`section-${section.id}${suffix}`}
                className="mb-3 px-1 text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400"
              >
                {t(`sections.${section.id}`)}
              </h3>

              <div className="space-y-3">
                {fields.map((key) => (
                  <FacetSelect
                    key={key}
                    id={`facet-${key}${suffix}`}
                    label={t(`filters.${key}`)}
                    value={(filters[key] as string | null) ?? ''}
                    onChange={(next) =>
                      // Clearing a dimension means `null` for every one of them EXCEPT `state`,
                      // whose "no filter" value is `all` — `null` is not one of its values, and
                      // setting it matched no row at all.
                      set(
                        key as keyof DirectoryFilters,
                        (next === '' ? (key === 'state' ? 'all' : null) : next) as never
                      )
                    }
                  >
                    {key === 'state' ? (
                      <>
                        {/*
                          THE CUTS ARE NOT A STAGE, and an `<optgroup>` is what says so without a
                          word. `Em andamento` is the working set — the one thing
                          `/admin/partnerships` had that this list did not — and `Todos` is the
                          absence of the filter. Listing either among the ten stages reads as an
                          eleventh stage.
                        */}
                        <optgroup label={t('stateGroups.cuts')}>
                          <option value="in_progress">
                            {withCount(p('queue.inProgress'), working)}
                          </option>
                          {/*
                            `all` AND NOT THE EMPTY STRING. `state` is the one dimension whose
                            "no filter" is a VALUE — `null` matches no row at all. With an empty
                            option here the select committed `''`, the panel wrote `all`, React
                            re-rendered with a value no option carried, and the browser fell back
                            to the first one: clearing the dimension snapped the operator to
                            `Em andamento`.
                          */}
                          <option value="all">{p('queue.allStates')}</option>
                        </optgroup>
                        <optgroup label={t('stateGroups.stage')}>
                          {view.facets.state.map((option) => (
                            <option key={option.value} value={option.value}>
                              {withCount(optionLabel('state', option.value), option.count)}
                            </option>
                          ))}
                        </optgroup>
                      </>
                    ) : (
                      <>
                        {/*
                          THE COUNT IS ON THE NEUTRAL OPTION TOO. `Todas as cidades (36)` is what
                          lets the operator read the size of the whole before narrowing it — the
                          question a closed control otherwise answers only after the choice.
                        */}
                        <option value="">
                          {withCount(t(`allOf.${key}`), totalOf(view.facets[key]))}
                        </option>
                        {view.facets[key].map((option) => (
                          <option key={option.value} value={option.value}>
                            {withCount(optionLabel(key, option.value), option.count)}
                          </option>
                        ))}
                      </>
                    )}
                  </FacetSelect>
                ))}

                {section.onlyLate && (
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
                )}
              </div>
            </section>
          )
        })}
      </div>
    </>
  )
}

/**
 * THE COUNT GOES INSIDE THE OPTION, and that is the whole reason a closed control can replace the
 * open list without losing what the list was good for.
 *
 * The operator reads the panel to decide `vale a pena filtrar por Cabo Frio?`, and that answer has
 * to exist BEFORE the choice. Beside the field it would describe the value already chosen; on the
 * result line it answers `quanto sobrou`, which is the after. Inside the option it is also read
 * aloud as part of the accessible name — `Cabo Frio, 41` — with no `aria-*` at all.
 *
 * Identity first and count as a suffix, because truncation eats the end (DS-COMPONENTE-065).
 * It is the literal precedent of `/pois`, which already labels a country `${name} (${total})`.
 */
function withCount(label: string, count: number): string {
  return `${label} (${count})`
}

/** How many rows a dimension holds in total — the count the neutral option carries. */
function totalOf(options: { count: number }[]): number {
  return options.reduce((sum, option) => sum + option.count, 0)
}

/**
 * ONE DIMENSION, AS A NATIVE `<select>`.
 *
 * Native, and not a custom listbox: it brings keyboard navigation, type-ahead by first letters,
 * the platform's own scrolling and — on a phone — the operating system's picker, none of which a
 * hand-rolled control gets right for free. That is also why the `mais N` and the per-facet search
 * box of the earlier design are gone: they were mechanisms for problems the control already
 * solves.
 *
 * `text-base` and not `text-sm` below the phone breakpoint, for the same reason the search field
 * carries it: Safari on iOS zooms the whole page when a focused control measures under 16px.
 */
function FacetSelect({
  id,
  label,
  value,
  onChange,
  children,
}: {
  id: string
  label: string
  value: string
  onChange: (next: string) => void
  children: React.ReactNode
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1 block px-1 text-xs font-medium text-gray-600 dark:text-gray-400"
      >
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-xl border border-gray-200 bg-gray-50/50 px-3 py-2.5 text-base outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-primary-800 dark:border-gray-700 dark:bg-gray-800/50 dark:text-white sm:text-sm"
      >
        {children}
      </select>
    </div>
  )
}

