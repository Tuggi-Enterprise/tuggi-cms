/**
 * Trail Visualization Service
 * 
 * Centralized service for trail visualization data fetching.
 * Follows DRY and SSOF principles - single source of truth for trail data.
 */

import { getSupabase } from '@/lib/core/supabase-client'
import { memoryCache } from '@/lib/cache/memory-cache'

export interface TrailQueryParams {
  bounds?: {
    north: number
    south: number
    east: number
    west: number
  }
  userIds?: string[]
  tripSessionIds?: string[]
  startDate?: string
  endDate?: string
  onlyMoving?: boolean
  limit?: number
  offset?: number
  fetchAll?: boolean // If true, fetch ALL available data (no limit)
}

export interface TrailPoint {
  id: string
  user_id: string
  trip_session_id: string
  latitude: number
  longitude: number
  timestamp: string
  sequence_order: number
  is_moving?: boolean
  speed?: number
  accuracy?: number
  heading?: number
}

export interface TrailData {
  trails: Array<{
    user_id: string
    trip_session_id: string
    points: TrailPoint[]
  }>
  pagination: {
    total: number
    limit: number
    offset: number
    hasMore: boolean
  }
  stats?: {
    total_points: number
    unique_users: number
    unique_trips: number
    date_range?: { start: string; end: string }
  }
}

export interface HeatMapParams {
  bounds: {
    north: number
    south: number
    east: number
    west: number
  }
  gridSize?: number
  startDate?: string
  endDate?: string
  useMaterializedView?: boolean
}

export interface HeatMapData {
  heatmap: Array<{
    lat: number
    lng: number
    weight: number
    unique_users?: number
    unique_trips?: number
    avg_speed?: number
    moving_points?: number
  }>
  gridSize: number
  totalPoints: number
  bounds: {
    north: number
    south: number
    east: number
    west: number
  }
  source?: 'materialized_view' | 'realtime'
}

export interface UserInfo {
  id: string
  email?: string
  trail_count: number
  trip_count?: number
  last_activity?: string
}

interface DistinctUser {
  user_id: string
  first_seen?: string
  last_seen?: string
}

export class TrailVisualizationService {
  /**
   * Get trail data with optimized query
   * Groups points by trip_session_id for proper polyline rendering
   */
  static async getTrails(params: TrailQueryParams): Promise<{
    success: boolean
    data?: TrailData
    error?: string
  }> {
    try {
      const supabase = getSupabase('server')

      // Build optimized query with spatial filtering
      // Note: We don't use count: 'exact' to avoid timeout on large datasets
      // Select only necessary fields to reduce data transfer
      const fieldsToSelect = 'id,user_id,trip_session_id,latitude,longitude,timestamp,sequence_order,is_moving,speed,accuracy,heading'
      let query = supabase
        .schema('drive')
        .from('route_trail')
        .select(fieldsToSelect)

      // Apply filters
      if (params.bounds) {
        query = query
          .gte('latitude', params.bounds.south)
          .lte('latitude', params.bounds.north)
          .gte('longitude', params.bounds.west)
          .lte('longitude', params.bounds.east)
      }

      if (params.userIds && params.userIds.length > 0) {
        query = query.in('user_id', params.userIds)
      }

      if (params.tripSessionIds && params.tripSessionIds.length > 0) {
        query = query.in('trip_session_id', params.tripSessionIds)
      }

      if (params.startDate) {
        query = query.gte('timestamp', params.startDate)
      }

      if (params.endDate) {
        query = query.lte('timestamp', params.endDate)
      }

      if (params.onlyMoving) {
        query = query.eq('is_moving', true)
      }

      // Apply pagination WITHOUT ordering to avoid timeout
      // Ordering large datasets before limiting causes timeout
      // We'll sort in memory after fetching
      const limit = Math.min(params.limit || 2000, 2000) // Max 2000 points per query
      const offset = params.offset || 0
      query = query.range(offset, offset + limit - 1)

      // DO NOT order here - it causes timeout on large datasets
      // We'll sort the results in memory after fetching

      // Set a timeout for the query (Supabase default is 60s, but we want to fail faster)
      const { data, error } = await query

      if (error) {
        console.error('Error fetching trails:', error)
        return {
          success: false,
          error: error.message
        }
      }

      if (!data || data.length === 0) {
        return {
          success: true,
          data: {
            trails: [],
            pagination: {
              total: 0,
              limit,
              offset,
              hasMore: false
            }
          }
        }
      }

      // Group points by trip_session_id
      const trailsMap = new Map<string, TrailPoint[]>()
      data.forEach(point => {
        const key = point.trip_session_id
        if (!trailsMap.has(key)) {
          trailsMap.set(key, [])
        }
        trailsMap.get(key)!.push({
          id: point.id,
          user_id: point.user_id,
          trip_session_id: point.trip_session_id,
          latitude: point.latitude,
          longitude: point.longitude,
          timestamp: point.timestamp,
          sequence_order: point.sequence_order,
          is_moving: point.is_moving,
          speed: point.speed,
          accuracy: point.accuracy,
          heading: point.heading
        })
      })

      // Convert to array format and sort in memory
      // Sort by trip_session_id first, then by sequence_order within each trip
      const trails = Array.from(trailsMap.entries())
        .map(([trip_session_id, points]) => ({
          user_id: points[0].user_id,
          trip_session_id,
          points: points.sort((a, b) => a.sequence_order - b.sequence_order)
        }))
        .sort((a, b) => {
          // Sort by trip_session_id, then by first sequence_order
          if (a.trip_session_id !== b.trip_session_id) {
            return a.trip_session_id.localeCompare(b.trip_session_id)
          }
          const aFirstSeq = a.points[0]?.sequence_order || 0
          const bFirstSeq = b.points[0]?.sequence_order || 0
          return aFirstSeq - bFirstSeq
        })

      // Calculate stats
      const uniqueUsers = new Set(trails.map(t => t.user_id))
      const uniqueTrips = new Set(trails.map(t => t.trip_session_id))
      const timestamps = data.map(p => new Date(p.timestamp).getTime()).filter(t => !isNaN(t))
      const dateRange = timestamps.length > 0 ? {
        start: new Date(Math.min(...timestamps)).toISOString(),
        end: new Date(Math.max(...timestamps)).toISOString()
      } : undefined

      // Estimate if there's more data (we fetched limit items, so if we got exactly limit, there might be more)
      const hasMore = data.length === limit

      return {
        success: true,
        data: {
          trails,
          pagination: {
            total: data.length, // Approximate total (we don't have exact count to avoid timeout)
            limit,
            offset,
            hasMore
          },
          stats: {
            total_points: data.length,
            unique_users: uniqueUsers.size,
            unique_trips: uniqueTrips.size,
            date_range: dateRange
          }
        }
      }
    } catch (error) {
      console.error('Error in getTrails:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  /**
   * Get aggregated heat map data
   * Uses materialized view if available, otherwise real-time aggregation
   */
  static async getHeatMapData(params: HeatMapParams): Promise<{
    success: boolean
    data?: HeatMapData
    error?: string
  }> {
    try {
      const supabase = getSupabase('server')
      const gridSize = params.gridSize || 0.001

      // Try to use materialized view first
      if (params.useMaterializedView !== false) {
        try {
          let query = supabase
            .schema('drive')
            .from('trail_heatmap_grid')
            .select('*')
            .gte('grid_lat', Math.floor(params.bounds.south * 1000) / 1000)
            .lte('grid_lat', Math.ceil(params.bounds.north * 1000) / 1000)
            .gte('grid_lng', Math.floor(params.bounds.west * 1000) / 1000)
            .lte('grid_lng', Math.ceil(params.bounds.east * 1000) / 1000)

          const { data, error } = await query

          if (!error && data && data.length > 0) {
            return {
              success: true,
              data: {
                heatmap: data.map((cell: any) => ({
                  lat: cell.grid_lat,
                  lng: cell.grid_lng,
                  weight: cell.point_count || 0,
                  unique_users: cell.unique_users,
                  unique_trips: cell.unique_trips,
                  avg_speed: cell.avg_speed,
                  moving_points: cell.moving_points
                })),
                gridSize,
                totalPoints: data.reduce((sum: number, cell: any) => sum + (cell.point_count || 0), 0),
                bounds: params.bounds,
                source: 'materialized_view'
              }
            }
          }
        } catch (viewError) {
          // Materialized view doesn't exist or error, fall through to real-time
          console.log('Materialized view not available, using real-time aggregation')
        }
      }

      // Fallback: Real-time aggregation
      // Limit the query to prevent timeout - we'll aggregate on a sample
      let query = supabase
        .schema('drive')
        .from('route_trail')
        .select('latitude, longitude, user_id, trip_session_id, is_moving, speed')
        .gte('latitude', params.bounds.south)
        .lte('latitude', params.bounds.north)
        .gte('longitude', params.bounds.west)
        .lte('longitude', params.bounds.east)
        .limit(10000) // Limit to 10k points for aggregation to prevent timeout

      if (params.startDate) {
        query = query.gte('timestamp', params.startDate)
      }

      if (params.endDate) {
        query = query.lte('timestamp', params.endDate)
      }

      if (params.useMaterializedView !== false) {
        query = query.eq('is_moving', true)
      }

      const { data, error } = await query

      if (error) {
        return {
          success: false,
          error: error.message
        }
      }

      if (!data || data.length === 0) {
        return {
          success: true,
          data: {
            heatmap: [],
            gridSize,
            totalPoints: 0,
            bounds: params.bounds,
            source: 'realtime'
          }
        }
      }

      // Aggregate into grid cells
      const gridMap = new Map<string, {
        lat: number
        lng: number
        count: number
        users: Set<string>
        trips: Set<string>
        speeds: number[]
        moving: number
      }>()

      data.forEach(point => {
        const gridLat = Math.floor(point.latitude / gridSize) * gridSize
        const gridLng = Math.floor(point.longitude / gridSize) * gridSize
        const key = `${gridLat},${gridLng}`

        if (!gridMap.has(key)) {
          gridMap.set(key, {
            lat: gridLat,
            lng: gridLng,
            count: 0,
            users: new Set(),
            trips: new Set(),
            speeds: [],
            moving: 0
          })
        }

        const cell = gridMap.get(key)!
        cell.count++
        cell.users.add(point.user_id)
        cell.trips.add(point.trip_session_id)
        if (point.speed) {
          cell.speeds.push(point.speed)
        }
        if (point.is_moving) {
          cell.moving++
        }
      })

      const heatmap = Array.from(gridMap.values()).map(cell => ({
        lat: cell.lat,
        lng: cell.lng,
        weight: cell.count,
        unique_users: cell.users.size,
        unique_trips: cell.trips.size,
        avg_speed: cell.speeds.length > 0 ? cell.speeds.reduce((a, b) => a + b, 0) / cell.speeds.length : undefined,
        moving_points: cell.moving
      }))

      return {
        success: true,
        data: {
          heatmap,
          gridSize,
          totalPoints: data.length,
          bounds: params.bounds,
          source: 'realtime'
        }
      }
    } catch (error) {
      console.error('Error in getHeatMapData:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  /**
   * Get user list with trail counts
   */
  /**
   * Get user list - SOLUÇÃO REAL
   * 
   * Estratégia:
   * 1. Buscar DISTINCT user_id diretamente da tabela (muito mais rápido que view)
   * 2. Usar cache em memória para evitar queries repetidas
   * 3. Buscar stats da view trail_trips_unified (mais leve que trail_users_from_trips)
   * 
   * Funciona no Vercel: Memory cache funciona (não persiste entre deployments, mas OK para este caso)
   */
  static async getUsers(params?: {
    search?: string
    limit?: number
    offset?: number
    fetchAll?: boolean
  }): Promise<{
    success: boolean
    data?: {
      users: UserInfo[]
      total: number
      hasMore: boolean
    }
    error?: string
  }> {
    try {
      const supabase = getSupabase('service')
      const CACHE_KEY = 'trail-users:all'
      const CACHE_TTL = 10 // 10 minutos

      // 1. Verificar cache primeiro (se fetchAll e sem search)
      if (params?.fetchAll && !params?.search) {
        const cached = memoryCache.get<UserInfo[]>(CACHE_KEY)
        if (cached) {
          console.log(`[getUsers] ✅ Cache hit: ${cached.length} users`)
          return {
            success: true,
            data: {
              users: cached,
              total: cached.length,
              hasMore: false
            }
          }
        }
      }

      console.log('[getUsers] 🔍 Fetching distinct users using RPC (optimized)...')
      
      // SOLUÇÃO REAL: Usar RPC com DISTINCT/GROUP BY no banco
      // Muito mais eficiente que buscar 10k+ linhas e deduplicar em memória
      let userIds: string[] = []
      let lastSeenMap = new Map<string, string>()
      
      try {
        const { data: distinctUsers, error: rpcError } = await supabase
          .schema('drive')
          .rpc('get_trail_users_distinct', {
            user_limit: 10000 // Limite alto para pegar todos (são apenas 7 usuários)
          })

        if (rpcError) {
          throw rpcError
        }

        if (!distinctUsers || distinctUsers.length === 0) {
          console.log('[getUsers] No users found')
          return {
            success: true,
            data: {
              users: [],
              total: 0,
              hasMore: false
            }
          }
        }

        const usersList = distinctUsers as DistinctUser[]
        userIds = usersList.map((u: DistinctUser) => u.user_id)
        console.log(`[getUsers] ✅ Found ${userIds.length} unique users via RPC`)

        // Criar map de last_seen para ordenação
        usersList.forEach((u: DistinctUser) => {
          if (u.last_seen) {
            lastSeenMap.set(u.user_id, u.last_seen)
          }
        })
      } catch (rpcError) {
        console.warn('[getUsers] RPC not available, falling back to chunked approach:', rpcError)
        
        // FALLBACK: Buscar em chunks (método anterior)
        let allUserIds: Set<string> = new Set()
        let currentOffset = 0
        const chunkSize = 1000
        let hasMore = true
        let chunkCount = 0

        while (hasMore) {
          chunkCount++
          const { data: chunkData, error: chunkError } = await supabase
            .schema('drive')
            .from('route_trail')
            .select('user_id')
            .range(currentOffset, currentOffset + chunkSize - 1)

          if (chunkError) {
            console.error(`[getUsers] Error in chunk ${chunkCount}:`, chunkError)
            break
          }

          if (!chunkData || chunkData.length === 0) {
            hasMore = false
            break
          }

          chunkData.forEach(row => {
            if (row.user_id) {
              allUserIds.add(row.user_id)
            }
          })

          currentOffset += chunkData.length

          if (chunkData.length < chunkSize) {
            hasMore = false
          }

          if (currentOffset >= 100000) {
            console.warn('[getUsers] Reached safety limit of 100k rows')
            hasMore = false
          }
        }

        userIds = Array.from(allUserIds)
        console.log(`[getUsers] ✅ Found ${userIds.length} unique users from ${chunkCount} chunks (fallback)`)
      }

      // 3. Buscar emails em chunks
      const emailMap = new Map<string, string>()
      for (let i = 0; i < userIds.length; i += 1000) {
        const userIdsChunk = userIds.slice(i, i + 1000)
        try {
          const { data: usersData } = await supabase
            .schema('auth')
            .from('users')
            .select('id, email')
            .in('id', userIdsChunk)

          usersData?.forEach(user => {
            emailMap.set(user.id, user.email)
          })
        } catch (emailError) {
          console.log(`[getUsers] Could not fetch emails for chunk ${i / 1000 + 1}`)
        }
      }

      // 4. Buscar stats da view trail_trips_unified (mais leve que trail_users_from_trips)
      const userStatsMap = new Map<string, { trip_count: number; total_points: number; last_activity?: string }>()
      
      // Buscar stats em chunks para evitar timeout
      for (let i = 0; i < userIds.length; i += 1000) {
        const userIdsChunk = userIds.slice(i, i + 1000)
        try {
          const { data: tripsData } = await supabase
            .schema('drive')
            .from('trail_trips_unified')
            .select('user_id, point_count, trip_end')
            .in('user_id', userIdsChunk)

          if (tripsData) {
            tripsData.forEach(trip => {
              const existing = userStatsMap.get(trip.user_id) || { trip_count: 0, total_points: 0 }
              userStatsMap.set(trip.user_id, {
                trip_count: existing.trip_count + 1,
                total_points: existing.total_points + (Number(trip.point_count) || 0),
                last_activity: trip.trip_end || existing.last_activity
              })
            })
          }
        } catch (statsError) {
          console.log(`[getUsers] Could not fetch stats for chunk ${i / 1000 + 1}, continuing...`)
        }
      }

      // 5. Montar lista de usuários
      let users: UserInfo[] = userIds.map(id => {
        const stats = userStatsMap.get(id)
        return {
          id,
          email: emailMap.get(id),
          trail_count: stats?.total_points || 0,
          trip_count: stats?.trip_count || 0,
          last_activity: stats?.last_activity
        }
      })

      // Ordenar por last_activity (mais recente primeiro)
      // Usar last_seen do RPC se disponível
      users.sort((a, b) => {
        const aTime = a.last_activity || lastSeenMap.get(a.id)
        const bTime = b.last_activity || lastSeenMap.get(b.id)
        if (!aTime && !bTime) return 0
        if (!aTime) return 1
        if (!bTime) return -1
        return new Date(bTime).getTime() - new Date(aTime).getTime()
      })

      // 6. Aplicar filtro de busca
      if (params?.search) {
        const searchLower = params.search.toLowerCase()
        users = users.filter(user =>
          user.id.toLowerCase().includes(searchLower) ||
          (user.email && user.email.toLowerCase().includes(searchLower))
        )
      }

      // 7. Aplicar paginação se não for fetchAll
      if (!params?.fetchAll) {
        const limit = params?.limit || 1000
        const offset = params?.offset || 0
        users = users.slice(offset, offset + limit)
      }

      // 8. Cachear resultado se fetchAll
      if (params?.fetchAll && !params?.search) {
        memoryCache.set(CACHE_KEY, users, CACHE_TTL)
        console.log(`[getUsers] 💾 Cached ${users.length} users for ${CACHE_TTL} minutes`)
      }

      return {
        success: true,
        data: {
          users,
          total: users.length,
          hasMore: false
        }
      }
    } catch (error) {
      console.error('[getUsers] Error:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }
}

