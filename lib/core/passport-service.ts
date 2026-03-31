/**
 * Passport Service - Gamification & Trip Exploration
 */

import { getSupabase } from './supabase-client'

export interface PassportStats {
  total_trips: number
  total_passed_lifetime: number
  total_distance_km: number
  top_categories: Array<{
    category: string
    count: number
  }>
}

export interface POIExp {
  id: string
  name: string
  city: string
  osm_category?: string
  category: string
  latitude: number
  longitude: number
  visit_timestamp?: string
}

export interface TripExploration {
  trip_session_id: string
  user_id: string
  heard_count: number
  missed_count: number
  heard_pois: POIExp[]
  missed_pois: POIExp[]
  buffer_meters: number
}

export class PassportService {
  /**
   * Fetch lifetime passport stats for a user
   */
  static async getUserStats(supabase: any, userId: string): Promise<PassportStats | null> {
    try {
      const { data, error } = await supabase.schema('drive').rpc('get_user_passport_stats', { p_user_id: userId })
      
      if (error) throw error
      return data as PassportStats
    } catch (err) {
      console.error('Error in PassportService.getUserStats:', err)
      return null
    }
  }

  /**
   * Fetch exploration details for a specific trip
   */
  static async getTripExploration(supabase: any, tripSessionId: string, bufferMeters: number = 1000): Promise<TripExploration | null> {
    try {
      const { data, error } = await supabase.schema('drive').rpc('get_trip_exploration_stats', { 
        p_trip_session_id: tripSessionId,
        p_buffer_meters: bufferMeters
      })
      
      if (error) throw error
      return data as TripExploration
    } catch (err) {
      console.error('Error in PassportService.getTripExploration:', err)
      return null
    }
  }

  /**
   * List unique trips for a user (simplified)
   */
  static async getUserTrips(supabase: any, userId: string) {
    try {
      const { data, error } = await supabase
        .schema('drive')
        .from('trail_trips_unified')
        .select('*')
        .eq('user_id', userId)
        .order('trip_start', { ascending: false })
      
      if (error) throw error
      return data
    } catch (err) {
      console.error('Error in PassportService.getUserTrips:', err)
      return []
    }
  }
}
