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
  city: string
  state: string
  country: string
  latitude: number
  longitude: number
  approved: boolean
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
}

export interface MapSearchOptions {
  onProgress?: (loaded: number, total: number) => void
  onChunk?: (chunk: MapPOI[], total: number) => void
  maxParallel?: number
  chunkSize?: number
}

export interface MapSearchResult {
  data: MapPOI[]
  total: number
  duration: number
}

/**
 * Fetch POIs optimized for map display with parallel loading
 */
export async function fetchPOIsForMap(
  filters: MapSearchFilters,
  options: MapSearchOptions = {}
): Promise<MapSearchResult> {
  const startTime = performance.now()
  
  const {
    onProgress,
    onChunk,
    maxParallel = 3,
    chunkSize = 5000
  } = options

  const supabase = getSupabaseClient()
  
  // Step 1: Get total count first (fast query)
  const totalCount = await getMapPOICount(filters)
  console.log(`🗺️ Total POIs to fetch: ${totalCount}`)
  
  if (totalCount === 0) {
    return { data: [], total: 0, duration: performance.now() - startTime }
  }

  // Step 2: Fetch in parallel chunks
  const allPOIs: MapPOI[] = []
  const totalChunks = Math.ceil(totalCount / chunkSize)
  
  for (let i = 0; i < totalChunks; i += maxParallel) {
    // Create batch of parallel requests
    const batchPromises: Promise<{ data: any[] | null; error: any }>[] = []
    
    for (let j = 0; j < maxParallel && (i + j) < totalChunks; j++) {
      const offset = (i + j) * chunkSize
      
      console.log(`🔍 Fetching chunk ${i + j + 1}/${totalChunks} (offset: ${offset})`)
      
      // Build RPC call (note: RPCs have hard 1000 limit, chunkSize should be 1000)
      const rpcCall = supabase.schema('core').rpc('cms_search_pois_map', {
        country_filter: filters.country || null,
        state_filter: filters.state || null,
        city_filter: filters.city || null,
        status_filter: filters.status || 'all',
        search_term: filters.search || null,
        limit_count: chunkSize,
        offset_count: offset
      })
      
      batchPromises.push(rpcCall)
    }
    
    // Wait for parallel batch
    const results = await Promise.all(batchPromises)
    
    // Process results
    results.forEach(({ data, error }) => {
      if (error) {
        console.error('❌ Chunk fetch error:', error)
        return
      }
      
      if (data && data.length > 0) {
        const typedData = data.map(row => ({
          id: row.id,
          name: row.name,
          city: row.city,
          state: row.state,
          country: row.country,
          latitude: parseFloat(row.latitude),
          longitude: parseFloat(row.longitude),
          approved: row.approved,
          rating: row.rating ? parseFloat(row.rating) : undefined,
          image_url: row.image_url,
          formatted_address: row.formatted_address,
          user_ratings_total: row.user_ratings_total,
          google_types: row.google_types
        }))
        
        allPOIs.push(...typedData)
        
        // Callback for progressive rendering
        if (onChunk) {
          onChunk(typedData, totalCount)
        }
      }
    })
    
    // Progress callback
    if (onProgress) {
      onProgress(allPOIs.length, totalCount)
    }
    
    console.log(`✅ Batch complete: ${allPOIs.length}/${totalCount} POIs loaded`)
  }
  
  const duration = performance.now() - startTime
  console.log(`🎉 Map POIs loaded: ${allPOIs.length} POIs in ${(duration / 1000).toFixed(2)}s`)
  
  return {
    data: allPOIs,
    total: totalCount,
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
export async function fetchMapPOIsPage(
  filters: MapSearchFilters,
  limit: number = 1000,
  offset: number = 0
): Promise<MapPOI[]> {
  const supabase = getSupabaseClient()
  
  const { data, error } = await supabase.schema('core').rpc('cms_search_pois_map', {
    country_filter: filters.country || null,
    state_filter: filters.state || null,
    city_filter: filters.city || null,
    status_filter: filters.status || 'all',
    search_term: filters.search || null,
    limit_count: limit,
    offset_count: offset
  })
  
  if (error) {
    console.error('❌ Error fetching map POIs page:', error)
    return []
  }
  
  if (!data) return []
  
  return data.map((row: any) => ({
    id: row.id,
    name: row.name,
    city: row.city,
    state: row.state,
    country: row.country,
    latitude: parseFloat(row.latitude),
    longitude: parseFloat(row.longitude),
    approved: row.approved,
    rating: row.rating ? parseFloat(row.rating) : undefined,
    image_url: row.image_url,
    formatted_address: row.formatted_address,
    user_ratings_total: row.user_ratings_total,
    google_types: row.google_types
  }))
}

