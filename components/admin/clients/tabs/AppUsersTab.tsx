'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSupabaseClient } from '@supabase/auth-helpers-react'
import { Smartphone, Trash2, Plus, AlertCircle, Loader2, Search, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { SectionHeader } from '@/components/admin/clients/shared/SectionHeader'
import type { ClientEditorTabProps } from './ProfileTab'

export interface AppUserLite {
  user_id: string
  full_name: string | null
  nickname: string | null
  email: string | null
}

interface SearchResult extends AppUserLite {
  client_id: string | null
}

/**
 * "App Users" tab — manage the app users (drive.profiles) linked to this client
 * via drive.profiles.client_id, so the partner QR shows up in their Passaporte.
 *
 * This is the APP user link (auth.users / drive.profiles), distinct from the
 * "Team" tab which links CMS users (core.client_cms_users).
 *
 * - Edit mode (clientId set): reads the linked list via the core.client_app_users
 *   RPC and links/unlinks immediately via PATCH /api/admin/users/[userId]/client.
 * - New mode (no clientId yet): there is no client to point at, so selections are
 *   *staged* (held by the parent ClientEditorModal) and linked right after the
 *   client is created.
 */
export function AppUsersTab({
  clientId,
  canEdit,
  stagedUsers,
  onStageChange,
}: ClientEditorTabProps & {
  stagedUsers?: AppUserLite[]
  onStageChange?: (users: AppUserLite[]) => void
}) {
  const t = useTranslations('Clients.appUsers')
  const supabase = useSupabaseClient()
  const isNew = !clientId

  const [linked, setLinked] = useState<AppUserLite[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  // Picker
  const [showAdd, setShowAdd] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)

  // In new mode the source of truth is the parent's staged list.
  const rows = isNew ? (stagedUsers ?? []) : linked

  const fetchLinked = useCallback(async () => {
    if (isNew) return
    setLoading(true)
    setError(null)
    try {
      const { data, error: rpcError } = await supabase
        .schema('core')
        .rpc('client_app_users', { target_client_id: clientId })
      if (rpcError) throw rpcError
      setLinked((data ?? []) as AppUserLite[])
    } catch {
      setError(t('errors.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [isNew, clientId, supabase, t])

  useEffect(() => { void fetchLinked() }, [fetchLinked])

  // Debounced app user search while the picker is open.
  useEffect(() => {
    if (!showAdd) return
    let active = true
    setSearching(true)
    const handle = setTimeout(async () => {
      try {
        const { data, error: rpcError } = await supabase
          .schema('core')
          .rpc('admin_search_app_users', { search: query, limit_count: 20 })
        if (!active) return
        setResults(rpcError ? [] : ((data ?? []) as SearchResult[]))
      } catch {
        if (active) setResults([])
      } finally {
        if (active) setSearching(false)
      }
    }, 300)
    return () => { active = false; clearTimeout(handle) }
  }, [query, showAdd, supabase])

  const link = async (u: SearchResult) => {
    setError(null)
    if (isNew) {
      // Stage — actual link happens after the client is created.
      const next = [...(stagedUsers ?? []).filter((s) => s.user_id !== u.user_id), {
        user_id: u.user_id, full_name: u.full_name, nickname: u.nickname, email: u.email,
      }]
      onStageChange?.(next)
      setShowAdd(false)
      setQuery('')
      return
    }
    setBusyId(u.user_id)
    try {
      const res = await fetch(`/api/admin/users/${u.user_id}/client`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError((data as { error?: string }).error ?? t('errors.linkFailed'))
        return
      }
      setShowAdd(false)
      setQuery('')
      await fetchLinked()
    } catch {
      setError(t('errors.linkFailed'))
    } finally {
      setBusyId(null)
    }
  }

  const unlink = async (userId: string) => {
    setError(null)
    if (isNew) {
      onStageChange?.((stagedUsers ?? []).filter((s) => s.user_id !== userId))
      return
    }
    setBusyId(userId)
    try {
      const res = await fetch(`/api/admin/users/${userId}/client`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: null }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError((data as { error?: string }).error ?? t('errors.unlinkFailed'))
        return
      }
      await fetchLinked()
    } catch {
      setError(t('errors.unlinkFailed'))
    } finally {
      setBusyId(null)
    }
  }

  const linkedIds = new Set(rows.map((r) => r.user_id))

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      <div className="bg-white dark:bg-gray-900 rounded-3xl border border-gray-200 dark:border-gray-800 p-8 shadow-sm">
        <div className="flex items-center justify-between mb-6">
          <SectionHeader icon={<Smartphone className="w-4 h-4 text-amber-500" />} title={t('section')} color="amber-500" />
          {canEdit && (
            <button
              onClick={() => { setShowAdd((v) => !v); setQuery(''); setResults([]) }}
              className="inline-flex items-center gap-1.5 rounded-xl bg-tuggi-blue px-3 py-1.5 text-xs font-bold text-white hover:bg-tuggi-blue/90 transition-all"
            >
              <Plus className="w-3.5 h-3.5" /> {t('linkUser')}
            </button>
          )}
        </div>

        {isNew && (
          <p className="mb-4 text-[11px] text-amber-600 dark:text-amber-400 font-medium">
            {t('newHint')}
          </p>
        )}

        {error && (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" /> {error}
          </div>
        )}

        {showAdd && canEdit && (
          <div className="mb-6 p-5 bg-gray-50 dark:bg-gray-950 rounded-2xl border border-gray-100 dark:border-gray-800">
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                autoFocus
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('searchPlaceholder')}
                className="w-full pl-9 pr-3 py-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-tuggi-blue/30"
              />
            </div>
            <div className="max-h-64 overflow-y-auto rounded-xl border border-gray-100 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
              {searching ? (
                <div className="py-6 flex justify-center"><Loader2 className="w-4 h-4 animate-spin text-tuggi-blue" /></div>
              ) : results.filter((r) => !linkedIds.has(r.user_id)).length === 0 ? (
                <p className="py-6 text-center text-xs text-gray-400">{t('noResults')}</p>
              ) : results.filter((r) => !linkedIds.has(r.user_id)).map((r) => (
                <button
                  key={r.user_id}
                  onClick={() => link(r)}
                  disabled={busyId === r.user_id}
                  className="w-full text-left px-3 py-2.5 hover:bg-white dark:hover:bg-gray-900 transition-colors disabled:opacity-50 flex items-center justify-between gap-2"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-gray-900 dark:text-white truncate">
                      {r.full_name || r.nickname || t('unnamed')}
                    </span>
                    <span className="block text-[11px] text-gray-400 truncate">{r.email || `@${r.nickname ?? ''}`}</span>
                  </span>
                  <span className="flex items-center gap-2 flex-shrink-0">
                    {r.client_id && r.client_id !== clientId && (
                      <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase tracking-widest bg-amber-100 text-amber-700 border border-amber-200">
                        {t('alreadyLinked')}
                      </span>
                    )}
                    {busyId === r.user_id && <Loader2 className="w-4 h-4 animate-spin text-tuggi-blue" />}
                  </span>
                </button>
              ))}
            </div>
            <div className="flex justify-end mt-3">
              <button
                onClick={() => { setShowAdd(false); setQuery('') }}
                className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 font-medium"
              >
                <X className="w-3.5 h-3.5" /> {t('cancel')}
              </button>
            </div>
          </div>
        )}

        <div className="overflow-hidden rounded-2xl border border-gray-100 dark:border-gray-800">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-800/50">
              <tr>
                <th className="px-5 py-3 text-left text-[10px] font-bold text-gray-400 uppercase tracking-widest">{t('user')}</th>
                <th className="px-5 py-3 text-right text-[10px] font-bold text-gray-400 uppercase tracking-widest">{t('actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {loading ? (
                <tr><td colSpan={2} className="px-5 py-8 text-center"><Loader2 className="w-5 h-5 animate-spin text-tuggi-blue mx-auto" /></td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={2} className="px-5 py-8 text-center text-gray-400 text-xs font-medium">{t('noLinkedUsers')}</td></tr>
              ) : rows.map((u) => (
                <tr key={u.user_id} className="group hover:bg-gray-50 dark:hover:bg-gray-800/20 transition-colors">
                  <td className="px-5 py-4">
                    <div className="font-bold text-gray-900 dark:text-white text-sm">{u.full_name || u.nickname || t('unnamed')}</div>
                    <div className="text-[11px] text-gray-400 font-medium">{u.email || `@${u.nickname ?? ''}`}</div>
                  </td>
                  <td className="px-5 py-4 text-right">
                    {canEdit && (
                      <button
                        onClick={() => unlink(u.user_id)}
                        disabled={busyId === u.user_id}
                        className="p-2 text-gray-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all disabled:opacity-50"
                      >
                        {busyId === u.user_id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
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
