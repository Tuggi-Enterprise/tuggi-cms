/**
 * POI Service - Single Source of Truth for POI Operations
 * 
 * Centralized service for POI search, filtering, and data management.
 * Eliminates duplication across POI management, trigger points, and verification pages.
 * 
 * Features:
 * - Unified POI search and filtering
 * - Consistent data transformation
 * - Caching for performance
 * - TypeScript interfaces
 * - Edge Functions compatibility
 */

import { getSupabase } from './supabase-client'

// POI Data Interfaces
export interface POI {
  id: string
  name: string
  city: string
  country: string
  state?: string
  category: string
  approved: boolean
  approved_by?: string
  approved_at?: string
  rating?: number
  image_url?: string
  created_at: string
  updated_at: string
  user_ratings_total?: number
  formatted_address?: string
  vicinity?: string
  website?: string
  formatted_phone_number?: string
  business_status?: string
  price_level?: number
  opening_hours?: any
  google_types?: string[]
  photos_references?: string[]
  google_place_id?: string
  user_id?: string
  coordinates?: {
    latitude: number
    longitude: number
  }
  // Content status indicators
  has_description: boolean
  has_audio: boolean
  description_count: number
  audio_count: number
  available_languages: string[]
  trigger_points_count: number
  active_trigger_points_count: number
  reference_links?: string[]
  descriptions?: any[]
  // Group status indicators
  group_status?: {
    is_in_group: boolean
    group_id?: string
    group_name?: string
    group_role?: 'main' | 'member'
    group_member_count?: number
  }
  verification_score?: number
  // Processing status
  processing_status?: 'pending' | 'processing' | 'completed' | 'failed'
  last_processed?: string
  has_boundary?: boolean
  boundary_source?: string
}

export interface POISearchFilters {
  search?: string
  status?: 'all' | 'approved' | 'pending'
  country?: string
  state?: string
  city?: string
  googleTypes?: string
  category?: string
  contentStatus?: 'all' | 'missing_description' | 'missing_audio' | 'complete'
  groupStatus?: 'all' | 'grouped' | 'ungrouped' | 'group_main' | 'group_member'
  scoreFilter?: 'all' | 'no_score' | 'rejected' | 'pending' | 'approved'
  triggerPointsFilter?: 'all' | 'with_trigger_points' | 'without_trigger_points'
  processingType?: 'without_trigger_points' | 'with_trigger_points' | 'all'
  language?: string
  limit?: number
  page?: number
}

export interface POISearchResult {
  success: boolean
  data: POI[]
  pagination: {
    totalCount: number
    totalPages: number
    currentPage: number
    hasNextPage: boolean
    hasPrevPage: boolean
  }
  filters: POISearchFilters
  metadata: {
    source: 'api' | 'database'
    timestamp: number
    processing_time: number
  }
  error?: string
}

export interface POIStats {
  total: number
  approved: number
  pending: number
  content_stats: {
    with_description: number
    with_audio: number
    complete: number
    missing_description: number
    missing_audio: number
  }
  group_stats: {
    grouped: number
    ungrouped: number
    group_main: number
    group_member: number
  }
  trigger_points_stats: {
    with_trigger_points: number
    without_trigger_points: number
    total_trigger_points: number
    active_trigger_points: number
  }
  verification_stats: {
    no_score: number
    pending: number
    approved: number
    rejected: number
  }
  countries: string[]
  cities: string[]
}

class POIService {
  private static readonly CACHE_TTL = 2 * 60 * 1000 // 2 minutes
  private static cache: Map<string, { data: any; timestamp: number }> = new Map()
  
  /**
   * Search POIs with filters
   */
  static async search(filters: POISearchFilters): Promise<POISearchResult> {
    const startTime = Date.now()
    const cacheKey = this.generateCacheKey('search', filters)
    
    try {
      // Check cache first
      const cached = this.cache.get(cacheKey)
      if (cached && (Date.now() - cached.timestamp) < this.CACHE_TTL) {
        return {
          ...cached.data,
          metadata: {
            ...cached.data.metadata,
            source: 'cache' as const
          }
        }
      }
      
      console.log('🔍 Searching POIs with filters:', filters)
      
      // Try API first (preferred for complex searches)
      try {
        const params = new URLSearchParams()
        
        // Add all filters to the request
        if (filters.search) params.set('search', filters.search)
        if (filters.status && filters.status !== 'all') params.set('status', filters.status)
        if (filters.country) params.set('country', filters.country)
        if (filters.state) params.set('state', filters.state)
        if (filters.city) params.set('city', filters.city)
        if (filters.googleTypes) params.set('googleTypes', filters.googleTypes)
        if (filters.category) params.set('category', filters.category)
        if (filters.contentStatus && filters.contentStatus !== 'all') params.set('contentStatus', filters.contentStatus)
        if (filters.groupStatus && filters.groupStatus !== 'all') params.set('groupStatus', filters.groupStatus)
        if (filters.scoreFilter && filters.scoreFilter !== 'all') params.set('scoreFilter', filters.scoreFilter)
        if (filters.triggerPointsFilter && filters.triggerPointsFilter !== 'all') params.set('triggerPointsFilter', filters.triggerPointsFilter)
        if (filters.page) params.set('page', filters.page.toString())
        if (filters.limit) params.set('limit', filters.limit.toString())
        
        const response = await fetch(`/api/pois/search?${params.toString()}`)
        const result = await response.json()
        
        if (result.success) {
          const searchResult: POISearchResult = {
            success: true,
            data: result.data || [],
            pagination: result.pagination || {
              totalCount: 0,
              totalPages: 0,
              currentPage: filters.page || 1,
              hasNextPage: false,
              hasPrevPage: false
            },
            filters,
            metadata: {
              source: 'api',
              timestamp: startTime,
              processing_time: Date.now() - startTime
            }
          }
          
          // Cache the result
          this.cache.set(cacheKey, { data: searchResult, timestamp: startTime })
          
          return searchResult
        }
      } catch (apiError) {
        console.warn('POI search API failed, falling back to database:', apiError)
      }
      
      // Fallback to direct database query
      const supabase = getSupabase('service')
      
      let query = supabase
        .schema('core')
        .from('attractions')
        .select(`
          *,
          attraction_descriptions(id, language, description),
          attraction_groups(id, name, role),
          attraction_trigger_points(id, is_active)
        `)
      
      // Apply filters
      if (filters.search) {
        query = query.ilike('name', `%${filters.search}%`)
      }
      if (filters.status === 'approved') {
        query = query.eq('approved', true)
      } else if (filters.status === 'pending') {
        query = query.eq('approved', false)
      }
      if (filters.country) {
        query = query.eq('country', filters.country)
      }
      if (filters.state) {
        query = query.eq('state', filters.state)
      }
      if (filters.city) {
        query = query.eq('city', filters.city)
      }
      if (filters.googleTypes) {
        query = query.contains('google_types', [filters.googleTypes])
      }
      
      // Apply pagination
      const page = filters.page || 1
      const limit = filters.limit || 50
      const offset = (page - 1) * limit
      
      query = query
        .range(offset, offset + limit - 1)
        .order('created_at', { ascending: false })
      
      const { data, error, count } = await query
      
      if (error) {
        throw new Error(`Database error: ${error.message}`)
      }
      
      // Transform data to POI format
      const pois = (data || []).map(this.transformToPOI)
      
      const totalCount = count || 0
      const totalPages = Math.ceil(totalCount / limit)
      
      const searchResult: POISearchResult = {
        success: true,
        data: pois,
        pagination: {
          totalCount,
          totalPages,
          currentPage: page,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1
        },
        filters,
        metadata: {
          source: 'database',
          timestamp: startTime,
          processing_time: Date.now() - startTime
        }
      }
      
      // Cache the result
      this.cache.set(cacheKey, { data: searchResult, timestamp: startTime })
      
      return searchResult
      
    } catch (error) {
      console.error('Error searching POIs:', error)
      return {
        success: false,
        data: [],
        pagination: {
          totalCount: 0,
          totalPages: 0,
          currentPage: filters.page || 1,
          hasNextPage: false,
          hasPrevPage: false
        },
        filters,
        metadata: {
          source: 'database',
          timestamp: startTime,
          processing_time: Date.now() - startTime
        },
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }
  
  /**
   * Get POIs for processing (trigger points, descriptions, etc.)
   */
  static async getForProcessing(
    type: 'trigger_points' | 'descriptions' | 'osm_enrichment',
    filters: {
      country?: string
      state?: string
      city?: string
      limit?: number
      processingType?: 'without_trigger_points' | 'with_trigger_points' | 'all'
      language?: string
    }
  ): Promise<{ success: boolean; data: POI[]; error?: string }> {
    const startTime = Date.now()
    
    try {
      console.log(`🎯 Getting POIs for ${type} processing:`, filters)
      
      // Use specific API endpoints for processing
      let endpoint = ''
      let params = new URLSearchParams()
      
      switch (type) {
        case 'trigger_points':
          endpoint = '/api/trigger-points/list-for-generation'
          if (filters.limit) params.set('limit', filters.limit.toString())
          if (filters.processingType) params.set('processing_type', filters.processingType)
          break
        case 'descriptions':
          endpoint = '/api/pois/search'
          params.set('contentStatus', 'missing_description')
          if (filters.limit) params.set('limit', filters.limit.toString())
          break
        case 'osm_enrichment':
          endpoint = '/api/pois/search'
          params.set('contentStatus', 'all')
          if (filters.limit) params.set('limit', filters.limit.toString())
          break
      }
      
      if (filters.country) params.set('country', filters.country)
      if (filters.state) params.set('state', filters.state)
      if (filters.city) params.set('city', filters.city)
      
      const response = await fetch(`${endpoint}?${params.toString()}`)
      const result = await response.json()
      
      if (result.success) {
        return {
          success: true,
          data: result.pois || result.data || []
        }
      } else {
        return {
          success: false,
          data: [],
          error: result.error || 'Failed to load POIs for processing'
        }
      }
      
    } catch (error) {
      console.error(`Error getting POIs for ${type} processing:`, error)
      return {
        success: false,
        data: [],
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }
  
  /**
   * Get POI by ID
   */
  static async getById(id: string): Promise<{ success: boolean; data?: POI; error?: string }> {
    const startTime = Date.now()
    const cacheKey = `poi_${id}`
    
    try {
      // Check cache first
      const cached = this.cache.get(cacheKey)
      if (cached && (Date.now() - cached.timestamp) < this.CACHE_TTL) {
        return {
          success: true,
          data: cached.data
        }
      }
      
      console.log(`🔍 Loading POI: ${id}`)
      
      const supabase = getSupabase('service')
      
      const { data, error } = await supabase
        .schema('core')
        .from('attractions')
        .select(`
          *,
          attraction_descriptions(id, language, description),
          attraction_groups(id, name, role),
          attraction_trigger_points(id, is_active)
        `)
        .eq('id', id)
        .single()
      
      if (error) {
        throw new Error(`Database error: ${error.message}`)
      }
      
      if (!data) {
        return {
          success: false,
          error: 'POI not found'
        }
      }
      
      const poi = this.transformToPOI(data)
      
      // Cache the result
      this.cache.set(cacheKey, { data: poi, timestamp: startTime })
      
      return {
        success: true,
        data: poi
      }
      
    } catch (error) {
      console.error(`Error loading POI ${id}:`, error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }
  
  /**
   * Get POI statistics
   */
  static async getStats(filters?: {
    country?: string
    state?: string
    city?: string
  }): Promise<{ success: boolean; data?: POIStats; error?: string }> {
    const startTime = Date.now()
    
    try {
      console.log('📊 Loading POI statistics:', filters)
      
      const response = await fetch('/api/pois/stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(filters || {})
      })
      
      const result = await response.json()
      
      if (result.success) {
        return {
          success: true,
          data: result.data
        }
      } else {
        return {
          success: false,
          error: result.error || 'Failed to load statistics'
        }
      }
      
    } catch (error) {
      console.error('Error loading POI statistics:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }
  
  /**
   * Transform database record to POI interface
   */
  private static transformToPOI(data: any): POI {
    return {
      id: data.id,
      name: data.name,
      city: data.city,
      country: data.country,
      state: data.state,
      category: data.google_types?.[0] || 'point_of_interest',
      approved: data.approved,
      approved_by: data.approved_by,
      approved_at: data.approved_at,
      rating: data.rating,
      image_url: data.image_url,
      created_at: data.created_at,
      updated_at: data.updated_at,
      user_ratings_total: data.user_ratings_total,
      formatted_address: data.address,
      vicinity: data.vicinity,
      website: data.website,
      formatted_phone_number: data.formatted_phone_number,
      business_status: data.business_status,
      price_level: data.price_level,
      opening_hours: data.opening_hours,
      google_types: data.google_types,
      photos_references: data.photos_references,
      google_place_id: data.google_place_id,
      user_id: data.user_id,
      coordinates: data.latitude && data.longitude ? {
        latitude: data.latitude,
        longitude: data.longitude
      } : undefined,
      has_description: (data.attraction_descriptions?.length || 0) > 0,
      has_audio: false, // TODO: Implement audio detection
      description_count: data.attraction_descriptions?.length || 0,
      audio_count: 0, // TODO: Implement audio count
      available_languages: data.attraction_descriptions?.map((d: any) => d.language) || [],
      trigger_points_count: data.attraction_trigger_points?.length || 0,
      active_trigger_points_count: data.attraction_trigger_points?.filter((tp: any) => tp.is_active)?.length || 0,
      reference_links: [],
      descriptions: data.attraction_descriptions,
      group_status: data.attraction_groups?.[0] ? {
        is_in_group: true,
        group_id: data.attraction_groups[0].id,
        group_name: data.attraction_groups[0].name,
        group_role: data.attraction_groups[0].role || 'main',
        group_member_count: 1
      } : undefined,
      verification_score: data.verification_score,
      processing_status: data.processing_status,
      last_processed: data.last_processed,
      has_boundary: data.has_boundary,
      boundary_source: data.boundary_source
    }
  }
  
  /**
   * Generate cache key for filters
   */
  private static generateCacheKey(operation: string, filters: any): string {
    const filterString = JSON.stringify(filters)
    return `${operation}_${Buffer.from(filterString).toString('base64')}`
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

/**
 * Convenience functions for common use cases
 */
export const poiService = {
  search: (filters: POISearchFilters) => POIService.search(filters),
  getForProcessing: (type: 'trigger_points' | 'descriptions' | 'osm_enrichment', filters: any) => 
    POIService.getForProcessing(type, filters),
  getById: (id: string) => POIService.getById(id),
  getStats: (filters?: any) => POIService.getStats(filters),
  clearCache: () => POIService.clearCache(),
  getCacheStats: () => POIService.getCacheStats()
}

export default POIService
