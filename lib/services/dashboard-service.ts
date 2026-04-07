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

import { getSupabase, getSupabaseClient } from '@/lib/core/supabase-client'

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

// ============================================================================
// SERVICE CLASS
// ============================================================================

class DashboardService {
  private static readonly CACHE_TTL = 2 * 60 * 1000 // 2 minutes
  private static cache: Map<string, { data: any; timestamp: number }> = new Map()
  
  /**
   * Carrega todos os dados do dashboard usando RPCs otimizadas
   */
  static async getDashboardData(ownerId?: string): Promise<{
    success: boolean
    data?: DashboardStats
    error?: string
  }> {
    const startTime = Date.now()
    const cacheKey = ownerId ? `dashboard:${ownerId}` : 'dashboard:global'
    
    try {
      // Check cache
      const cached = this.cache.get(cacheKey)
      if (cached && (Date.now() - cached.timestamp) < this.CACHE_TTL) {
        return { success: true, data: { ...cached.data, source: 'cache' as const } }
      }
      
      console.log('📊 Loading dashboard data V4...')

      // Use client-side Supabase (com JWT do usuário autenticado)
      const supabase = typeof window !== 'undefined'
        ? getSupabaseClient()
        : getSupabase('server')
      
      // Executar todas as RPCs em paralelo
      const [
        userAnalyticsResult,
        cityStatsResult,
        mostVisitedCitiesResult,
        topPOIsResult,
        recentPOIsResult,
        inventoryFunnelResult,
        contentQualityResult,
        visitsByLanguageResult,
        recentAppActivityResult,
        countryStatsResult
      ] = await Promise.all([
        // parameter renamed to p_owner_id to avoid naming conflict
        supabase.schema('core').rpc('dashboard_user_analytics', { p_owner_id: ownerId || null }),
        supabase.schema('core').rpc('dashboard_city_stats', { p_owner_id: ownerId || null }),
        supabase.schema('core').rpc('dashboard_most_visited_cities', { limit_count: 20 }),
        supabase.schema('core').rpc('dashboard_top_visited_pois', { limit_count: 10 }),
        supabase.schema('core').rpc('dashboard_recent_visited_pois', { limit_count: 10 }),
        supabase.schema('core').rpc('dashboard_inventory_funnel'),
        supabase.schema('core').rpc('dashboard_content_quality'),
        supabase.schema('core').rpc('dashboard_visits_by_language'),
        supabase.schema('core').rpc('dashboard_recent_app_users', { limit_count: 7 }),
        supabase.schema('core').rpc('dashboard_country_stats', { p_owner_id: ownerId || null })
      ])
      
      // Log de erros individuais (não fatal)
      if (userAnalyticsResult.error) console.warn('⚠️ User analytics error:', userAnalyticsResult.error.message)
      if (cityStatsResult.error) console.warn('⚠️ City stats error:', cityStatsResult.error.message)
      if (mostVisitedCitiesResult.error) console.warn('⚠️ Most visited cities error:', mostVisitedCitiesResult.error.message)
      if (topPOIsResult.error) console.warn('⚠️ Top POIs error:', topPOIsResult.error.message)
      if (recentPOIsResult.error) console.warn('⚠️ Recent POIs error:', recentPOIsResult.error.message)
      if (inventoryFunnelResult.error) console.warn('⚠️ Inventory funnel error:', inventoryFunnelResult.error.message)
      if (contentQualityResult.error) console.warn('⚠️ Content quality error:', contentQualityResult.error.message)
      if (visitsByLanguageResult?.error) console.warn('⚠️ Visits by language error:', visitsByLanguageResult.error.message)
      
      // Parse dos resultados (com fallbacks seguros)
      const userAnalytics = userAnalyticsResult.data?.[0] || {}
      const inventoryFunnel = inventoryFunnelResult.data?.[0] || {}
      const contentQuality = contentQualityResult.data?.[0] || {}
      const cityStats = cityStatsResult.data || []
      const mostVisitedCities = mostVisitedCitiesResult.data || []
      const topPOIs = topPOIsResult.data || []
      const recentPOIs = recentPOIsResult.data || []
      const visitsByLanguage = visitsByLanguageResult?.data || []
      
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
        countryDistribution: (countryStatsResult?.data || []).map((c: any) => ({
          country: c.country,
          poi_count: Number(c.poi_count),
          city_count: Number(c.city_count),
          approved_count: Number(c.approved_count)
        })),
        
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
      const supabase = typeof window !== 'undefined'
        ? getSupabaseClient()
        : getSupabase('server')
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
      const supabase = typeof window !== 'undefined'
        ? getSupabaseClient()
        : getSupabase('server')
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
      const supabase = typeof window !== 'undefined'
        ? getSupabaseClient()
        : getSupabase('server')
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
      const supabase = typeof window !== 'undefined'
        ? getSupabaseClient()
        : getSupabase('server')
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
   * Busca atividades em tempo real para o Realtime Dashboard
   */
  static async getRealtimeActivity(intervalMinutes = 10): Promise<{ 
    success: boolean; 
    data?: {
      active_users: Array<{ user_id: string; lat: number; lng: number; timestamp: string }>;
      active_pois: Array<{ visit_id: string; poi_id: string; poi_name: string; poi_city: string; poi_country: string; poi_category: string; user_nickname: string; visit_timestamp: string; audio_played: boolean; platform: string; audio_language: string }>;
      interval_minutes: number;
      generated_at: string;
    }; 
    error?: string 
  }> {
    try {
      const supabase = typeof window !== 'undefined'
        ? getSupabaseClient()
        : getSupabase('server')
        
      const { data, error } = await supabase
        .schema('core')
        .rpc('dashboard_realtime_activity', { interval_minutes: intervalMinutes })

      if (error) throw error
      return { success: true, data: data as any }
    } catch (error) {
      console.error('Error fetching realtime activity:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
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
  getDashboardData: (ownerId?: string) => DashboardService.getDashboardData(ownerId),
  getInventoryDetails: () => DashboardService.getInventoryDetails(),
  getHeatmapData: (sampleSize?: number) => DashboardService.getHeatmapData(sampleSize),
  getUsersWithSessions: (limit?: number) => DashboardService.getUsersWithSessions(limit),
  getProfiles: (limit?: number) => DashboardService.getProfiles(limit),
  getRealtimeActivity: (intervalMinutes?: number) => DashboardService.getRealtimeActivity(intervalMinutes),
  clearCache: () => DashboardService.clearCache(),
  getCacheStats: () => DashboardService.getCacheStats()
}

export default DashboardService
