'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSupabaseClient } from '@supabase/auth-helpers-react'
import {
  Smartphone, Search, RefreshCw, Filter, Crown,
  TrendingUp, AlertCircle, ChevronDown,
  Apple, Zap, User, Play, Plane, ArrowUpDown, ArrowUp, ArrowDown
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { StatCard, StatCardRow } from '@/components/ui/StatCard'
import { SubscriptionBadge, ProviderIcon } from '@/components/ui/SubscriptionBadge'
import { Button } from '@/components/ui/button'
import { GrantCreditDialog } from '@/components/admin/credit/GrantCreditDialog'
import type { GrantTarget } from '@/components/admin/credit/types'
import { AppUserLink } from '@/components/dashboard/AppUserLink'
import { useCmsUser } from '@/lib/hooks/useCmsUser'
import { appUserInitial } from '@/lib/format/user-identity'
import { useTranslations } from 'next-intl'

// ============================================================================
// TYPES
// ============================================================================

/**
 * One tourist, as the old `dashboard_app_users_detailed` RPC still returns them.
 *
 * `full_name` and `email` stay in the type and stay out of the screen — **BR-USUARIO-042**.
 * `full_name` is now read by exactly one thing and it is not display: the search box, because
 * filtering is not showing (item 3, and the operator finds the account by the name or the
 * address the tourist gave him). `email` is read by the search box too and by ONE screen —
 * the manual grant confirmation, `GrantTarget` — which is the single nominal exception to the
 * rule, opened by the founder on 2026-09-01 (the rule's 4th edge case). When phase 2 drops
 * `full_name` from the payload the search has to move to the server on the same wave, or it
 * goes quiet without breaking a single screen; `email` stays for the exception.
 */
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

type SortConfig = {
  key: keyof AppUser
  direction: 'asc' | 'desc'
}


// ============================================================================
// MAIN PAGE
// ============================================================================

export default function AppUsersPage() {
  const t = useTranslations('Pages.AppUsers')
  const tCredit = useTranslations('Pages.AppUsers.credit')
  const supabase = useSupabaseClient()
  const [users, setUsers] = useState<AppUser[]>([])
  const [subscriptionStats, setSubscriptionStats] = useState<SubscriptionStats | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Batch grant (card #310). The batch is born from the SELECTION in this list and only
  // from it: every recipient is an account that already exists and that the operator has
  // seen. Pasted e-mails would introduce a new class of error — an address that matches no
  // account — with a resolution screen of its own, and that is a different card.
  const { isAdmin } = useCmsUser()
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [batchOpen, setBatchOpen] = useState(false)
  
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

  // Selection follows the rows the filters left visible; nothing hidden is ever selected.
  const visibleIds = sortedUsers.map((user) => user.user_id)
  const selectedVisibleIds = selectedIds.filter((id) => visibleIds.includes(id))
  const allVisibleSelected = visibleIds.length > 0 && selectedVisibleIds.length === visibleIds.length

  const toggleUser = (userId: string) => {
    setSelectedIds((current) =>
      current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId]
    )
  }

  const toggleAllVisible = () => {
    setSelectedIds(allVisibleSelected ? [] : visibleIds)
  }

  const batchTargets: GrantTarget[] = selectedVisibleIds.map((id) => {
    const user = users.find((candidate) => candidate.user_id === id)
    return { userId: id, nickname: user?.nickname ?? null, email: user?.email ?? null }
  })

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

      {/* Selection bar. The button carries the count — never "Confirmar", never "OK". */}
      {isAdmin && selectedVisibleIds.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl bg-tuggi-blue/10 px-4 py-3">
          <span className="text-sm font-bold text-gray-900 dark:text-white">
            {tCredit('batch.selected', { count: selectedVisibleIds.length })}
          </span>
          <Button size="sm" onClick={() => setBatchOpen(true)}>
            {tCredit('batch.cta', { count: selectedVisibleIds.length })}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setSelectedIds([])}>
            {tCredit('batch.clear')}
          </Button>
        </div>
      )}

      {/* Users Table */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                {isAdmin && (
                  <th className="w-12 px-3 py-4">
                    {/* 24 x 24 px target — WCAG 2.2 SC 2.5.8. */}
                    <input
                      type="checkbox"
                      className="h-6 w-6 cursor-pointer align-middle"
                      aria-label={tCredit('batch.select_all')}
                      checked={allVisibleSelected}
                      onChange={toggleAllVisible}
                    />
                  </th>
                )}
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
                    {isAdmin && <td className="px-3 py-4"><div className="h-6 w-6 bg-gray-200 dark:bg-gray-700 rounded" /></td>}
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
                  <td colSpan={isAdmin ? 11 : 10} className="px-6 py-12 text-center text-gray-500">
                    {t('table.no_results')}
                  </td>
                </tr>
              ) : (
                sortedUsers.map((user) => (
                  <tr
                    key={user.user_id}
                    className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                  >
                    {isAdmin && (
                      <td className="px-3 py-4">
                        <input
                          type="checkbox"
                          className="h-6 w-6 cursor-pointer align-middle"
                          aria-label={tCredit('batch.select_user')}
                          checked={selectedIds.includes(user.user_id)}
                          onChange={() => toggleUser(user.user_id)}
                        />
                      </td>
                    )}
                    <td className="px-6 py-4">
                      <div className="flex items-center">
                        <div className="h-10 w-10 rounded-full bg-gradient-to-br from-tuggi-blue to-purple-500 flex items-center justify-center text-white font-bold mr-3">
                          {appUserInitial(user)}
                        </div>
                        <div className="min-w-0">
                          <AppUserLink
                            user={user}
                            className="block font-medium text-gray-900 dark:text-white truncate max-w-full"
                            onUpdate={() => { fetchUsers(); fetchSubscriptionStats() }}
                          />
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
                        type="button"
                        onClick={() => { window.location.href = `/admin/users/${user.user_id}` }}
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

      {/* Batch grant, from the selection. Same dialog as the individual grant. */}
      {batchOpen ? (
        <GrantCreditDialog
          targets={batchTargets}
          onClose={() => setBatchOpen(false)}
          onGranted={() => {
            setSelectedIds([])
            fetchUsers()
            fetchSubscriptionStats()
          }}
        />
      ) : null}
    </div>
  )
}
