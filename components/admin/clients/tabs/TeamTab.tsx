'use client'

import { useCallback, useEffect, useState } from 'react'
import { Users, Trash2, Plus, AlertCircle, Loader2 } from 'lucide-react'
import { SectionHeader } from '@/components/admin/clients/shared/SectionHeader'
import type { ClientEditorTabProps } from './ProfileTab'

interface LinkedUser {
  id: string
  cms_user_id: string
  client_role: 'owner' | 'manager' | 'viewer'
  cms_users?: { id: string; email: string; full_name?: string | null } | null
}

interface CmsUserOption {
  id: string
  email: string
  full_name?: string | null
}

/**
 * Equipe tab — list and manage CMS users linked to this client via the
 * core.client_cms_users junction table. Extracted from the "Linked Users"
 * section that used to live inside ClientDetails (now deleted).
 *
 * Reuses the existing endpoints:
 *   GET    /api/clients/{id}/users                — list linked users
 *   POST   /api/admin/users/{userId}/link-client  — link
 *   DELETE /api/admin/users/{userId}/link-client?client_id={id} — unlink
 *   GET    /api/admin/users?limit=100             — available user pool
 */
export function TeamTab({ clientId, canEdit }: ClientEditorTabProps) {
  const [linked, setLinked] = useState<LinkedUser[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [available, setAvailable] = useState<CmsUserOption[]>([])
  const [loadingAvailable, setLoadingAvailable] = useState(false)
  const [selectedUserId, setSelectedUserId] = useState('')
  const [selectedRole, setSelectedRole] = useState<'owner' | 'manager' | 'viewer'>('viewer')
  const [adding, setAdding] = useState(false)
  const [unlinking, setUnlinking] = useState<string | null>(null)

  const fetchLinked = useCallback(async () => {
    if (!clientId) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/users`)
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Falha ao carregar usuários')
        return
      }
      setLinked(data.users ?? [])
    } catch {
      setError('Erro de rede ao carregar usuários')
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => { void fetchLinked() }, [fetchLinked])

  const fetchAvailable = async () => {
    setLoadingAvailable(true)
    try {
      const res = await fetch('/api/admin/users?limit=100')
      const data = await res.json()
      if (res.ok) {
        const linkedIds = new Set(linked.map((l) => l.cms_user_id))
        setAvailable((data.users ?? []).filter((u: CmsUserOption) => !linkedIds.has(u.id)))
      }
    } catch (err) {
      console.error('Failed to load users:', err)
    } finally {
      setLoadingAvailable(false)
    }
  }

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedUserId || !clientId) return
    setAdding(true)
    try {
      const res = await fetch(`/api/admin/users/${selectedUserId}/link-client`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, client_role: selectedRole }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Falha ao vincular usuário')
        return
      }
      await fetchLinked()
      setShowAdd(false)
      setSelectedUserId('')
      setSelectedRole('viewer')
    } catch {
      setError('Erro de rede ao vincular')
    } finally {
      setAdding(false)
    }
  }

  const handleUnlink = async (userId: string) => {
    if (!clientId) return
    setUnlinking(userId)
    try {
      const res = await fetch(`/api/admin/users/${userId}/link-client?client_id=${clientId}`, { method: 'DELETE' })
      if (res.ok) await fetchLinked()
    } catch (err) {
      console.error(err)
    } finally {
      setUnlinking(null)
    }
  }

  if (!clientId) {
    return (
      <div className="max-w-2xl mx-auto py-20 text-center">
        <p className="text-sm text-gray-400 font-semibold uppercase tracking-widest mb-2">Sem cliente</p>
        <h3 className="text-2xl font-bold text-gray-700 mb-3">Equipe</h3>
        <p className="text-sm text-gray-500">Salve o cliente primeiro para vincular usuários CMS.</p>
      </div>
    )
  }

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      <div className="bg-white dark:bg-gray-900 rounded-3xl border border-gray-200 dark:border-gray-800 p-8 shadow-sm">
        <div className="flex items-center justify-between mb-6">
          <SectionHeader icon={<Users className="w-4 h-4 text-green-500" />} title="Usuários vinculados" color="green-500" />
          {canEdit && (
            <button
              onClick={() => { setShowAdd((v) => !v); if (!showAdd) void fetchAvailable() }}
              className="inline-flex items-center gap-1.5 rounded-xl bg-tuggi-blue px-3 py-1.5 text-xs font-bold text-white hover:bg-tuggi-blue/90 transition-all"
            >
              <Plus className="w-3.5 h-3.5" /> Vincular usuário
            </button>
          )}
        </div>

        {error && (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            <AlertCircle className="w-3.5 h-3.5" /> {error}
          </div>
        )}

        {showAdd && canEdit && (
          <form onSubmit={handleAdd} className="mb-6 p-5 bg-gray-50 dark:bg-gray-950 rounded-2xl border border-gray-100 dark:border-gray-800">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-400 uppercase pl-1">Usuário</label>
                <select
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value)}
                  required
                  disabled={loadingAvailable}
                  className="w-full px-4 py-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-tuggi-blue"
                >
                  <option value="">{loadingAvailable ? 'Carregando…' : 'Selecionar…'}</option>
                  {available.map((u) => (
                    <option key={u.id} value={u.id}>{u.email}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-400 uppercase pl-1">Papel</label>
                <select
                  value={selectedRole}
                  onChange={(e) => setSelectedRole(e.target.value as typeof selectedRole)}
                  className="w-full px-4 py-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-tuggi-blue"
                >
                  <option value="viewer">Viewer</option>
                  <option value="manager">Manager</option>
                  <option value="owner">Owner</option>
                </select>
              </div>
            </div>
            <button
              type="submit"
              disabled={!selectedUserId || adding}
              className="w-full py-3 bg-tuggi-blue text-white rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-tuggi-blue/90 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
            >
              {adding && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Confirmar vínculo
            </button>
          </form>
        )}

        <div className="overflow-hidden rounded-2xl border border-gray-100 dark:border-gray-800">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-800/50">
              <tr>
                <th className="px-5 py-3 text-left text-[10px] font-bold text-gray-400 uppercase tracking-widest">Usuário</th>
                <th className="px-5 py-3 text-left text-[10px] font-bold text-gray-400 uppercase tracking-widest">Papel</th>
                <th className="px-5 py-3 text-right text-[10px] font-bold text-gray-400 uppercase tracking-widest">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {loading ? (
                <tr><td colSpan={3} className="px-5 py-8 text-center"><Loader2 className="w-5 h-5 animate-spin text-tuggi-blue mx-auto" /></td></tr>
              ) : linked.length === 0 ? (
                <tr><td colSpan={3} className="px-5 py-8 text-center text-gray-400 text-xs font-medium">Nenhum usuário vinculado a este cliente</td></tr>
              ) : linked.map((link) => (
                <tr key={link.id} className="group hover:bg-gray-50 dark:hover:bg-gray-800/20 transition-colors">
                  <td className="px-5 py-4">
                    <div className="font-bold text-gray-900 dark:text-white text-sm">{link.cms_users?.email}</div>
                    <div className="text-[11px] text-gray-400 font-medium">{link.cms_users?.full_name ?? '—'}</div>
                  </td>
                  <td className="px-5 py-4">
                    <span className="inline-flex px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase tracking-widest bg-tuggi-blue/5 text-tuggi-blue border border-tuggi-blue/10">
                      {link.client_role}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-right">
                    {canEdit && (
                      <button
                        onClick={() => handleUnlink(link.cms_user_id)}
                        disabled={unlinking === link.cms_user_id}
                        className="p-2 text-gray-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all disabled:opacity-50"
                      >
                        {unlinking === link.cms_user_id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
