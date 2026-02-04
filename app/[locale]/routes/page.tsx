'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { 
  Plus, 
  Search, 
  Filter, 
  Route as RouteIcon, 
  Edit, 
  Trash2, 
  Map as MapIcon,
  ChevronRight,
  ChevronLeft,
  MoreVertical,
  Activity,
  Clock,
  Navigation,
  History,
  CheckCircle,
  XCircle,
  AlertCircle,
  RefreshCw
} from 'lucide-react'
import { Link, useRouter } from '@/navigation'
import { cn } from '@/lib/utils'

interface Route {
  id: string
  name: string
  description?: string
  client_id: string
  is_active: boolean
  created_at: string
  metadata?: {
    distance?: number
    duration?: number
  }
}

export default function RoutesPage() {
  const t = useTranslations('CustomRoutes')
  const router = useRouter()
  const [routes, setRoutes] = useState<Route[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [activeOnly, setActiveOnly] = useState(true)
  
  // Audit UI State
  const [isAuditModalOpen, setIsAuditModalOpen] = useState(false)
  const [selectedRouteForAudit, setSelectedRouteForAudit] = useState<Route | null>(null)
  const [auditLogs, setAuditLogs] = useState<any[]>([])
  const [isAuditLoading, setIsAuditLoading] = useState(false)

  const fetchRoutes = useCallback(async () => {
    try {
      setIsLoading(true)
      // Note: In a real app, we'd need the client_id. 
      // For now, let's fetch all or handle client selection.
      // Assuming the API handles the auth-based filtering.
      const response = await fetch('/api/routes')
      if (response.ok) {
        const data = await response.json()
        setRoutes(data.routes || [])
      }
    } catch (error) {
      console.error('Error fetching routes:', error)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchRoutes()
  }, [fetchRoutes])

  const filteredRoutes = routes.filter(route => {
    const matchesSearch = route.name.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesActive = activeOnly ? route.is_active : true
    return matchesSearch && matchesActive
  })

  const formatDistance = (meters?: number) => {
    if (!meters) return '--'
    if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`
    return `${meters.toFixed(0)} m`
  }

  const formatDuration = (seconds?: number) => {
    if (!seconds) return '--'
    const mins = Math.round(seconds / 60)
    if (mins >= 60) {
      const hours = Math.floor(mins / 60)
      const remainingMins = mins % 60
      return `${hours}h ${remainingMins}m`
    }
    return `${mins} min`
  }

  const toggleStatus = async (id: string, currentStatus: boolean) => {
    try {
      const response = await fetch(`/api/routes/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !currentStatus })
      })
      
      if (response.ok) {
        setRoutes(prev => prev.map(r => r.id === id ? { ...r, is_active: !currentStatus } : r))
      }
    } catch (error) {
      console.error('Error toggling route status:', error)
    }
  }

  const fetchAuditLogs = async (route: Route) => {
    try {
      setIsAuditLoading(true)
      setSelectedRouteForAudit(route)
      setIsAuditModalOpen(true)
      
      const response = await fetch(`/api/routes/${route.id}/audit`)
      if (response.ok) {
        const data = await response.json()
        setAuditLogs(data.logs || [])
      }
    } catch (error) {
      console.error('Error fetching audit logs:', error)
    } finally {
      setIsAuditLoading(false)
    }
  }

  return (
    <div className="p-8 max-w-7xl mx-auto">
      {/* Header Area */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
            <div className="p-2 bg-tuggi-blue/10 rounded-xl">
              <RouteIcon className="h-8 w-8 text-tuggi-blue" />
            </div>
            {t('title')}
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            {t('subtitle')}
          </p>
        </div>
        <Link
          href="/routes/new"
          className="inline-flex items-center justify-center px-5 py-2.5 bg-tuggi-blue text-white font-semibold rounded-xl hover:bg-tuggi-blue/90 transition-all shadow-lg shadow-tuggi-blue/20 hover:scale-[1.02] active:scale-[0.98]"
        >
          <Plus className="h-5 w-5 mr-2" />
          {t('create_new')}
        </Link>
      </div>

      {/* Filters and Controls */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-4 mb-6 flex flex-wrap items-center gap-4">
        <div className="relative flex-1 min-w-[300px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
          <input
            type="text"
            placeholder={t('filters.search_placeholder')}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-gray-50 dark:bg-gray-900 border-none rounded-xl focus:ring-2 focus:ring-tuggi-blue transition-all"
          />
        </div>
        
        <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 dark:bg-gray-900 rounded-xl border border-transparent hover:border-gray-200 dark:hover:border-gray-700 transition-all cursor-pointer select-none"
             onClick={() => setActiveOnly(!activeOnly)}>
          <div className={cn(
            "w-10 h-5 rounded-full relative transition-all duration-300",
            activeOnly ? "bg-tuggi-blue" : "bg-gray-300 dark:bg-gray-600"
          )}>
            <div className={cn(
              "absolute top-1 left-1 w-3 h-3 bg-white rounded-full transition-all duration-300",
              activeOnly ? "translate-x-5" : "translate-x-0"
            )} />
          </div>
          <span className="text-sm font-medium text-gray-600 dark:text-gray-300">
            {t('filters.active_only')}
          </span>
        </div>
      </div>

      {/* Routes List/Table */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
        {isLoading ? (
          <div className="py-20 flex flex-col items-center justify-center gap-4">
            <div className="w-12 h-12 border-4 border-tuggi-blue/20 border-t-tuggi-blue rounded-full animate-spin" />
            <p className="text-gray-500 font-medium animate-pulse">Carregando rotas...</p>
          </div>
        ) : filteredRoutes.length === 0 ? (
          <div className="py-20 flex flex-col items-center justify-center text-center px-4">
            <div className="p-4 bg-gray-50 dark:bg-gray-900 rounded-full mb-4">
              <Navigation className="h-12 w-12 text-gray-300 dark:text-gray-600" />
            </div>
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Nenhuma rota encontrada</h3>
            <p className="text-gray-500 dark:text-gray-400 max-w-sm">
              Você ainda não criou nenhuma rota customizada ou os filtros estão ocultando os resultados.
            </p>
            {searchTerm && (
              <button 
                onClick={() => setSearchTerm('')}
                className="mt-4 text-tuggi-blue font-semibold hover:underline"
              >
                Limpar busca
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-700">
                  <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider">{t('table.name')}</th>
                  <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider">{t('table.distance')}</th>
                  <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider">{t('table.duration')}</th>
                  <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider">{t('table.status')}</th>
                  <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider text-right">{t('table.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
                {filteredRoutes.map((route) => (
                  <tr key={route.id} className="group hover:bg-gray-50/50 dark:hover:bg-gray-700/30 transition-all cursor-pointer" 
                      onClick={() => router.push(`/routes/${route.id}`)}>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-tuggi-blue/5 rounded-lg flex items-center justify-center group-hover:bg-tuggi-blue/10 transition-colors">
                          <MapIcon className="h-5 w-5 text-tuggi-blue" />
                        </div>
                        <div>
                          <p className="font-bold text-gray-900 dark:text-white leading-tight">
                            {route.name}
                          </p>
                          {route.description && (
                            <p className="text-xs text-gray-500 line-clamp-1 mt-1">
                              {route.description}
                            </p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                        <Activity className="h-4 w-4 text-gray-400" />
                        {formatDistance(route.metadata?.distance)}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                        <Clock className="h-4 w-4 text-gray-400" />
                        {formatDuration(route.metadata?.duration)}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <button 
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleStatus(route.id, route.is_active)
                        }}
                        className={cn(
                          "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold transition-all",
                          route.is_active 
                            ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 hover:bg-green-200"
                            : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400 hover:bg-gray-200"
                        )}
                      >
                        {route.is_active ? <CheckCircle className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                        {route.is_active ? 'Ativa' : 'Inativa'}
                      </button>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button 
                          onClick={(e) => {
                            e.stopPropagation()
                            fetchAuditLogs(route)
                          }}
                          className="p-2 text-gray-400 hover:text-tuggi-blue hover:bg-tuggi-blue/10 rounded-lg transition-all"
                          title="Histórico de alterações"
                        >
                          <History className="h-4 w-4" />
                        </button>
                        <Link 
                          href={`/routes/${route.id}`}
                          className="p-2 text-gray-400 hover:text-tuggi-blue hover:bg-tuggi-blue/10 rounded-lg transition-all"
                          onClick={(e) => e.stopPropagation()}
                          title="Editar rota"
                        >
                          <Edit className="h-4 w-4" />
                        </Link>
                        <button 
                          className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                          onClick={(e) => {
                            e.stopPropagation()
                            if (confirm('Deseja realmente excluir esta rota? Ela ficará inativa.')) {
                                toggleStatus(route.id, true) // Deactivate
                            }
                          }}
                          title="Excluir rota"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {/* Audit Log Modal */}
      {isAuditModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
             onClick={() => setIsAuditModalOpen(false)}>
          <div className="bg-white dark:bg-gray-900 w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
               onClick={(e) => e.stopPropagation()}>
            <div className="p-6 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                  <History className="h-5 w-5 text-tuggi-blue" />
                  Histórico de Alterações
                </h2>
                <p className="text-sm text-gray-500">{selectedRouteForAudit?.name}</p>
              </div>
              <button 
                onClick={() => setIsAuditModalOpen(false)}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-all"
              >
                <XCircle className="h-6 w-6 text-gray-400" />
              </button>
            </div>
            
            <div className="p-6 max-h-[60vh] overflow-y-auto">
              {isAuditLoading ? (
                <div className="py-10 flex justify-center">
                  <RefreshCw className="h-8 w-8 text-tuggi-blue animate-spin" />
                </div>
              ) : auditLogs.length === 0 ? (
                <div className="py-10 text-center text-gray-500">
                  Nenhum log de alteração encontrado.
                </div>
              ) : (
                <div className="space-y-6">
                  {auditLogs.map((log, index) => (
                    <div key={log.id} className="relative pl-8 border-l-2 border-gray-100 dark:border-gray-800 last:border-transparent">
                      <div className="absolute left-[-9px] top-0 w-4 h-4 rounded-full bg-white dark:bg-gray-900 border-2 border-tuggi-blue" />
                      <div className="mb-1 flex items-center gap-2">
                        <span className={cn(
                          "px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider",
                          log.action === 'CREATE' ? "bg-green-100 text-green-700" :
                          log.action === 'UPDATE' ? "bg-blue-100 text-blue-700" : "bg-red-100 text-red-700"
                        )}>
                          {log.action}
                        </span>
                        <span className="text-xs text-gray-400">
                          {new Date(log.created_at).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">
                        Alterado por <span className="font-bold underline">{log.performer?.full_name || log.performer?.email || 'Sistema'}</span>
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
              <button 
                onClick={() => setIsAuditModalOpen(false)}
                className="px-6 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl font-bold text-sm hover:bg-gray-50 transition-all"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
