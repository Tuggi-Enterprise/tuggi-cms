'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSupabaseClient } from '@supabase/auth-helpers-react'
import { 
  Smartphone, Search, RefreshCw, Filter, Crown,
  CreditCard, TrendingUp, AlertCircle, ChevronDown,
  Apple, Zap, User, Activity, Mail, Play, Plane, ArrowUpDown, ArrowUp, ArrowDown,
  Link2, Building2, QrCode, Loader2, X, Trash2
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { StatCard, StatCardRow } from '@/components/ui/StatCard'
import { SubscriptionBadge, ProviderIcon, PlatformBadge } from '@/components/ui/SubscriptionBadge'
import { useTranslations } from 'next-intl'

// PlayCircle icon (not in lucide-react standard)
const PlayCircle = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <polygon points="10,8 16,12 10,16 10,8"/>
  </svg>
)

// ============================================================================
// TYPES
// ============================================================================

interface AppUser {
  user_id: string
  full_name: string | null
  nickname: string | null
  email: string | null
  country: string | null
  language: string | null
  timezone: string | null
  voice_preference: string | null
  driver_type: string | null
  last_platform: string | null
  last_device_model: string | null
  last_app_version: string | null
  subscription_tier_id: string | null
  subscription_tier_name: string | null
  subscription_tier_display_name: string | null
  subscription_provider: string | null
  subscription_start_date: string | null
  subscription_end_date: string | null
  is_premium: boolean
  login_count: number
  last_sign_in_at: string | null
  created_at: string
  onboarding_completed: boolean
  trip_count: number
  total_km: number
  poi_visits_count: number
  last_trip_at: string | null
}

interface SubscriptionStats {
  total_users: number
  free_users: number
  premium_users: number
  premium_percentage: number
  apple_subscriptions: number
  google_subscriptions: number
  stripe_subscriptions: number
  tiers_breakdown: Array<{ tier_id: string; tier_name: string; count: number }>
  new_subscriptions_7d: number
  churned_7d: number
}

interface UserDetail extends AppUser {
  unique_cities_visited: number
  subscription_history: Array<{
    id: string
    action: string
    provider: string
    tier_name: string
    previous_tier_name: string | null
    created_at: string
  }>
  client_id: string | null
  linked_client: {
    id: string
    name: string
    client_type: string | null
    slug: string | null
    qr_url: string | null
  } | null
}

type SortConfig = {
  key: keyof AppUser
  direction: 'asc' | 'desc'
}

// ============================================================================
// LINKED CLIENT SECTION (partner QR)
// ============================================================================

interface LinkedClient {
  id: string
  name: string
  client_type: string | null
  slug: string | null
  qr_url: string | null
}

interface ClientOption {
  id: string
  name: string
  company_name?: string | null
  client_type?: string | null
  slug?: string | null
}

/**
 * "Linked Client" section — sets drive.profiles.client_id for an app user so the
 * app surfaces that client's partner QR (https://tuggi.app/d/<slug>) in the
 * Passaporte. The current link (`linked`) comes from the core.dashboard_user_detail
 * RPC; writes go through PATCH /api/admin/users/[userId]/client (admin-only), which
 * calls the core.admin_set_app_user_client RPC. After a write, onChanged re-runs the
 * detail RPC. This is NOT the CMS user link (core.client_cms_users / Team tab).
 */
const LinkedClientSection = ({
  userId,
  linked,
  onChanged,
}: {
  userId: string
  linked: LinkedClient | null
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

// ============================================================================
// USER DETAIL MODAL
// ============================================================================

const UserDetailModal = ({ 
  userId,
  onClose,
  onUpdate,
  supabase
}: { 
  userId: string | null
  onClose: () => void
  onUpdate?: () => void
  supabase: any
}) => {
  const t = useTranslations('Pages.AppUsers.modal')
  const [user, setUser] = useState<UserDetail | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  // Edit Subscription State
  const [isEditingSub, setIsEditingSub] = useState(false)
  const [tiers, setTiers] = useState<any[]>([])
  const [selectedTierId, setSelectedTierId] = useState<string>('')
  const [selectedEndDate, setSelectedEndDate] = useState<string>('')
  const [selectedDays, setSelectedDays] = useState<number | null>(null)
  const [isSavingSub, setIsSavingSub] = useState(false)

  const fetchDetail = useCallback(async () => {
    if (!userId) {
      setUser(null)
      return
    }
    setIsLoading(true)
    try {
      const { data, error } = await supabase
        .schema('core')
        .rpc('dashboard_user_detail', { target_user_id: userId })

      if (error) throw error
      if (data && data.length > 0) {
        setUser(data[0])
      }
    } catch (err) {
      console.error('Error fetching user detail:', err)
    } finally {
      setIsLoading(false)
    }
  }, [userId, supabase])

  useEffect(() => { void fetchDetail() }, [fetchDetail])

  const handleEditClick = async () => {
    if (tiers.length === 0) {
      try {
        const { data, error } = await supabase
          .schema('drive')
          .from('subscription_tiers')
          .select('id, display_name, name')
          .eq('is_active', true)
        
        if (!error && data) {
          setTiers(data)
        }
      } catch (err) {
        console.error('Error fetching tiers:', err)
      }
    }
    
    // Set initial values from user
    setSelectedTierId(user?.subscription_tier_id || '')
    if (user?.subscription_end_date) {
      setSelectedEndDate(new Date(user.subscription_end_date).toISOString().split('T')[0])
    } else {
      setSelectedEndDate('')
    }
    setSelectedDays(null)
    
    setIsEditingSub(true)
  }

  const handleSaveSub = async () => {
    if (!userId || !user) return
    
    try {
      setIsSavingSub(true)
      
      const payload: Record<string, any> = {
        subscription_tier_id: selectedTierId || null,
      }
      
      if (selectedEndDate) {
        payload.subscription_end_date = new Date(selectedEndDate).toISOString()
      } else {
        payload.subscription_end_date = null
      }

      const res = await fetch(`/api/admin/users/${user.user_id}/subscription`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const result = await res.json()
      
      if (!res.ok) {
        throw new Error(result.error || t('save_error'))
      }
      
      // Refresh user details to show new tier immediately inside modal
      const { data: refreshedData, error: refreshError } = await supabase
        .schema('core')
        .rpc('dashboard_user_detail', { target_user_id: user.user_id })
      
      if (!refreshError && refreshedData && refreshedData.length > 0) {
        setUser(refreshedData[0])
      }
      
      // Tell parent to refresh the grid
      if (onUpdate) onUpdate()
      
      setIsEditingSub(false)
    } catch (err) {
      console.error('Error updating subscription:', err)
      alert(err instanceof Error ? err.message : t('save_error'))
    } finally {
      setIsSavingSub(false)
    }
  }

  if (!userId) return null

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="flex min-h-full items-center justify-center p-4">
        <div 
          className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-3xl relative animate-in zoom-in-95 duration-300"
          onClick={(e) => e.stopPropagation()}
        >
          {isLoading ? (
            <div className="p-12 flex items-center justify-center">
              <RefreshCw className="h-8 w-8 animate-spin text-tuggi-blue" />
            </div>
          ) : user ? (
          <>
            {/* Header */}
            <div className="p-6 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-start justify-between">
                <div className="flex items-center">
                  <div className="h-16 w-16 rounded-full bg-gradient-to-br from-tuggi-blue to-purple-500 flex items-center justify-center text-white text-2xl font-bold mr-4">
                    {(user.full_name || user.nickname || 'U').charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                      {user.full_name || t('unnamed')}
                      <SubscriptionBadge isPremium={user.is_premium} tierName={user.subscription_tier_display_name} />
                    </h2>
                    <p className="text-gray-500">@{user.nickname || t('no_nickname')}</p>
                    {user.email && (
                      <p className="text-sm text-gray-400 flex items-center mt-1">
                        <Mail className="h-3 w-3 mr-1" />
                        {user.email}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
            
            {/* Content */}
            <div className="p-6 space-y-6">
              {/* Quick Stats */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="text-center p-4 bg-tuggi-blue/10 rounded-xl">
                  <p className="text-2xl font-bold text-tuggi-blue">{user.trip_count || 0}</p>
                  <p className="text-xs text-gray-500">Trips</p>
                </div>
                <div className="text-center p-4 bg-green-500/10 rounded-xl">
                  <p className="text-2xl font-bold text-green-600">{user.poi_visits_count || 0}</p>
                  <p className="text-xs text-gray-500">POI Visits</p>
                </div>
                <div className="text-center p-4 bg-purple-500/10 rounded-xl">
                  <p className="text-2xl font-bold text-purple-600">{Math.round(user.total_km || 0)}</p>
                  <p className="text-xs text-gray-500">KM</p>
                </div>
                <div className="text-center p-4 bg-orange-500/10 rounded-xl">
                  <p className="text-2xl font-bold text-orange-600">{user.unique_cities_visited || 0}</p>
                  <p className="text-xs text-gray-500">{t('cities')}</p>
                </div>
              </div>

              {/* Info Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Profile Info */}
                <div className="space-y-3">
                  <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 flex items-center">
                    <User className="h-4 w-4 mr-2" />
                    {t('profile')}
                  </h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-500">{t('country')}</span>
                      <span className="font-medium text-gray-900 dark:text-white">{user.country || 'N/A'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">{t('language')}</span>
                      <span className="font-medium text-gray-900 dark:text-white">{user.language || 'N/A'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">{t('driver_type')}</span>
                      <span className="font-medium text-gray-900 dark:text-white">{user.driver_type || 'N/A'}</span>
                    </div>
                    {/* <div className="flex justify-between">
                      <span className="text-gray-500">Voz</span>
                      <span className="font-medium text-gray-900 dark:text-white">{user.voice_preference || 'N/A'}</span>
                    </div> */}
                  </div>
                </div>

                {/* Device Info */}
                <div className="space-y-3">
                  <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 flex items-center">
                    <Smartphone className="h-4 w-4 mr-2" />
                    {t('device')}
                  </h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-500">{t('platform')}</span>
                      <span className={cn(
                        "px-2 py-0.5 rounded text-xs font-bold",
                        user.last_platform === 'ios' ? 'bg-blue-100 text-blue-700' : 
                        user.last_platform === 'android' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'
                      )}>
                        {user.last_platform || 'N/A'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">{t('model')}</span>
                      <span className="font-medium text-gray-900 dark:text-white">{user.last_device_model || 'N/A'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">{t('app_version')}</span>
                      <span className="font-medium text-gray-900 dark:text-white">{user.last_app_version || 'N/A'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">{t('logins')}</span>
                      <span className="font-medium text-gray-900 dark:text-white">{user.login_count || 0}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Subscription */}
              <div className="p-4 bg-gradient-to-r from-gray-50 to-gray-100 dark:from-gray-800/50 dark:to-gray-800 rounded-xl">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 flex items-center">
                    <CreditCard className="h-4 w-4 mr-2" />
                    {t('subscription')}
                  </h3>
                  {!isEditingSub ? (
                    <button 
                      onClick={handleEditClick}
                      className="text-xs text-tuggi-blue hover:underline font-medium"
                    >
                      {t('edit')}
                    </button>
                  ) : (
                    <div className="flex items-center gap-3">
                      <button 
                        onClick={() => setIsEditingSub(false)}
                        className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 font-medium"
                      >
                        {t('cancel')}
                      </button>
                      <button 
                        onClick={handleSaveSub}
                        disabled={isSavingSub}
                        className="text-xs bg-tuggi-blue text-white px-3 py-1 rounded-md hover:bg-tuggi-blue/80 disabled:opacity-50 transition-colors font-medium"
                      >
                        {isSavingSub ? t('saving') : t('save')}
                      </button>
                    </div>
                  )}
                </div>

                {!isEditingSub ? (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <p className="text-xs text-gray-500">{t('tier')}</p>
                      <p className="font-bold text-gray-900 dark:text-white flex items-center gap-2 mt-1">
                        {user.is_premium ? (
                          <>
                            <Crown className="h-4 w-4 text-amber-500" />
                            {user.subscription_tier_display_name || 'Premium'}
                          </>
                        ) : (
                          'Free'
                        )}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">{t('provider')}</p>
                      <p className="font-medium text-gray-900 dark:text-white flex items-center gap-1 mt-1">
                        <ProviderIcon provider={user.subscription_provider} />
                        {user.subscription_provider || 'N/A'}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">{t('expires_at')}</p>
                      <p className="font-medium text-gray-900 dark:text-white mt-1">
                        {user.subscription_end_date 
                          ? new Date(user.subscription_end_date).toLocaleDateString()
                          : 'N/A'
                        }
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4 bg-white dark:bg-gray-900 p-3 rounded-lg border border-gray-200 dark:border-gray-700">
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">
                        {t('tier')}
                      </label>
                      <select 
                        value={selectedTierId} 
                        onChange={e => setSelectedTierId(e.target.value)}
                        className="w-full text-sm py-1.5 px-2 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-1 focus:ring-tuggi-blue"
                      >
                        <option value="">{t('select_tier')}</option>
                        {tiers.map(t => (
                          <option key={t.id} value={t.id}>{t.display_name} ({t.name})</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                        {t('duration')}
                      </label>
                      <div className="flex gap-2">
                        {[7, 15, 30].map(days => (
                          <button
                            key={days}
                            type="button"
                            onClick={() => {
                              const date = new Date()
                              date.setDate(date.getDate() + days)
                              setSelectedEndDate(date.toISOString().split('T')[0])
                              setSelectedDays(days)
                            }}
                            className={cn(
                              "flex-1 py-2 text-xs font-black rounded-lg border transition-all",
                              selectedDays === days 
                                ? "bg-tuggi-blue text-white border-tuggi-blue shadow-md" 
                                : "bg-white dark:bg-gray-800 text-gray-500 border-gray-200 dark:border-gray-700 hover:border-tuggi-blue/50"
                            )}
                          >
                            {days} {t('days_unit') || 'dias'}
                          </button>
                        ))}
                      </div>
                      
                      {selectedEndDate && (
                        <p className="mt-2 text-[10px] font-bold text-gray-400 uppercase tracking-widest text-center">
                          {t('expires_at')}: {new Date(selectedEndDate).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Linked Client (partner QR) */}
              <LinkedClientSection
                userId={user.user_id}
                linked={user.linked_client}
                onChanged={() => { void fetchDetail(); if (onUpdate) onUpdate() }}
              />

              {/* Subscription History */}
              {user.subscription_history && user.subscription_history.length > 0 && (
                <div>
                  <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-3 flex items-center">
                    <Activity className="h-4 w-4 mr-2" />
                    {t('history')}
                  </h3>
                  <div className="space-y-2">
                    {user.subscription_history.map((h, i) => (
                      <div key={h.id || i} className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-800/50 rounded-lg text-sm">
                        <div className="flex items-center gap-2">
                          <span className={cn(
                            "px-2 py-0.5 rounded text-xs font-bold uppercase",
                            h.action === 'subscribe' ? 'bg-green-100 text-green-700' :
                            h.action === 'renew' ? 'bg-blue-100 text-blue-700' :
                            h.action === 'upgrade' ? 'bg-purple-100 text-purple-700' :
                            h.action === 'downgrade' ? 'bg-yellow-100 text-yellow-700' :
                            'bg-red-100 text-red-700'
                          )}>
                            {h.action}
                          </span>
                          <span className="text-gray-600 dark:text-gray-400">{h.tier_name}</span>
                          {h.previous_tier_name && (
                            <span className="text-gray-400">← {h.previous_tier_name}</span>
                          )}
                        </div>
                        <span className="text-gray-400 text-xs">
                          {new Date(h.created_at).toLocaleDateString()}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Timestamps */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm text-gray-500 border-t border-gray-200 dark:border-gray-700 pt-4">
                <div>
                  <p className="text-xs">{t('created_at')}</p>
                  <p className="font-medium text-gray-700 dark:text-gray-300">
                    {new Date(user.created_at).toLocaleDateString()}
                  </p>
                </div>
                <div>
                  <p className="text-xs">{t('last_login')}</p>
                  <p className="font-medium text-gray-700 dark:text-gray-300">
                    {user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleDateString() : t('never')}
                  </p>
                </div>
                <div>
                  <p className="text-xs">{t('last_trip')}</p>
                  <p className="font-medium text-gray-700 dark:text-gray-300">
                    {user.last_trip_at ? new Date(user.last_trip_at).toLocaleDateString() : t('never')}
                  </p>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="p-6 border-t border-gray-200 dark:border-gray-700 flex justify-end">
              <button
                onClick={onClose}
                className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              >
                {t('close')}
              </button>
            </div>
          </>
        ) : (
          <div className="p-12 text-center text-gray-500">
            {t('not_found')}
          </div>
        )}
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// MAIN PAGE
// ============================================================================

export default function AppUsersPage() {
  const t = useTranslations('Pages.AppUsers')
  const supabase = useSupabaseClient()
  const [users, setUsers] = useState<AppUser[]>([])
  const [subscriptionStats, setSubscriptionStats] = useState<SubscriptionStats | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  
  // Filters
  const [filterCountry, setFilterCountry] = useState<string>('')
  const [filterPlatform, setFilterPlatform] = useState<string>('')
  const [filterSubscription, setFilterSubscription] = useState<string>('')
  const [showFilters, setShowFilters] = useState(false)
  
  // Sorting
  const [sortConfig, setSortConfig] = useState<SortConfig>({ 
    key: 'last_sign_in_at', 
    direction: 'desc' 
  })

  // Fetch users
  const fetchUsers = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      
      // Fetch users with the new detailed RPC
      const { data, error } = await supabase
        .schema('core')
        .rpc('dashboard_app_users_detailed', { 
          limit_count: 200,
          filter_country: filterCountry || null,
          filter_platform: filterPlatform || null
        })

      if (error) {
        // Fallback to old RPC
        const { data: fallbackData, error: fallbackError } = await supabase
          .schema('core')
          .rpc('dashboard_user_sessions', { limit_count: 200 })
        
        if (fallbackError) throw fallbackError
        
        setUsers((fallbackData || []).map((u: any) => ({
          ...u,
          user_id: u.user_id,
          is_premium: false,
          subscription_tier_name: null,
          subscription_tier_display_name: null
        })))
        return
      }
      
      setUsers(data || [])
    } catch (err) {
      console.error('Error fetching app users:', err)
      setError(err instanceof Error ? err.message : t('table.load_error'))
    } finally {
      setIsLoading(false)
    }
  }, [supabase, filterCountry, filterPlatform])

  // Fetch subscription stats
  const fetchSubscriptionStats = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .schema('core')
        .rpc('dashboard_subscription_stats')

      if (error) throw error
      if (data && data.length > 0) {
        setSubscriptionStats(data[0])
      }
    } catch (err) {
      console.error('Error fetching subscription stats:', err)
    }
  }, [supabase])

  useEffect(() => {
    fetchUsers()
    fetchSubscriptionStats()
  }, [fetchUsers, fetchSubscriptionStats])

  const handleSort = (key: keyof AppUser) => {
    setSortConfig(current => ({
      key,
      direction: current.key === key && current.direction === 'desc' ? 'asc' : 'desc'
    }))
  }

  // Get unique countries for filter
  const countries = [...new Set(users.map(u => u.country).filter(Boolean))] as string[]
  
  // Apply search filter (country/platform filters are applied in RPC)
  const filteredUsers = users.filter(user => {
    const matchesSearch = 
      !searchQuery ||
      (user.full_name && user.full_name.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (user.nickname && user.nickname.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (user.email && user.email.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (user.country && user.country.toLowerCase().includes(searchQuery.toLowerCase()))
    
    const matchesSubscription = 
      !filterSubscription ||
      (filterSubscription === 'premium' && user.is_premium) ||
      (filterSubscription === 'free' && !user.is_premium)
    
    return matchesSearch && matchesSubscription
  })

  // Apply sorting
  const sortedUsers = [...filteredUsers].sort((a, b) => {
    const aValue = a[sortConfig.key]
    const bValue = b[sortConfig.key]

    if (aValue === bValue) return 0
    
    // Abstract null checks for dates/numbers
    if (aValue === null) return 1 // Nulls last
    if (bValue === null) return -1

    const comparison = aValue > bValue ? 1 : -1
    return sortConfig.direction === 'asc' ? comparison : -comparison
  })

  // Stats from subscription stats or computed
  const stats = subscriptionStats || {
    total_users: users.length,
    free_users: users.filter(u => !u.is_premium).length,
    premium_users: users.filter(u => u.is_premium).length,
    premium_percentage: users.length > 0 ? Math.round((users.filter(u => u.is_premium).length / users.length) * 100) : 0,
    apple_subscriptions: 0,
    google_subscriptions: 0,
    stripe_subscriptions: 0
  }

  const clearFilters = () => {
    setFilterCountry('')
    setFilterPlatform('')
    setFilterSubscription('')
    setSearchQuery('')
  }
  
  const SortIcon = ({ column }: { column: keyof AppUser }) => {
    if (sortConfig.key !== column) return <ArrowUpDown className="h-3 w-3 ml-1 text-gray-400" />
    return sortConfig.direction === 'asc' 
      ? <ArrowUp className="h-3 w-3 ml-1 text-tuggi-blue" />
      : <ArrowDown className="h-3 w-3 ml-1 text-tuggi-blue" />
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white flex items-center">
            <Smartphone className="h-8 w-8 mr-3 text-tuggi-blue" />
            {t('title')}
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            {t('subtitle')}
          </p>
        </div>
        
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={cn(
              "flex items-center px-4 py-2 rounded-lg border transition-colors",
              showFilters 
                ? "border-tuggi-blue bg-tuggi-blue/10 text-tuggi-blue" 
                : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
            )}
          >
            <Filter className="h-4 w-4 mr-2" />
            {t('filters.title')}
            <ChevronDown className={cn("h-4 w-4 ml-2 transition-transform", showFilters && "rotate-180")} />
          </button>
          
          <button
            onClick={() => { fetchUsers(); fetchSubscriptionStats(); }}
            disabled={isLoading}
            className="p-2 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn("h-5 w-5 text-gray-500", isLoading && "animate-spin")} />
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <StatCardRow columns={8} className="mb-6">
        <StatCard label={t('stats.total')} value={stats.total_users} icon={Smartphone} color="#00A8E8" isLoading={isLoading} />
        <StatCard label={t('stats.free')} value={stats.free_users} icon={User} color="#6B7280" isLoading={isLoading} />
        <StatCard 
          label={t('stats.premium')} 
          value={stats.premium_users} 
          icon={Crown} 
          color="#F59E0B" 
          subtitle={`${stats.premium_percentage}%`}
          isLoading={isLoading}
        />
        <StatCard label={t('stats.apple')} value={stats.apple_subscriptions} icon={Apple} color="#000000" isLoading={isLoading} />
        <StatCard label={t('stats.google')} value={stats.google_subscriptions} icon={Play} color="#34A853" isLoading={isLoading} />
        <StatCard label={t('stats.stripe')} value={stats.stripe_subscriptions} icon={Zap} color="#635BFF" isLoading={isLoading} />
        <StatCard 
          label={t('stats.new_7d')} 
          value={subscriptionStats?.new_subscriptions_7d || 0} 
          icon={TrendingUp} 
          color="#10B981" 
          isLoading={isLoading}
        />
        <StatCard 
          label={t('stats.churn_7d')} 
          value={subscriptionStats?.churned_7d || 0} 
          icon={AlertCircle} 
          color="#EF4444" 
          isLoading={isLoading}
        />
      </StatCardRow>

      {/* Filters Panel */}
      {showFilters && (
        <div className="mb-6 p-4 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 animate-in slide-in-from-top-2">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                {t('filters.country')}
              </label>
              <select
                value={filterCountry}
                onChange={(e) => setFilterCountry(e.target.value)}
                className="w-full px-4 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              >
                <option value="">{t('filters.all')}</option>
                {countries.map(country => (
                  <option key={country} value={country}>{country}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                {t('filters.platform')}
              </label>
              <select
                value={filterPlatform}
                onChange={(e) => setFilterPlatform(e.target.value)}
                className="w-full px-4 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              >
                <option value="">{t('filters.all_platforms')}</option>
                <option value="ios">iOS</option>
                <option value="android">Android</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                {t('filters.subscription')}
              </label>
              <select
                value={filterSubscription}
                onChange={(e) => setFilterSubscription(e.target.value)}
                className="w-full px-4 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              >
                <option value="">{t('filters.all_subscriptions')}</option>
                <option value="premium">Premium</option>
                <option value="free">Free</option>
              </select>
            </div>
            <div className="flex items-end">
              <button
                onClick={clearFilters}
                className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
              >
                {t('filters.clear')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('table.search_placeholder')}
            className="w-full pl-10 pr-4 py-3 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-tuggi-blue focus:border-transparent"
          />
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-red-600 dark:text-red-400 flex items-center">
          <AlertCircle className="h-5 w-5 mr-2 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Results count */}
      <p className="text-sm text-gray-500 mb-4">
        {t('table.results_info', { filtered: filteredUsers.length, total: users.length })}
      </p>

      {/* Users Table */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                <th 
                  className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider"
                >
                  {t('table.user')}
                </th>
                <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">{t('table.subscription')}</th>
                <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">{t('table.language')}</th>
                <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">{t('table.timezone')}</th>
                <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">{t('table.device')}</th>
                <th className="px-6 py-4 text-right text-xs font-bold text-gray-500 uppercase tracking-wider">{t('table.logins')}</th>
                <th 
                  className="px-6 py-4 text-right text-xs font-bold text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700/50"
                  onClick={() => handleSort('trip_count')}
                >
                  <div className="flex items-center justify-end">
                    {t('table.trips')}
                    <SortIcon column="trip_count" />
                  </div>
                </th>
                <th 
                  className="px-6 py-4 text-right text-xs font-bold text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700/50"
                  onClick={() => handleSort('created_at')}
                >
                  <div className="flex items-center justify-end">
                    {t('table.created_at')}
                    <SortIcon column="created_at" />
                  </div>
                </th>
                <th 
                  className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700/50"
                  onClick={() => handleSort('last_sign_in_at')}
                >
                  <div className="flex items-center">
                    {t('table.last_login')}
                    <SortIcon column="last_sign_in_at" />
                  </div>
                </th>
                <th className="px-6 py-4 text-center text-xs font-bold text-gray-500 uppercase tracking-wider">Passaporte</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {isLoading ? (
                [...Array(10)].map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td className="px-6 py-4"><div className="h-10 w-48 bg-gray-200 dark:bg-gray-700 rounded" /></td>
                    <td className="px-6 py-4"><div className="h-6 w-20 bg-gray-200 dark:bg-gray-700 rounded-full" /></td>
                    <td className="px-6 py-4"><div className="h-6 w-16 bg-gray-200 dark:bg-gray-700 rounded" /></td>
                    <td className="px-6 py-4"><div className="h-6 w-24 bg-gray-200 dark:bg-gray-700 rounded" /></td>
                    <td className="px-6 py-4"><div className="h-6 w-20 bg-gray-200 dark:bg-gray-700 rounded" /></td>
                    <td className="px-6 py-4"><div className="h-4 w-12 bg-gray-200 dark:bg-gray-700 rounded ml-auto" /></td>
                    <td className="px-6 py-4"><div className="h-4 w-8 bg-gray-200 dark:bg-gray-700 rounded ml-auto" /></td>
                    <td className="px-6 py-4"><div className="h-4 w-24 bg-gray-200 dark:bg-gray-700 rounded ml-auto" /></td>
                    <td className="px-6 py-4"><div className="h-4 w-24 bg-gray-200 dark:bg-gray-700 rounded" /></td>
                  </tr>
                ))
              ) : sortedUsers.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-6 py-12 text-center text-gray-500">
                    {t('table.no_results')}
                  </td>
                </tr>
              ) : (
                sortedUsers.map((user) => (
                  <tr 
                    key={user.user_id} 
                    className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors cursor-pointer"
                    onClick={() => setSelectedUserId(user.user_id)}
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center">
                        <div className="h-10 w-10 rounded-full bg-gradient-to-br from-tuggi-blue to-purple-500 flex items-center justify-center text-white font-bold mr-3">
                          {(user.full_name || user.nickname || 'U').charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-medium text-gray-900 dark:text-white">
                            {user.full_name || t('modal.unnamed')}
                          </p>
                          <p className="text-sm text-gray-500">
                            {user.email || `@${user.nickname || 'none'}`}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <SubscriptionBadge isPremium={user.is_premium} tierName={user.subscription_tier_display_name} />
                        <ProviderIcon provider={user.subscription_provider} />
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded text-xs font-bold text-gray-600 dark:text-gray-400 uppercase">
                        {user.language || 'N/A'}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-xs text-gray-500">
                        {user.timezone || 'N/A'}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col">
                        <span className={cn(
                          "px-2 py-0.5 rounded text-xs font-bold w-fit",
                          user.last_platform === 'ios' ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400' : 
                          user.last_platform === 'android' ? 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400' : 
                          'bg-gray-100 text-gray-500'
                        )}>
                          {user.last_platform || 'N/A'}
                        </span>
                        {user.last_device_model && (
                          <span className="text-xs text-gray-400 mt-1 truncate max-w-[120px]">
                            {user.last_device_model}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right font-medium text-gray-700 dark:text-gray-300">
                      {user.login_count || 0}
                    </td>
                    <td className="px-6 py-4 text-right font-bold text-gray-900 dark:text-white">
                      {user.trip_count || 0}
                    </td>
                    <td className="px-6 py-4 text-right text-sm text-gray-500">
                      {user.created_at 
                        ? new Date(user.created_at).toLocaleDateString()
                        : 'N/A'
                      }
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {user.last_sign_in_at 
                        ? new Date(user.last_sign_in_at).toLocaleDateString()
                        : t('modal.never')
                      }
                    </td>
                    <td className="px-6 py-4 text-center">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          window.location.href = `/admin/users/${user.user_id}`;
                        }}
                        className="p-2 bg-orange-100 hover:bg-orange-200 text-orange-600 rounded-xl transition-all duration-300 hover:scale-110 shadow-sm"
                        title="Ver Passaporte"
                      >
                        <Plane className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* User Detail Modal */}
      <UserDetailModal 
        userId={selectedUserId} 
        onClose={() => setSelectedUserId(null)}
        supabase={supabase}
        onUpdate={() => {
          fetchUsers();
          fetchSubscriptionStats();
        }}
      />
    </div>
  )
}
