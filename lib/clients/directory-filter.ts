/**
 * What the operator sees in the unified list, and what the filter rail offers — one pure
 * decision over one set of rows.
 *
 * THE COUNTS AND THE TABLE READ THE SAME LIST, and that is the whole reason this is a module
 * rather than three `useMemo`s. The queue already paid for the alternative: `{n} com a triagem
 * vencida` counted `rows` while the table rendered `filtered`, so clicking the counter opened
 * `Nenhuma parceria com esse filtro`. Here every facet count is produced by applying the SAME
 * predicate the table applies, minus its own dimension — which is what makes a count clickable
 * without lying.
 *
 * WHY THE OPTIONS ARE DERIVED AND NOT DECLARED. `país`, `estado` and `cidade` are free text in
 * `partner.clients`, and on 2026-08-17 only 3 of 11 rows carried a country at all. A dropdown of
 * 200 countries over 3 usable values is a filter that costs more to read than the list it
 * filters, so the options come from the rows themselves, each with the count it would produce.
 * A dimension with nothing to choose from does not render.
 *
 * WHY IT EXCLUDES ITS OWN DIMENSION. Counting `Brasil` while `país = Portugal` is applied would
 * answer zero for every country including the one on screen, and the rail would look broken.
 * Each dimension is counted against the OTHER filters only — the standard behaviour of a facet
 * rail, and the one that lets an operator widen a search without clearing it first.
 *
 * Nothing here fetches, and nothing here is React: it is proven by
 * `tests/api/client-directory-filter.test.ts` without a database or a browser.
 */

import { isTriageOverdue, deriveTriageStatus } from '@/lib/partnerships/triage'
import {
  IN_PROGRESS_STATES,
  PIPELINE_STATES,
  type PipelineState,
} from '@/lib/partnerships/pipeline'
import { planFacetValue } from '@/lib/clients/partner-plan'
import type { ClientDirectoryRow } from '@/lib/services/partnership-service'

/**
 * The dimensions the rail offers. `state` here is the PIPELINE state; the approval of the
 * relationship is `status`, and the two answer different questions — a partnership can be
 * `place_in_curation` while the client is still `pending`.
 */
export interface DirectoryFilters {
  search: string
  country: string | null
  region: string | null
  city: string | null
  clientType: string | null
  /** `pending` | `approved` | `rejected` */
  status: string | null
  /** `none` | `draft` | `sent` | `signed` | `superseded` | `terminated` */
  contract: string | null
  /**
   * `paid` | `courtesy` | `undeclared` — what the REGISTRATION says about money, which is the
   * reading that decides whether publishing may be offered (BR-B2B-017, item 6). Not the tier of
   * the contract and not what the partner asked for on the form: `lib/clients/partner-plan`
   * keeps the three apart, and this is the one an operator filters a work queue by.
   */
  plan: string | null
  /** A single pipeline state, `in_progress` for the working set, or `all`. */
  state: PipelineState | 'in_progress' | 'all'
  onlyLate: boolean
}

export const EMPTY_FILTERS: DirectoryFilters = {
  search: '',
  country: null,
  region: null,
  city: null,
  clientType: null,
  status: null,
  contract: null,
  plan: null,
  state: 'all',
  onlyLate: false,
}

/** Which dimensions the facet counts leave out, one at a time. */
export type FacetKey =
  | 'country'
  | 'region'
  | 'city'
  | 'clientType'
  | 'status'
  | 'contract'
  | 'plan'
  | 'state'

export interface FacetOption {
  value: string
  count: number
}

export type Facets = Record<FacetKey, FacetOption[]>

export interface DirectoryView {
  rows: ClientDirectoryRow[]
  facets: Facets
  /** How many rows the filters removed — what `Limpar filtros` would bring back. */
  hiddenCount: number
  filtering: boolean
}

/**
 * `Parado há` sorts the list, and an overdue triage outranks it: a broken 72-hour promise
 * (BR-B2B-010, item 4) is owed to somebody outside the company, and idleness is not.
 */
function compareRows(a: ClientDirectoryRow, b: ClientDirectoryRow): number {
  const lateA = isLate(a)
  const lateB = isLate(b)
  if (lateA !== lateB) return lateA ? -1 : 1
  return (a.since ?? '').localeCompare(b.since ?? '')
}

function isLate(row: ClientDirectoryRow): boolean {
  return isTriageOverdue(deriveTriageStatus(row.triage))
}

/** The searchable text of a row — name, CNPJ and place, the three an operator types. */
function haystack(row: ClientDirectoryRow): string {
  return [row.name, row.taxId, row.city, row.region, row.country]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

/**
 * One dimension's verdict. Split per dimension so the facet counts can drop exactly one and
 * keep the rest — the alternative is a second predicate that drifts from this one.
 */
const MATCHERS: Record<FacetKey | 'search' | 'onlyLate', (row: ClientDirectoryRow, filters: DirectoryFilters) => boolean> = {
  search: (row, filters) => {
    const needle = filters.search.trim().toLowerCase()
    return needle === '' || haystack(row).indexOf(needle) >= 0
  },
  country: (row, filters) => filters.country === null || row.country === filters.country,
  region: (row, filters) => filters.region === null || row.region === filters.region,
  city: (row, filters) => filters.city === null || row.city === filters.city,
  clientType: (row, filters) => filters.clientType === null || row.clientType === filters.clientType,
  status: (row, filters) => filters.status === null || row.status === filters.status,
  contract: (row, filters) => filters.contract === null || row.contract === filters.contract,
  plan: (row, filters) => filters.plan === null || planFacetValue(row) === filters.plan,
  state: (row, filters) => {
    if (filters.state === 'all') return true
    if (filters.state === 'in_progress') return IN_PROGRESS_STATES.indexOf(row.state) >= 0
    return row.state === filters.state
  },
  onlyLate: (row, filters) => !filters.onlyLate || isLate(row),
}

const ALL_KEYS = Object.keys(MATCHERS) as (keyof typeof MATCHERS)[]

function matches(row: ClientDirectoryRow, filters: DirectoryFilters, except?: FacetKey): boolean {
  for (const key of ALL_KEYS) {
    if (key === except) continue
    if (!MATCHERS[key](row, filters)) return false
  }
  return true
}

/** What a row answers for one dimension. `null` means it has nothing to say and is not counted. */
function valueOf(row: ClientDirectoryRow, key: FacetKey): string | null {
  if (key === 'country') return row.country
  if (key === 'region') return row.region
  if (key === 'city') return row.city
  if (key === 'clientType') return row.clientType
  if (key === 'status') return row.status
  if (key === 'contract') return row.contract
  // A proposal nobody priced has no answer to give, and `planFacetValue` returns `null` for it —
  // counted as nothing, exactly like a row with no country.
  if (key === 'plan') return planFacetValue(row)
  return row.state
}

const FACET_KEYS: FacetKey[] = [
  'country',
  'region',
  'city',
  'clientType',
  'status',
  'contract',
  'plan',
  'state',
]

export function buildDirectoryView(
  rows: ClientDirectoryRow[],
  filters: DirectoryFilters
): DirectoryView {
  const visible = rows.filter((row) => matches(row, filters)).sort(compareRows)

  const facets = {} as Facets
  for (const key of FACET_KEYS) {
    const counts = new Map<string, number>()
    for (const row of rows) {
      if (!matches(row, filters, key)) continue
      const value = valueOf(row, key)
      if (value === null || value === '') continue
      counts.set(value, (counts.get(value) ?? 0) + 1)
    }
    facets[key] = Array.from(counts.entries())
      .map(([value, count]) => ({ value, count }))
      // Most rows first, then alphabetically — a rail an operator scans top-down.
      .sort((a, b) => (b.count - a.count) || a.value.localeCompare(b.value))
  }

  return {
    rows: visible,
    facets,
    hiddenCount: rows.length - visible.length,
    filtering: isFiltering(filters),
  }
}

/**
 * THE FILTERS LIVE IN THE URL, and that is what let the second list die.
 *
 * `/admin/partnerships` was a whole screen whose only distinct behaviour was opening on the
 * working set — the states that are still work, with `Publicado`, `Descartado` and
 * `Recusado na triagem` out of the way (criterion 4, DS-COPY-020, point 5). That is a filter,
 * not a screen, and once a filter can be named in a link the menu entry `Parcerias` becomes
 * `/admin/clients?state=in_progress` and the queue has nothing left of its own.
 *
 * It also buys what neither list had: an operator can send `Minas, sem contrato` to somebody
 * else, or keep it as a bookmark, instead of describing the six clicks that produce it.
 *
 * DEFAULTS ARE NOT WRITTEN. A list with nothing applied has a clean URL, so `?state=all` never
 * appears and `Limpar filtros` really does empty the address bar. The default is `all` and not
 * `in_progress`, because this is the CLIENT list too: somebody opening it to fix the fiscal
 * data of a partner already on air must find them, and `in_progress` hides exactly that row.
 */
const PARAM_KEYS = {
  search: 'q',
  country: 'country',
  region: 'region',
  city: 'city',
  clientType: 'type',
  status: 'status',
  contract: 'contract',
  plan: 'plan',
  state: 'state',
  onlyLate: 'late',
} as const

export function parseFilters(params: URLSearchParams): DirectoryFilters {
  const text = (key: string) => {
    const value = params.get(key)
    return value === null || value.trim() === '' ? null : value
  }

  const rawState = params.get(PARAM_KEYS.state)
  const state: DirectoryFilters['state'] =
    rawState === 'in_progress' || rawState === 'all'
      ? rawState
      : PIPELINE_STATES.indexOf(rawState as PipelineState) >= 0
        ? (rawState as PipelineState)
        : // A `?state=` nobody implemented falls back to the whole list rather than to an empty
          // table that looks like a broken screen.
          'all'

  return {
    search: params.get(PARAM_KEYS.search) ?? '',
    country: text(PARAM_KEYS.country),
    region: text(PARAM_KEYS.region),
    city: text(PARAM_KEYS.city),
    clientType: text(PARAM_KEYS.clientType),
    status: text(PARAM_KEYS.status),
    contract: text(PARAM_KEYS.contract),
    plan: text(PARAM_KEYS.plan),
    state,
    onlyLate: params.get(PARAM_KEYS.onlyLate) === '1',
  }
}

/**
 * The filters as a query string, merged onto whatever else the URL carries — the client record
 * opens over this list through `?clientId=`, and narrowing the rail must not close it.
 */
export function applyFilters(params: URLSearchParams, filters: DirectoryFilters): URLSearchParams {
  const next = new URLSearchParams(params)
  const set = (key: string, value: string | null) => {
    if (value === null || value === '') next.delete(key)
    else next.set(key, value)
  }

  set(PARAM_KEYS.search, filters.search.trim())
  set(PARAM_KEYS.country, filters.country)
  set(PARAM_KEYS.region, filters.region)
  set(PARAM_KEYS.city, filters.city)
  set(PARAM_KEYS.clientType, filters.clientType)
  set(PARAM_KEYS.status, filters.status)
  set(PARAM_KEYS.contract, filters.contract)
  set(PARAM_KEYS.plan, filters.plan)
  set(PARAM_KEYS.state, filters.state === 'all' ? null : filters.state)
  set(PARAM_KEYS.onlyLate, filters.onlyLate ? '1' : null)

  return next
}

/** How many rows the working set holds — the count the `Em andamento` option carries. */
export function inProgressCount(rows: ClientDirectoryRow[]): number {
  return rows.filter((row) => IN_PROGRESS_STATES.indexOf(row.state) >= 0).length
}

export function isFiltering(filters: DirectoryFilters): boolean {
  return (
    filters.search.trim() !== '' ||
    filters.country !== null ||
    filters.region !== null ||
    filters.city !== null ||
    filters.clientType !== null ||
    filters.status !== null ||
    filters.contract !== null ||
    filters.plan !== null ||
    filters.state !== 'all' ||
    filters.onlyLate
  )
}

/**
 * How many rows have a broken triage promise, counted over the WHOLE set.
 *
 * Over the whole set on purpose: it is the count the operator clicks to REACH those rows, so
 * counting it inside the current filter would make it disappear the moment somebody narrowed
 * the list — which is the defect DS-COPY-020, point 5, names.
 */
export function overdueCount(rows: ClientDirectoryRow[]): number {
  return rows.filter(isLate).length
}
