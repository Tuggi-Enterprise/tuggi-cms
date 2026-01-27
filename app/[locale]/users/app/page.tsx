'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSupabaseClient } from '@supabase/auth-helpers-react'
import { 
  Smartphone, Search, RefreshCw, Filter, Crown, 
  CreditCard, TrendingUp, AlertCircle, ChevronDown,
  Apple, Zap, User, Activity, Mail, Play
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { StatCard, StatCardRow } from '@/components/ui/StatCard'
import { SubscriptionBadge, ProviderIcon, PlatformBadge } from '@/components/ui/SubscriptionBadge'

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
}

// ============================================================================
// USER DETAIL MODAL
// ============================================================================

const UserDetailModal = ({ 
  userId,
  onClose,
  supabase
}: { 
  userId: string | null
  onClose: () => void
  supabase: any
}) => {
  const [user, setUser] = useState<UserDetail | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (!userId) {
      setUser(null)
      return
    }

    const fetchDetail = async () => {
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
    }

    fetchDetail()
  }, [userId, supabase])

  if (!userId) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div 
        className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-3xl mx-4 max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-300"
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
                      {user.full_name || 'Sem nome'}
                      <SubscriptionBadge isPremium={user.is_premium} tierName={user.subscription_tier_display_name} />
                    </h2>
                    <p className="text-gray-500">@{user.nickname || 'sem-nickname'}</p>
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
              <div className="grid grid-cols-4 gap-4">
                <div className="text-center p-4 bg-tuggi-blue/10 rounded-xl">
                  <p className="text-2xl font-black text-tuggi-blue">{user.trip_count || 0}</p>
                  <p className="text-xs text-gray-500">Trips</p>
                </div>
                <div className="text-center p-4 bg-green-500/10 rounded-xl">
                  <p className="text-2xl font-black text-green-600">{user.poi_visits_count || 0}</p>
                  <p className="text-xs text-gray-500">POI Visits</p>
                </div>
                <div className="text-center p-4 bg-purple-500/10 rounded-xl">
                  <p className="text-2xl font-black text-purple-600">{Math.round(user.total_km || 0)}</p>
                  <p className="text-xs text-gray-500">KM</p>
                </div>
                <div className="text-center p-4 bg-orange-500/10 rounded-xl">
                  <p className="text-2xl font-black text-orange-600">{user.unique_cities_visited || 0}</p>
                  <p className="text-xs text-gray-500">Cidades</p>
                </div>
              </div>

              {/* Info Grid */}
              <div className="grid grid-cols-2 gap-6">
                {/* Profile Info */}
                <div className="space-y-3">
                  <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 flex items-center">
                    <User className="h-4 w-4 mr-2" />
                    Perfil
                  </h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-500">País</span>
                      <span className="font-medium text-gray-900 dark:text-white">{user.country || 'N/A'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Idioma</span>
                      <span className="font-medium text-gray-900 dark:text-white">{user.language || 'N/A'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Driver Type</span>
                      <span className="font-medium text-gray-900 dark:text-white">{user.driver_type || 'N/A'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Voz</span>
                      <span className="font-medium text-gray-900 dark:text-white">{user.voice_preference || 'N/A'}</span>
                    </div>
                  </div>
                </div>

                {/* Device Info */}
                <div className="space-y-3">
                  <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 flex items-center">
                    <Smartphone className="h-4 w-4 mr-2" />
                    Dispositivo
                  </h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Plataforma</span>
                      <span className={cn(
                        "px-2 py-0.5 rounded text-xs font-bold",
                        user.last_platform === 'ios' ? 'bg-blue-100 text-blue-700' : 
                        user.last_platform === 'android' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'
                      )}>
                        {user.last_platform || 'N/A'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Modelo</span>
                      <span className="font-medium text-gray-900 dark:text-white">{user.last_device_model || 'N/A'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">App Version</span>
                      <span className="font-medium text-gray-900 dark:text-white">{user.last_app_version || 'N/A'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Logins</span>
                      <span className="font-medium text-gray-900 dark:text-white">{user.login_count || 0}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Subscription */}
              <div className="p-4 bg-gradient-to-r from-gray-50 to-gray-100 dark:from-gray-800/50 dark:to-gray-800 rounded-xl">
                <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-3 flex items-center">
                  <CreditCard className="h-4 w-4 mr-2" />
                  Assinatura
                </h3>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <p className="text-xs text-gray-500">Tier</p>
                    <p className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
                      {user.is_premium ? (
                        <>
                          <Crown className="h-4 w-4 text-yellow-500" />
                          {user.subscription_tier_display_name || 'Premium'}
                        </>
                      ) : (
                        'Free'
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Provider</p>
                    <p className="font-medium text-gray-900 dark:text-white flex items-center gap-1">
                      <ProviderIcon provider={user.subscription_provider} />
                      {user.subscription_provider || 'N/A'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Vence em</p>
                    <p className="font-medium text-gray-900 dark:text-white">
                      {user.subscription_end_date 
                        ? new Date(user.subscription_end_date).toLocaleDateString('pt-BR')
                        : 'N/A'
                      }
                    </p>
                  </div>
                </div>
              </div>

              {/* Subscription History */}
              {user.subscription_history && user.subscription_history.length > 0 && (
                <div>
                  <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-3 flex items-center">
                    <Activity className="h-4 w-4 mr-2" />
                    Histórico de Assinatura
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
                          {new Date(h.created_at).toLocaleDateString('pt-BR')}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Timestamps */}
              <div className="grid grid-cols-3 gap-4 text-sm text-gray-500 border-t border-gray-200 dark:border-gray-700 pt-4">
                <div>
                  <p className="text-xs">Cadastro</p>
                  <p className="font-medium text-gray-700 dark:text-gray-300">
                    {new Date(user.created_at).toLocaleDateString('pt-BR')}
                  </p>
                </div>
                <div>
                  <p className="text-xs">Último login</p>
                  <p className="font-medium text-gray-700 dark:text-gray-300">
                    {user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleDateString('pt-BR') : 'Nunca'}
                  </p>
                </div>
                <div>
                  <p className="text-xs">Última trip</p>
                  <p className="font-medium text-gray-700 dark:text-gray-300">
                    {user.last_trip_at ? new Date(user.last_trip_at).toLocaleDateString('pt-BR') : 'Nunca'}
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
                Fechar
              </button>
            </div>
          </>
        ) : (
          <div className="p-12 text-center text-gray-500">
            Usuário não encontrado
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// MAIN PAGE
// ============================================================================

export default function AppUsersPage() {
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
      setError(err instanceof Error ? err.message : 'Erro ao carregar usuários')
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

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-black text-gray-900 dark:text-white flex items-center">
            <Smartphone className="h-8 w-8 mr-3 text-tuggi-blue" />
            App Users
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Usuários do aplicativo Tuggi com dados de assinatura
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
            Filtros
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
      {/* Stats Cards */}
      <StatCardRow columns={8} className="mb-6">
        <StatCard label="Total" value={stats.total_users} icon={Smartphone} color="#00A8E8" isLoading={isLoading} />
        <StatCard label="Free" value={stats.free_users} icon={User} color="#6B7280" isLoading={isLoading} />
        <StatCard 
          label="Premium" 
          value={stats.premium_users} 
          icon={Crown} 
          color="#F59E0B" 
          subtitle={`${stats.premium_percentage}%`}
          isLoading={isLoading}
        />
        <StatCard label="Apple" value={stats.apple_subscriptions} icon={Apple} color="#000000" isLoading={isLoading} />
        <StatCard label="Google" value={stats.google_subscriptions} icon={Play} color="#34A853" isLoading={isLoading} />
        <StatCard label="Stripe" value={stats.stripe_subscriptions} icon={Zap} color="#635BFF" isLoading={isLoading} />
        <StatCard 
          label="Novos (7d)" 
          value={subscriptionStats?.new_subscriptions_7d || 0} 
          icon={TrendingUp} 
          color="#10B981" 
          isLoading={isLoading}
        />
        <StatCard 
          label="Churn (7d)" 
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
                País
              </label>
              <select
                value={filterCountry}
                onChange={(e) => setFilterCountry(e.target.value)}
                className="w-full px-4 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              >
                <option value="">Todos</option>
                {countries.map(country => (
                  <option key={country} value={country}>{country}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                Plataforma
              </label>
              <select
                value={filterPlatform}
                onChange={(e) => setFilterPlatform(e.target.value)}
                className="w-full px-4 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              >
                <option value="">Todas</option>
                <option value="ios">iOS</option>
                <option value="android">Android</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                Assinatura
              </label>
              <select
                value={filterSubscription}
                onChange={(e) => setFilterSubscription(e.target.value)}
                className="w-full px-4 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              >
                <option value="">Todas</option>
                <option value="premium">Premium</option>
                <option value="free">Free</option>
              </select>
            </div>
            <div className="flex items-end">
              <button
                onClick={clearFilters}
                className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
              >
                Limpar filtros
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
            placeholder="Buscar por nome, email, nickname ou país..."
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
        Mostrando {filteredUsers.length} de {users.length} usuários
      </p>

      {/* Users Table */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Usuário</th>
                <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Assinatura</th>
                <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">País</th>
                <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Device</th>
                <th className="px-6 py-4 text-right text-xs font-bold text-gray-500 uppercase tracking-wider">Trips</th>
                <th className="px-6 py-4 text-right text-xs font-bold text-gray-500 uppercase tracking-wider">Visits</th>
                <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Último Login</th>
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
                    <td className="px-6 py-4"><div className="h-4 w-8 bg-gray-200 dark:bg-gray-700 rounded ml-auto" /></td>
                    <td className="px-6 py-4"><div className="h-4 w-8 bg-gray-200 dark:bg-gray-700 rounded ml-auto" /></td>
                    <td className="px-6 py-4"><div className="h-4 w-24 bg-gray-200 dark:bg-gray-700 rounded" /></td>
                  </tr>
                ))
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-gray-500">
                    Nenhum usuário encontrado
                  </td>
                </tr>
              ) : (
                filteredUsers.map((user) => (
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
                            {user.full_name || 'Sem nome'}
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
                        {user.country || 'N/A'}
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
                    <td className="px-6 py-4 text-right font-bold text-gray-900 dark:text-white">
                      {user.trip_count || 0}
                    </td>
                    <td className="px-6 py-4 text-right font-bold text-tuggi-blue">
                      {user.poi_visits_count || 0}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {user.last_sign_in_at 
                        ? new Date(user.last_sign_in_at).toLocaleDateString('pt-BR')
                        : 'Nunca'
                      }
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
      />
    </div>
  )
}
