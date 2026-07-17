'use client'

import { useCallback, useEffect, useState } from 'react'
import { Users, Trash2, Plus, AlertCircle, Loader2, Network, UserPlus } from 'lucide-react'
import { useTranslations } from 'next-intl'
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

const ROLE_VALUES: Array<'viewer' | 'manager' | 'owner'> = ['viewer', 'manager', 'owner']

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
export function TeamTab({ client, edited, updateField, clientId, canEdit }: ClientEditorTabProps) {
  const t = useTranslations('Clients.team')
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

  // Criar login novo (auth + cms_users + vínculo) — para dar acesso ao coordenador/equipe.
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [newName, setNewName] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newRole, setNewRole] = useState<'owner' | 'manager' | 'viewer'>('owner')
  const [success, setSuccess] = useState<string | null>(null)

  // Toggle "é coordenador" (capacidade em core.clients.is_coordinator). Fica staged em
  // `edited` e persiste no Salvar do modal (PATCH), como os demais campos do editor.
  const isCoordinator = Boolean(edited.is_coordinator ?? client?.is_coordinator)

  // Vincular ESTA empresa a um coordenador (parent_client_id). Só admin (esta aba só
  // existe no editor admin). Staged em `edited`, persiste no Salvar.
  const parentId = (edited.parent_client_id ?? client?.parent_client_id ?? '') || ''
  const [coordinators, setCoordinators] = useState<Array<{ id: string; company_name: string | null; slug: string | null }>>([])

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/coordinator/roots')
        const data = await res.json()
        if (res.ok) setCoordinators(data.roots ?? [])
      } catch { /* seletor fica vazio; não bloqueia a aba */ }
    })()
  }, [])

  const fetchLinked = useCallback(async () => {
    if (!clientId) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/users`)
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? t('errors.loadFailed'))
        return
      }
      setLinked(data.users ?? [])
    } catch {
      setError(t('errors.networkLoad'))
    } finally {
      setLoading(false)
    }
  }, [clientId, t])

  useEffect(() => { void fetchLinked() }, [fetchLinked])

  const fetchAvailable = async () => {
    setLoadingAvailable(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/users?limit=100')
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? t('errors.loadAvailableFailed'))
        return
      }
      const linkedIds = new Set(linked.map((l) => l.cms_user_id))
      setAvailable((data.users ?? []).filter((u: CmsUserOption) => !linkedIds.has(u.id)))
    } catch (err) {
      console.error('Failed to load users:', err)
      setError(t('errors.networkAvailable'))
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
        setError(data.error ?? t('errors.linkFailed'))
        return
      }
      await fetchLinked()
      setShowAdd(false)
      setSelectedUserId('')
      setSelectedRole('viewer')
    } catch {
      setError(t('errors.networkLink'))
    } finally {
      setAdding(false)
    }
  }

  const handleCreateLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!clientId) return
    setCreating(true)
    setError(null)
    setSuccess(null)
    try {
      const res = await fetch(`/api/admin/clients/${clientId}/team/create-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newEmail, full_name: newName, password: newPassword, client_role: newRole }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? t('errors.createLoginFailed'))
        return
      }
      await fetchLinked()
      setShowCreate(false)
      setNewEmail(''); setNewName(''); setNewPassword(''); setNewRole('owner')
      setSuccess(t('loginCreated'))
      setTimeout(() => setSuccess(null), 2500)
    } catch {
      setError(t('errors.networkCreateLogin'))
    } finally {
      setCreating(false)
    }
  }

  const handleUnlink = async (userId: string) => {
    if (!clientId) return
    setUnlinking(userId)
    setError(null)
    try {
      const res = await fetch(`/api/admin/users/${userId}/link-client?client_id=${clientId}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError((data as { error?: string }).error ?? t('errors.unlinkFailed'))
        return
      }
      await fetchLinked()
    } catch (err) {
      console.error(err)
      setError(t('errors.networkUnlink'))
    } finally {
      setUnlinking(null)
    }
  }

  if (!clientId) {
    return (
      <div className="max-w-2xl mx-auto py-20 text-center">
        <p className="text-sm text-gray-400 font-semibold uppercase tracking-widest mb-2">{t('emptyTitle')}</p>
        <h3 className="text-2xl font-bold text-gray-700 mb-3">{t('section')}</h3>
        <p className="text-sm text-gray-500">{t('emptyDesc')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      {/* Programa de afiliados — capacidade de coordenador (admin-only; esta aba só existe
          no editor admin, nunca no modal de filha do coordenador). */}
      <div className="bg-white dark:bg-gray-900 rounded-3xl border border-gray-200 dark:border-gray-800 p-8 shadow-sm">
        <SectionHeader icon={<Network className="w-4 h-4 text-tuggi-blue" />} title={t('coordinatorTitle')} color="tuggi-blue" />
        <p className="text-xs text-gray-500 mb-4 leading-relaxed">{t('coordinatorHelp')}</p>
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={isCoordinator}
            disabled={!canEdit}
            onChange={(e) => updateField('is_coordinator', e.target.checked)}
            className="rounded border-gray-300 text-tuggi-blue focus:ring-tuggi-blue/30"
          />
          <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">{t('isCoordinator')}</span>
        </label>

        {/* Vincular esta empresa SOB um coordenador. Só admin. Uma empresa que já é
            coordenadora (tem filhas) não pode virar filha — a trava do banco recusa. */}
        {clientId && !isCoordinator && (
          <div className="mt-5 space-y-1 max-w-md">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{t('parentCoordinator')}</p>
            <select
              value={parentId}
              disabled={!canEdit}
              onChange={(e) => updateField('parent_client_id', e.target.value || null)}
              className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm font-semibold text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-tuggi-blue/30"
            >
              <option value="">{t('noParent')}</option>
              {coordinators
                .filter((c) => c.id !== clientId)
                .map((c) => (
                  <option key={c.id} value={c.id}>{c.company_name || c.slug || c.id}</option>
                ))}
            </select>
            <p className="text-[10px] text-gray-400">{t('parentCoordinatorHelp')}</p>
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-3xl border border-gray-200 dark:border-gray-800 p-8 shadow-sm">
        <div className="flex items-center justify-between mb-6">
          <SectionHeader icon={<Users className="w-4 h-4 text-green-500" />} title={t('section')} color="green-500" />
          {canEdit && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => { setShowCreate((v) => !v); setShowAdd(false) }}
                className="inline-flex items-center gap-1.5 rounded-xl border border-tuggi-blue/30 px-3 py-1.5 text-xs font-bold text-tuggi-blue hover:bg-tuggi-blue/5 transition-all"
              >
                <UserPlus className="w-3.5 h-3.5" /> {t('createLogin')}
              </button>
              <button
                onClick={() => { setShowAdd((v) => !v); setShowCreate(false); if (!showAdd) void fetchAvailable() }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-tuggi-blue px-3 py-1.5 text-xs font-bold text-white hover:bg-tuggi-blue/90 transition-all"
              >
                <Plus className="w-3.5 h-3.5" /> {t('linkUser')}
              </button>
            </div>
          )}
        </div>

        {error && (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            <AlertCircle className="w-3.5 h-3.5" /> {error}
          </div>
        )}

        {success && (
          <div className="mb-4 rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-xs font-semibold text-green-700">
            {success}
          </div>
        )}

        {showCreate && canEdit && (
          <form onSubmit={handleCreateLogin} className="mb-6 p-5 bg-gray-50 dark:bg-gray-950 rounded-2xl border border-gray-100 dark:border-gray-800">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">{t('createLoginTitle')}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
              <input
                type="text" required placeholder={t('fullName')}
                value={newName} onChange={(e) => setNewName(e.target.value)}
                className="w-full px-4 py-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-tuggi-blue/30"
              />
              <input
                type="email" required placeholder={t('email')}
                value={newEmail} onChange={(e) => setNewEmail(e.target.value)}
                className="w-full px-4 py-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-tuggi-blue/30"
              />
              <div>
                <input
                  type="password" required minLength={8} placeholder={t('password')}
                  value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-4 py-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-tuggi-blue/30"
                />
                <p className="text-[10px] text-gray-400 mt-1 pl-1">{t('passwordHint')}</p>
              </div>
              <select
                value={newRole} onChange={(e) => setNewRole(e.target.value as typeof newRole)}
                className="w-full px-4 py-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-tuggi-blue/30"
              >
                {ROLE_VALUES.map((r) => <option key={r} value={r}>{t(`roles.${r}`)}</option>)}
              </select>
            </div>
            <button
              type="submit"
              disabled={creating || !newEmail || !newName || newPassword.length < 8}
              className="w-full py-3 bg-tuggi-blue text-white rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-tuggi-blue/90 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
            >
              {creating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {t('createLoginSubmit')}
            </button>
          </form>
        )}

        {showAdd && canEdit && (
          <form onSubmit={handleAdd} className="mb-6 p-5 bg-gray-50 dark:bg-gray-950 rounded-2xl border border-gray-100 dark:border-gray-800">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-400 uppercase pl-1">{t('user')}</label>
                <select
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value)}
                  required
                  disabled={loadingAvailable}
                  className="w-full px-4 py-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-tuggi-blue/30"
                >
                  <option value="">{loadingAvailable ? t('userLoading') : t('userSelect')}</option>
                  {available.map((u) => (
                    <option key={u.id} value={u.id}>{u.email}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-400 uppercase pl-1">{t('role')}</label>
                <select
                  value={selectedRole}
                  onChange={(e) => setSelectedRole(e.target.value as typeof selectedRole)}
                  className="w-full px-4 py-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-tuggi-blue/30"
                >
                  {ROLE_VALUES.map((r) => (
                    <option key={r} value={r}>{t(`roles.${r}`)}</option>
                  ))}
                </select>
              </div>
            </div>
            <button
              type="submit"
              disabled={!selectedUserId || adding}
              className="w-full py-3 bg-tuggi-blue text-white rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-tuggi-blue/90 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
            >
              {adding && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {t('confirmLink')}
            </button>
          </form>
        )}

        <div className="overflow-hidden rounded-2xl border border-gray-100 dark:border-gray-800">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-800/50">
              <tr>
                <th className="px-5 py-3 text-left text-[10px] font-bold text-gray-400 uppercase tracking-widest">{t('user')}</th>
                <th className="px-5 py-3 text-left text-[10px] font-bold text-gray-400 uppercase tracking-widest">{t('role')}</th>
                <th className="px-5 py-3 text-right text-[10px] font-bold text-gray-400 uppercase tracking-widest">{t('actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {loading ? (
                <tr><td colSpan={3} className="px-5 py-8 text-center"><Loader2 className="w-5 h-5 animate-spin text-tuggi-blue mx-auto" /></td></tr>
              ) : linked.length === 0 ? (
                <tr><td colSpan={3} className="px-5 py-8 text-center text-gray-400 text-xs font-medium">{t('noLinkedUsers')}</td></tr>
              ) : linked.map((link) => (
                <tr key={link.id} className="group hover:bg-gray-50 dark:hover:bg-gray-800/20 transition-colors">
                  <td className="px-5 py-4">
                    <div className="font-bold text-gray-900 dark:text-white text-sm">{link.cms_users?.email}</div>
                    <div className="text-[11px] text-gray-400 font-medium">{link.cms_users?.full_name ?? '—'}</div>
                  </td>
                  <td className="px-5 py-4">
                    <span className="inline-flex px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase tracking-widest bg-tuggi-blue/5 text-tuggi-blue border border-tuggi-blue/10">
                      {t(`roles.${link.client_role}`)}
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
