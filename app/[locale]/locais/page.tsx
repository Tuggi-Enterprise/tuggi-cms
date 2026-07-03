'use client'

import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Store, Plus, Search, Loader2 } from 'lucide-react'
import { usePlaces, usePlaceFacets } from '@/lib/hooks/use-places'
import { useCmsUser } from '@/lib/hooks/useCmsUser'
import type { PlaceFilters } from '@/lib/core/place-service'
import { PlaceFormModal } from '@/components/place-management/PlaceFormModal'

const PAGE_SIZE = 50

export default function LocaisPage() {
  const queryClient = useQueryClient()
  const { canEdit } = useCmsUser()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'all' | 'approved' | 'pending'>('all')
  const [page, setPage] = useState(1)

  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const filters: PlaceFilters = useMemo(
    () => ({ search: search || undefined, status, page, pageSize: PAGE_SIZE }),
    [search, status, page]
  )
  const facetFilters: PlaceFilters = useMemo(() => ({ search: search || undefined }), [search])

  const { data, isLoading, isFetching } = usePlaces(filters)
  const { data: facets } = usePlaceFacets(facetFilters)

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const openCreate = () => { setEditingId(null); setModalOpen(true) }
  const openEdit = (id: string) => { setEditingId(id); setModalOpen(true) }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-tuggi-blue/10">
            <Store className="w-6 h-6 text-tuggi-blue" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Places</h1>
            <p className="text-sm text-gray-500">{total} place{total === 1 ? '' : 's'}</p>
          </div>
        </div>
        {canEdit && (
          <button onClick={openCreate} className="px-4 py-2 rounded-lg bg-tuggi-blue text-white font-medium flex items-center gap-2">
            <Plus className="w-4 h-4" /> New Place
          </button>
        )}
      </div>

      {facets && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {[
            { label: 'Total', value: facets.total },
            { label: 'With hours', value: facets.withHours },
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

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            placeholder="Search places..."
            className="w-full pl-9 pr-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900"
          />
        </div>
        <select value={status} onChange={(e) => { setStatus(e.target.value as any); setPage(1) }} className="px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900">
          <option value="all">All status</option>
          <option value="approved">Approved</option>
          <option value="pending">Pending</option>
        </select>
        {isFetching && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
      </div>

      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800 text-left text-gray-500">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Location</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Content</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {isLoading ? (
              <tr><td colSpan={5} className="px-4 py-12 text-center text-gray-400"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-12 text-center text-gray-400">No places found.</td></tr>
            ) : (
              items.map((pl) => (
                <tr key={pl.id} onClick={() => openEdit(pl.id)} className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50">
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{pl.name}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                    {pl.place_type || '—'}
                    {pl.price_range ? <span className="ml-2 text-gray-400">{'$'.repeat(pl.price_range)}</span> : null}
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                    {[pl.city, pl.state, pl.country].filter(Boolean).join(', ')}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${pl.approved ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                      {pl.approved ? 'approved' : 'pending'}
                    </span>
                    {pl.has_hours && <span className="ml-2 text-xs text-gray-400">hours</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {pl.description_count} desc · {pl.trigger_point_count} TP
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 mt-4">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="px-3 py-1 rounded border border-gray-300 dark:border-gray-700 disabled:opacity-40">Prev</button>
          <span className="text-sm text-gray-500">Page {page} / {totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="px-3 py-1 rounded border border-gray-300 dark:border-gray-700 disabled:opacity-40">Next</button>
        </div>
      )}

      <PlaceFormModal
        placeId={editingId}
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={() => {
          queryClient.invalidateQueries({ queryKey: ['places'] })
          queryClient.invalidateQueries({ queryKey: ['places-facets'] })
        }}
      />
    </div>
  )
}
