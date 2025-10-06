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
      
      // FASE 1: Get POI data using existing poiService
      const [poiStatsResult, cityDistributionResult] = await Promise.all([
        poiService.getStats(),
        poiService.search({ limit: 1000 }) // Get all POIs for city distribution
      ])
      
      if (!poiStatsResult.success) {
        throw new Error(`POI stats failed: ${poiStatsResult.error}`)
      }
      
      if (!cityDistributionResult.success) {
        throw new Error(`City distribution failed: ${cityDistributionResult.error}`)
      }
      
      // FASE 2: Get user analytics (will be implemented in next phase)
      const userAnalytics = await this.getUserAnalytics()
      
      // Process city distribution
      const cityDistribution = this.processCityDistribution(cityDistributionResult.data)
      
      // Calculate approval rate
      const approvalRate = poiStatsResult.data.total > 0 
        ? Math.round((poiStatsResult.data.approved / poiStatsResult.data.total) * 100)
        : 0
      
      const dashboardData: DashboardStats = {
        // POI Statistics
        totalPOIs: poiStatsResult.data.total,
        approvedPOIs: poiStatsResult.data.approved,
        totalDescriptions: poiStatsResult.data.content_stats.with_description,
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
   * Get user analytics (temporary implementation with direct queries)
   * TODO: Replace with RPC in FASE 2
   */
  private static async getUserAnalytics(): Promise<UserAnalyticsResult> {
    try {
      const supabase = getSupabase('server')
      
      // Get user count
      const { count: totalUsers } = await supabase
        .schema('drive')
        .from('profiles')
        .select('*', { count: 'exact', head: true })
      
      // Get trip data
      const { data: tripsData } = await supabase
        .schema('drive')
        .from('trip_sessions')
        .select('distance_km, platform, start_time, end_time')
        .not('end_time', 'is', null)
      
      // Get POI plays data
      const { data: poiPlaysData } = await supabase
        .schema('drive')
        .from('trip_session_attractions')
        .select('attraction_id')
        .gte('played_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
      
      // Process data
      const totalTrips = tripsData?.length || 0
      const totalKmDriven = tripsData?.reduce((sum, trip) => sum + (trip.distance_km || 0), 0) || 0
      const totalPOIsPlayed = poiPlaysData?.length || 0
      
      // Calculate average trip duration
      let avgTripDuration = 0
      if (tripsData && tripsData.length > 0) {
        const totalMinutes = tripsData.reduce((acc, trip) => {
          if (trip.start_time && trip.end_time) {
            const start = new Date(trip.start_time)
            const end = new Date(trip.end_time)
            return acc + (end.getTime() - start.getTime()) / (1000 * 60)
          }
          return acc
        }, 0)
        avgTripDuration = totalMinutes / tripsData.length
      }
      
      // Process platform data
      const platformCounts = tripsData?.reduce((acc: Record<string, number>, trip) => {
        acc[trip.platform] = (acc[trip.platform] || 0) + 1
        return acc
      }, {}) || {}
      
      const tripsByPlatform = Object.entries(platformCounts)
        .map(([platform, trips]) => ({ platform: platform || 'Unknown', trips: trips as number }))
      
      return {
        total_users: totalUsers || 0,
        total_trips: totalTrips,
        total_km_driven: totalKmDriven,
        total_pois_played: totalPOIsPlayed,
        avg_trip_duration: `${Math.round(avgTripDuration)} minutes`,
        trips_by_platform: tripsByPlatform
      }
      
    } catch (error) {
      console.error('Error loading user analytics:', error)
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
   */
  private static processCityDistribution(pois: any[]): Array<{ city: string; count: number }> {
    const cityCounts = pois.reduce((acc: Record<string, number>, poi) => {
      if (poi.city) {
        acc[poi.city] = (acc[poi.city] || 0) + 1
      }
      return acc
    }, {})
    
    return Object.entries(cityCounts)
      .map(([city, count]) => ({ city, count: count as number }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10) // Top 10 cities
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
