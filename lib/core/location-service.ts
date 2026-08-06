/**
 * Location Service - Single Source of Truth for Location Data
 * 
 * Centralized service for managing countries, states, and cities data.
 * Eliminates duplication across trigger-points-generation, verification, and POI management.
 * 
 * Features:
 * - Unified location data fetching
 * - Consistent error handling
 * - Caching for performance
 * - TypeScript interfaces
 * - Edge Functions compatibility
 */

import { getSupabaseClient } from './supabase-client'

// Location Data Interfaces
export interface Country {
  name: string
  code: string
  cityCount: number
  totalPOIs: number
}

export interface State {
  value: string
  label: string
  cityCount?: number
  totalPOIs?: number
}

export interface City {
  name: string
  cityCount?: number
  totalPOIs?: number
}

export interface LocationFilters {
  country?: string
  state?: string
  city?: string
  category?: string
  schema?: 'core' | 'homolog'
  limit?: number
}

export interface LocationResult<T> {
  success: boolean
  data?: T[]
  error?: string
  metadata: {
    source: 'database' | 'api' | 'cache'
    timestamp: number
    filters: LocationFilters
  }
}

// Cache for performance optimization
interface LocationCache {
  countries: { data: Country[]; timestamp: number }
  states: { [country: string]: { data: State[]; timestamp: number } }
  cities: { [key: string]: { data: City[]; timestamp: number } }
}

class LocationService {
  private static cache: LocationCache = {
    countries: { data: [], timestamp: 0 },
    states: {},
    cities: {}
  }
  
  private static readonly CACHE_TTL = 5 * 60 * 1000 // 5 minutes
  
  /**
   * Get all countries with POI counts
   */
  static async getCountries(category?: string, schema: 'core' | 'homolog' = 'core'): Promise<LocationResult<Country>> {
    const startTime = Date.now()
    const cacheKey = `${schema}_countries_${category || 'all'}`
    
    try {
      // Check cache (using states/cities style for countries too now)
      if ((this.cache as any)[cacheKey] && this.isCacheValid((this.cache as any)[cacheKey])) {
        return {
          success: true,
          data: (this.cache as any)[cacheKey].data,
          metadata: {
            source: 'cache',
            timestamp: startTime,
            filters: { category, schema }
          }
        }
      }

      // Use RPC for optimized performance
      const supabase = getSupabaseClient()
      
      const { data, error } = await supabase
        .schema(schema)
        .rpc('cms_get_countries', { p_category: category || null })
      
      if (error) {
        throw new Error(`RPC error: ${error.message}`)
      }
      
      const countries = (data || []).map((country: any) => ({
        name: country.value || country.label,
        code: country.value || country.label,
        cityCount: 0, 
        totalPOIs: country.count || 0
      })).sort((a: Country, b: Country) => a.name.localeCompare(b.name))
      
      // Update cache
      ;(this.cache as any)[cacheKey] = { data: countries, timestamp: startTime }
      
      return {
        success: true,
        data: countries,
        metadata: {
          source: 'database',
          timestamp: startTime,
          filters: { category, schema }
        }
      }
      
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        metadata: {
          source: 'database',
          timestamp: startTime,
          filters: { category, schema }
        }
      }
    }
  }
  
  /**
   * Get states for a specific country
   */
  static async getStates(country: string, category?: string, schema: 'core' | 'homolog' = 'core'): Promise<LocationResult<State>> {
    const startTime = Date.now()
    const cacheKey = `${schema}_${country.toLowerCase()}_${category || 'all'}`
    
    try {
      if (this.cache.states[cacheKey] && this.isCacheValid(this.cache.states[cacheKey])) {
        return {
          success: true,
          data: this.cache.states[cacheKey].data,
          metadata: {
            source: 'cache',
            timestamp: startTime,
            filters: { country, category, schema }
          }
        }
      }

      // Use RPC for optimized performance
      const supabase = getSupabaseClient()
      
      const { data, error } = await supabase
        .schema(schema)
        .rpc('cms_get_states', { 
          country_name: country,
          p_category: category || null 
        })
      
      if (error) {
        throw new Error(`RPC error: ${error.message}`)
      }
      
      const states = (data || []).map((state: any) => ({
        value: state.value || state.label,
        label: state.label || state.value,
        cityCount: 0,
        totalPOIs: state.count || 0
      })).sort((a: State, b: State) => a.label.localeCompare(b.label))

      this.cache.states[cacheKey] = { data: states, timestamp: startTime }
      
      return {
        success: true,
        data: states,
        metadata: {
          source: 'database',
          timestamp: startTime,
          filters: { country, category, schema }
        }
      }
      
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        metadata: {
          source: 'database',
          timestamp: startTime,
          filters: { country, category, schema }
        }
      }
    }
  }
  
  /**
   * Get cities for a specific country and optional state
   */
  static async getCities(country: string, state?: string, category?: string, schema: 'core' | 'homolog' = 'core'): Promise<LocationResult<City>> {
    const startTime = Date.now()
    const cacheKey = `${schema}_${country.toLowerCase()}_${state?.toLowerCase() || 'all'}_${category || 'all'}`
    
    try {
      if (this.cache.cities[cacheKey] && this.isCacheValid(this.cache.cities[cacheKey])) {
        return {
          success: true,
          data: this.cache.cities[cacheKey].data,
          metadata: {
            source: 'cache',
            timestamp: startTime,
            filters: { country, state, category }
          }
        }
      }

      // Use RPC for optimized performance
      const supabase = getSupabaseClient()
      
      const { data, error } = await supabase
        .schema(schema)
        .rpc('cms_get_cities', { 
          country_name: country, 
          state_name: state || null,
          p_category: category || null
        })
      
      if (error) {
        throw new Error(`RPC error: ${error.message}`)
      }
      
      const cities = (data || []).map((city: any) => ({
        name: city.value || city.label,
        cityCount: 0,
        totalPOIs: city.count || 0
      })).sort((a: City, b: City) => a.name.localeCompare(b.name))

      this.cache.cities[cacheKey] = { data: cities, timestamp: startTime }
      
      return {
        success: true,
        data: cities,
        metadata: {
          source: 'database',
          timestamp: startTime,
          filters: { country, state, category }
        }
      }
      
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        metadata: {
          source: 'database',
          timestamp: startTime,
          filters: { country, state, category }
        }
      }
    }
  }
  
  /**
   * Clear cache for specific location or all
   */
  static clearCache(type?: 'countries' | 'states' | 'cities', key?: string): void {
    if (type === 'countries') {
      this.cache.countries = { data: [], timestamp: 0 }
    } else if (type === 'states') {
      if (key) {
        delete this.cache.states[key.toLowerCase()]
      } else {
        this.cache.states = {}
      }
    } else if (type === 'cities') {
      if (key) {
        delete this.cache.cities[key.toLowerCase()]
      } else {
        this.cache.cities = {}
      }
    } else {
      // Clear all cache
      this.cache = {
        countries: { data: [], timestamp: 0 },
        states: {},
        cities: {}
      }
    }
  }
  
  /**
   * Get cache statistics
   */
  static getCacheStats(): {
    countries: { cached: boolean; age: number }
    states: { count: number; keys: string[] }
    cities: { count: number; keys: string[] }
  } {
    return {
      countries: {
        cached: this.cache.countries.data.length > 0,
        age: Date.now() - this.cache.countries.timestamp
      },
      states: {
        count: Object.keys(this.cache.states).length,
        keys: Object.keys(this.cache.states)
      },
      cities: {
        count: Object.keys(this.cache.cities).length,
        keys: Object.keys(this.cache.cities)
      }
    }
  }
  
  /**
   * Check if cache entry is valid
   */
  private static isCacheValid(cacheEntry: { data: any[]; timestamp: number }): boolean {
    return cacheEntry.data.length > 0 && (Date.now() - cacheEntry.timestamp) < this.CACHE_TTL
  }
}

/**
 * Convenience functions for common use cases
 */
export const locationService = {
  countries: (category?: string, schema: 'core' | 'homolog' = 'core') => LocationService.getCountries(category, schema),
  states: (country: string, category?: string, schema: 'core' | 'homolog' = 'core') => LocationService.getStates(country, category, schema),
  cities: (country: string, state?: string, category?: string, schema: 'core' | 'homolog' = 'core') => LocationService.getCities(country, state, category, schema),
  clearCache: (type?: 'countries' | 'states' | 'cities', key?: string) => 
    LocationService.clearCache(type, key),
  getCacheStats: () => LocationService.getCacheStats()
}

export default LocationService
