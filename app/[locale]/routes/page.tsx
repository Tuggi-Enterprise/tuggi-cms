'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import {
  Plus, Search, Route as RouteIcon, Edit, Trash2,
  Map as MapIcon, Activity, Clock, CheckCircle, XCircle,
  History, RefreshCw, X, RotateCcw, Mountain, Building2,
  Trees, Wheat, Car, Accessibility, Globe,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { RouteEditorModal } from '@/components/routes/RouteEditorModal'
import { useCmsUser } from '@/lib/hooks/useCmsUser'
import { useRouter as useLocalizedRouter } from '@/navigation'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Route {
  id: string
  name: string
  description?: string
  client_id: string
  is_active: boolean
  created_at: string
  metadata?: { distance?: number; duration?: number }
  scenic_profile?: string[]
  drivability?: string
  accessibility?: string
  country?: string
  region?: string
}

// ─── Filter types ─────────────────────────────────────────────────────────────

interface Filters {
  search:        string
  status:        string   // '' | 'active' | 'inactive'
  country:       string
  drivability:   string   // '' | 'easy' | 'moderate' | 'demanding'
  accessibility: string   // '' | 'accessible' | 'partial' | 'not_accessible'
  scenic:        string[] // multi-select
}

const DEFAULT_FILTERS: Filters = {
  search: '', status: '', country: '', drivability: '', accessibility: '', scenic: [],
}

const SCENIC_OPTIONS = [
  { id: 'panoramic', label: 'Panorâmica', icon: Mountain },
  { id: 'historical', label: 'Histórica',  icon: Building2 },
  { id: 'nature',     label: 'Natureza',   icon: Trees },
  { id: 'urban',      label: 'Urbana',     icon: Building2 },
  { id: 'rural',      label: 'Rural',      icon: Wheat },
]

// ─── Page ────────────────────────────────────────────────────────────────────

export default function RoutesPage() {
  const t           = useTranslations('CustomRoutes')
  const searchParams = useSearchParams()
  const router      = useRouter()
  const pathname    = usePathname()
  const localizedRouter = useLocalizedRouter()
  const { isCoordinator, isLoading: cmsUserLoading } = useCmsUser()

  // Coordenador não acessa gestão de pontos (POIs/Rotas) → "Minha rede".
  useEffect(() => {
    if (!cmsUserLoading && isCoordinator) localizedRouter.replace('/clients/coordinator')
  }, [cmsUserLoading, isCoordinator, localizedRouter])

  // ── Routes state ────────────────────────────────────────────────────────
  const [routes,    setRoutes]    = useState<Route[]>([])
  const [total,     setTotal]     = useState(0)
  const [page,      setPage]      = useState(1)
  const [isLoading, setIsLoading] = useState(true)
  const PAGE_SIZE = 50

  // ── Filters state ────────────────────────────────────────────────────────
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Modal state ──────────────────────────────────────────────────────────
  const [modalOpen,  setModalOpen]  = useState(false)
  const [editRouteId, setEditRouteId] = useState<string | undefined>(undefined)

  // ── Audit log state ──────────────────────────────────────────────────────
  const [auditOpen,       setAuditOpen]       = useState(false)
  const [auditRoute,      setAuditRoute]      = useState<Route | null>(null)
  const [auditLogs,       setAuditLogs]       = useState<any[]>([])
  const [auditLoading,    setAuditLoading]    = useState(false)

  // ── Known countries (for filter select) ──────────────────────────────────
  const [countries, setCountries] = useState<string[]>([])

  // ── Read URL params on mount ──────────────────────────────────────────────
  useEffect(() => {
    const editId = searchParams.get('editId')
    const mode   = searchParams.get('mode')
    if (editId) { setEditRouteId(editId); setModalOpen(true) }
    else if (mode === 'new') { setEditRouteId(undefined); setModalOpen(true) }
  }, [searchParams])

  // ── Fetch routes ──────────────────────────────────────────────────────────
  const fetchRoutes = useCallback(async (f: Filters = filters, p: number = page) => {
    setIsLoading(true)
    try {
      const params = new URLSearchParams()
      if (f.search)        params.set('search',        f.search)
      if (f.status)        params.set('status',        f.status)
      if (f.country)       params.set('country',       f.country)
      if (f.drivability)   params.set('drivability',   f.drivability)
      if (f.accessibility) params.set('accessibility', f.accessibility)
      if (f.scenic.length) params.set('scenic',        f.scenic.join(','))
      params.set('page',     String(p))
      params.set('pageSize', String(PAGE_SIZE))

      const res = await fetch(`/api/routes?${params}`)
      if (res.ok) {
        const data = await res.json()
        setRoutes(data.routes || [])
        setTotal(data.total || 0)
        // Collect unique countries for filter
        const found = [...new Set((data.routes || []).map((r: Route) => r.country).filter(Boolean))] as string[]
        setCountries(prev => [...new Set([...prev, ...found])])
      }
    } catch (err) {
      console.error('Error fetching routes:', err)
    } finally {
      setIsLoading(false)
    }
  }, [filters, page])

  useEffect(() => { fetchRoutes() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Filter helpers ────────────────────────────────────────────────────────
  const applyFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    const next = { ...filters, [key]: value }
    setFilters(next)
    setPage(1)
    if (key === 'search') {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
      searchTimerRef.current = setTimeout(() => fetchRoutes(next, 1), 300)
    } else {
      fetchRoutes(next, 1)
    }
  }

  const toggleScenic = (id: string) => {
    const next = { ...filters, scenic: filters.scenic.includes(id) ? filters.scenic.filter(x => x !== id) : [...filters.scenic, id] }
    setFilters(next)
    setPage(1)
    fetchRoutes(next, 1)
  }

  const clearFilters = () => {
    setFilters(DEFAULT_FILTERS)
    setPage(1)
    fetchRoutes(DEFAULT_FILTERS, 1)
  }

  const hasActiveFilters = filters.search || filters.status || filters.country || filters.drivability || filters.accessibility || filters.scenic.length > 0

  // ── Modal helpers ─────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditRouteId(undefined)
    setModalOpen(true)
    router.replace(`${pathname}?mode=new`)
  }

  const openEdit = (id: string) => {
    setEditRouteId(id)
    setModalOpen(true)
    router.replace(`${pathname}?editId=${id}`)
  }

  const closeModal = () => {
    setModalOpen(false)
    setEditRouteId(undefined)
    router.replace(pathname)
  }

  const handleSaved = (savedId: string) => {
    closeModal()
    fetchRoutes()
  }

  const handleDeleted = (deletedId: string) => {
    closeModal()
    fetchRoutes()
  }

  // ── Toggle status ─────────────────────────────────────────────────────────
  const toggleStatus = async (id: string, current: boolean) => {
    await fetch(`/api/routes/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !current }),
    })
    setRoutes(prev => prev.map(r => r.id === id ? { ...r, is_active: !current } : r))
  }

  // ── Audit log ─────────────────────────────────────────────────────────────
  const openAudit = async (route: Route) => {
    setAuditRoute(route)
    setAuditOpen(true)
    setAuditLoading(true)
    try {
      const res = await fetch(`/api/routes/${route.id}/audit`)
      if (res.ok) { const d = await res.json(); setAuditLogs(d.logs || []) }
    } finally { setAuditLoading(false) }
  }

  // ── Format helpers ─────────────────────────────────────────────────────────
  const fmtDist = (m?: number) => {
    if (!m) return '--'
    return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${m.toFixed(0)} m`
  }
  const fmtDur = (s?: number) => {
    if (!s) return '--'
    const m = Math.round(s / 60)
    return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden bg-white dark:bg-gray-900">

      {/* ── Left sidebar: Filters ──────────────────────────────────────────── */}
      <aside className="w-72 shrink-0 bg-white dark:bg-gray-900 border-r border-gray-100 dark:border-gray-800 p-6 flex flex-col gap-5 overflow-y-auto">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-tuggi-blue/10 rounded-lg">
              <RouteIcon className="h-4 w-4 text-tuggi-blue" />
            </div>
            <span className="font-bold text-gray-900 dark:text-white text-sm">Filtros</span>
          </div>
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="flex items-center gap-1 text-[10px] text-red-500 hover:text-red-600 font-semibold transition-all"
            >
              <RotateCcw className="h-3 w-3" /> Limpar
            </button>
          )}
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            value={filters.search}
            onChange={e => applyFilter('search', e.target.value)}
            placeholder="Buscar por nome..."
            className="w-full pl-9 pr-4 py-2.5 bg-gray-50 dark:bg-gray-800 border-none rounded-xl text-sm focus:ring-2 focus:ring-tuggi-blue transition-all"
          />
          {filters.search && (
            <button onClick={() => applyFilter('search', '')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Status */}
        <div className="space-y-2">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Status</p>
          <div className="grid grid-cols-3 gap-1.5">
            {[{ v: '', l: 'Todas' }, { v: 'active', l: 'Ativas' }, { v: 'inactive', l: 'Inativas' }].map(({ v, l }) => (
              <button key={v} onClick={() => applyFilter('status', v)}
                className={cn('py-1.5 px-2 rounded-lg text-xs font-semibold transition-all',
                  filters.status === v ? 'bg-tuggi-blue text-white' : 'bg-gray-50 dark:bg-gray-800 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700'
                )}>{l}</button>
            ))}
          </div>
        </div>

        {/* Country */}
        {countries.length > 0 && (
          <div className="space-y-2">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex items-center gap-1">
              <Globe className="h-3 w-3" /> País
            </p>
            <select
              value={filters.country}
              onChange={e => applyFilter('country', e.target.value)}
              className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border-none rounded-xl text-xs focus:ring-2 focus:ring-tuggi-blue transition-all"
            >
              <option value="">Todos</option>
              {countries.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        )}

        {/* Scenic Profile */}
        <div className="space-y-2">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Perfil Cênico</p>
          <div className="space-y-1.5">
            {SCENIC_OPTIONS.map(({ id, label, icon: Icon }) => (
              <label key={id} className="flex items-center gap-2.5 cursor-pointer group">
                <div className={cn(
                  'w-4 h-4 rounded border-2 flex items-center justify-center transition-all shrink-0',
                  filters.scenic.includes(id) ? 'bg-tuggi-blue border-tuggi-blue' : 'border-gray-300 dark:border-gray-600 group-hover:border-tuggi-blue/50'
                )} onClick={() => toggleScenic(id)}>
                  {filters.scenic.includes(id) && (
                    <CheckCircle className="h-2.5 w-2.5 text-white" />
                  )}
                </div>
                <span className="text-xs text-gray-600 dark:text-gray-400 group-hover:text-gray-900 dark:group-hover:text-white transition-colors">
                  {label}
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* Drivability */}
        <div className="space-y-2">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex items-center gap-1">
            <Car className="h-3 w-3" /> Dificuldade
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {[{ v: '', l: 'Todas' }, { v: 'easy', l: 'Fácil' }, { v: 'moderate', l: 'Moderada' }, { v: 'demanding', l: 'Exigente' }].map(({ v, l }) => (
              <button key={v} onClick={() => applyFilter('drivability', v)}
                className={cn('py-1.5 px-2 rounded-lg text-[10px] font-semibold transition-all',
                  filters.drivability === v ? 'bg-tuggi-blue text-white' : 'bg-gray-50 dark:bg-gray-800 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700'
                )}>{l}</button>
            ))}
          </div>
        </div>

        {/* Accessibility */}
        <div className="space-y-2">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex items-center gap-1">
            <Accessibility className="h-3 w-3" /> Acessibilidade
          </p>
          <div className="space-y-1.5">
            {[{ v: '', l: 'Todas' }, { v: 'accessible', l: 'Acessível' }, { v: 'partial', l: 'Parcial' }, { v: 'not_accessible', l: 'Não acessível' }].map(({ v, l }) => (
              <button key={v} onClick={() => applyFilter('accessibility', v)}
                className={cn('w-full text-left py-1.5 px-3 rounded-lg text-xs transition-all',
                  filters.accessibility === v ? 'bg-tuggi-blue/10 text-tuggi-blue font-semibold' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
                )}>{l}</button>
            ))}
          </div>
        </div>

        {/* Stats box */}
        <div className="mt-auto p-3 bg-gray-50 dark:bg-gray-800 rounded-2xl">
          <p className="text-[10px] text-gray-400 font-medium">
            {isLoading ? 'Carregando...' : (
              <>
                <span className="text-base font-bold text-gray-900 dark:text-white block leading-tight">{total}</span>
                rota{total !== 1 ? 's' : ''} encontrada{total !== 1 ? 's' : ''}
              </>
            )}
          </p>
        </div>
      </aside>

      {/* ── Right content area ─────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Stats bar */}
        <div className="h-16 flex items-center justify-between px-8 border-b border-gray-100 dark:border-gray-800 shrink-0">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <RouteIcon className="h-5 w-5 text-tuggi-blue" />
              {t('title')}
            </h1>
            {!isLoading && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 bg-tuggi-blue/10 rounded-full">
                <div className="w-1.5 h-1.5 bg-tuggi-blue rounded-full animate-pulse" />
                <span className="text-xs font-bold text-tuggi-blue">{total}</span>
              </div>
            )}
          </div>
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-2 px-4 py-2 bg-tuggi-blue text-white font-semibold rounded-xl hover:bg-tuggi-blue/90 transition-all shadow-lg shadow-tuggi-blue/20 hover:scale-[1.02] active:scale-[0.98] text-sm"
          >
            <Plus className="h-4 w-4" />
            {t('create_new')}
          </button>
        </div>

        {/* Routes table */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {isLoading ? (
            <div className="py-24 flex flex-col items-center justify-center gap-4">
              <div className="w-12 h-12 border-4 border-tuggi-blue/20 border-t-tuggi-blue rounded-full animate-spin" />
              <p className="text-gray-500 font-medium animate-pulse">Carregando rotas...</p>
            </div>
          ) : routes.length === 0 ? (
            <div className="py-24 flex flex-col items-center justify-center text-center px-4">
              <div className="p-4 bg-gray-50 dark:bg-gray-900 rounded-full mb-4">
                <MapIcon className="h-12 w-12 text-gray-300 dark:text-gray-600" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Nenhuma rota encontrada</h3>
              <p className="text-gray-500 dark:text-gray-400 max-w-sm mb-4">
                {hasActiveFilters ? 'Os filtros aplicados não retornaram resultados.' : 'Você ainda não criou nenhuma rota customizada.'}
              </p>
              {hasActiveFilters && (
                <button onClick={clearFilters} className="text-tuggi-blue font-semibold hover:underline text-sm">
                  Limpar filtros
                </button>
              )}
            </div>
          ) : (
            <>
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/50">
                    <th className="px-6 py-3.5 text-xs font-bold text-gray-400 uppercase tracking-wider">Nome</th>
                    <th className="px-6 py-3.5 text-xs font-bold text-gray-400 uppercase tracking-wider">Distância</th>
                    <th className="px-6 py-3.5 text-xs font-bold text-gray-400 uppercase tracking-wider">Duração</th>
                    <th className="px-6 py-3.5 text-xs font-bold text-gray-400 uppercase tracking-wider">País / Região</th>
                    <th className="px-6 py-3.5 text-xs font-bold text-gray-400 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3.5 text-xs font-bold text-gray-400 uppercase tracking-wider text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
                  {routes.map(route => (
                    <tr
                      key={route.id}
                      className="group hover:bg-gray-50/50 dark:hover:bg-gray-700/30 transition-all cursor-pointer"
                      onClick={() => openEdit(route.id)}
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 bg-tuggi-blue/5 rounded-xl flex items-center justify-center group-hover:bg-tuggi-blue/10 transition-colors shrink-0">
                            <MapIcon className="h-4 w-4 text-tuggi-blue" />
                          </div>
                          <div className="min-w-0">
                            <p className="font-bold text-gray-900 dark:text-white leading-tight truncate max-w-[480px]">
                              {route.name}
                            </p>
                            {route.description && (
                              <p className="text-xs text-gray-500 line-clamp-1 mt-0.5">{route.description}</p>
                            )}
                            {route.scenic_profile && route.scenic_profile.length > 0 && (
                              <div className="flex gap-1 mt-1">
                                {route.scenic_profile.slice(0, 3).map(p => (
                                  <span key={p} className="px-1.5 py-0.5 bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400 rounded text-[9px] font-semibold uppercase tracking-wide">
                                    {p}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                          <Activity className="h-3.5 w-3.5 text-gray-400" />
                          {fmtDist(route.metadata?.distance)}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                          <Clock className="h-3.5 w-3.5 text-gray-400" />
                          {fmtDur(route.metadata?.duration)}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        {(route.country || route.region) ? (
                          <div className="text-sm text-gray-600 dark:text-gray-300">
                            <span className="font-medium">{route.country}</span>
                            {route.region && <span className="text-gray-400 text-xs"> · {route.region}</span>}
                          </div>
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <button
                          onClick={e => { e.stopPropagation(); toggleStatus(route.id, route.is_active) }}
                          className={cn(
                            'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold transition-all',
                            route.is_active
                              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 hover:bg-green-200'
                              : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400 hover:bg-gray-200'
                          )}
                        >
                          {route.is_active ? <CheckCircle className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                          {route.is_active ? 'Ativa' : 'Inativa'}
                        </button>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={e => { e.stopPropagation(); openAudit(route) }}
                            className="p-2 text-gray-400 hover:text-tuggi-blue hover:bg-tuggi-blue/10 rounded-lg transition-all"
                            title="Histórico"
                          >
                            <History className="h-4 w-4" />
                          </button>
                          <button
                            onClick={e => { e.stopPropagation(); openEdit(route.id) }}
                            className="p-2 text-gray-400 hover:text-tuggi-blue hover:bg-tuggi-blue/10 rounded-lg transition-all"
                            title="Editar"
                          >
                            <Edit className="h-4 w-4" />
                          </button>
                          <button
                            className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                            title="Desativar"
                            onClick={e => {
                              e.stopPropagation()
                              if (confirm('Desativar esta rota?')) toggleStatus(route.id, true)
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-3 py-6 border-t border-gray-100 dark:border-gray-800">
                  <button
                    onClick={() => { const p = page - 1; setPage(p); fetchRoutes(filters, p) }}
                    disabled={page === 1}
                    className="px-4 py-2 bg-gray-50 dark:bg-gray-800 rounded-xl text-sm font-semibold text-gray-600 disabled:opacity-30 hover:bg-gray-100 transition-all"
                  >
                    ← Anterior
                  </button>
                  <span className="text-sm text-gray-500">
                    Página <strong>{page}</strong> de <strong>{totalPages}</strong>
                  </span>
                  <button
                    onClick={() => { const p = page + 1; setPage(p); fetchRoutes(filters, p) }}
                    disabled={page === totalPages}
                    className="px-4 py-2 bg-gray-50 dark:bg-gray-800 rounded-xl text-sm font-semibold text-gray-600 disabled:opacity-30 hover:bg-gray-100 transition-all"
                  >
                    Próxima →
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Route Editor Modal ─────────────────────────────────────────────── */}
      <RouteEditorModal
        routeId={editRouteId}
        isOpen={modalOpen}
        onClose={closeModal}
        onSaved={handleSaved}
        onDeleted={handleDeleted}
      />

      {/* ── Audit Log Modal ────────────────────────────────────────────────── */}
      {auditOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setAuditOpen(false)}>
          <div className="bg-white dark:bg-gray-900 w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                  <History className="h-5 w-5 text-tuggi-blue" /> Histórico de Alterações
                </h2>
                <p className="text-sm text-gray-500">{auditRoute?.name}</p>
              </div>
              <button onClick={() => setAuditOpen(false)} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-all">
                <X className="h-5 w-5 text-gray-400" />
              </button>
            </div>
            <div className="p-6 max-h-[60vh] overflow-y-auto">
              {auditLoading ? (
                <div className="py-10 flex justify-center"><RefreshCw className="h-8 w-8 text-tuggi-blue animate-spin" /></div>
              ) : auditLogs.length === 0 ? (
                <div className="py-10 text-center text-gray-500">Nenhum log de alteração encontrado.</div>
              ) : (
                <div className="space-y-6">
                  {auditLogs.map(log => (
                    <div key={log.id} className="relative pl-8 border-l-2 border-gray-100 dark:border-gray-800 last:border-transparent">
                      <div className="absolute left-[-9px] top-0 w-4 h-4 rounded-full bg-white dark:bg-gray-900 border-2 border-tuggi-blue" />
                      <div className="mb-1 flex items-center gap-2">
                        <span className={cn('px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider',
                          log.action === 'CREATE' ? 'bg-green-100 text-green-700' : log.action === 'UPDATE' ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700'
                        )}>{log.action}</span>
                        <span className="text-xs text-gray-400">{new Date(log.created_at).toLocaleString()}</span>
                      </div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">
                        Alterado por <strong>{log.performer?.full_name || log.performer?.email || 'Sistema'}</strong>
                      </p>
                      {log.changes && Object.keys(log.changes).length > 0 && (
                        <div className="mt-2 p-3 bg-gray-50 dark:bg-gray-800 rounded-xl text-[10px] font-mono whitespace-pre-wrap">
                          {JSON.stringify(log.changes, null, 2)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="p-6 bg-gray-50 dark:bg-gray-800 text-right">
              <button onClick={() => setAuditOpen(false)} className="px-6 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl font-bold text-sm hover:bg-gray-50 transition-all">
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
