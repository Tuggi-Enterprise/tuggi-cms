'use client'

import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  CalendarDays, Plus, Search, Filter, RotateCcw, Loader2,
  CalendarClock, CheckCircle2, Clock, ChevronLeft, ChevronRight,
} from 'lucide-react'
import { useEvents, useEventFacets } from '@/lib/hooks/use-events'
import { useCmsUser } from '@/lib/hooks/useCmsUser'
import type { EventFilters } from '@/lib/core/event-service'
import { EventFormModal } from '@/components/event-management/EventFormModal'
import { StatCard, StatCardRow } from '@/components/ui/StatCard'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 50

export default function EventosPage() {
  const t = useTranslations('EventManagement')
  const queryClient = useQueryClient()
  const { canEdit } = useCmsUser()

  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'all' | 'approved' | 'pending'>('all')
  const [time, setTime] = useState<'all' | 'upcoming' | 'past'>('all')
  const [page, setPage] = useState(1)

  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const filters: EventFilters = useMemo(
    () => ({ search: search || undefined, status, time, page, pageSize: PAGE_SIZE }),
    [search, status, time, page]
  )
  const facetFilters: EventFilters = useMemo(() => ({ search: search || undefined }), [search])

  const { data, isLoading, isFetching } = useEvents(filters)
  const { data: facets } = useEventFacets(facetFilters)

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const hasActiveFilters = !!search || status !== 'all' || time !== 'all'

  const openCreate = () => { setEditingId(null); setModalOpen(true) }
  const openEdit = (id: string) => { setEditingId(id); setModalOpen(true) }
  const clearFilters = () => { setSearch(''); setStatus('all'); setTime('all'); setPage(1) }

  const sidebarSelect = 'w-full px-3 py-2.5 bg-gray-50/50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-tuggi-blue transition-all dark:text-white'
  const pagerBtn = 'p-3 rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-300 enabled:hover:bg-tuggi-blue enabled:hover:text-white enabled:hover:border-tuggi-blue disabled:opacity-40 transition-all'

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 p-6 lg:p-8">
      <div className="flex gap-8">
        {/* Filters sidebar (18%) */}
        <aside className="w-[18%] flex-shrink-0">
          <div className="bg-white/70 dark:bg-gray-900/70 backdrop-blur-xl rounded-3xl border border-gray-200 dark:border-gray-800 shadow-2xl shadow-black/5 sticky top-24">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-tuggi-blue/10 rounded-xl"><Filter className="h-5 w-5 text-tuggi-blue" /></div>
                  <h2 className="text-xl font-semibold text-gray-900 dark:text-white tracking-tight">{t('filters.title')}</h2>
                </div>
                {hasActiveFilters && (
                  <button onClick={clearFilters} className="p-2 text-gray-400 hover:text-tuggi-blue hover:bg-tuggi-blue/5 rounded-lg transition-all">
                    <RotateCcw className="h-4 w-4" />
                  </button>
                )}
              </div>

              <div className="relative group mb-6">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Search className="h-4 w-4 text-gray-400 group-focus-within:text-tuggi-blue transition-colors" />
                </div>
                <input
                  type="text"
                  placeholder={t('search_placeholder')}
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1) }}
                  className="w-full pl-10 pr-4 py-3 bg-gray-50/50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:ring-2 focus:ring-tuggi-blue focus:border-transparent transition-all outline-none dark:text-white"
                />
              </div>

              <div className="mb-5">
                <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3 px-1">{t('columns.status')}</h3>
                <select value={status} onChange={(e) => { setStatus(e.target.value as any); setPage(1) }} className={sidebarSelect}>
                  <option value="all">{t('filters.status_all')}</option>
                  <option value="approved">{t('filters.status_approved')}</option>
                  <option value="pending">{t('filters.status_pending')}</option>
                </select>
              </div>

              <div>
                <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3 px-1">{t('columns.when')}</h3>
                <select value={time} onChange={(e) => { setTime(e.target.value as any); setPage(1) }} className={sidebarSelect}>
                  <option value="all">{t('filters.time_all')}</option>
                  <option value="upcoming">{t('filters.time_upcoming')}</option>
                  <option value="past">{t('filters.time_past')}</option>
                </select>
              </div>
            </div>
          </div>
        </aside>

        {/* Content (82%) */}
        <div className="w-[82%] min-w-0">
          <StatCardRow columns={4} className="mb-6">
            <StatCard label={t('stats.total')} value={facets?.total ?? 0} icon={CalendarDays} color="#00A8E8" isLoading={!facets} />
            <StatCard label={t('stats.upcoming')} value={facets?.upcoming ?? 0} icon={CalendarClock} color="#8B5CF6" isLoading={!facets} />
            <StatCard label={t('stats.approved')} value={facets?.approved ?? 0} icon={CheckCircle2} color="#10B981" isLoading={!facets} />
            <StatCard label={t('stats.pending')} value={facets?.pending ?? 0} icon={Clock} color="#FF6F00" isLoading={!facets} />
          </StatCardRow>

          {/* Action bar */}
          <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl rounded-3xl border border-gray-200 dark:border-gray-800 shadow-2xl shadow-black/5 mb-6">
            <div className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-4 pl-2">
                <div className="p-2.5 bg-tuggi-blue/10 rounded-2xl"><CalendarDays className="h-5 w-5 text-tuggi-blue" /></div>
                <div className="flex flex-col">
                  <span className="text-lg font-extrabold text-gray-900 dark:text-white leading-none">{t('title')}</span>
                  <span className="text-xs text-gray-400 mt-1">{t('count', { count: total })}</span>
                </div>
                {isFetching && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
              </div>
              {canEdit && (
                <button
                  onClick={openCreate}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-2xl font-semibold text-xs bg-tuggi-blue text-white hover:bg-tuggi-blue/90 shadow-lg shadow-tuggi-blue/20 transition-all duration-300"
                >
                  <Plus className="h-3.5 w-3.5" /> {t('new_event')}
                </button>
              )}
            </div>
          </div>

          {/* List */}
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
            <div className="space-y-3">
              {items.map((ev) => (
                <button
                  key={ev.id}
                  onClick={() => openEdit(ev.id)}
                  className="w-full text-left group relative overflow-hidden bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl border border-gray-200/60 dark:border-gray-800/60 rounded-[1.5rem] hover:shadow-2xl hover:shadow-tuggi-blue/5 hover:-translate-y-0.5 hover:border-tuggi-blue/30 transition-all duration-300 p-5"
                >
                  <div className={cn('absolute top-0 left-0 w-1 h-full', ev.approved ? 'bg-gradient-to-b from-green-400 to-emerald-500' : 'bg-gradient-to-b from-orange-400 to-amber-500')} />
                  <div className="flex items-center justify-between gap-4 pl-2">
                    <div className="min-w-0">
                      <h3 className="font-bold text-gray-900 dark:text-white truncate">{ev.name}</h3>
                      <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                        <span className="flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" />{ev.starts_at ? new Date(ev.starts_at).toLocaleString() : '—'}</span>
                        <span className="text-gray-300 dark:text-gray-700">•</span>
                        <span className="truncate">{[ev.city, ev.state, ev.country].filter(Boolean).join(', ')}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <span className="hidden sm:inline text-[11px] text-gray-400">{t('content_summary', { desc: ev.description_count, tp: ev.trigger_point_count })}</span>
                      <span className={cn('px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase tracking-widest border',
                        ev.approved ? 'bg-green-500/10 text-green-500 border-green-500/20' : 'bg-orange-500/10 text-orange-500 border-orange-500/20')}>
                        {ev.approved ? t('badges.approved') : t('badges.pending')}
                      </span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 mt-6">
              <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className={pagerBtn}><ChevronLeft className="h-4 w-4" /></button>
              <span className="text-sm font-medium text-gray-500 min-w-[80px] text-center">{page} / {totalPages}</span>
              <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className={pagerBtn}><ChevronRight className="h-4 w-4" /></button>
            </div>
          )}
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
