/**
 * Route Service - CRUD operations for Custom Routes
 * 
 * Handles business logic for creating, reading, updating, and deleting routes.
 * Follows existing ClientService pattern: Static methods, Supabase client.
 * 
 * SSOT: All route data comes from core.custom_routes table.
 */

import { SupabaseClient } from '@supabase/supabase-js'
import { OSRMService, LatLng, RouteResult } from './routing/OSRMService'

// Characteristic Enums
export type AccessibilityLevel = 'accessible' | 'partial' | 'not_accessible' | 'unknown';
export type DrivabilityLevel = 'easy' | 'moderate' | 'demanding' | 'unknown';
export type PhotgenicRating = 'low' | 'medium' | 'high' | 'unknown';
export type ScenicProfile = 'panoramic' | 'historical' | 'nature' | 'urban' | 'rural';
export type BestTime = 'morning' | 'afternoon' | 'night' | 'sunset';
export type RoadCondition = 'paved' | 'dirt' | 'steep' | 'curves';
export type ResourceStatus = 'yes' | 'partial' | 'no' | 'unknown';

export interface RouteResources {
  parking?: ResourceStatus;
  restrooms?: ResourceStatus;
  rest_areas?: ResourceStatus;
}

// Types
export interface CustomRoute {
  id: string;
  name: string;
  description?: string;
  client_id: string;
  created_by?: string;
  updated_by?: string;
  geometry?: string; // WKT or GeoJSON
  waypoints?: LatLng[];
  metadata?: {
    distance?: number;
    duration?: number;
    source?: 'osrm' | 'manual';
  };
  is_active: boolean;
  created_at: string;
  updated_at: string;
  // Characteristics
  accessibility?: AccessibilityLevel;
  drivability?: DrivabilityLevel;
  scenic_profile?: ScenicProfile[];
  best_time?: BestTime[];
  road_conditions?: RoadCondition[];
  resources?: RouteResources;
  photogenic_rating?: PhotgenicRating;
  stops_count?: number;
}

export interface CreateRouteRequest {
  name: string;
  description?: string;
  client_id: string;
  waypoints: LatLng[];
  snap_to_roads?: boolean;
  // Characteristics
  accessibility?: AccessibilityLevel;
  drivability?: DrivabilityLevel;
  scenic_profile?: ScenicProfile[];
  best_time?: BestTime[];
  road_conditions?: RoadCondition[];
  resources?: RouteResources;
  photogenic_rating?: PhotgenicRating;
  stops_count?: number;
}

export interface UpdateRouteRequest {
  name?: string;
  description?: string;
  waypoints?: LatLng[];
  is_active?: boolean;
  snap_to_roads?: boolean;
  // Characteristics
  accessibility?: AccessibilityLevel;
  drivability?: DrivabilityLevel;
  scenic_profile?: ScenicProfile[];
  best_time?: BestTime[];
  road_conditions?: RoadCondition[];
  resources?: RouteResources;
  photogenic_rating?: PhotgenicRating;
  stops_count?: number;
}

/**
 * Route Service - manages custom routes CRUD
 */
export class RouteService {

  /**
   * Create a new custom route
   * If snap_to_roads is true, uses OSRM to snap waypoints to road network
   */
  static async createRoute(supabase: SupabaseClient, data: CreateRouteRequest, userId: string): Promise<CustomRoute> {
    let geometry: string | undefined
    let metadata: CustomRoute['metadata'] = { source: 'manual' }

    // If snap_to_roads requested, use OSRM to generate proper geometry
    if (data.snap_to_roads && data.waypoints.length >= 2) {
      try {
        const routeResult = await OSRMService.getRoute(data.waypoints)
        geometry = OSRMService.toWKT(routeResult.coordinates)
        metadata = {
          distance: routeResult.distance,
          duration: routeResult.duration,
          source: 'osrm'
        }
      } catch (error) {
        console.error('RouteService: OSRM routing failed, falling back to manual:', error)
        // Fallback: use raw waypoints as geometry
        geometry = OSRMService.toWKT(data.waypoints)
      }
    } else if (data.waypoints.length >= 2) {
      // Manual mode: just connect the dots
      geometry = OSRMService.toWKT(data.waypoints)
    }

    const { data: route, error } = await supabase
      .schema('core')
      .rpc('upsert_custom_route', {
        p_id: null,
        p_name: data.name,
        p_description: data.description || null,
        p_client_id: data.client_id || null,
        p_geometry_wkt: geometry,
        p_waypoints: data.waypoints,
        p_metadata: metadata,
        p_is_active: true,
        // Characteristics
        p_accessibility: data.accessibility || 'unknown',
        p_drivability: data.drivability || 'unknown',
        p_scenic_profile: data.scenic_profile || [],
        p_best_time: data.best_time || [],
        p_road_conditions: data.road_conditions || [],
        p_resources: data.resources || {},
        p_photogenic_rating: data.photogenic_rating || 'unknown',
        p_stops_count: data.stops_count ?? data.waypoints.length
      })

    if (error) {
      console.error('RouteService.createRoute error:', error)
      throw new Error(`Failed to create route: ${error.message}`)
    }

    // Log audit
    await this.logAudit(supabase, route.id, 'CREATE', userId, { new: route })

    return route as CustomRoute
  }

  /**
   * Get routes for a client
   */
  static async getRoutesByClient(supabase: SupabaseClient, clientId: string, includeInactive = false): Promise<CustomRoute[]> {
    const { data, error } = await supabase
      .schema('core')
      .rpc('get_custom_routes', { p_client_id: clientId })

    if (error) {
      throw new Error(`Failed to fetch routes: ${error.message}`)
    }

    return (data || []) as CustomRoute[]
  }

  /**
   * Get a single route by ID
   */
  static async getRouteById(supabase: SupabaseClient, routeId: string): Promise<CustomRoute | null> {
    const { data, error } = await supabase
      .schema('core')
      .rpc('get_custom_route', { p_id: routeId })

    if (error) {
      throw new Error(`Failed to fetch route: ${error.message}`)
    }

    return data as CustomRoute | null
  }

  /**
   * Update a route
   */
  static async updateRoute(supabase: SupabaseClient, routeId: string, data: UpdateRouteRequest, userId: string): Promise<CustomRoute> {
    // Fetch old state for audit
    const oldRoute = await this.getRouteById(supabase, routeId)
    if (!oldRoute) {
      throw new Error('Route not found')
    }

    let geometry = oldRoute.geometry
    let metadata = oldRoute.metadata

    // If waypoints changed, recalculate geometry
    if (data.waypoints && data.waypoints.length >= 2) {
      if (data.snap_to_roads) {
        try {
          const routeResult = await OSRMService.getRoute(data.waypoints)
          geometry = OSRMService.toWKT(routeResult.coordinates)
          metadata = {
            distance: routeResult.distance,
            duration: routeResult.duration,
            source: 'osrm'
          }
        } catch (error) {
          console.error('RouteService: OSRM routing failed during update:', error)
          geometry = OSRMService.toWKT(data.waypoints)
          metadata = { source: 'manual' }
        }
      } else {
        geometry = OSRMService.toWKT(data.waypoints)
        metadata = { ...oldRoute.metadata, source: 'manual' }
      }
    }

    const { data: route, error } = await supabase
      .schema('core')
      .rpc('upsert_custom_route', {
        p_id: routeId,
        p_name: data.name ?? oldRoute.name,
        p_description: data.description ?? oldRoute.description,
        p_client_id: oldRoute.client_id,
        p_geometry_wkt: geometry,
        p_waypoints: data.waypoints ?? oldRoute.waypoints,
        p_metadata: metadata,
        p_is_active: data.is_active ?? oldRoute.is_active,
        // Characteristics (merge with existing values)
        p_accessibility: data.accessibility ?? oldRoute.accessibility ?? 'unknown',
        p_drivability: data.drivability ?? oldRoute.drivability ?? 'unknown',
        p_scenic_profile: data.scenic_profile ?? oldRoute.scenic_profile ?? [],
        p_best_time: data.best_time ?? oldRoute.best_time ?? [],
        p_road_conditions: data.road_conditions ?? oldRoute.road_conditions ?? [],
        p_resources: data.resources ?? oldRoute.resources ?? {},
        p_photogenic_rating: data.photogenic_rating ?? oldRoute.photogenic_rating ?? 'unknown',
        p_stops_count: data.stops_count ?? oldRoute.stops_count ?? (data.waypoints ?? oldRoute.waypoints ?? []).length
      })

    if (error) {
      throw new Error(`Failed to update route: ${error.message}`)
    }

    // Determine audit action
    let action: 'CREATE' | 'UPDATE' | 'DELETE' | 'ACTIVATE' | 'DEACTIVATE' = 'UPDATE'
    if (data.is_active !== undefined && data.is_active !== oldRoute.is_active) {
      action = data.is_active ? 'ACTIVATE' : 'DEACTIVATE'
    }

    // Log audit
    await this.logAudit(supabase, routeId, action, userId, { old: oldRoute, new: route })

    return route as CustomRoute
  }

  /**
   * Delete (soft) a route - just marks inactive
   */
  static async deleteRoute(supabase: SupabaseClient, routeId: string, userId: string): Promise<void> {
    const oldRoute = await this.getRouteById(supabase, routeId)

    const { error } = await supabase
      .schema('core')
      .rpc('delete_custom_route', { p_id: routeId })

    if (error) {
      throw new Error(`Failed to delete route: ${error.message}`)
    }

    await this.logAudit(supabase, routeId, 'DELETE', userId, { old: oldRoute })
  }

  /**
   * Generate a snapped route preview (without saving)
   */
  static async previewRoute(waypoints: LatLng[]): Promise<RouteResult> {
    return OSRMService.getRoute(waypoints)
  }

  /**
   * Match a drawn trace to roads (preview without saving)
   */
  static async matchDrawnRoute(trace: LatLng[]): Promise<RouteResult> {
    return OSRMService.matchRoute(trace)
  }

  /**
   * Log route changes for audit trail
   */
  private static async logAudit(
    supabase: SupabaseClient,
    routeId: string,
    action: 'CREATE' | 'UPDATE' | 'DELETE' | 'ACTIVATE' | 'DEACTIVATE',
    performerId: string,
    changes: Record<string, unknown>
  ): Promise<void> {
    try {
      await supabase
        .schema('drive')
        .from('custom_route_audit_logs')
        .insert([{
          route_id: routeId,
          action,
          performer_id: performerId,
          changes
        }])
    } catch (error) {
      // Don't fail the main operation if audit logging fails
      console.error('RouteService: Audit logging failed:', error)
    }
  }
}
