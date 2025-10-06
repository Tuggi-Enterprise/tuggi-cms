/**
 * Dashboard Service - Centralized data fetching for dashboard
 * 
 * Reuses existing poiService and creates optimized RPCs for dashboard data.
 * Eliminates direct SQL queries and pagination issues.
 */

import { poiService, POIStats } from '@/lib/core/poi-service'
import { getSupabase } from '@/lib/core/supabase-client'

export interface DashboardStats {
  // POI Statistics (from poiService)
  totalPOIs: number
  approvedPOIs: number
  totalDescriptions: number
  approvalRate: number
  
  // City Distribution
  cityDistribution: Array<{ city: string; count: number }>
  
  // User Analytics (from new RPC)
  totalUsers: number
  totalTrips: number
  totalKmDriven: number
  totalPOIsPlayed: number
  avgTripDuration: number
  tripsByPlatform: Array<{ platform: string; trips: number }>
  
  // Metadata
  lastUpdated: Date
  source: 'cache' | 'database'
}

export interface UserAnalyticsResult {
  total_users: number
  total_trips: number
  total_km_driven: number
  total_pois_played: number
  avg_trip_duration: string
  trips_by_platform: Array<{ platform: string; trips: number }>
}

class DashboardService {
  private static readonly CACHE_TTL = 2 * 60 * 1000 // 2 minutes
  private static cache: Map<string, { data: any; timestamp: number }> = new Map()
  
  /**
   * Get complete dashboard data using optimized RPCs
   */
  static async getDashboardData(): Promise<{
    success: boolean
    data?: DashboardStats
    error?: string
  }> {
    const startTime = Date.now()
    const cacheKey = 'dashboard_data'
    
    try {
      // Check cache first
      const cached = this.cache.get(cacheKey)
      if (cached && (Date.now() - cached.timestamp) < this.CACHE_TTL) {
        return {
          success: true,
          data: {
            ...cached.data,
            source: 'cache' as const
          }
        }
      }
      
      console.log('📊 Loading dashboard data with RPCs...')
      
      // Clear cache to ensure fresh data
      poiService.clearCache()
      console.log('🧹 Cache cleared, forcing fresh data fetch')
      
      // FASE 1: Get POI data using existing poiService and city stats RPC
      const supabase = getSupabase('server')
      
      const [poiStatsResult, cityStatsResult] = await Promise.all([
        poiService.getStats(),
        supabase.schema('core').rpc('dashboard_city_stats') // Get city statistics directly
      ])
      
      if (!poiStatsResult.success) {
        throw new Error(`POI stats failed: ${poiStatsResult.error}`)
      }
      
      if (cityStatsResult.error) {
        throw new Error(`City stats failed: ${cityStatsResult.error.message}`)
      }
      
      // FASE 2: Get user analytics
      const userAnalytics = await this.getUserAnalytics()
      
      // Process city distribution from RPC results
      console.log('🔍 City stats data length:', cityStatsResult.data?.length)
      console.log('🔍 First few cities:', cityStatsResult.data?.slice(0, 5))
      
      const cityDistribution = cityStatsResult.data?.map((row: any) => ({
        city: row.city,
        count: Number(row.poi_count)
      })) || []
      
      console.log('🔍 City distribution processed:', cityDistribution.length, 'cities')
      
      // Calculate approval rate
      const approvalRate = poiStatsResult.data && poiStatsResult.data.total > 0 
        ? Math.round((poiStatsResult.data.approved / poiStatsResult.data.total) * 100)
        : 0
      
      const dashboardData: DashboardStats = {
        // POI Statistics
        totalPOIs: poiStatsResult.data?.total || 0,
        approvedPOIs: poiStatsResult.data?.approved || 0,
        totalDescriptions: poiStatsResult.data?.content_stats?.with_description || 0,
        approvalRate,
        
        // City Distribution
        cityDistribution,
        
        // User Analytics
        totalUsers: userAnalytics.total_users,
        totalTrips: userAnalytics.total_trips,
        totalKmDriven: Math.round(userAnalytics.total_km_driven),
        totalPOIsPlayed: userAnalytics.total_pois_played,
        avgTripDuration: this.parseDuration(userAnalytics.avg_trip_duration),
        tripsByPlatform: userAnalytics.trips_by_platform,
        
        // Metadata
        lastUpdated: new Date(),
        source: 'database'
      }
      
      // Cache the result
      this.cache.set(cacheKey, { data: dashboardData, timestamp: startTime })
      
      console.log(`✅ Dashboard data loaded in ${Date.now() - startTime}ms`)
      return {
        success: true,
        data: dashboardData
      }
      
    } catch (error) {
      console.error('Error loading dashboard data:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }
  
  /**
   * Get user analytics using optimized RPC
   */
  private static async getUserAnalytics(): Promise<UserAnalyticsResult> {
    try {
      console.log('📊 Loading user analytics with RPC...')
      
      const supabase = getSupabase('server')
      
      // Use the new RPC function
      const { data, error } = await supabase
        .schema('core')
        .rpc('dashboard_user_analytics')
      
      if (error) {
        console.error('❌ User Analytics RPC failed:', error)
        throw new Error(`RPC error: ${error.message}`)
      }
      
      if (data && data.length > 0) {
        const result = data[0]
        console.log('✅ User Analytics RPC completed:', result)
        
        return {
          total_users: result.total_users || 0,
          total_trips: result.total_trips || 0,
          total_km_driven: result.total_km_driven || 0,
          total_pois_played: result.total_pois_played || 0,
          avg_trip_duration: result.avg_trip_duration || '0 minutes',
          trips_by_platform: result.trips_by_platform || []
        }
      } else {
        console.log('✅ User Analytics RPC completed - No data found')
        return {
          total_users: 0,
          total_trips: 0,
          total_km_driven: 0,
          total_pois_played: 0,
          avg_trip_duration: '0 minutes',
          trips_by_platform: []
        }
      }
      
    } catch (error) {
      console.error('Error loading user analytics with RPC:', error)
      return {
        total_users: 0,
        total_trips: 0,
        total_km_driven: 0,
        total_pois_played: 0,
        avg_trip_duration: '0 minutes',
        trips_by_platform: []
      }
    }
  }
  
  /**
   * Process city distribution from POI search results
   * @deprecated Use dashboard_city_stats RPC instead
   */
  private static processCityDistribution(pois: any[]): Array<{ city: string; count: number }> {
    // This method is deprecated - use dashboard_city_stats RPC for better performance
    const cityCounts = pois.reduce((acc: Record<string, number>, poi) => {
      if (poi.city) {
        acc[poi.city] = (acc[poi.city] || 0) + 1
      }
      return acc
    }, {})
    
    return Object.entries(cityCounts)
      .map(([city, count]) => ({ city, count: count as number }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20)
  }
  
  /**
   * Parse duration string to minutes
   */
  private static parseDuration(durationStr: string): number {
    const match = durationStr.match(/(\d+)/)
    return match ? parseInt(match[1]) : 0
  }
  
  /**
   * Clear cache
   */
  static clearCache(): void {
    this.cache.clear()
  }
  
  /**
   * Get cache statistics
   */
  static getCacheStats(): {
    size: number
    keys: string[]
    oldestEntry: number
    newestEntry: number
  } {
    const keys = Array.from(this.cache.keys())
    const timestamps = Array.from(this.cache.values()).map(entry => entry.timestamp)
    
    return {
      size: this.cache.size,
      keys,
      oldestEntry: timestamps.length > 0 ? Math.min(...timestamps) : 0,
      newestEntry: timestamps.length > 0 ? Math.max(...timestamps) : 0
    }
  }
}

export const dashboardService = {
  getDashboardData: () => DashboardService.getDashboardData(),
  clearCache: () => DashboardService.clearCache(),
  getCacheStats: () => DashboardService.getCacheStats()
}

export default DashboardService
