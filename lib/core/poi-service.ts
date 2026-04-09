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
  osm_category?: string | null
  record_type?: string
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
  /** FK to clients table - indicates which client owns this POI */
  owner_id?: string
  /** FK to cms_users table - who created this POI */
  created_by?: string
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
  trigger_points?: any[]
  is_active: boolean
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
  // Verification data
  verification_data?: {
    verification_status: 'pending' | 'approved' | 'needs_review' | 'rejected' | null
    score: number | null
    last_verified_at: string | null
    is_original: boolean
    language: string
    subscores?: any
    flags?: any
    description_id?: string
  }
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
  osmCategory?: string
  contentStatus?: 'all' | 'missing_description' | 'missing_audio' | 'complete'
  groupStatus?: 'all' | 'grouped' | 'ungrouped' | 'group_main' | 'group_member'
  scoreFilter?: 'all' | 'no_score' | 'rejected' | 'pending' | 'approved'
  triggerPointsFilter?: 'all' | 'with_trigger_points' | 'without_trigger_points'
  processingType?: 'without_trigger_points' | 'with_trigger_points' | 'all'
  language?: string
  limit?: number
  page?: number
  fetch_all?: boolean  // New parameter for map view
  map_view?: boolean   // New parameter to indicate map context
  isActiveFilter?: 'all' | 'active' | 'inactive'
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
   * Search POIs with Trigger Point coordinates (Optimized for Map Visualization)
   */
  static async getWithTriggers(filters: { city: string; state?: string; country?: string }): Promise<POI[]> {
    const supabase = getSupabase(typeof window !== 'undefined' ? 'client' : 'server');
    const { data, error } = await supabase
      .schema('core')
      .rpc('get_pois_with_trigger_coords', {
        p_city_filter: filters.city,
        p_state_filter: filters.state || null,
        p_country_filter: filters.country || null
      })

    if (error) {
      console.error('Error fetching POIs with triggers:', error)
      throw error
    }

    return (data || []).map((row: any) => this.transformToPOI(row))
  }

  /**
   * Search POIs with filters using RPC
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
      
      
      const supabase = getSupabase(typeof window !== 'undefined' ? 'client' : 'server')
      
      // Use the new RPC function for efficient search
      const rpcParams = {
        search_term: filters.search || null,
        status_filter: filters.status || 'all',
        country_filter: filters.country || null,
        state_filter: filters.state || null,
        city_filter: filters.city || null,
        google_types_filter: filters.googleTypes || null,
        category_filter: filters.category || null,
        osm_category_filter: filters.osmCategory || null,
        content_status_filter: filters.contentStatus || null,
        group_status_filter: filters.groupStatus || 'all',
        score_filter: filters.scoreFilter || 'all',
        trigger_points_filter: filters.triggerPointsFilter || 'all',
        is_active_filter: filters.isActiveFilter || 'all',
        limit_count: filters.fetch_all ? 0 : (filters.limit || 1000),
        offset_count: filters.fetch_all ? 0 : ((filters.page || 1) - 1) * (filters.limit || 1000),
        fetch_all: filters.fetch_all || false,
        p_owner_id: (filters as any).ownerId || null
      }
      
      
      let data: any[] = []
      let error: any = null
      
      if (rpcParams.fetch_all) {
        
        let allData: any[] = []
        let currentOffset = 0
        const chunkSize = 1000
        let hasMore = true
        
        while (hasMore) {
          const chunkParams = {
            ...rpcParams,
            fetch_all: false, // Use pagination for chunks
            limit_count: chunkSize,
            offset_count: currentOffset
          }
          
          
          const { data: chunkData, error: chunkError } = await supabase
            .schema('core')
            .rpc('cms_search_pois', chunkParams)
          
          if (chunkError) {
            throw new Error(`RPC error: ${chunkError.message}`)
          }
          
          if (!chunkData || chunkData.length === 0) {
            hasMore = false
          } else {
            allData = [...allData, ...chunkData]
            currentOffset += chunkSize
            
            // If we got less than chunkSize, we've reached the end
            if (chunkData.length < chunkSize) {
              hasMore = false
            }
            
            // Safety check to prevent infinite loops
            if (currentOffset > 100000) {
              hasMore = false
            }
          }
        }
        
        data = allData
        error = null
      } else {
        // Normal single call (not fetch_all)
        const result = await supabase.schema('core').rpc('cms_search_pois', rpcParams)
        data = result.data || []
        error = result.error
      }
      
      if (data && data.length > 0) {
        // Extract statistics from the first row (they're the same for all rows)
        const stats = {
          total: data[0].total_count || 0,
          approved: data[0].approved_count || 0,
          pending: data[0].pending_count || 0,
          withDescription: data[0].with_description_count || 0,
          withAudio: data[0].with_audio_count || 0,
          withTriggerPoints: data[0].with_trigger_points_count || 0,
          complete: data[0].complete_count || 0
        }
        
        // Transform the data to match our POI interface
        const pois = data.map((row: any) => ({
            id: row.id,
            name: row.name,
            city: row.city,
            state: row.state,
            country: row.country,
            category: row.osm_category || row.category || 'point_of_interest',
            osm_category: row.osm_category,
            record_type: row.category,
            approved: row.approved,
            is_active: row.is_active ?? true,
            created_at: row.created_at,
            updated_at: row.updated_at,
          user_id: row.user_id,
          owner_id: row.owner_id,
          created_by: row.created_by,
          business_status: row.business_status,
          formatted_phone_number: row.formatted_phone_number,
          coordinates: (row.latitude && row.longitude) ? {
            latitude: Number(row.latitude),
            longitude: Number(row.longitude)
          } : (row.coordinates && row.coordinates[0]) ? {
            latitude: Number(row.coordinates[0].latitude),
            longitude: Number(row.coordinates[0].longitude)
          } : (row.coordinates && typeof row.coordinates === 'object') ? {
            latitude: Number(row.coordinates.latitude),
            longitude: Number(row.coordinates.longitude)
          } : undefined,
          descriptions: row.descriptions || [],
          trigger_points: row.trigger_points || [],
          group_membership: row.group_membership || [],
          verification_data: row.verification_data,
          // Content status indicators
          has_description: (row.descriptions?.length || 0) > 0,
          has_audio: (row.descriptions?.filter((d: any) => d.audio_url)?.length || 0) > 0,
          description_count: row.descriptions?.length || 0,
          audio_count: row.descriptions?.filter((d: any) => d.audio_url)?.length || 0,
          available_languages: row.descriptions?.map((d: any) => d.language) || [],
          trigger_points_count: row.trigger_points?.length || 0,
          active_trigger_points_count: row.trigger_points?.filter((tp: any) => tp.is_active)?.length || 0,
          // Group status
          group_status: row.group_membership?.[0] ? {
            is_in_group: true,
            group_id: row.group_membership[0].group_id,
            group_name: row.group_membership[0].group_name,
            group_role: row.group_membership[0].group_role || 'main',
            group_member_count: row.group_membership.length
          } : undefined
        }))
        
        const totalCount = stats.total
        const page = filters.page || 1
        const limit = filters.limit || 1000
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
      } else {
        return {
          success: true,
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
          }
        }
      }
      
    } catch (error) {
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
    
    try {
      
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
      
      const supabase = getSupabase('server')
      
      // First, check if there are multiple rows with the same ID (should never happen, but let's be safe)
      const { count: duplicateCount } = await supabase
        .schema('core')
        .from('attractions')
        .select('id', { count: 'exact', head: true })
        .eq('id', id)
      
      if (duplicateCount && duplicateCount > 1) {
        console.error(`❌ CRITICAL: Found ${duplicateCount} duplicate rows for POI ${id} in core.attractions`)
        // This should never happen, but if it does, we need to handle it
        // For now, we'll try to get the first one
      }
      
      // Use maybeSingle() instead of single() to handle edge cases
      // PostgREST should aggregate relations into arrays automatically
      const { data, error } = await supabase
        .schema('core')
        .from('attractions')
        .select(`
          *,
          attraction_descriptions(id, language, description),
          attraction_group_members(
            group_role,
            attraction_groups(id, name)
          ),
          attraction_trigger_points(id, is_active),
          coordinates:attraction_coordinate(latitude, longitude)
        `)
        .eq('id', id)
        .maybeSingle()
      
      if (error) {
        // If error is about multiple rows, try a different approach
        if (error.code === 'PGRST116' || error.message.includes('multiple')) {
          console.warn(`⚠️  Multiple rows detected for POI ${id}, trying alternative query...`)
          // Try without relations first, then load relations separately
          const { data: baseData, error: baseError } = await supabase
            .schema('core')
            .from('attractions')
            .select('*')
            .eq('id', id)
            .limit(1)
            .maybeSingle()
          
          if (baseError || !baseData) {
            throw new Error(`Database error: ${baseError?.message || error.message}`)
          }
          
          // Load relations separately
          const [descriptions, groupMembers, triggerPoints, coordinates] = await Promise.all([
            supabase.schema('core').from('attraction_descriptions').select('id, language, description').eq('attraction_id', id),
            supabase.schema('core').from('attraction_group_members').select('group_role, attraction_groups(id, name)').eq('attraction_id', id),
            supabase.schema('core').from('attraction_trigger_points').select('id, is_active').eq('attraction_id', id),
            supabase.schema('core').from('attraction_coordinate').select('latitude, longitude').eq('attraction_id', id).maybeSingle()
          ])
          
          const data = {
            ...baseData,
            attraction_descriptions: descriptions.data || [],
            attraction_group_members: groupMembers.data || [],
            attraction_trigger_points: triggerPoints.data || [],
            coordinates: coordinates.data || null
          }
          
          const poi = this.transformToPOI(data)
          this.cache.set(cacheKey, { data: poi, timestamp: startTime })
          return { success: true, data: poi }
        }
        throw new Error(`Database error: ${error.message}`)
      }
      
      if (!data) {
        return {
          success: false,
          error: 'POI not found'
        }
      }
      
      // Debug: Log the raw data structure
      console.log('🔍 Raw POI data structure:', JSON.stringify({
        id: data.id,
        has_coordinates: !!data.coordinates,
        coordinates_type: typeof data.coordinates,
        coordinates_length: Array.isArray(data.coordinates) ? data.coordinates.length : 'not array',
        coordinates_value: data.coordinates
      }, null, 2))
      
      const poi = this.transformToPOI(data)
      
      // Debug: Log transformed coordinates
      console.log('🔍 Transformed POI coordinates:', poi.coordinates)
      
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
   * Get POI statistics using RPC
   */
  static async getStats(filters?: POISearchFilters): Promise<{ success: boolean; data?: POIStats; error?: string }> {
    const startTime = Date.now()
    
    try {
      console.log('📊 Loading POI statistics with RPC:', filters)
      
      const supabase = getSupabase('server')
      
      // Use the RPC function with fetch_all=true to get complete statistics
      const { data, error } = await supabase.schema('core').rpc('cms_search_pois', {
        search_term: filters?.search || null,
        status_filter: filters?.status || 'all',
        country_filter: filters?.country || null,
        state_filter: filters?.state || null,
        city_filter: filters?.city || null,
        google_types_filter: filters?.googleTypes || null,
        category_filter: filters?.category || null,
        content_status_filter: filters?.contentStatus || null,
        group_status_filter: filters?.groupStatus || null,
        score_filter: filters?.scoreFilter || null,
        trigger_points_filter: filters?.triggerPointsFilter || null,
        limit_count: 1, // We only need one row to get the statistics
        offset_count: 0,
        fetch_all: true // This ensures we get statistics for ALL matching records
      })
      
      if (error) {
        console.error('❌ POI Statistics RPC failed:', error)
        return {
          success: false,
          error: error.message || 'Failed to load statistics'
        }
      }
      
      if (data && data.length > 0) {
        // Extract statistics from the first row
        const row = data[0]
        const stats: POIStats = {
          total: row.total_count || 0,
          approved: row.approved_count || 0,
          pending: row.pending_count || 0,
          content_stats: {
            with_description: row.with_description_count || 0,
            with_audio: row.with_audio_count || 0,
            complete: row.complete_count || 0,
            missing_description: (row.total_count || 0) - (row.with_description_count || 0),
            missing_audio: (row.total_count || 0) - (row.with_audio_count || 0)
          },
          group_stats: {
            grouped: 0, // Not available in current RPC
            ungrouped: 0,
            group_main: 0,
            group_member: 0
          },
          trigger_points_stats: {
            with_trigger_points: row.with_trigger_points_count || 0,
            without_trigger_points: (row.total_count || 0) - (row.with_trigger_points_count || 0),
            total_trigger_points: 0, // Not available in current RPC
            active_trigger_points: 0
          },
          verification_stats: {
            no_score: 0, // Not available in current RPC
            pending: 0,
            approved: 0,
            rejected: 0
          },
          countries: [], // Not available in current RPC
          cities: []
        }
        
        console.log(`✅ POI Statistics RPC completed in ${Date.now() - startTime}ms`)
        return {
          success: true,
          data: stats
        }
      } else {
        console.log('✅ POI Statistics RPC completed - No data found')
        return {
          success: true,
          data: {
            total: 0,
            approved: 0,
            pending: 0,
            content_stats: {
              with_description: 0,
              with_audio: 0,
              complete: 0,
              missing_description: 0,
              missing_audio: 0
            },
            group_stats: {
              grouped: 0,
              ungrouped: 0,
              group_main: 0,
              group_member: 0
            },
            trigger_points_stats: {
              with_trigger_points: 0,
              without_trigger_points: 0,
              total_trigger_points: 0,
              active_trigger_points: 0
            },
            verification_stats: {
              no_score: 0,
              pending: 0,
              approved: 0,
              rejected: 0
            },
            countries: [],
            cities: []
          }
        }
      }
      
    } catch (error) {
      console.error('Error loading POI statistics with RPC:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  /**
   * Get candidates for migration
   */
  static async getMigrationCandidates(
    filters: {
      country?: string
      state?: string
      city?: string
      processingStatus?: string
      limit?: number
      source?: string
    }
  ): Promise<{ success: boolean; data: any[]; error?: string }> {
    try {
      const params = new URLSearchParams()
      if (filters.country) params.set('country', filters.country)
      if (filters.state) params.set('state', filters.state)
      if (filters.city) params.set('city', filters.city)
      if (filters.processingStatus) params.set('processing_status', filters.processingStatus)
      if (filters.limit) params.set('limit', filters.limit.toString())
      if (filters.source) params.set('source', filters.source)

      const response = await fetch(`/api/migration/list-candidates?${params.toString()}`)
      const result = await response.json()

      if (result.success) {
        return {
          success: true,
          data: result.data || []
        }
      } else {
        return {
          success: false,
          data: [],
          error: result.error || 'Failed to load migration candidates'
        }
      }
    } catch (error) {
      console.error('Error getting migration candidates:', error)
      return {
        success: false,
        data: [],
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
      category: data.osm_category || data.category || 'point_of_interest',
      osm_category: data.osm_category,
      record_type: data.category,
      approved: data.approved,
      is_active: data.is_active ?? true,
      approved_by: data.approved_by,
      approved_at: data.approved_at,
      rating: 0,
      created_at: data.created_at,
      updated_at: data.updated_at,
      formatted_address: data.formatted_address || data.address || null,
      vicinity: data.vicinity,
      website: data.website,
      formatted_phone_number: data.formatted_phone_number,
      business_status: data.business_status,
      user_id: data.user_id,
      owner_id: data.owner_id,
      created_by: data.created_by,
      coordinates: (data.latitude && data.longitude) ? {
        latitude: Number(data.latitude),
        longitude: Number(data.longitude)
      } : (data.coordinates && data.coordinates[0]) ? {
        latitude: Number(data.coordinates[0].latitude),
        longitude: Number(data.coordinates[0].longitude)
      } : (data.coordinates && typeof data.coordinates === 'object' && !Array.isArray(data.coordinates)) ? {
        latitude: Number(data.coordinates.latitude),
        longitude: Number(data.coordinates.longitude)
      } : undefined,
      has_description: (data.descriptions?.length || 0) > 0,
      has_audio: (data.descriptions?.filter((d: any) => d.audio_url)?.length || 0) > 0,
      description_count: data.descriptions?.length || 0,
      audio_count: data.descriptions?.filter((d: any) => d.audio_url)?.length || 0,
      available_languages: data.descriptions?.map((d: any) => d.language) || [],
      trigger_points_count: data.trigger_points?.length || 0,
      active_trigger_points_count: data.trigger_points?.filter((tp: any) => tp.is_active)?.length || 0,
      trigger_points: data.trigger_points || [],
      descriptions: data.descriptions,
      group_status: data.group_membership?.[0] ? {
        is_in_group: true,
        group_id: data.group_membership[0].group_id,
        group_name: data.group_membership[0].group_name,
        group_role: data.group_membership[0].group_role || 'main',
        group_member_count: data.group_membership.length
      } : undefined,
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
  getWithTriggers: (filters: { city: string; state?: string; country?: string }) => 
    POIService.getWithTriggers(filters),
  search: (filters: POISearchFilters) => POIService.search(filters),
  getForProcessing: (type: 'trigger_points' | 'descriptions' | 'osm_enrichment', filters: any) => 
    POIService.getForProcessing(type, filters),
  getById: (id: string) => POIService.getById(id),
  getStats: (filters?: any) => POIService.getStats(filters),
  getMigrationCandidates: (filters: any) => POIService.getMigrationCandidates(filters),
  clearCache: () => POIService.clearCache(),
  getCacheStats: () => POIService.getCacheStats()
}

export default POIService
