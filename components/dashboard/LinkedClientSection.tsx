'use client'

/**
 * "Linked Client" — sets `drive.profiles.client_id` for an app user so the app surfaces that
 * client's partner QR (`https://tuggi.app/d/<slug>`) in the Passaporte.
 *
 * The current link comes from `core.dashboard_user_detail`; writes go through
 * `PATCH /api/admin/users/[userId]/client` (admin only), which calls
 * `core.admin_set_app_user_client`. After a write, `onChanged` re-runs the detail read.
 *
 * This is **not** the CMS user link (`partner.client_cms_users` / the Team tab). The client
 * is a business counterparty and is named by its trade name — BR-USUARIO-042 item 4 covers
 * only the tourist, and the tourist is not on this line.
 *
 * It lived inside `app/[locale]/users/app/page.tsx` until #659, where it was reachable only
 * from that one page's copy of the detail modal. It moved out with the modal.
 */

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AlertCircle, Building2, Link2, Loader2, QrCode, Search, Trash2, X } from 'lucide-react'
import type { UserDetailLinkedClient } from '@/lib/services/dashboard-service'

interface ClientOption {
  id: string
  name: string
  company_name?: string | null
  client_type?: string | null
  slug?: string | null
}

export const LinkedClientSection = ({
  userId,
  linked,
  onChanged,
}: {
  userId: string
  linked: UserDetailLinkedClient | null
  onChanged?: () => void
}) => {
  const t = useTranslations('Pages.AppUsers.modal')
  const [isEditing, setIsEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Client picker state
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ClientOption[]>([])
  const [searching, setSearching] = useState(false)

  // Debounced client search while the picker is open
  useEffect(() => {
    if (!isEditing) return
    let active = true
    setSearching(true)
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/clients?status=all&limit=20&search=${encodeURIComponent(query)}`)
        const data = await res.json()
        if (active) setResults(res.ok ? (data.clients ?? []) : [])
      } catch {
        if (active) setResults([])
      } finally {
        if (active) setSearching(false)
      }
    }, 300)
    return () => { active = false; clearTimeout(handle) }
  }, [query, isEditing])

  const save = async (clientId: string | null) => {
    setIsSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/users/${userId}/client`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? t('link_error'))
        return
      }
      setIsEditing(false)
      setQuery('')
      if (onChanged) onChanged()
    } catch {
      setError(t('link_error'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="p-4 bg-gradient-to-r from-gray-50 to-gray-100 dark:from-gray-800/50 dark:to-gray-800 rounded-xl">
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 flex items-center">
          <Link2 className="h-4 w-4 mr-2" />
          {t('linked_client')}
        </h3>
        {!isEditing && (
          <button
            type="button"
            onClick={() => { setIsEditing(true); setQuery('') }}
            className="text-xs text-tuggi-blue hover:underline font-medium"
          >
            {linked ? t('change_client') : t('link_client')}
          </button>
        )}
      </div>

      {error && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" /> {error}
        </div>
      )}

      {!isEditing ? (
        linked ? (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <Building2 className="h-4 w-4 text-tuggi-blue flex-shrink-0" />
                <span className="truncate">{linked.name}</span>
                {linked.client_type && (
                  <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase tracking-widest bg-tuggi-blue/5 text-tuggi-blue border border-tuggi-blue/10">
                    {linked.client_type}
                  </span>
                )}
              </p>
              {linked.qr_url && (
                <p className="text-xs text-gray-500 flex items-center gap-1 mt-1 truncate">
                  <QrCode className="h-3 w-3 flex-shrink-0" /> {linked.qr_url}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => save(null)}
              disabled={isSaving}
              title={t('remove_link')}
              className="p-2 text-gray-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all disabled:opacity-50 flex-shrink-0"
            >
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            </button>
          </div>
        ) : (
          <p className="text-sm text-gray-500">{t('no_linked_client')}</p>
        )
      ) : (
        <div className="bg-white dark:bg-gray-900 p-3 rounded-lg border border-gray-200 dark:border-gray-700">
          {linked && (
            <p className="mb-2 text-[11px] text-amber-600 dark:text-amber-400 font-medium">
              {t('replace_hint', { name: linked.name })}
            </p>
          )}
          <div className="relative mb-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('search_clients')}
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-tuggi-blue/30 outline-none"
            />
          </div>
          <div className="max-h-56 overflow-y-auto rounded-lg border border-gray-100 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
            {searching ? (
              <div className="py-6 flex justify-center"><Loader2 className="w-4 h-4 animate-spin text-tuggi-blue" /></div>
            ) : results.length === 0 ? (
              <p className="py-6 text-center text-xs text-gray-400">{t('no_clients')}</p>
            ) : results.map((c) => (
              <button
                type="button"
                key={c.id}
                onClick={() => save(c.id)}
                disabled={isSaving}
                className="w-full text-left px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors disabled:opacity-50 flex items-center justify-between gap-2"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-gray-900 dark:text-white truncate">{c.name}</span>
                  {c.slug && <span className="block text-[11px] text-gray-400 truncate">/d/{c.slug}</span>}
                </span>
                {c.client_type && (
                  <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase tracking-widest bg-gray-100 dark:bg-gray-800 text-gray-500 flex-shrink-0">
                    {c.client_type}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="flex justify-end mt-3">
            <button
              type="button"
              onClick={() => { setIsEditing(false); setError(null) }}
              className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 font-medium"
            >
              <X className="w-3.5 h-3.5" /> {t('cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default LinkedClientSection
