'use client'

import { useEffect, useState, useMemo } from 'react'
import { Search, ChevronLeft, ChevronRight, Plus, Eye, Edit2, Trash2, AlertCircle, Users, CheckCircle, Clock, Grid, List, RotateCcw, Filter, User, MapPin, Target, FileText, Music } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Client } from '@/types/clients'
import { cn } from '@/lib/utils'

interface ClientsListAdminProps {
  onCreateNew?: () => void
}

export function ClientsListAdmin({ onCreateNew }: ClientsListAdminProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [clients, setClients] = useState<(Client & { users_count: number })[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [viewMode, setViewMode] = useState<'list' | 'cards'>('cards')
  const [status, setStatus] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all')
  const [selectedClients, setSelectedClients] = useState<string[]>([])
  const [page, setPage] = useState(1)
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 10,
    total: 0,
    pages: 1
  })
  const [error, setError] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const fetchClients = async (searchPage = 1) => {
    try {
      setLoading(true)
      setError(null)
      const params = new URLSearchParams({
        page: searchPage.toString(),
        limit: '50' // Same as POI management
      })
      if (search) params.append('search', search)
      if (status !== 'all') params.append('status', status)
      const response = await fetch(`/api/admin/clients?${params}`)
      if (!response.ok) {
        const data = await response.json()
        setError(data.error || 'Failed to fetch clients')
        return
      }
      const data = await response.json()
      setClients(data.clients || [])
      setPagination(data.pagination)
      setPage(searchPage)
    } catch (err) {
      setError('An error occurred while fetching clients')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchClients(1)
  }, [search, status])

  const handleDelete = async (clientId: string) => {
    if (!deleteConfirm) {
      setDeleteConfirm(clientId)
      return
    }
    try {
      setDeleting(true)
      const response = await fetch(`/api/admin/clients/${clientId}`, { method: 'DELETE' })
      if (!response.ok) {
        const data = await response.json()
        setError(data.error || 'Failed to delete client')
        return
      }
      setClients(prev => prev.filter(c => c.id !== clientId))
      setDeleteConfirm(null)
    } catch (err) {
      setError('An error occurred while deleting the client')
      console.error(err)
    } finally {
      setDeleting(false)
    }
  }

  const handleClientClick = (clientId: string) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('clientId', clientId)
    router.push(`/admin/clients?${params.toString()}`, { scroll: false })
  }

  const handleClientSelection = (clientId: string, isSelected: boolean) => {
    if (isSelected) {
      setSelectedClients(prev => [...prev, clientId])
    } else {
      setSelectedClients(prev => prev.filter(id => id !== clientId))
    }
  }

  const handleSelectAll = () => setSelectedClients(clients.map(c => c.id))
  const handleDeselectAll = () => setSelectedClients([])
  const clearFilters = () => { setSearch(''); setStatus('all'); }

  return (
    <div className="flex gap-8 flex-1 animate-in fade-in duration-500">
      {/* Sidebar - Matching /pois exactly */}
      <div className="w-[18%] flex-shrink-0">
        <div className="bg-white/70 dark:bg-gray-900/70 backdrop-blur-xl rounded-3xl border border-gray-200 dark:border-gray-800 shadow-2xl shadow-black/5 sticky top-24">
          <div className="p-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-tuggi-blue/10 rounded-xl">
                  <Filter className="h-5 w-5 text-tuggi-blue" />
                </div>
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white tracking-tight">
                  Filters
                </h2>
              </div>
              {(search || status !== 'all') && (
                <button
                  onClick={clearFilters}
                  className="p-2 text-gray-400 hover:text-tuggi-blue hover:bg-tuggi-blue/5 rounded-lg transition-all"
                  title="Clear All"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* Search Bar */}
            <div className="mb-6">
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Search className="h-4 w-4 text-gray-400 group-focus-within:text-tuggi-blue transition-colors" />
                </div>
                <input
                  type="text"
                  placeholder="Search Clients..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 bg-gray-50/50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:ring-2 focus:ring-tuggi-blue focus:border-transparent transition-all outline-none"
                />
              </div>
            </div>

            {/* Filters List */}
            <div className="space-y-5">
              <div>
                <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3 px-1">Status</h3>
                <div className="space-y-2">
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as any)}
                    className="w-full px-3 py-2.5 bg-gray-50/50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-tuggi-blue transition-all"
                  >
                    <option value="all">All Clients</option>
                    <option value="pending">Pending Approval</option>
                    <option value="approved">Approved</option>
                    <option value="rejected">Rejected</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Column */}
      <div className="w-[82%]">
        {/* Stats Summary Bar */}
        <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl rounded-3xl border border-gray-200 dark:border-gray-800 shadow-2xl shadow-black/5 mb-8 sticky top-0 z-30">
          <div className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-8 pl-2">
              <div className="flex flex-col">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest leading-none mb-1">Total Clients</span>
                <div className="flex items-center gap-2">
                  <span className="text-2xl font-bold text-gray-900 dark:text-white leading-none">{pagination.total}</span>
                  <div className="w-1.5 h-1.5 rounded-full bg-tuggi-blue animate-pulse" />
                </div>
              </div>

              <div className="h-8 w-px bg-gray-200 dark:bg-gray-800" />

              {/* View Modes In Header */}
              <div className="flex items-center gap-1 p-1 bg-gray-50/50 dark:bg-gray-950/50 rounded-2xl border border-gray-100 dark:border-gray-800">
                <button
                  onClick={() => setViewMode('cards')}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all duration-300",
                    viewMode === 'cards' 
                      ? "bg-white dark:bg-gray-800 text-tuggi-blue shadow-md shadow-black/5" 
                      : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                  )}
                >
                  <Grid className="h-3.5 w-3.5" />
                  Cards
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all duration-300",
                    viewMode === 'list' 
                      ? "bg-white dark:bg-gray-800 text-tuggi-blue shadow-md shadow-black/5" 
                      : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                  )}
                >
                  <List className="h-3.5 w-3.5" />
                  List
                </button>
              </div>

              <div className="h-8 w-px bg-gray-200 dark:bg-gray-800" />

              <div className="flex items-center gap-4">
                <button
                  onClick={onCreateNew}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-2xl font-semibold text-xs bg-tuggi-blue text-white hover:bg-tuggi-blue/90 shadow-lg shadow-tuggi-blue/20 transition-all duration-300"
                >
                  <Plus className="h-3.5 w-3.5" />
                  New Client
                </button>
              </div>
            </div>

            <div className="flex items-center gap-3 pr-2">
              <button
                onClick={handleSelectAll}
                className="px-4 py-2 bg-tuggi-blue/10 text-tuggi-blue font-bold text-xs rounded-xl hover:bg-tuggi-blue/20 transition-all"
              >
                Select All
              </button>
              <button
                onClick={handleDeselectAll}
                className="px-4 py-2 bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 font-bold text-xs rounded-xl hover:bg-gray-200 dark:hover:bg-gray-700 transition-all"
              >
                Deselect All
              </button>
            </div>
          </div>
        </div>

        {/* Clients Grid */}
        {loading ? (
          <div className="h-96 flex flex-col items-center justify-center bg-white/50 dark:bg-gray-900/50 backdrop-blur-sm rounded-3xl border border-gray-200 dark:border-gray-800">
             <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-tuggi-blue" />
          </div>
        ) : (
          <div className={cn(
            "transition-all duration-500",
            viewMode === 'cards' 
              ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6" 
              : "space-y-3"
          )}>
            {clients.map((client) => (
              <div
                key={client.id}
                onClick={() => handleClientClick(client.id)}
                className={cn(
                  "group transition-all duration-300 cursor-pointer overflow-hidden relative",
                  viewMode === 'cards' 
                    ? "bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl border border-gray-200/60 dark:border-gray-800/60 rounded-[1.5rem] hover:shadow-2xl hover:shadow-tuggi-blue/5 hover:-translate-y-1 hover:border-tuggi-blue/30 p-5" 
                    : "bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl p-4 border border-gray-200/60 dark:border-gray-800/60 rounded-2xl hover:border-tuggi-blue/30 hover:shadow-xl hover:shadow-black/5"
                )}
              >
                <div className={cn(
                  "absolute top-0 left-0 w-full h-1 opacity-80",
                  client.status === 'approved' ? "bg-gradient-to-r from-green-400 to-emerald-500" : "bg-gradient-to-r from-orange-400 to-amber-500"
                )} />

                <div className={cn(
                  "flex",
                  viewMode === 'cards' ? "flex-col h-full" : "items-center gap-6"
                )}>
                  {/* Card Header (Category/Checkbox) */}
                  {viewMode === 'cards' && (
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-tuggi-blue uppercase tracking-widest px-2.5 py-1 bg-tuggi-blue/5 rounded-full border border-tuggi-blue/10">
                          Client
                        </span>
                      </div>
                      <div 
                        className="relative cursor-pointer group/checkbox"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleClientSelection(client.id, !selectedClients.includes(client.id));
                        }}
                      >
                        <div className={cn(
                          "h-5 w-5 rounded-lg border-2 transition-all duration-300 flex items-center justify-center",
                          selectedClients.includes(client.id)
                            ? "bg-tuggi-blue border-tuggi-blue scale-105 shadow-lg shadow-tuggi-blue/20"
                            : "border-gray-200 dark:border-gray-700 group-hover/checkbox:border-tuggi-blue/50 bg-white dark:bg-gray-900"
                        )}>
                          {selectedClients.includes(client.id) && (
                            <div className="w-2 h-2 rounded-[2px] bg-white animate-in zoom-in-50 duration-200" />
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <div className={cn(
                      "mb-3",
                      viewMode === 'list' && "grid grid-cols-1 md:grid-cols-4 gap-4 items-center"
                    )}>
                      <div className={cn(viewMode === 'list' && "col-span-2")}>
                        <div className="h-[3rem] flex items-center mb-1">
                          <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 line-clamp-2 group-hover:text-tuggi-blue transition-colors leading-tight w-full">
                            {client.name}
                          </h3>
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 font-medium">
                          <MapPin className="h-3.5 w-3.5 text-tuggi-blue/60 flex-shrink-0" />
                          <span className="truncate">{client.email}</span>
                        </div>
                      </div>

                      {viewMode === 'list' && (
                        <div className="hidden md:flex items-center gap-4 text-[11px] text-gray-400">
                          <div className="flex items-center gap-1.5 px-2 py-0.5 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-800">
                            <Users className="h-3 w-3 text-tuggi-blue/60" />
                            <span className="font-medium text-gray-700 dark:text-gray-300">{client.users_count || 0}</span>
                          </div>
                        </div>
                      )}
                    </div>

                    {viewMode === 'cards' && (
                      <div className="flex items-center gap-4 text-[11px] text-gray-400/80 mt-auto pt-4 border-t border-gray-100 dark:border-gray-800">
                        <div className="flex items-center gap-1.5 px-2 py-0.5 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-800 transition-colors group-hover:bg-tuggi-blue/5">
                          <Users className="h-3 w-3 text-tuggi-blue/60" />
                          <span className="font-semibold text-gray-700 dark:text-gray-300">{client.users_count || 0} Users</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
