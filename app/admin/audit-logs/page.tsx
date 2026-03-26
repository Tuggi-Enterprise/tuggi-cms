
'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronRight, Filter, RefreshCw, Search, X } from 'lucide-react'
import { useSupabaseClient, useSessionContext } from '@supabase/auth-helpers-react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Container } from '@/components/ui/Container'

interface AuditLog {
  id: string
  user_id: string | null
  user_email: string | null
  action: string
  entity: string | null
  entity_id: string | null
  description: string | null
  ip_address: string | null
  user_agent: string | null
  created_at: string
}

interface AuditResponse {
  success: boolean
  logs: AuditLog[]
  pagination: { page: number; limit: number; total: number; pages: number }
}

const ACTIONS = [
  'LOGIN_SUCCESS',
  'LOGIN_FAILURE',
  'PASSWORD_RESET_REQUEST',
  'PASSWORD_CHANGE',
  'UPDATE_PROFILE',
  'CREATE_POI',
  'UPDATE_POI',
  'DELETE_POI'
]

const ENTITIES = ['AUTH', 'USER', 'POI']

export default function AdminAuditLogsPage() {
  const router = useRouter()
  const { session, isLoading: sessionLoading } = useSessionContext()
  const supabase = useSupabaseClient()

  const [isAuthorized, setIsAuthorized] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null)
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, pages: 1 })

  const [filters, setFilters] = useState({
    user_email: '',
    action: '',
    entity: '',
    from: '',
    to: ''
  })

  const queryString = useMemo(() => {
    const params = new URLSearchParams()
    if (filters.user_email) params.set('user_email', filters.user_email)
    if (filters.action) params.set('action', filters.action)
    if (filters.entity) params.set('entity', filters.entity)
    if (filters.from) params.set('from', filters.from)
    if (filters.to) params.set('to', filters.to)
    params.set('page', String(pagination.page))
    params.set('limit', String(pagination.limit))
    return params.toString()
  }, [filters, pagination.page, pagination.limit])

  useEffect(() => {
    const checkAuth = async () => {
      if (sessionLoading) return
      if (!session) {
        router.push('/login')
        return
      }

      try {
        const { data: cmsUser } = await supabase
          .schema('core')
          .from('cms_users')
          .select('role')
          .eq('email', session.user.email)
          .single()

        if (cmsUser?.role !== 'admin') {
          router.push('/unauthorized')
          return
        }

        setIsAuthorized(true)
      } catch (error) {
        console.error('Auth error:', error)
        router.push('/unauthorized')
      } finally {
        setIsLoading(false)
      }
    }

    checkAuth()
  }, [session, sessionLoading, router, supabase])

  const fetchLogs = async () => {
    setIsLoading(true)
    try {
      const response = await fetch(`/api/admin/audit-logs?${queryString}`)
      const data = (await response.json()) as AuditResponse
      if (!response.ok) throw new Error(data as any)
      setLogs(data.logs || [])
      setPagination((prev) => ({
        ...prev,
        total: data.pagination.total,
        pages: data.pagination.pages
      }))
    } catch (error) {
      console.error('Error fetching audit logs:', error)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (!isAuthorized) return
    fetchLogs()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, queryString])

  if (isLoading && !isAuthorized) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-tuggi-blue mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    )
  }

  if (!isAuthorized) return null

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200">
        <Container className="py-4">
          <nav className="flex items-center gap-2 text-sm">
            <Link href="/dashboard" className="text-blue-600 hover:text-blue-700">
              Dashboard
            </Link>
            <ChevronRight className="w-4 h-4 text-gray-400" />
            <span className="text-gray-900 font-medium">Audit Logs</span>
          </nav>
        </Container>
      </div>

      <Container className="py-8 space-y-6">
        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Filter className="h-5 w-5 text-gray-500" />
              <h2 className="text-lg font-semibold">Filtros</h2>
            </div>
            <button
              onClick={fetchLogs}
              className="flex items-center gap-2 px-3 py-2 border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
              Atualizar
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div className="md:col-span-2">
              <label className="text-xs text-gray-500">Usuário (email)</label>
              <div className="relative">
                <Search className="h-4 w-4 text-gray-400 absolute left-3 top-3" />
                <input
                  value={filters.user_email}
                  onChange={(e) => setFilters((prev) => ({ ...prev, user_email: e.target.value }))}
                  placeholder="buscar por email"
                  className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg"
                />
              </div>
            </div>

            <div>
              <label className="text-xs text-gray-500">Ação</label>
              <select
                value={filters.action}
                onChange={(e) => setFilters((prev) => ({ ...prev, action: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg"
              >
                <option value="">Todas</option>
                {ACTIONS.map((action) => (
                  <option key={action} value={action}>{action}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs text-gray-500">Entidade</label>
              <select
                value={filters.entity}
                onChange={(e) => setFilters((prev) => ({ ...prev, entity: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg"
              >
                <option value="">Todas</option>
                {ENTITIES.map((entity) => (
                  <option key={entity} value={entity}>{entity}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs text-gray-500">Intervalo</label>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="date"
                  value={filters.from}
                  onChange={(e) => setFilters((prev) => ({ ...prev, from: e.target.value }))}
                  className="w-full px-2 py-2 border border-gray-200 rounded-lg"
                />
                <input
                  type="date"
                  value={filters.to}
                  onChange={(e) => setFilters((prev) => ({ ...prev, to: e.target.value }))}
                  className="w-full px-2 py-2 border border-gray-200 rounded-lg"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-100">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase">Data</th>
                  <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase">Usuário</th>
                  <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase">Ação</th>
                  <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase">Entidade</th>
                  <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase">Descrição</th>
                  <th className="px-6 py-3 text-right text-xs font-bold text-gray-500 uppercase">Detalhes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {isLoading ? (
                  [...Array(5)].map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      <td className="px-6 py-4"><div className="h-4 w-32 bg-gray-200 rounded" /></td>
                      <td className="px-6 py-4"><div className="h-4 w-32 bg-gray-200 rounded" /></td>
                      <td className="px-6 py-4"><div className="h-4 w-20 bg-gray-200 rounded" /></td>
                      <td className="px-6 py-4"><div className="h-4 w-24 bg-gray-200 rounded" /></td>
                      <td className="px-6 py-4"><div className="h-4 w-48 bg-gray-200 rounded" /></td>
                      <td className="px-6 py-4"><div className="h-8 w-16 bg-gray-200 rounded" /></td>
                    </tr>
                  ))
                ) : logs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-8 text-center text-gray-500">
                      Nenhum log encontrado
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => (
                    <tr key={log.id}>
                      <td className="px-6 py-4 text-sm text-gray-700">
                        {new Date(log.created_at).toLocaleString()}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-700">
                        {log.user_email || '—'}
                      </td>
                      <td className="px-6 py-4 text-sm font-medium text-gray-900">
                        {log.action}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-700">
                        {log.entity || '—'}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-700">
                        {log.description || '—'}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => setSelectedLog(log)}
                          className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50"
                        >
                          Ver
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100">
            <div className="text-sm text-gray-600">
              {pagination.total} registros
            </div>
            <div className="flex items-center gap-2">
              <button
                disabled={pagination.page <= 1}
                onClick={() => setPagination((prev) => ({ ...prev, page: prev.page - 1 }))}
                className="px-3 py-2 border border-gray-200 rounded-lg disabled:opacity-50"
              >
                Anterior
              </button>
              <span className="text-sm text-gray-600">
                Página {pagination.page} de {pagination.pages}
              </span>
              <button
                disabled={pagination.page >= pagination.pages}
                onClick={() => setPagination((prev) => ({ ...prev, page: prev.page + 1 }))}
                className="px-3 py-2 border border-gray-200 rounded-lg disabled:opacity-50"
              >
                Próxima
              </button>
            </div>
          </div>
        </div>
      </Container>

      {selectedLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl mx-4">
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <h3 className="text-lg font-semibold">Detalhes do Log</h3>
              <button onClick={() => setSelectedLog(null)}>
                <X className="h-5 w-5 text-gray-500" />
              </button>
            </div>
            <div className="p-6 space-y-3 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">Data</span><span>{new Date(selectedLog.created_at).toLocaleString()}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Usuário</span><span>{selectedLog.user_email || '—'}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Ação</span><span>{selectedLog.action}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Entidade</span><span>{selectedLog.entity || '—'}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">ID Entidade</span><span>{selectedLog.entity_id || '—'}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">IP</span><span>{selectedLog.ip_address || '—'}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">User Agent</span><span className="text-right max-w-xs break-words">{selectedLog.user_agent || '—'}</span></div>
              <div className="pt-2">
                <div className="text-gray-500 mb-1">Descrição</div>
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                  {selectedLog.description || '—'}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
