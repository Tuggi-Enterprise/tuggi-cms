/**
 * Dashboard Service - V4 com inventory_details e cidades normalizadas
 * 
 * RPCs disponíveis:
 * - dashboard_user_analytics: Métricas de usuários e trips (MAU em ordem ASC)
 * - dashboard_recent_visited_pois: Últimos POIs visitados
 * - dashboard_top_visited_pois: POIs mais visitados (agregado)
 * - dashboard_most_visited_cities: Cidades mais visitadas (normalizado)
 * - dashboard_city_stats: POIs por cidade (normalizado)
 * - dashboard_inventory_funnel: Funil Core + Homolog
 * - dashboard_content_quality: Qualidade por idioma
 * - dashboard_inventory_details: Detalhes completos do inventário
 * - dashboard_user_sessions: Usuários com dados de trip
 * - dashboard_heatmap_data: Dados para heatmap
 */

import { getSupabaseClient } from '@/lib/core/supabase-client'
import { nameMatchFilter } from '@/lib/shared/name-search'

// ============================================================================
// TRANSPORTE
// ============================================================================

/**
 * SEC-37 — as sete leituras que devolvem identificador ou localização de pessoa
 * (`realtime_activity`, `waitlist_stats`, `waitlist_pins`, `content_quality`,
 * `inventory_funnel`, `top_generators`, `top_visited_pois`) saem por `app/api/dashboard/*`,
 * onde `withAuth({ roles: ['admin'] })` confere sessão e papel **no servidor**. O parse
 * continua aqui: a rota devolve o resultado cru da RPC.
 *
 * As demais ainda falam com o PostgREST pelo cliente de browser ligado ao cookie
 * (`getSupabaseClient()`), que carimba o JWT do operador. O que sumiu foi o
 * `getSupabase('server')` — chave publicável sem sessão, ou seja, `anon`.
 */
interface RpcResult<T> {
  data: T | null
  error: { message: string } | null
}

/**
 * GET numa rota do próprio CMS, com o cookie de sessão.
 *
 * Caminho relativo de propósito: estas chamadas são de tela, e uma execução no
 * servidor tem de falhar alto em vez de escolher outra identidade sozinha — foi
 * exatamente o `typeof window ? ... : anon` que produziu as 269 chamadas anônimas.
 */
async function fetchDashboardRoute<T>(path: string): Promise<RpcResult<T>> {
  if (typeof window === 'undefined') {
    return { data: null, error: { message: `${path} requires the operator session; it has no server-side caller` } }
  }

  const response = await fetch(path, { credentials: 'same-origin' })
  const body = await response.json().catch(() => null)

  if (!response.ok) {
    const message = (body && typeof body.error === 'string' && body.error) || `HTTP ${response.status}`
    return { data: null, error: { message } }
  }

  return { data: (body?.data ?? null) as T | null, error: null }
}

// ============================================================================
// TIPOS
// ============================================================================

export interface DashboardStats {
  // POI Inventory
  totalPOIs: number
  approvedPOIs: number
  pendingPOIs: number
  homologPOIs: number
  totalInventory: number
  approvalRate: number
  
  // Content Quality
  languagesBreakdown: Array<{ language: string; count: number }>
  withAudio: number
  contentCoverage: number
  citiesCovered: number
  
  // User Analytics
  totalUsers: number
  activeUsers30d: number
  totalTrips: number
  totalKmDriven: number
  totalPOIVisits: number
  totalAudioPlays: number
  avgTripDuration: string
  tripsByPlatform: Array<{ platform: string; count: number }>
  totalPremiumUsers: number
  upcomingExpirations: Array<{
    user_id: string
    full_name: string
    email: string
    tier_name: string
    end_date: string
  }>
  
  // Temporal Data (últimos 30 dias - rolling window)
  mauHistory: Array<{ date: string; count: number }>
  userGrowth: Array<{ month: string; count: number }>
  recentAppActivity: Array<{
    user_id: string
    name: string
    last_activity: string
    duration_minutes: number
    platform: string
  }>
  
  // Geographic - POIs por cidade
  cityDistribution: Array<{ city: string; country: string; poi_count: number; approved_count: number }>
  countryDistribution: Array<{ country: string; poi_count: number; city_count: number }>
  
  // Geographic - Cidades mais visitadas
  mostVisitedCities: Array<{ city: string; country: string; visit_count: number; audio_plays: number; unique_visitors: number }>
  
  // Top POIs mais visitados (agregado)
  topVisitedPOIs: Array<{ 
    poi_id: string
    poi_name: string
    city: string
    country: string
    category: string
    total_visits: number
    audio_plays: number
    unique_visitors: number 
  }>
  
  // Últimos POIs visitados (recentes)
  recentVisitedPOIs: Array<{
    visit_id: string
    poi_id: string
    poi_name: string
    poi_city: string
    poi_country: string
    poi_category: string
    user_nickname: string
    visit_timestamp: string
    audio_played: boolean
    visit_source: string
    platform: string
    audio_language: string
  }>

  // Visits by Language
  visitsByLanguage: Array<{ language_code: string; visit_count: number; audio_played_count: number }>
  
  // Migration Analytics
  migrationMetrics: {
    monthly: Array<{ month: string; volume: number; avg_seconds: number }>
    overallAvgSeconds: number
    recentAvgSeconds: number
    recentVolume: number
  }
  
  // Content Generators
  topGenerators: Array<{
    user_id: string
    nickname: string
    content_count: number
  }>
  
  // Metadata
  lastUpdated: Date
  source: 'cache' | 'database'
}

export const EMPTY_DASHBOARD_STATS: DashboardStats = {
  totalPOIs: 0,
  approvedPOIs: 0,
  pendingPOIs: 0,
  homologPOIs: 0,
  totalInventory: 0,
  approvalRate: 0,
  languagesBreakdown: [],
  withAudio: 0,
  contentCoverage: 0,
  citiesCovered: 0,
  totalUsers: 0,
  activeUsers30d: 0,
  totalTrips: 0,
  totalKmDriven: 0,
  totalPOIVisits: 0,
  totalAudioPlays: 0,
  avgTripDuration: '0 min',
  tripsByPlatform: [],
  totalPremiumUsers: 0,
  upcomingExpirations: [],
  mauHistory: [],
  userGrowth: [],
  cityDistribution: [],
  countryDistribution: [],
  mostVisitedCities: [],
  topVisitedPOIs: [],
  recentVisitedPOIs: [],
  recentAppActivity: [],
  visitsByLanguage: [],
  migrationMetrics: { monthly: [], overallAvgSeconds: 0, recentAvgSeconds: 0, recentVolume: 0 },
  topGenerators: [],
  lastUpdated: new Date(),
  source: 'database'
}

export interface InventoryDetails {
  // Core stats
  coreTotal: number
  coreApproved: number
  corePending: number
  coreWithCoordinates: number
  coreWithTriggerPoints: number
  coreMissingTriggerPoints: number
  
  // Homolog stats
  homologTotal: number
  homologProcessed: number
  homologPending: number
  
  // Content stats
  poisWithAnyDescription: number
  poisWithAllLanguages: number
  poisWithAudio: number
  poisMissingContent: number
  
  // Top cities
  topCities: Array<{ city: string; country: string; count: number }>
  
  // Categories
  categoriesBreakdown: Array<{ category: string; count: number }>
  
  // Recent additions
  recentCoreAdditions: number
  recentHomologAdditions: number
}

export interface UserWithSessions {
  user_id: string
  full_name: string | null
  nickname: string | null
  country: string | null
  last_platform: string | null
  last_sign_in_at: string | null
  login_count: number
  trip_count: number
  total_km: number
  poi_visits_count: number
  last_trip_at: string | null
}

export interface HeatmapPoint {
  lat: number
  lng: number
  weight: number
}

export interface UserLocationPin {
  user_id: string
  latitude: number
  longitude: number
  country: string | null
  nickname: string | null
  last_platform: string | null
  last_sign_in_at: string | null
  is_premium: boolean
}

export interface WaitlistStats {
  total: number
  pending: number
  notified: number
  conversion_rate: number
  by_country: Array<{ country: string; pending: number; notified: number; total: number }>
}

export interface WaitlistPin {
  id: string
  latitude: number
  longitude: number
  country: string | null
  nickname: string | null
  notified: boolean
  created_at: string
}

export interface SubscriptionStats {
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

export interface AppUserDetailed {
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
  created_at: string | null
  onboarding_completed: boolean
  trip_count: number
  total_km: number
  poi_visits_count: number
  last_trip_at: string | null
}

export interface UserDetail extends AppUserDetailed {
  phone: string | null
  unique_cities_visited: number
  subscription_history: Array<{
    action: string
    provider: string | null
    tier_name: string | null
    previous_tier_name: string | null
    created_at: string
  }>
}

export interface ContentQuality {
  languagesBreakdown: Array<{ language: string; count: number }>
  coveragePercentage: number
  totalWithAudio: number
  totalWithDescriptions: number
}

// ============================================================================
// SERVICE CLASS
// ============================================================================

class DashboardService {
  private static readonly CACHE_TTL = 2 * 60 * 1000 // 2 minutes
  private static cache: Map<string, { data: any; timestamp: number }> = new Map()
  
  /**
   * Carrega todos os dados do dashboard usando RPCs otimizadas
   */
  static async getDashboardData(ownerId?: string, force?: boolean): Promise<{
    success: boolean
    data?: DashboardStats
    error?: string
  }> {
    const startTime = Date.now()
    const cacheKey = ownerId ? `dashboard:${ownerId}` : 'dashboard:global'

    try {
      // Check cache (force=true fura o cache — usado pelo refresh realtime debounced)
      const cached = this.cache.get(cacheKey)
      if (!force && cached && (Date.now() - cached.timestamp) < this.CACHE_TTL) {
        return { success: true, data: { ...cached.data, source: 'cache' as const } }
      }
      
      console.log('📊 Loading dashboard data V4...')

      // As 12 RPCs rodam em paralelo no servidor, sob withAuth({ roles: ['admin'] }),
      // com o JWT do operador — inclusive as duas que leem MV por wrapper
      // (`dashboard_user_analytics_global`, `dashboard_country_stats_global`), cujo gate
      // é `core.is_caller_platform_admin()`. Ver app/api/dashboard/overview/route.ts.
      const query = ownerId ? `?ownerId=${encodeURIComponent(ownerId)}` : ''
      const overview = await fetchDashboardRoute<any>(`/api/dashboard/overview${query}`)
      if (overview.error) throw new Error(overview.error.message)

      const {
        userAnalytics: userAnalyticsResult,
        cityStats: cityStatsResult,
        mostVisitedCities: mostVisitedCitiesResult,
        topPOIs: topPOIsResult,
        recentPOIs: recentPOIsResult,
        inventoryFunnel: inventoryFunnelResult,
        contentQuality: contentQualityResult,
        visitsByLanguage: visitsByLanguageResult,
        recentAppActivity: recentAppActivityResult,
        countryStats: countryStatsResult,
        migrationMetrics: migrationMetricsResult,
        topGenerators: topGeneratorsResult,
      } = overview.data as Record<string, RpcResult<any>>

      // Log de erros individuais (não fatal)
      if (userAnalyticsResult.error) console.warn('⚠️ User analytics error:', userAnalyticsResult.error.message)
      if (cityStatsResult.error) console.warn('⚠️ City stats error:', cityStatsResult.error.message)
      if (mostVisitedCitiesResult.error) console.warn('⚠️ Most visited cities error:', mostVisitedCitiesResult.error.message)
      if (topPOIsResult.error) console.warn('⚠️ Top POIs error:', topPOIsResult.error.message)
      if (recentPOIsResult.error) console.warn('⚠️ Recent POIs error:', recentPOIsResult.error.message)
      if (inventoryFunnelResult.error) console.warn('⚠️ Inventory funnel error:', inventoryFunnelResult.error.message)
      if (contentQualityResult.error) console.warn('⚠️ Content quality error:', contentQualityResult.error.message)
      if (visitsByLanguageResult?.error) console.warn('⚠️ Visits by language error:', visitsByLanguageResult.error.message)
      if (migrationMetricsResult?.error) console.warn('⚠️ Migration metrics error:', migrationMetricsResult.error.message)
      if (topGeneratorsResult?.error) console.warn('⚠️ Top generators error:', topGeneratorsResult.error.message)
      
      // Parse dos resultados (com fallbacks seguros)
      const userAnalytics = userAnalyticsResult.data?.[0] || {}
      const inventoryFunnel = inventoryFunnelResult.data?.[0] || {}
      const contentQuality = contentQualityResult.data?.[0] || {}
      const cityStats = cityStatsResult.data || []
      const mostVisitedCities = mostVisitedCitiesResult.data || []
      const topPOIs = topPOIsResult.data || []
      const recentPOIs = recentPOIsResult.data || []
      const visitsByLanguage = visitsByLanguageResult?.data || []
      const migrationMetricsRaw = migrationMetricsResult?.data || { monthly: [], overall_avg_seconds: 0, recent_avg_seconds: 0, recent_volume: 0 }
      const topGenerators = topGeneratorsResult?.data || []
      
      // Construir objeto final
      const dashboardData: DashboardStats = {
        // POI Inventory
        totalPOIs: Number(inventoryFunnel.core_approved || 0) + Number(inventoryFunnel.core_pending || 0),
        approvedPOIs: Number(inventoryFunnel.core_approved || 0),
        pendingPOIs: Number(inventoryFunnel.core_pending || 0),
        homologPOIs: Number(inventoryFunnel.homolog_raw || 0),
        totalInventory: Number(inventoryFunnel.total_inventory || 0),
        approvalRate: 0,
        
        // Content Quality
        languagesBreakdown: contentQuality.languages_breakdown || [],
        withAudio: Number(contentQuality.total_with_audio || 0),
        contentCoverage: Number(contentQuality.coverage_percentage || 0),
        citiesCovered: cityStats.length,
        
        // User Analytics
        totalUsers: Number(userAnalytics.total_users || 0),
        activeUsers30d: Number(userAnalytics.active_users_30d || 0),
        totalTrips: Number(userAnalytics.total_trips || 0),
        totalKmDriven: Math.round(Number(userAnalytics.total_km_driven || 0)),
        totalPOIVisits: Number(userAnalytics.total_poi_visits || 0),
        totalAudioPlays: Number(userAnalytics.total_audio_plays || 0),
        avgTripDuration: userAnalytics.avg_trip_duration || '0 min',
        tripsByPlatform: userAnalytics.trips_by_platform || [],
        totalPremiumUsers: Number(userAnalytics.total_premium_users || 0),
        upcomingExpirations: userAnalytics.upcoming_expirations || [],
        
        // Temporal Data (já vem em ordem ASC do SQL)
        mauHistory: userAnalytics.mau_history || [],
        userGrowth: userAnalytics.user_growth || [],
        recentAppActivity: recentAppActivityResult?.data || [],
        
        // Geographic - POIs por cidade
        cityDistribution: cityStats.map((c: any) => ({
          city: c.city,
          country: c.country,
          poi_count: Number(c.poi_count),
          approved_count: Number(c.approved_count)
        })),

        // Geographic - POIs por país (agregado diretamente da RPC corrigida)
        countryDistribution: (countryStatsResult?.data || [])
          .map((c: any) => ({
            country: c.country,
            poi_count: Number(c.poi_count),
            city_count: Number(c.city_count),
            approved_count: Number(c.approved_count)
          }))
          .sort((a: any, b: any) => b.poi_count - a.poi_count),
        
        // Geographic - Cidades mais visitadas
        mostVisitedCities: mostVisitedCities.map((c: any) => ({
          city: c.city,
          country: c.country,
          visit_count: Number(c.visit_count),
          audio_plays: Number(c.audio_plays),
          unique_visitors: Number(c.unique_visitors)
        })),
        
        // Top POIs (agregado)
        topVisitedPOIs: topPOIs.map((p: any) => ({
          poi_id: p.poi_id,
          poi_name: p.poi_name,
          city: p.city,
          country: p.country,
          category: p.category,
          total_visits: Number(p.total_visits),
          audio_plays: Number(p.audio_plays),
          unique_visitors: Number(p.unique_visitors)
        })),
        
        // Recent POIs (últimos visitados)
        recentVisitedPOIs: recentPOIs.map((p: any) => ({
          visit_id: p.visit_id,
          poi_id: p.poi_id,
          poi_name: p.poi_name,
          poi_city: p.poi_city,
          poi_country: p.poi_country,
          poi_category: p.poi_category,
          user_nickname: p.user_nickname || 'Anonymous',
          visit_timestamp: p.visit_timestamp,
          audio_played: p.audio_played,
          visit_source: p.visit_source,
          platform: p.platform,
          audio_language: p.audio_language
        })),
        
        // Visits by Language
        visitsByLanguage: visitsByLanguage.map((v: any) => ({
          language_code: v.language_code,
          visit_count: Number(v.visit_count),
          audio_played_count: Number(v.audio_played_count)
        })),

        // Migration Analytics
        migrationMetrics: {
          monthly: migrationMetricsRaw.monthly || [],
          overallAvgSeconds: Number(migrationMetricsRaw.overall_avg_seconds || 0),
          recentAvgSeconds: Number(migrationMetricsRaw.recent_avg_seconds || 0),
          recentVolume: Number(migrationMetricsRaw.recent_volume || 0)
        },
        
        // Top Generators
        topGenerators: topGenerators.map((g: any) => ({
          user_id: g.user_id,
          nickname: g.nickname || 'Unknown',
          content_count: Number(g.content_count || 0)
        })),
        
        // Metadata
        lastUpdated: new Date(),
        source: 'database'
      }
      
      // Calcular taxa de aprovação
      if (dashboardData.totalPOIs > 0) {
        dashboardData.approvalRate = Math.round((dashboardData.approvedPOIs / dashboardData.totalPOIs) * 100)
      }
      
      // Cache
      this.cache.set(cacheKey, { data: dashboardData, timestamp: startTime })
      
      console.log(`✅ Dashboard loaded in ${Date.now() - startTime}ms`)
      return { success: true, data: dashboardData }
      
    } catch (error) {
      console.error('❌ Dashboard error:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }
  
  /**
   * Busca detalhes do inventário para a Content tab
   */
  static async getInventoryDetails(): Promise<{ success: boolean; data?: InventoryDetails; error?: string }> {
    try {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .schema('core')
        .rpc('dashboard_inventory_details')

      if (error) throw error
      
      const row = data?.[0] || {}
      
      const inventoryDetails: InventoryDetails = {
        coreTotal: Number(row.core_total || 0),
        coreApproved: Number(row.core_approved || 0),
        corePending: Number(row.core_pending || 0),
        coreWithCoordinates: Number(row.core_with_coordinates || 0),
        coreWithTriggerPoints: Number(row.core_with_trigger_points || 0),
        coreMissingTriggerPoints: Number(row.core_missing_trigger_points || 0),
        homologTotal: Number(row.homolog_total || 0),
        homologProcessed: Number(row.homolog_processed || 0),
        homologPending: Number(row.homolog_pending || 0),
        poisWithAnyDescription: Number(row.pois_with_any_description || 0),
        poisWithAllLanguages: Number(row.pois_with_all_languages || 0),
        poisWithAudio: Number(row.pois_with_audio || 0),
        poisMissingContent: Number(row.pois_missing_content || 0),
        topCities: row.top_cities || [],
        categoriesBreakdown: row.categories_breakdown || [],
        recentCoreAdditions: Number(row.recent_core_additions || 0),
        recentHomologAdditions: Number(row.recent_homolog_additions || 0)
      }
      
      return { success: true, data: inventoryDetails }
    } catch (error) {
      console.error('Error fetching inventory details:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }
  
  /**
   * Busca dados para o heatmap
   */
  static async getHeatmapData(sampleSize = 5000): Promise<{ success: boolean; data?: HeatmapPoint[]; error?: string }> {
    try {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .schema('core')
        .rpc('dashboard_heatmap_data', { sample_size: sampleSize })

      if (error) throw error
      return { success: true, data: data || [] }
    } catch (error) {
      console.error('Error fetching heatmap data:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }
  
  /**
   * Busca perfis de usuários COM DADOS DE TRIPS
   */
  static async getUsersWithSessions(limit = 50): Promise<{ success: boolean; data?: UserWithSessions[]; error?: string }> {
    try {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .schema('core')
        .rpc('dashboard_user_sessions', { limit_count: limit })

      if (error) throw error
      return { success: true, data }
    } catch (error) {
      console.error('Error fetching user sessions:', error)
      // Fallback: busca apenas profiles
      return this.getProfiles(limit)
    }
  }
  
  /**
   * Busca perfis de usuários (fallback)
   */
  static async getProfiles(limit = 100): Promise<{ success: boolean; data?: any[]; error?: string }> {
    try {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .schema('drive')
        .from('profiles')
        .select('id, full_name, nickname, avatar_url, country, language, last_sign_in_at, login_count, created_at, last_platform, subscription_tier_id')
        .order('last_sign_in_at', { ascending: false, nullsFirst: false })
        .limit(limit)

      if (error) throw error
      return { success: true, data }
    } catch (error) {
      console.error('Error fetching profiles:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }
  
  /**
   * Busca perfis por termo (nickname/full_name) direto no banco.
   * O seletor de push direto carrega só os N mais recentes; sem busca no
   * servidor um usuário fora dessa janela nunca aparece.
   */
  static async searchProfiles(term: string, limit = 50): Promise<{ success: boolean; data?: any[]; error?: string }> {
    const query = term.trim()
    if (!query) return this.getProfiles(limit)
    try {
      const supabase = getSupabaseClient()
      // NOTHING TO ESCAPE ANY MORE. This escaped `%`, `_` and `,` because the term went into a
      // `LIKE` pattern and into PostgREST's `or` grammar raw. `nameMatchFilter` builds a regex
      // in which every character that is not a letter or a digit becomes a hole, so a `%` the
      // operator typed is data, not syntax — and escaping it would make the backslash data.
      const { data, error } = await supabase
        .schema('drive')
        .from('profiles')
        .select('id, full_name, nickname, avatar_url, country, language, last_sign_in_at, login_count, created_at, last_platform, subscription_tier_id')
        .or(nameMatchFilter(['nickname', 'full_name'], query))
        .order('last_sign_in_at', { ascending: false, nullsFirst: false })
        .limit(limit)

      if (error) throw error
      return { success: true, data }
    } catch (error) {
      console.error('Error searching profiles:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  /**
   * Busca a última posição conhecida de cada usuário (profiles.lat/lng) para o
   * mapa-hero da Overview. Endpoint slim — NÃO passa pelo getDashboardData monolítico.
   */
  static async getUserLocationPins(limit = 5000, ownerId?: string): Promise<{ success: boolean; data?: UserLocationPin[]; error?: string }> {
    try {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .schema('core')
        .rpc('dashboard_user_location_pins', { p_owner_id: ownerId || null, p_limit: limit })

      if (error) throw error
      return { success: true, data: (data || []) as UserLocationPin[] }
    } catch (error) {
      console.error('Error fetching user location pins:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  /**
   * Agregações da region_waitlist (KPI/painel Demanda da Overview + funil do geography).
   */
  static async getWaitlistStats(): Promise<{ success: boolean; data?: WaitlistStats; error?: string }> {
    try {
      const { data, error } = await fetchDashboardRoute<any>('/api/dashboard/waitlist/stats')

      if (error) throw new Error(error.message)
      const raw = (data || {}) as any
      return {
        success: true,
        data: {
          total: Number(raw.total || 0),
          pending: Number(raw.pending || 0),
          notified: Number(raw.notified || 0),
          conversion_rate: Number(raw.conversion_rate || 0),
          by_country: (raw.by_country || []).map((c: any) => ({
            country: c.country,
            pending: Number(c.pending || 0),
            notified: Number(c.notified || 0),
            total: Number(c.total || 0),
          })),
        },
      }
    } catch (error) {
      console.error('Error fetching waitlist stats:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  /**
   * Pins de demanda (region_waitlist) para o mapa do report geography.
   */
  static async getWaitlistPins(limit = 5000, onlyPending = true): Promise<{ success: boolean; data?: WaitlistPin[]; error?: string }> {
    try {
      const { data, error } = await fetchDashboardRoute<WaitlistPin[]>(
        `/api/dashboard/waitlist/pins?limit=${limit}&onlyPending=${onlyPending}`
      )

      if (error) throw new Error(error.message)
      return { success: true, data: (data || []) as WaitlistPin[] }
    } catch (error) {
      console.error('Error fetching waitlist pins:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  /**
   * Estatísticas de assinatura (Premium report): tiers, provider, churn 7d, free/premium.
   * Wrapper slim de dashboard_subscription_stats() — RPC já existente.
   */
  static async getSubscriptionStats(): Promise<{ success: boolean; data?: SubscriptionStats; error?: string }> {
    try {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.schema('core').rpc('dashboard_subscription_stats')
      if (error) throw error
      const row = (data?.[0] || {}) as any
      return {
        success: true,
        data: {
          total_users: Number(row.total_users || 0),
          free_users: Number(row.free_users || 0),
          premium_users: Number(row.premium_users || 0),
          premium_percentage: Number(row.premium_percentage || 0),
          apple_subscriptions: Number(row.apple_subscriptions || 0),
          google_subscriptions: Number(row.google_subscriptions || 0),
          stripe_subscriptions: Number(row.stripe_subscriptions || 0),
          tiers_breakdown: (row.tiers_breakdown || []).map((t: any) => ({
            tier_id: t.tier_id, tier_name: t.tier_name, count: Number(t.count || 0),
          })),
          new_subscriptions_7d: Number(row.new_subscriptions_7d || 0),
          churned_7d: Number(row.churned_7d || 0),
        },
      }
    } catch (error: any) {
      console.error('Error fetching subscription stats:', error?.message || error)
      return { success: false, error: error?.message || 'Unknown error' }
    }
  }

  /**
   * Usuários detalhados (27 campos: tier, provider, device, engagement) com filtros opcionais.
   * Wrapper slim de dashboard_app_users_detailed() — RPC já existente.
   */
  static async getAppUsersDetailed(limit = 100, country?: string, platform?: string): Promise<{ success: boolean; data?: AppUserDetailed[]; error?: string }> {
    try {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.schema('core').rpc('dashboard_app_users_detailed', {
        limit_count: limit,
        filter_country: country || null,
        filter_platform: platform || null,
      })
      if (error) throw error
      return { success: true, data: (data || []) as AppUserDetailed[] }
    } catch (error: any) {
      console.error('Error fetching app users detailed:', error?.message || error)
      return { success: false, error: error?.message || 'Unknown error' }
    }
  }

  /**
   * Deep-dive de 1 usuário + timeline de assinatura (subscription_history).
   * Wrapper slim de dashboard_user_detail() — RPC já existente.
   */
  static async getUserDetail(userId: string): Promise<{ success: boolean; data?: UserDetail; error?: string }> {
    try {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.schema('core').rpc('dashboard_user_detail', { target_user_id: userId })
      if (error) throw error
      const row = (data?.[0] || null) as any
      if (!row) return { success: false, error: 'User not found' }
      return {
        success: true,
        data: {
          ...row,
          login_count: Number(row.login_count || 0),
          trip_count: Number(row.trip_count || 0),
          total_km: Number(row.total_km || 0),
          poi_visits_count: Number(row.poi_visits_count || 0),
          unique_cities_visited: Number(row.unique_cities_visited || 0),
          subscription_history: row.subscription_history || [],
        } as UserDetail,
      }
    } catch (error: any) {
      console.error('Error fetching user detail:', error?.message || error)
      return { success: false, error: error?.message || 'Unknown error' }
    }
  }

  /**
   * Qualidade de conteúdo (idiomas + cobertura). Wrapper slim de dashboard_content_quality().
   * Usado por inventory/content-coverage sem precisar do getDashboardData monolítico.
   */
  static async getContentQuality(): Promise<{ success: boolean; data?: ContentQuality; error?: string }> {
    try {
      const { data, error } = await fetchDashboardRoute<any[]>('/api/dashboard/content-quality')
      if (error) throw new Error(error.message)
      const row = (data?.[0] || {}) as any
      return {
        success: true,
        data: {
          languagesBreakdown: row.languages_breakdown || [],
          coveragePercentage: Number(row.coverage_percentage || 0),
          totalWithAudio: Number(row.total_with_audio || 0),
          totalWithDescriptions: Number(row.total_with_descriptions || 0),
        },
      }
    } catch (error: any) {
      console.error('Error fetching content quality:', error?.message || error)
      return { success: false, error: error?.message || 'Unknown error' }
    }
  }

  /**
   * Top autores de conteúdo. Wrapper slim de dashboard_top_generators().
   */
  static async getTopGenerators(limit = 10): Promise<{ success: boolean; data?: Array<{ user_id: string; nickname: string; content_count: number }>; error?: string }> {
    try {
      const { data, error } = await fetchDashboardRoute<any[]>(`/api/dashboard/top-generators?limit=${limit}`)
      if (error) throw new Error(error.message)
      return {
        success: true,
        data: (data || []).map((g: any) => ({ user_id: g.user_id, nickname: g.nickname || 'Unknown', content_count: Number(g.content_count || 0) })),
      }
    } catch (error: any) {
      console.error('Error fetching top generators:', error?.message || error)
      return { success: false, error: error?.message || 'Unknown error' }
    }
  }

  /**
   * Métricas autoritativas de usuário (mesma fonte da Overview): total real (209),
   * MAU 30d (login nos últimos 30 dias) e premium. NÃO depende do limite da lista.
   */
  static async getUserAnalytics(ownerId?: string): Promise<{ success: boolean; data?: { totalUsers: number; activeUsers30d: number; totalPremiumUsers: number }; error?: string }> {
    try {
      const supabase = getSupabaseClient()
      const res = ownerId
        ? await supabase.schema('core').rpc('dashboard_user_analytics', { p_owner_id: ownerId })
        : await supabase.schema('core').rpc('dashboard_user_analytics_global')
      if (res.error) throw res.error
      const row = (res.data?.[0] || {}) as any
      return {
        success: true,
        data: {
          totalUsers: Number(row.total_users || 0),
          activeUsers30d: Number(row.active_users_30d || 0),
          totalPremiumUsers: Number(row.total_premium_users || 0),
        },
      }
    } catch (error: any) {
      console.error('Error fetching user analytics:', error?.message || error)
      return { success: false, error: error?.message || 'Unknown error' }
    }
  }

  /**
   * Funil de inventário (rápido, via MV mv_inventory_stats) — mesma fonte da Overview.
   * Substitui o getInventoryDetails pesado (que varre attractions e dá timeout).
   */
  static async getInventoryFunnel(): Promise<{ success: boolean; data?: { coreApproved: number; corePending: number; homologRaw: number; totalInventory: number }; error?: string }> {
    try {
      const { data, error } = await fetchDashboardRoute<any[]>('/api/dashboard/inventory-funnel')
      if (error) throw new Error(error.message)
      const row = (data?.[0] || {}) as any
      return {
        success: true,
        data: {
          coreApproved: Number(row.core_approved || 0),
          corePending: Number(row.core_pending || 0),
          homologRaw: Number(row.homolog_raw || 0),
          totalInventory: Number(row.total_inventory || 0),
        },
      }
    } catch (error: any) {
      console.error('Error fetching inventory funnel:', error?.message || error)
      return { success: false, error: error?.message || 'Unknown error' }
    }
  }

  /**
   * POIs por país (Top Countries). Wrapper slim de dashboard_country_stats().
   */
  static async getCountryStats(ownerId?: string): Promise<{ success: boolean; data?: Array<{ country: string; poi_count: number; city_count: number; approved_count: number }>; error?: string }> {
    try {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.schema('core').rpc('dashboard_country_stats', { p_owner_id: ownerId || null })
      if (error) throw error
      return {
        success: true,
        data: (data || [])
          .map((c: any) => ({ country: c.country, poi_count: Number(c.poi_count || 0), city_count: Number(c.city_count || 0), approved_count: Number(c.approved_count || 0) }))
          .sort((a: any, b: any) => b.poi_count - a.poi_count),
      }
    } catch (error: any) {
      console.error('Error fetching country stats:', error?.message || error)
      return { success: false, error: error?.message || 'Unknown error' }
    }
  }

  /**
   * Métricas de migração (mensal + médias). Wrapper slim de dashboard_migration_metrics().
   */
  static async getMigrationMetrics(): Promise<{ success: boolean; data?: DashboardStats['migrationMetrics']; error?: string }> {
    try {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.schema('core').rpc('dashboard_migration_metrics')
      if (error) throw error
      const raw = (data || {}) as any
      return {
        success: true,
        data: {
          monthly: raw.monthly || [],
          overallAvgSeconds: Number(raw.overall_avg_seconds || 0),
          recentAvgSeconds: Number(raw.recent_avg_seconds || 0),
          recentVolume: Number(raw.recent_volume || 0),
        },
      }
    } catch (error: any) {
      console.error('Error fetching migration metrics:', error?.message || error)
      return { success: false, error: error?.message || 'Unknown error' }
    }
  }

  /**
   * Busca atividade ao vivo. windowSeconds = janela de presença ("online agora"):
   * usuário é ativo se teve ping em user_location_history nos últimos N segundos.
   */
  static async getRealtimeActivity(windowSeconds = 120): Promise<{
    success: boolean;
    data?: {
      active_users: Array<{ user_id: string; lat: number; lng: number; timestamp: string }>;
      // `visit_source` é opcional enquanto `core.dashboard_realtime_activity` não
      // devolver a coluna — SQL pendente em docs/dev/radar-visit-source.md. O cartão
      // omite o selo de engajamento no que chegar sem ela.
      active_pois: Array<{ visit_id: string; poi_id: string; poi_name: string; poi_city: string; poi_country: string; poi_category: string; user_nickname: string; visit_timestamp: string; audio_played: boolean; platform: string; audio_language: string; visit_source?: string }>;
      window_seconds: number;
      generated_at: string;
    };
    error?: string
  }> {
    try {
      const { data, error } = await fetchDashboardRoute<any>(
        `/api/dashboard/realtime-activity?windowSeconds=${windowSeconds}`
      )

      if (error) throw new Error(error.message)
      return { success: true, data: data as any }
    } catch (error: any) {
      // Supabase/PostgREST errors serializam como {} no console — extrai os campos úteis.
      const msg = error?.message || error?.error_description || 'Unknown error'
      console.error('Error fetching realtime activity:', {
        message: msg, code: error?.code, details: error?.details, hint: error?.hint,
      })
      if (error?.code === 'PGRST202' || /function/i.test(msg)) {
        console.error('↳ RPC dashboard_realtime_activity(window_seconds) não encontrada. Rode a migration 20260628_realtime_active_from_location_history.sql no painel Supabase.')
      }
      return { success: false, error: msg }
    }
  }

  /**
   * Limpa o cache
   */
  static clearCache(): void {
    this.cache.clear()
  }
  
  /**
   * Estatísticas do cache
   */
  static getCacheStats() {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys())
    }
  }
}

// ============================================================================
// EXPORT
// ============================================================================

export const dashboardService = {
  getDashboardData: (ownerId?: string, force?: boolean) => DashboardService.getDashboardData(ownerId, force),
  getInventoryDetails: () => DashboardService.getInventoryDetails(),
  getHeatmapData: (sampleSize?: number) => DashboardService.getHeatmapData(sampleSize),
  getUsersWithSessions: (limit?: number) => DashboardService.getUsersWithSessions(limit),
  getProfiles: (limit?: number) => DashboardService.getProfiles(limit),
  searchProfiles: (term: string, limit?: number) => DashboardService.searchProfiles(term, limit),
  getUserLocationPins: (limit?: number, ownerId?: string) => DashboardService.getUserLocationPins(limit, ownerId),
  getWaitlistStats: () => DashboardService.getWaitlistStats(),
  getWaitlistPins: (limit?: number, onlyPending?: boolean) => DashboardService.getWaitlistPins(limit, onlyPending),
  getSubscriptionStats: () => DashboardService.getSubscriptionStats(),
  getAppUsersDetailed: (limit?: number, country?: string, platform?: string) => DashboardService.getAppUsersDetailed(limit, country, platform),
  getUserDetail: (userId: string) => DashboardService.getUserDetail(userId),
  getContentQuality: () => DashboardService.getContentQuality(),
  getTopGenerators: (limit?: number) => DashboardService.getTopGenerators(limit),
  getCountryStats: (ownerId?: string) => DashboardService.getCountryStats(ownerId),
  getInventoryFunnel: () => DashboardService.getInventoryFunnel(),
  getUserAnalytics: (ownerId?: string) => DashboardService.getUserAnalytics(ownerId),
  getMigrationMetrics: () => DashboardService.getMigrationMetrics(),
  getRealtimeActivity: (windowSeconds?: number) => DashboardService.getRealtimeActivity(windowSeconds),
  clearCache: () => DashboardService.clearCache(),
  getCacheStats: () => DashboardService.getCacheStats()
}

export default DashboardService
