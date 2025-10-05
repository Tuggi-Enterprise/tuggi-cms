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

import { getSupabase } from './supabase-client'

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
  static async getCountries(): Promise<LocationResult<Country>> {
    const startTime = Date.now()
    
    try {
      // Check cache first
      if (this.isCacheValid(this.cache.countries)) {
        return {
          success: true,
          data: this.cache.countries.data,
          metadata: {
            source: 'cache',
            timestamp: startTime,
            filters: {}
          }
        }
      }
      
      console.log('🌍 Loading countries from database...')
      
      // Try API first (faster)
      try {
        const response = await fetch('/api/locations/countries-cities')
        const result = await response.json()
        
        if (result.success && result.countries) {
          const countries = result.countries.map((country: any) => ({
            name: country.country,
            code: country.country,
            cityCount: country.cityCount || 0,
            totalPOIs: country.totalPOIs || 0
          }))
          
          // Update cache
          this.cache.countries = { data: countries, timestamp: startTime }
          
          return {
            success: true,
            data: countries,
            metadata: {
              source: 'api',
              timestamp: startTime,
              filters: {}
            }
          }
        }
      } catch (apiError) {
        console.warn('API failed, falling back to database:', apiError)
      }
      
      // Fallback to direct database query
      const supabase = getSupabase('server')
      
      const { data, error } = await supabase
        .schema('core')
        .from('countries')
        .select('name')
        .order('name')
      
      if (error) {
        throw new Error(`Database error: ${error.message}`)
      }
      
      const countries = (data || []).map(country => ({
        name: country.name,
        code: country.name,
        cityCount: 0,
        totalPOIs: 0
      }))
      
      // Update cache
      this.cache.countries = { data: countries, timestamp: startTime }
      
      return {
        success: true,
        data: countries,
        metadata: {
          source: 'database',
          timestamp: startTime,
          filters: {}
        }
      }
      
    } catch (error) {
      console.error('Error loading countries:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        metadata: {
          source: 'database',
          timestamp: startTime,
          filters: {}
        }
      }
    }
  }
  
  /**
   * Get states for a specific country
   */
  static async getStates(country: string): Promise<LocationResult<State>> {
    const startTime = Date.now()
    const cacheKey = country.toLowerCase()
    
    try {
      // Check cache first
      if (this.cache.states[cacheKey] && this.isCacheValid(this.cache.states[cacheKey])) {
        return {
          success: true,
          data: this.cache.states[cacheKey].data,
          metadata: {
            source: 'cache',
            timestamp: startTime,
            filters: { country }
          }
        }
      }
      
      console.log(`🏛️ Loading states for ${country}...`)
      
      // Try API first
      try {
        const response = await fetch(`/api/states?country=${encodeURIComponent(country)}`)
        const result = await response.json()
        
        console.log(`🏛️ States API response for ${country}:`, result)
        
        if (result.success && result.data) {
          const states = result.data.map((state: any) => ({
            value: state.value || state.name,
            label: state.label || state.name,
            cityCount: state.cityCount || 0,
            totalPOIs: state.totalPOIs || 0
          }))
          
          // Update cache
          this.cache.states[cacheKey] = { data: states, timestamp: startTime }
          
          return {
            success: true,
            data: states,
            metadata: {
              source: 'api',
              timestamp: startTime,
              filters: { country }
            }
          }
        }
      } catch (apiError) {
        console.warn('API failed, falling back to database:', apiError)
      }
      
      // Fallback to direct database query
      const supabase = getSupabase('server')
      
      const { data, error } = await supabase
        .schema('core')
        .from('attractions')
        .select('state')
        .eq('country', country)
        .not('state', 'is', null)
        .order('state')
      
      if (error) {
        throw new Error(`Database error: ${error.message}`)
      }
      
      // Get unique states
      const uniqueStates = Array.from(new Set(
        (data || [])
          .map(item => item.state)
          .filter(Boolean)
      )).map(state => ({
        value: state,
        label: state,
        cityCount: 0,
        totalPOIs: 0
      }))
      
      // Update cache
      this.cache.states[cacheKey] = { data: uniqueStates, timestamp: startTime }
      
      return {
        success: true,
        data: uniqueStates,
        metadata: {
          source: 'database',
          timestamp: startTime,
          filters: { country }
        }
      }
      
    } catch (error) {
      console.error(`Error loading states for ${country}:`, error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        metadata: {
          source: 'database',
          timestamp: startTime,
          filters: { country }
        }
      }
    }
  }
  
  /**
   * Get cities for a specific country and optional state
   */
  static async getCities(country: string, state?: string): Promise<LocationResult<City>> {
    const startTime = Date.now()
    const cacheKey = `${country.toLowerCase()}_${state?.toLowerCase() || 'all'}`
    
    try {
      // Check cache first
      if (this.cache.cities[cacheKey] && this.isCacheValid(this.cache.cities[cacheKey])) {
        return {
          success: true,
          data: this.cache.cities[cacheKey].data,
          metadata: {
            source: 'cache',
            timestamp: startTime,
            filters: { country, state }
          }
        }
      }
      
      console.log(`🏙️ Loading cities for ${country}${state ? `, ${state}` : ''}...`)
      
      // Try API first
      try {
        let url = `/api/locations/countries-cities?country=${encodeURIComponent(country)}`
        if (state) {
          url += `&state=${encodeURIComponent(state)}`
        }
        
        const response = await fetch(url)
        const result = await response.json()
        
        if (result.success && result.cities) {
          const cities = result.cities.map((city: any) => ({
            name: city,
            cityCount: 0,
            totalPOIs: 0
          }))
          
          // Update cache
          this.cache.cities[cacheKey] = { data: cities, timestamp: startTime }
          
          return {
            success: true,
            data: cities,
            metadata: {
              source: 'api',
              timestamp: startTime,
              filters: { country, state }
            }
          }
        }
      } catch (apiError) {
        console.warn('API failed, falling back to database:', apiError)
      }
      
      // Fallback to direct database query
      const supabase = getSupabase('server')
      
      let query = supabase
        .schema('core')
        .from('attractions')
        .select('city')
        .eq('country', country)
        .not('city', 'is', null)
        .order('city')
      
      if (state) {
        query = query.eq('state', state)
      }
      
      const { data, error } = await query
      
      if (error) {
        throw new Error(`Database error: ${error.message}`)
      }
      
      // Get unique cities
      const uniqueCities = Array.from(new Set(
        (data || [])
          .map(item => item.city)
          .filter(Boolean)
      )).map(city => ({
        name: city,
        cityCount: 0,
        totalPOIs: 0
      }))
      
      // Update cache
      this.cache.cities[cacheKey] = { data: uniqueCities, timestamp: startTime }
      
      return {
        success: true,
        data: uniqueCities,
        metadata: {
          source: 'database',
          timestamp: startTime,
          filters: { country, state }
        }
      }
      
    } catch (error) {
      console.error(`Error loading cities for ${country}${state ? `, ${state}` : ''}:`, error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        metadata: {
          source: 'database',
          timestamp: startTime,
          filters: { country, state }
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
  countries: () => LocationService.getCountries(),
  states: (country: string) => LocationService.getStates(country),
  cities: (country: string, state?: string) => LocationService.getCities(country, state),
  clearCache: (type?: 'countries' | 'states' | 'cities', key?: string) => 
    LocationService.clearCache(type, key),
  getCacheStats: () => LocationService.getCacheStats()
}

export default LocationService
