'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useSupabaseClient } from '@supabase/auth-helpers-react'
import {
  Smartphone, Search, RefreshCw, Filter, AlertCircle, ChevronDown,
  User, UserPlus, Activity, ShoppingBag, CalendarClock, Headphones,
  ArrowUpDown, ArrowUp, ArrowDown
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { StatCard, StatCardRow } from '@/components/ui/StatCard'
import { Button } from '@/components/ui/button'
import { GrantCreditDialog } from '@/components/admin/credit/GrantCreditDialog'
import type { GrantTarget } from '@/components/admin/credit/types'
import { AppUserDeepLink, AppUserLink } from '@/components/dashboard/AppUserLink'
import { useCmsUser } from '@/lib/hooks/useCmsUser'
import { appUserInitial } from '@/lib/format/user-identity'
import { useLocale, useTranslations } from 'next-intl'
import { APP_USER_PARAM, APP_USER_TAB_PARAM, appUserListHref, appUserTab } from '@/lib/users/app-user-href'
import {
  ACCESS_LEVELS, accessBadge, accessLevelOf, matchesAccessFilter, purchasedShare, storeDetailKey,
  type AppUserStats,
} from '@/lib/users/app-user-access'

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
  login_count: number
  last_sign_in_at: string | null
  created_at: string
  onboarding_completed: boolean
  trip_count: number
  total_km: number
  poi_visits_count: number
  last_trip_at: string | null
  /** `free` | `purchased` | `until`, decided by the database (#979, contract Part 13). */
  access_level: string | null
  /** `app_store` | `play_store` | null; the newest real purchase, SANDBOX ignored. */
  purchase_store: string | null
  minutes_consumed: number
}

type SortConfig = {
  key: keyof AppUser
  direction: 'asc' | 'desc'
}


/**
 * The record opened from the address, `?user=<id>&tab=<tab>` (#976): the link an operator shares,
 * and where the old Passaporte page `/admin/users/<id>` redirects. Closing takes the two drawer
 * parameters off and keeps the rest. Its own component because `useSearchParams` needs a
 * Suspense boundary, and the list should not wait on one.
 */
function DrawerFromAddress({ onUpdate }: { onUpdate: () => void }) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const locale = useLocale()
  const userId = searchParams.get(APP_USER_PARAM)?.trim()
  if (!userId) return null

  return (
    <AppUserDeepLink
      userId={userId}
      tab={appUserTab(searchParams.get(APP_USER_TAB_PARAM))}
      onClose={() => router.replace(appUserListHref(new URLSearchParams(searchParams.toString()), locale), { scroll: false })}
      onUpdate={onUpdate}
    />
  )
}

/** The access level badge, and for a purchase the store as a small detail under it (#979). */
function AccessLevelCell({ level: raw, store }: { level: string | null; store: string | null }) {
  const t = useTranslations('Pages.AppUsers.access')
  const level = accessLevelOf(raw)
  if (!level) return <span className="text-xs text-gray-400">{t('unknown')}</span>

  const badge = accessBadge(level)
  const storeKey = storeDetailKey(level, store)
  return (
    <div className="flex flex-col">
      <span className={cn('w-fit whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold', badge.className)}>
        {t(badge.labelKey)}
      </span>
      {storeKey && <span className="mt-1 text-xs text-gray-500">{t(storeKey)}</span>}
    </div>
  )
}

// ============================================================================
// MAIN PAGE
// ============================================================================

export default function AppUsersPage() {
  const t = useTranslations('Pages.AppUsers')
  const tCredit = useTranslations('Pages.AppUsers.credit')
  const supabase = useSupabaseClient()
  const [users, setUsers] = useState<AppUser[]>([])
  const [stats, setStats] = useState<AppUserStats | null>(null)
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
  const [filterAccess, setFilterAccess] = useState<string>('')
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
      
      // The whole base, not a page of it: the search filters in the browser, so an account left
      // out of this payload is an account the operator cannot find (#975). The RPC ends in
      // `LIMIT limit_count`, and `LIMIT NULL` in Postgres means no limit. Move paging and search
      // to the server once the base outgrows a single payload (BR-USUARIO-042, item 3).
      const { data, error } = await supabase
        .schema('core')
        .rpc('dashboard_app_users_detailed', {
          limit_count: null,
          filter_country: filterCountry || null,
          filter_platform: filterPlatform || null
        })

      // No fallback to another RPC: a list without `access_level` would show every tourist with
      // no level at all, and an error the operator sees beats a column that quietly lies.
      if (error) throw error

      setUsers(data || [])
    } catch (err) {
      console.error('Error fetching app users:', err)
      setError(err instanceof Error ? err.message : t('table.load_error'))
    } finally {
      setIsLoading(false)
    }
  }, [supabase, filterCountry, filterPlatform])

  // The big numbers. They exclude test accounts (`excluded_from_metrics`) and the list does not,
  // so they are never recomputed from `users`: a missing row shows the skeleton, not a guess.
  const fetchStats = useCallback(async () => {
    const { data, error } = await supabase
      .schema('core')
      .rpc('dashboard_app_user_stats')

    if (error) {
      console.error('Error fetching app user stats:', error.message)
      return
    }
    setStats(Array.isArray(data) && data.length > 0 ? data[0] : null)
  }, [supabase])

  const refreshAll = useCallback(() => {
    fetchUsers()
    fetchStats()
  }, [fetchUsers, fetchStats])

  useEffect(() => {
    refreshAll()
  }, [refreshAll])

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
    
    return matchesSearch && matchesAccessFilter(user.access_level, filterAccess)
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
    setFilterAccess('')
    setSearchQuery('')
  }
  
  const SortIcon = ({ column }: { column: keyof AppUser }) => {
    if (sortConfig.key !== column) return <ArrowUpDown className="h-3 w-3 ml-1 text-gray-400" />
    return sortConfig.direction === 'asc' 
      ? <ArrowUp className="h-3 w-3 ml-1 text-tuggi-blue" />
      : <ArrowDown className="h-3 w-3 ml-1 text-tuggi-blue" />
  }

  return (
    <div className="cms-width min-h-screen bg-gray-50 dark:bg-gray-950 p-6 lg:p-8">
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
            onClick={refreshAll}
            disabled={isLoading}
            className="p-2 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn("h-5 w-5 text-gray-500", isLoading && "animate-spin")} />
          </button>
        </div>
      </div>

      {/* Big numbers (#979). Read from `dashboard_app_user_stats`; the three levels add up to the total. */}
      <StatCardRow columns={7} className="mb-6">
        <StatCard
          label={t('stats.total')}
          value={stats?.total_users ?? 0}
          subtitle={stats ? t('stats.total_detail', { ios: stats.ios_users, android: stats.android_users }) : undefined}
          icon={Smartphone}
          color="#00A8E8"
          isLoading={isLoading || !stats}
        />
        <StatCard label={t('stats.new_7d')} value={stats?.new_users_7d ?? 0} icon={UserPlus} color="#10B981" isLoading={isLoading || !stats} />
        <StatCard label={t('stats.active_7d')} value={stats?.active_users_7d ?? 0} icon={Activity} color="#6366F1" isLoading={isLoading || !stats} />
        <StatCard label={t('stats.free_only')} value={stats?.free_users ?? 0} icon={User} color="#6B7280" isLoading={isLoading || !stats} />
        <StatCard
          label={t('stats.purchased')}
          value={stats?.purchased_users ?? 0}
          subtitle={stats ? t('stats.purchased_detail', {
            share: purchasedShare(stats),
            appStore: stats.purchased_app_store_users,
            playStore: stats.purchased_play_store_users,
          }) : undefined}
          icon={ShoppingBag}
          color="#059669"
          isLoading={isLoading || !stats}
        />
        <StatCard label={t('stats.until')} value={stats?.until_users ?? 0} icon={CalendarClock} color="#F59E0B" isLoading={isLoading || !stats} />
        <StatCard label={t('stats.consumed')} value={stats?.consumed_users ?? 0} icon={Headphones} color="#8B5CF6" isLoading={isLoading || !stats} />
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
                {t('filters.access')}
              </label>
              <select
                value={filterAccess}
                onChange={(e) => setFilterAccess(e.target.value)}
                className="w-full px-4 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              >
                <option value="">{t('filters.all_access')}</option>
                {ACCESS_LEVELS.map((level) => (
                  <option key={level} value={level}>{t(`access.${accessBadge(level).labelKey}`)}</option>
                ))}
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
        {/* The count lives inside the search block: a bare <p> as a direct child of the page
            rendered outside the content grid (operator, 2026-10-19). */}
        <p className="mt-3 text-sm text-gray-500">
          {t('table.results_info', { filtered: filteredUsers.length, total: users.length })}
        </p>
      </div>

      {/* Error State */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-red-600 dark:text-red-400 flex items-center">
          <AlertCircle className="h-5 w-5 mr-2 flex-shrink-0" />
          {error}
        </div>
      )}


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
                <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">{t('table.access')}</th>
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
                  <td colSpan={isAdmin ? 10 : 9} className="px-6 py-12 text-center text-gray-500">
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
                            onUpdate={refreshAll}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <AccessLevelCell level={user.access_level} store={user.purchase_store} />
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
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Suspense fallback={null}>
        <DrawerFromAddress onUpdate={refreshAll} />
      </Suspense>

      {/* Batch grant, from the selection. Same dialog as the individual grant. */}
      {batchOpen ? (
        <GrantCreditDialog
          targets={batchTargets}
          onClose={() => setBatchOpen(false)}
          onGranted={() => {
            setSelectedIds([])
            refreshAll()
          }}
        />
      ) : null}
    </div>
  )
}
