'use client'

import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CalendarDays, Plus, Search, Loader2 } from 'lucide-react'
import { useEvents, useEventFacets } from '@/lib/hooks/use-events'
import { useCmsUser } from '@/lib/hooks/useCmsUser'
import type { EventFilters } from '@/lib/core/event-service'
import { EventFormModal } from '@/components/event-management/EventFormModal'

const PAGE_SIZE = 50

export default function EventosPage() {
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

  const openCreate = () => { setEditingId(null); setModalOpen(true) }
  const openEdit = (id: string) => { setEditingId(id); setModalOpen(true) }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-tuggi-blue/10">
            <CalendarDays className="w-6 h-6 text-tuggi-blue" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Events</h1>
            <p className="text-sm text-gray-500">{total} event{total === 1 ? '' : 's'}</p>
          </div>
        </div>
        {canEdit && (
          <button onClick={openCreate} className="px-4 py-2 rounded-lg bg-tuggi-blue text-white font-medium flex items-center gap-2">
            <Plus className="w-4 h-4" /> New Event
          </button>
        )}
      </div>

      {/* Facets */}
      {facets && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {[
            { label: 'Total', value: facets.total },
            { label: 'Upcoming', value: facets.upcoming },
            { label: 'Approved', value: facets.approved },
            { label: 'Pending', value: facets.pending },
          ].map((s) => (
            <div key={s.label} className="p-4 rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800">
              <div className="text-2xl font-bold text-gray-900 dark:text-white">{s.value}</div>
              <div className="text-xs text-gray-500">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            placeholder="Search events..."
            className="w-full pl-9 pr-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900"
          />
        </div>
        <select value={status} onChange={(e) => { setStatus(e.target.value as any); setPage(1) }} className="px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900">
          <option value="all">All status</option>
          <option value="approved">Approved</option>
          <option value="pending">Pending</option>
        </select>
        <select value={time} onChange={(e) => { setTime(e.target.value as any); setPage(1) }} className="px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900">
          <option value="all">All dates</option>
          <option value="upcoming">Upcoming</option>
          <option value="past">Past</option>
        </select>
        {isFetching && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800 text-left text-gray-500">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">When</th>
              <th className="px-4 py-3 font-medium">Location</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Content</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {isLoading ? (
              <tr><td colSpan={5} className="px-4 py-12 text-center text-gray-400"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-12 text-center text-gray-400">No events found.</td></tr>
            ) : (
              items.map((ev) => (
                <tr key={ev.id} onClick={() => openEdit(ev.id)} className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50">
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{ev.name}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                    {ev.starts_at ? new Date(ev.starts_at).toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                    {[ev.city, ev.state, ev.country].filter(Boolean).join(', ')}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${ev.approved ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                      {ev.approved ? 'approved' : 'pending'}
                    </span>
                    <span className="ml-2 text-xs text-gray-400">{ev.status}</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {ev.description_count} desc · {ev.trigger_point_count} TP
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 mt-4">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="px-3 py-1 rounded border border-gray-300 dark:border-gray-700 disabled:opacity-40">Prev</button>
          <span className="text-sm text-gray-500">Page {page} / {totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="px-3 py-1 rounded border border-gray-300 dark:border-gray-700 disabled:opacity-40">Next</button>
        </div>
      )}

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
