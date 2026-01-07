/**
 * OSM Importer Types
 * 
 * Centralized type definitions for OSM importer functionality
 * 
 * @module lib/types/osm-types
 */

/**
 * Simple OSM POI structure for file parsing and display
 */
export interface SimpleOSMPOI {
  _id: string
  uuid_id?: string
  id?: string
  properties: {
    name?: string
    city?: string
    state?: string
    country?: string
    category?: string
    primary_category?: string
    [key: string]: any
  }
  geometry: {
    type: string
    coordinates: [number, number]
  }
}

/**
 * Import operation results
 */
export interface ImportResults {
  success: boolean
  imported: number
  errors: string[]
}

/**
 * Local database statistics
 */
export interface LocalDBStats {
  features: number
  coordinates: number
}

/**
 * OSM POI from database (homolog.pois)
 */
export interface OSMPOI {
  uuid_id: string
  name: string
  city: string
  state: string
  country: string
  lat: number
  lon: number
  primary_category: string
  category: string
  osm_id: number
  osm_type: string
  created_at: string
  updated_at: string
}

/**
 * Pagination response metadata
 */
export interface PaginationMeta {
  total: number
  totalPages: number
  currentPage: number
  limit: number
}

/**
 * Filter options for dropdowns
 */
export interface FilterOptions {
  states: string[]
  cities: string[]
  categories: string[]
  totalCount: number
}
