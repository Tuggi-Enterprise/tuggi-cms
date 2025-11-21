/**
 * Trail Visualization Service
 * 
 * Centralized service for trail visualization data fetching.
 * Follows DRY and SSOF principles - single source of truth for trail data.
 */

import { getSupabase } from '@/lib/core/supabase-client'

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
      const fieldsToSelect = 'id,user_id,trip_session_id,latitude,longitude,timestamp,sequence_order,is_moving,speed'
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

      // Order by trip and sequence for proper line rendering
      query = query
        .order('trip_session_id', { ascending: true })
        .order('sequence_order', { ascending: true })

      // Apply pagination with reasonable limits to avoid timeout
      // Reduce default limit to prevent timeout
      const limit = Math.min(params.limit || 2000, 2000) // Max 2000 points per query
      const offset = params.offset || 0
      query = query.range(offset, offset + limit - 1)

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

      // Convert to array format
      const trails = Array.from(trailsMap.entries()).map(([trip_session_id, points]) => ({
        user_id: points[0].user_id,
        trip_session_id,
        points: points.sort((a, b) => a.sequence_order - b.sequence_order)
      }))

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
  static async getUsers(params?: {
    search?: string
    limit?: number
  }): Promise<{
    success: boolean
    data?: {
      users: UserInfo[]
      total: number
    }
    error?: string
  }> {
    try {
      const supabase = getSupabase('server')

      // Optimize: Get distinct users with trail counts
      // Use a more efficient approach - get recent users first, then aggregate
      const limit = Math.min(params?.limit || 500, 500) // Limit to 500 users max
      
      // First, get distinct user_ids from recent trails (more efficient)
      const { data: recentTrails, error: trailsError } = await supabase
        .schema('drive')
        .from('route_trail')
        .select('user_id, timestamp, trip_session_id')
        .order('timestamp', { ascending: false })
        .limit(5000) // Sample recent 5k trails to get user list

      if (trailsError) {
        return {
          success: false,
          error: trailsError.message
        }
      }

      if (!recentTrails || recentTrails.length === 0) {
        return {
          success: true,
          data: {
            users: [],
            total: 0
          }
        }
      }

      // Aggregate by user from the sample
      const userMap = new Map<string, {
        trail_count: number
        trips: Set<string>
        last_activity?: string
      }>()

      recentTrails.forEach(point => {
        if (!userMap.has(point.user_id)) {
          userMap.set(point.user_id, {
            trail_count: 0,
            trips: new Set(),
            last_activity: point.timestamp
          })
        }

        const user = userMap.get(point.user_id)!
        user.trail_count++
        user.trips.add(point.trip_session_id)
        if (point.timestamp && (!user.last_activity || point.timestamp > user.last_activity)) {
          user.last_activity = point.timestamp
        }
      })

      // Try to get user emails from auth.users (if accessible)
      // Limit to first 100 users to avoid query timeout
      const userIds = Array.from(userMap.keys()).slice(0, 100)
      let userEmails: Map<string, string> = new Map()

      try {
        // Note: This might not work if we don't have access to auth.users
        // In that case, we'll just use user IDs
        if (userIds.length > 0) {
          const { data: usersData } = await supabase
            .schema('auth')
            .from('users')
            .select('id, email')
            .in('id', userIds)
            .limit(100) // Additional safety limit

          if (usersData) {
            usersData.forEach(user => {
              userEmails.set(user.id, user.email)
            })
          }
        }
      } catch (emailError) {
        // If we can't access auth.users, continue without emails
        console.log('Could not fetch user emails, continuing without them')
      }

      const users: UserInfo[] = Array.from(userMap.entries()).map(([id, data]) => ({
        id,
        email: userEmails.get(id),
        trail_count: data.trail_count,
        trip_count: data.trips.size,
        last_activity: data.last_activity
      }))

      // Apply search filter if provided
      let filteredUsers = users
      if (params?.search) {
        const searchLower = params.search.toLowerCase()
        filteredUsers = users.filter(user =>
          user.id.toLowerCase().includes(searchLower) ||
          (user.email && user.email.toLowerCase().includes(searchLower))
        )
      }

      // Sort by trail count descending
      filteredUsers.sort((a, b) => b.trail_count - a.trail_count)

      return {
        success: true,
        data: {
          users: filteredUsers,
          total: filteredUsers.length
        }
      }
    } catch (error) {
      console.error('Error in getUsers:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }
}

