'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  CalendarDays, Plus, Search, Filter, RotateCcw, Loader2,
  CalendarClock, Grid, List, Map as MapIcon, ChevronLeft, ChevronRight, Database,
} from 'lucide-react'
import { useEvents, useEventFacets, useEventFilterOptions } from '@/lib/hooks/use-events'
import { useCmsUser } from '@/lib/hooks/useCmsUser'
import type { EventFilterOption, EventFilters, EventListItem } from '@/lib/core/event-service'
import {
  EMPTY_EVENT_FILTERS, hasActiveEventFilters, readEventFilters, toEventFilters, writeEventFilters,
  type EventPageFilters,
} from '@/lib/core/event-filter-params'
import { EventFormModal } from '@/components/event-management/EventFormModal'
import { cn } from '@/lib/utils'

// Map mode is opt-in, so the Google Maps view (POIMapVisualization underneath) stays out of the
// initial JS of the cards mode this screen opens in.
const EntityMapView = dynamic(
  () => import('@/components/entity-management/EntityMapView').then(m => m.EntityMapView),
  {
    ssr: false,
    loading: () => (
      <div className="h-[70vh] w-full flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-tuggi-blue" />
      </div>
    )
  }
)

const PAGE_SIZE = 50
const MAP_PAGE_SIZE = 2000
const SEARCH_DEBOUNCE_MS = 300

/** The options, plus the values the URL selects that the options lack (a shared link, a source with no event left). */
function withCurrent(options: EventFilterOption[] | undefined, current: string, many: string[] = []): EventFilterOption[] {
  const list = options ?? []
  const missing = [current, ...many].filter((v) => v && !list.some((o) => o.value === v))
  return [...list, ...missing.map((value) => ({ value, label: null, count: 0 }))]
}

function EventosPageContent() {
  const t = useTranslations('EventManagement')
  const tc = useTranslations('Common')
  const queryClient = useQueryClient()
  const { canEdit } = useCmsUser()
  const router = useRouter()
  const searchParams = useSearchParams()

  // The URL is the filter state (#1078): read here, written by setFilters.
  const f = useMemo(() => readEventFilters(searchParams), [searchParams])
  const setFilters = useCallback((patch: Partial<EventPageFilters>) => {
    const current = readEventFilters(new URLSearchParams(window.location.search))
    // Any filter change goes back to the first page; turning the page or the view keeps the rest.
    const next = { ...current, page: 1, ...patch }
    const query = writeEventFilters(next).toString()
    router.replace(query ? `?${query}` : window.location.pathname, { scroll: false })
  }, [router])
  const { page, view: viewMode } = f

  // The search box types locally and reaches the URL after a pause.
  // A URL change from outside the box (back button, clear) refills it, during render.
  const [searchInput, setSearchInput] = useState(f.search)
  const [urlSearch, setUrlSearch] = useState(f.search)
  if (urlSearch !== f.search) {
    setUrlSearch(f.search)
    setSearchInput(f.search)
  }
  useEffect(() => {
    if (searchInput === f.search) return
    const timer = setTimeout(() => setFilters({ search: searchInput }), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [searchInput, f.search, setFilters])

  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const baseFilters = useMemo(() => toEventFilters(f), [f])
  const filters: EventFilters = useMemo(() => ({ ...baseFilters, page, pageSize: PAGE_SIZE }), [baseFilters, page])

  const { data, isLoading, isFetching } = useEvents(filters)
  const { data: facets } = useEventFacets(baseFilters)
  const { data: options } = useEventFilterOptions(f.country || null, f.state || null)

  // Map view: every matching event (with coordinates) in one page, same filters, only when active.
  const mapFilters: EventFilters = useMemo(() => ({ ...baseFilters, page: 1, pageSize: MAP_PAGE_SIZE }), [baseFilters])
  const { data: mapData, isLoading: mapLoading } = useEvents(mapFilters, viewMode === 'map')
  const mapItems = mapData?.items ?? []

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const hasActiveFilters = hasActiveEventFilters(f)

  const openCreate = () => { setEditingId(null); setModalOpen(true) }
  const openEdit = (id: string) => { setEditingId(id); setModalOpen(true) }
  const clearFilters = () => { setSearchInput(''); setFilters({ ...EMPTY_EVENT_FILTERS, view: viewMode }) }
  const toggleCategory = (code: string) => setFilters({
    categories: f.categories.indexOf(code) >= 0 ? f.categories.filter((c) => c !== code) : [...f.categories, code],
  })
  const categoryLabel = (code: string | null) => (code && t.has(`categories.${code}`) ? t(`categories.${code}`) : code || t('categories.other'))
  const sourceLabel = (ev: { source_name: string | null }) => ev.source_name || t('source.manual')

  const sidebarSelect = 'w-full px-3 py-2.5 bg-gray-50/50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-tuggi-blue transition-all dark:text-white'
  const sidebarHeading = 'text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3 px-1'
  const viewBtn = (active: boolean) => cn(
    'flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all duration-300',
    active ? 'bg-white dark:bg-gray-800 text-tuggi-blue shadow-md shadow-black/5' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-200'
  )
  const pagerBtn = 'p-3 rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-300 enabled:hover:bg-tuggi-blue enabled:hover:text-white enabled:hover:border-tuggi-blue disabled:opacity-40 transition-all'

  const renderCard = (ev: EventListItem) => {
    const when = ev.starts_at ? new Date(ev.starts_at).toLocaleString() : '—'
    const location = [ev.city, ev.state, ev.country].filter(Boolean).join(', ')
    const statusPill = (
      <span className={cn('px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase tracking-widest border',
        ev.approved ? 'bg-green-500/10 text-green-500 border-green-500/20' : 'bg-orange-500/10 text-orange-500 border-orange-500/20')}>
        {ev.approved ? t('badges.approved') : t('badges.pending')}
      </span>
    )
    return (
      <div
        key={ev.id}
        onClick={() => openEdit(ev.id)}
        className={cn(
          'group transition-all duration-300 cursor-pointer overflow-hidden relative',
          viewMode === 'cards'
            ? 'bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl border border-gray-200/60 dark:border-gray-800/60 rounded-[1.5rem] hover:shadow-2xl hover:shadow-tuggi-blue/5 hover:-translate-y-1 hover:border-tuggi-blue/30 p-5'
            : 'bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl p-4 border border-gray-200/60 dark:border-gray-800/60 rounded-2xl hover:border-tuggi-blue/30 hover:shadow-xl hover:shadow-black/5'
        )}
      >
        <div className={cn('absolute top-0 left-0 h-1 opacity-80', viewMode === 'cards' ? 'w-full' : 'w-1 h-full',
          ev.approved ? 'bg-gradient-to-r from-green-400 to-emerald-500' : 'bg-gradient-to-r from-orange-400 to-amber-500')} />

        {viewMode === 'cards' ? (
          <div className="flex flex-col h-full">
            <div className="flex items-center justify-between mb-4">
              <span className="text-[10px] font-bold text-tuggi-blue uppercase tracking-widest px-2.5 py-1 bg-tuggi-blue/5 rounded-full border border-tuggi-blue/10">
                {categoryLabel(ev.event_category)}
              </span>
              {statusPill}
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-bold text-gray-900 dark:text-white truncate mb-2">{ev.name}</h3>
              <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
                <CalendarClock className="h-3.5 w-3.5 flex-shrink-0" /><span className="truncate">{when}</span>
              </div>
              <p className="text-xs text-gray-400 truncate">{location}</p>
              <p className="flex items-center gap-1.5 text-[11px] text-gray-400 mt-1" title={t('source.label')}>
                <Database className="h-3 w-3 flex-shrink-0" /><span className="truncate">{sourceLabel(ev)}</span>
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-800 text-[11px] text-gray-400">
              {t('content_summary', { desc: ev.description_count, tp: ev.trigger_point_count })}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-6 pl-2">
            <div className="flex-1 min-w-0">
              <h3 className="font-bold text-gray-900 dark:text-white truncate">{ev.name}</h3>
              <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                <span className="flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" />{when}</span>
                <span className="text-gray-300 dark:text-gray-700">•</span>
                <span className="truncate">{location}</span>
                <span className="text-gray-300 dark:text-gray-700">•</span>
                <span className="flex items-center gap-1 truncate" title={t('source.label')}><Database className="h-3 w-3 flex-shrink-0" />{sourceLabel(ev)}</span>
              </div>
            </div>
            <span className="hidden md:inline text-[11px] text-gray-400 flex-shrink-0">{t('content_summary', { desc: ev.description_count, tp: ev.trigger_point_count })}</span>
            <div className="flex-shrink-0">{statusPill}</div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="cms-width min-h-screen bg-gray-50 dark:bg-gray-950 p-6 lg:p-8 flex flex-col">
      <div className="flex gap-8 flex-1 pt-6">
        {/* Left Column - Filters Sidebar */}
        <div className="w-[18%] flex-shrink-0">
          <div className="bg-white/70 dark:bg-gray-900/70 backdrop-blur-xl rounded-3xl border border-gray-200 dark:border-gray-800 shadow-2xl shadow-black/5 sticky top-24">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-tuggi-blue/10 rounded-xl"><Filter className="h-5 w-5 text-tuggi-blue" /></div>
                  <h2 className="text-xl font-semibold text-gray-900 dark:text-white tracking-tight">{t('filters.title')}</h2>
                </div>
                {hasActiveFilters && (
                  <button onClick={clearFilters} title={t('filters.clear')} aria-label={t('filters.clear')} className="p-2 text-gray-400 hover:text-tuggi-blue hover:bg-tuggi-blue/5 rounded-lg transition-all">
                    <RotateCcw className="h-4 w-4" />
                  </button>
                )}
              </div>

              <div className="mb-6">
                <div className="relative group">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Search className="h-4 w-4 text-gray-400 group-focus-within:text-tuggi-blue transition-colors" />
                  </div>
                  <input
                    type="text"
                    placeholder={t('search_placeholder')}
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 bg-gray-50/50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:ring-2 focus:ring-tuggi-blue focus:border-transparent transition-all outline-none dark:text-white"
                  />
                </div>
              </div>

              <div className="space-y-5">
                <div>
                  <h3 className={sidebarHeading}>{t('columns.status')}</h3>
                  <select value={f.status} onChange={(e) => setFilters({ status: e.target.value as EventPageFilters['status'] })} className={sidebarSelect}>
                    <option value="all">{t('filters.status_all')}</option>
                    <option value="approved">{t('filters.status_approved')}</option>
                    <option value="pending">{t('filters.status_pending')}</option>
                  </select>
                </div>
                <div>
                  <h3 className={sidebarHeading}>{t('columns.when')}</h3>
                  <select value={f.time} onChange={(e) => setFilters({ time: e.target.value as EventPageFilters['time'] })} className={sidebarSelect}>
                    <option value="all">{t('filters.time_all')}</option>
                    <option value="upcoming">{t('filters.time_upcoming')}</option>
                    <option value="past">{t('filters.time_past')}</option>
                  </select>
                </div>
                <div>
                  <h3 className={sidebarHeading}>{t('filters.period')}</h3>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-[10px] text-gray-400">
                      {t('filters.period_from')}
                      <input type="date" value={f.from} max={f.to || undefined} onChange={(e) => setFilters({ from: e.target.value })} className={cn(sidebarSelect, 'mt-1 px-2')} />
                    </label>
                    <label className="text-[10px] text-gray-400">
                      {t('filters.period_to')}
                      <input type="date" value={f.to} min={f.from || undefined} onChange={(e) => setFilters({ to: e.target.value })} className={cn(sidebarSelect, 'mt-1 px-2')} />
                    </label>
                  </div>
                </div>
                <div>
                  <h3 className={sidebarHeading}>{t('filters.country')}</h3>
                  <select value={f.country} onChange={(e) => setFilters({ country: e.target.value, state: '', city: '', source: '' })} className={sidebarSelect}>
                    <option value="">{t('filters.country_all')}</option>
                    {withCurrent(options?.country, f.country).map((o) => <option key={o.value} value={o.value}>{o.label || o.value} ({o.count})</option>)}
                  </select>
                </div>
                <div>
                  <h3 className={sidebarHeading}>{t('filters.state')}</h3>
                  <select value={f.state} disabled={!f.country} onChange={(e) => setFilters({ state: e.target.value, city: '', source: '' })} className={cn(sidebarSelect, 'disabled:opacity-50')}>
                    <option value="">{t('filters.state_all')}</option>
                    {f.country && withCurrent(options?.state, f.state).map((o) => <option key={o.value} value={o.value}>{o.label || o.value} ({o.count})</option>)}
                  </select>
                </div>
                <div>
                  <h3 className={sidebarHeading}>{t('filters.city')}</h3>
                  <select value={f.city} onChange={(e) => setFilters({ city: e.target.value })} className={sidebarSelect}>
                    <option value="">{t('filters.city_all')}</option>
                    {withCurrent(options?.city, f.city).map((o) => <option key={o.value} value={o.value}>{o.label || o.value} ({o.count})</option>)}
                  </select>
                </div>
                <div>
                  <h3 className={sidebarHeading}>{t('filters.category')}</h3>
                  <div className="space-y-1.5 px-1">
                    {withCurrent(options?.category, '', f.categories).map((o) => (
                      <label key={o.value} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                        <input type="checkbox" checked={f.categories.indexOf(o.value) >= 0} onChange={() => toggleCategory(o.value)} className="rounded border-gray-300 text-tuggi-blue focus:ring-tuggi-blue" />
                        <span className="flex-1 truncate">{categoryLabel(o.value)}</span>
                        <span className="text-[11px] text-gray-400">{o.count}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <h3 className={sidebarHeading}>{t('filters.source')}</h3>
                  <select value={f.source} onChange={(e) => setFilters({ source: e.target.value })} className={sidebarSelect}>
                    <option value="">{t('filters.source_all')}</option>
                    {withCurrent(options?.source, f.source).map((o) => (
                      <option key={o.value} value={o.value}>{(o.value === 'manual' ? t('source.manual') : o.label || o.value)} ({o.count})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <h3 className={sidebarHeading}>{t('filters.price')}</h3>
                  <select value={f.free} onChange={(e) => setFilters({ free: e.target.value as EventPageFilters['free'] })} className={sidebarSelect}>
                    <option value="all">{t('filters.price_all')}</option>
                    <option value="free">{t('filters.price_free')}</option>
                    <option value="paid">{t('filters.price_paid')}</option>
                  </select>
                </div>
                <div className="space-y-2 px-1">
                  <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                    <input type="checkbox" checked={f.missingImage} onChange={(e) => setFilters({ missingImage: e.target.checked })} className="rounded border-gray-300 text-tuggi-blue focus:ring-tuggi-blue" />
                    {t('filters.missing_image')}
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                    <input type="checkbox" checked={f.missingTriggerPoints} onChange={(e) => setFilters({ missingTriggerPoints: e.target.checked })} className="rounded border-gray-300 text-tuggi-blue focus:ring-tuggi-blue" />
                    {t('filters.missing_trigger_points')}
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column - Content */}
        <div className="w-[82%]">
          {/* Stats Summary Bar */}
          <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl rounded-3xl border border-gray-200 dark:border-gray-800 shadow-2xl shadow-black/5 mb-8 sticky top-0 z-30">
            <div className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-8 pl-2">
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest leading-none mb-1">{t('title')}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-2xl font-bold text-gray-900 dark:text-white leading-none">{total}</span>
                    <div className="w-1.5 h-1.5 rounded-full bg-tuggi-blue animate-pulse" />
                    {isFetching && <Loader2 className="h-4 w-4 animate-spin text-gray-300" />}
                  </div>
                </div>

                {facets && (
                  <div className="hidden lg:flex items-center gap-4 text-[11px] text-gray-500">
                    <span>{t('stats.upcoming')}: <strong className="text-gray-900 dark:text-white">{facets.upcoming}</strong></span>
                    <span>{t('stats.approved')}: <strong className="text-gray-900 dark:text-white">{facets.approved}</strong></span>
                    <span>{t('stats.pending')}: <strong className="text-gray-900 dark:text-white">{facets.pending}</strong></span>
                  </div>
                )}

                <div className="h-8 w-px bg-gray-200 dark:bg-gray-800" />

                <div className="flex items-center gap-1 p-1 bg-gray-50/50 dark:bg-gray-950/50 rounded-2xl border border-gray-100 dark:border-gray-800">
                  <button onClick={() => setFilters({ view: 'cards', page })} className={viewBtn(viewMode === 'cards')}><Grid className="h-3.5 w-3.5" /> Cards</button>
                  <button onClick={() => setFilters({ view: 'list', page })} className={viewBtn(viewMode === 'list')}><List className="h-3.5 w-3.5" /> List</button>
                  <button onClick={() => setFilters({ view: 'map', page })} className={viewBtn(viewMode === 'map')}><MapIcon className="h-3.5 w-3.5" /> Map</button>
                </div>
              </div>

              {canEdit && (
                <div className="pr-2">
                  <button
                    onClick={openCreate}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-2xl font-semibold text-xs bg-tuggi-blue text-white hover:bg-tuggi-blue/90 shadow-lg shadow-tuggi-blue/20 transition-all duration-300"
                  >
                    <Plus className="h-3.5 w-3.5" /> {t('new_event')}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Content Area */}
          <div className="flex-1">
            {viewMode === 'map' ? (
              mapLoading ? (
                <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl rounded-3xl border border-gray-200 dark:border-gray-800 p-16 flex justify-center">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-tuggi-blue" />
                </div>
              ) : mapItems.length === 0 ? (
                <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl rounded-3xl border border-gray-200 dark:border-gray-800 p-16 text-center">
                  <div className="inline-flex p-4 bg-gray-100 dark:bg-gray-800 rounded-2xl mb-4"><CalendarDays className="h-8 w-8 text-gray-400" /></div>
                  <p className="text-gray-500">{t('empty')}</p>
                </div>
              ) : (
                <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl rounded-3xl border border-gray-200 dark:border-gray-800 overflow-hidden">
                  <EntityMapView
                    items={mapItems}
                    onItemClick={openEdit}
                    actionMenuLabels={{ edit: tc('actions.edit'), delete: '', garbage: '', approved: t('badges.approved'), pending: t('badges.pending') }}
                    height="70vh"
                  />
                </div>
              )
            ) : (
              <>
                {isLoading ? (
                  <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl rounded-3xl border border-gray-200 dark:border-gray-800 p-16 flex justify-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-tuggi-blue" />
                  </div>
                ) : items.length === 0 ? (
                  <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl rounded-3xl border border-gray-200 dark:border-gray-800 p-16 text-center">
                    <div className="inline-flex p-4 bg-gray-100 dark:bg-gray-800 rounded-2xl mb-4"><CalendarDays className="h-8 w-8 text-gray-400" /></div>
                    <p className="text-gray-500">{t('empty')}</p>
                  </div>
                ) : (
                  <div className={cn('transition-all duration-500',
                    viewMode === 'cards'
                      ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-6'
                      : 'space-y-3')}>
                    {items.map(renderCard)}
                  </div>
                )}

                {totalPages > 1 && (
                  <div className="flex items-center justify-center gap-3 mt-8">
                    <button disabled={page <= 1} onClick={() => setFilters({ page: page - 1 })} className={pagerBtn}><ChevronLeft className="h-4 w-4" /></button>
                    <span className="text-sm font-medium text-gray-500 min-w-[80px] text-center">{page} / {totalPages}</span>
                    <button disabled={page >= totalPages} onClick={() => setFilters({ page: page + 1 })} className={pagerBtn}><ChevronRight className="h-4 w-4" /></button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <EventFormModal
        eventId={editingId}
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={() => {
          queryClient.invalidateQueries({ queryKey: ['events'] })
          queryClient.invalidateQueries({ queryKey: ['events-facets'] })
        }}
      />
    </div>
  )
}

export default function EventosPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-tuggi-blue" />
      </div>
    }>
      <EventosPageContent />
    </Suspense>
  )
}
