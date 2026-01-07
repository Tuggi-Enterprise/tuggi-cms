/**
 * POI Map Service - Optimized for Map Visualization
 * 
 * Features:
 * - Parallel chunk fetching for speed
 * - Progressive loading with callbacks
 * - Lightweight payload (map-specific data only)
 * - Efficient memory usage
 */

import { getSupabaseClient } from '@/lib/core/supabase-client'

export interface MapPOI {
  id: string
  name: string
  latitude: number
  longitude: number
  type: 'cluster' | 'poi'
  count: number
  metadata?: any
  // Legacy compatibility fields (optional)
  city?: string
  state?: string
  country?: string
  approved?: boolean
  rating?: number
  image_url?: string
  formatted_address?: string
  user_ratings_total?: number
  google_types?: string[]
}

export interface MapSearchFilters {
  country?: string
  state?: string
  city?: string
  status?: 'all' | 'approved' | 'pending'
  search?: string
  googleTypes?: string
}

export interface MapSearchOptions {
  // Options for react-query if needed
}

export interface MapSearchResult {
  data: MapPOI[]
  duration: number
}

/**
 * Fetch POIs optimized for map display using server-side clustering
 */
export async function fetchPOIsForMap(
  filters: MapSearchFilters,
  bounds: { minLat: number; minLng: number; maxLat: number; maxLng: number },
  zoom: number
): Promise<MapSearchResult> {
  const startTime = performance.now()
  const supabase = getSupabaseClient()
  
  console.log(`🗺️ Fetching map POIs with bounds [${bounds.minLat}, ${bounds.minLng}] to [${bounds.maxLat}, ${bounds.maxLng}] zoom ${zoom}`)

  const { data, error } = await supabase.schema('core').rpc('cms_search_pois_map', {
    min_lat: bounds.minLat,
    min_lng: bounds.minLng,
    max_lat: bounds.maxLat,
    max_lng: bounds.maxLng,
    zoom_level: zoom,
    search_term: filters.search || null,
    status_filter: filters.status || 'all',
    country_filter: filters.country || null,
    state_filter: filters.state || null,
    city_filter: filters.city || null,
    google_types_filter: filters.googleTypes || null
  })

  if (error) {
    console.error('❌ Error fetching map POIs:', error)
    return { data: [], duration: performance.now() - startTime }
  }
  
  // Transform data
  const pois: MapPOI[] = (data || []).map((row: any) => ({
    id: row.ids && row.ids.length > 0 ? row.ids[0] : row.id, // For clusters, row.id might be null if aggregated heavily, but our SQL returns ID if count <= 10 or just ID
    name: row.name,
    latitude: row.latitude,
    longitude: row.longitude,
    type: row.type as 'cluster' | 'poi',
    count: row.count,
    metadata: row.metadata,
    // Map metadata to legacy fields if available (for individual POIs)
    city: row.metadata?.city,
    state: row.metadata?.state
  }))

  const duration = performance.now() - startTime
  console.log(`✅ Map fetch complete: ${pois.length} items (clusters/pois) in ${(duration / 1000).toFixed(2)}s`)
  
  return {
    data: pois,
    duration
  }
}

/**
 * Get total count of POIs for map (fast query)
 */
async function getMapPOICount(filters: MapSearchFilters): Promise<number> {
  const supabase = getSupabaseClient()
  
  let query = supabase
    .schema('core')
    .from('attractions')
    .select('id', { count: 'exact', head: true })
    .not('id', 'is', null) // Exists
  
  // Apply filters
  if (filters.country) {
    query = query.eq('country', filters.country)
  }
  if (filters.state) {
    query = query.eq('state', filters.state)
  }
  if (filters.city) {
    query = query.eq('city', filters.city)
  }
  if (filters.status && filters.status !== 'all') {
    query = query.eq('approved', filters.status === 'approved')
  }
  if (filters.search) {
    query = query.or(`name.ilike.%${filters.search}%,city.ilike.%${filters.search}%,country.ilike.%${filters.search}%`)
  }
  
  const { count, error } = await query
  
  if (error) {
    console.error('❌ Error getting POI count:', error)
    return 0
  }
  
  return count || 0
}

/**
 * Fetch single page for normal pagination (fallback)
 */
// Deprecated or fallback using world bounds
export async function fetchMapPOIsPage(
  filters: MapSearchFilters,
  limit: number = 1000,
  offset: number = 0
): Promise<MapPOI[]> {
  const supabase = getSupabaseClient()
  
  // Call with world bounds
  const { data, error } = await supabase.schema('core').rpc('cms_search_pois_map', {
    min_lat: -90,
    min_lng: -180,
    max_lat: 90,
    max_lng: 180,
    zoom_level: 15, // High zoom to get points
    search_term: filters.search || null,
    status_filter: filters.status || 'all',
    country_filter: filters.country || null,
    state_filter: filters.state || null,
    city_filter: filters.city || null,
     google_types_filter: filters.googleTypes || null
  })
  
  if (error || !data) return []
  
  return data.map((row: any) => ({
    id: row.id,
    name: row.name,
    latitude: row.latitude,
    longitude: row.longitude,
    type: row.type,
    count: row.count,
    metadata: row.metadata,
    city: row.metadata?.city,
    state: row.metadata?.state
  }))
}

