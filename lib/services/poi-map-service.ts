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
import { nameMatchFilter } from '@/lib/shared/name-search'

export interface MapPOI {
  id: string
  name: string
  latitude: number
  longitude: number
  type: 'cluster' | 'poi'
  count: number
  metadata?: any
  // Nível de prioridade (1/2/3) — vem de metadata.priority_level (só POI individual, não cluster).
  priority_level?: number | null
  // Legacy compatibility fields (optional)
  city?: string
  state?: string
  country?: string
  approved?: boolean
  has_description?: boolean
  has_audio?: boolean
  trigger_points_count?: number
  active_trigger_points_count?: number
}

export interface MapSearchFilters {
  country?: string
  state?: string
  city?: string
  status?: 'all' | 'approved' | 'pending'
  search?: string
  isActiveFilter?: 'all' | 'active' | 'inactive'
  // Subconjunto de níveis a mostrar; undefined/todos = sem filtro.
  priorityLevels?: number[]
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

  // If the caller is logged in as a client, restrict map results to their own POIs
  let ownerId: string | null = null
  try {
    const { data: sessionData } = await supabase.auth.getSession()
    if (sessionData?.session) {
      const { data: cmsUser } = await supabase
        .schema('core')
        .from('cms_users')
        .select('id, role')
        .eq('email', sessionData.session.user.email)
        .single()
      if (cmsUser && cmsUser.role === 'client') {
        ownerId = cmsUser.id
        console.log('🗺️ Map fetch: applying owner filter for client', ownerId)
      }
    }
  } catch (err) {
    console.warn('🗺️ Map fetch: could not determine cms user for owner filtering', err)
  }

  const rpcParams: any = {
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
    is_active_filter: filters.isActiveFilter || 'all'
  }

  // Só envia quando é subconjunto real (1 ou 2 níveis) — mantém compat com a RPC antiga.
  if (Array.isArray(filters.priorityLevels) && filters.priorityLevels.length > 0 && filters.priorityLevels.length < 3) {
    rpcParams.priority_levels = filters.priorityLevels
  }

  if (ownerId) rpcParams.p_owner_id = ownerId

  const { data, error } = await supabase.schema('core').rpc('cms_search_pois_map', rpcParams)

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
    priority_level: row.metadata?.priority_level ?? null,
    // Map metadata to legacy fields if available (for individual POIs)
    city: row.metadata?.city,
    state: row.metadata?.state,
    country: row.metadata?.country,
    approved: row.metadata?.approved,
    has_description: row.metadata?.has_description,
    has_audio: row.metadata?.has_audio,
    trigger_points_count: row.metadata?.trigger_points_count,
    active_trigger_points_count: row.metadata?.active_trigger_points_count
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
    query = query.or(nameMatchFilter(['name', 'city', 'country'], filters.search))
  }
  if (filters.isActiveFilter && filters.isActiveFilter !== 'all') {
    query = query.eq('is_active', filters.isActiveFilter === 'active')
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
    is_active_filter: filters.isActiveFilter || 'all'
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

