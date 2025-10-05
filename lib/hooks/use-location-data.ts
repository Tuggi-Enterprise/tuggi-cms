/**
 * useLocationData Hook - Unified Location Data Management
 * 
 * Centralized hook for managing countries, states, and cities data.
 * Eliminates duplication across all pages that need location filtering.
 * 
 * Features:
 * - Unified state management
 * - Automatic loading and caching
 * - Error handling
 * - Loading states
 * - TypeScript support
 */

import { useState, useEffect, useCallback } from 'react'
import { locationService, Country, State, City, LocationResult } from '../core/location-service'

export interface UseLocationDataOptions {
  autoLoadCountries?: boolean
  cacheResults?: boolean
  onError?: (error: string) => void
}

export interface UseLocationDataReturn {
  // Countries
  countries: Country[]
  countriesLoading: boolean
  countriesError: string | null
  loadCountries: () => Promise<void>
  
  // States
  states: State[]
  statesLoading: boolean
  statesError: string | null
  loadStates: (country: string) => Promise<void>
  
  // Cities
  cities: City[]
  citiesLoading: boolean
  citiesError: string | null
  loadCities: (country: string, state?: string) => Promise<void>
  
  // Cache management
  clearCache: () => void
  getCacheStats: () => any
  
  // Utility functions
  reset: () => void
}

export function useLocationData(options: UseLocationDataOptions = {}): UseLocationDataReturn {
  const {
    autoLoadCountries = true,
    cacheResults = true,
    onError
  } = options
  
  // Countries state
  const [countries, setCountries] = useState<Country[]>([])
  const [countriesLoading, setCountriesLoading] = useState(false)
  const [countriesError, setCountriesError] = useState<string | null>(null)
  
  // States state
  const [states, setStates] = useState<State[]>([])
  const [statesLoading, setStatesLoading] = useState(false)
  const [statesError, setStatesError] = useState<string | null>(null)
  
  // Cities state
  const [cities, setCities] = useState<City[]>([])
  const [citiesLoading, setCitiesLoading] = useState(false)
  const [citiesError, setCitiesError] = useState<string | null>(null)
  
  // Load countries
  const loadCountries = useCallback(async () => {
    setCountriesLoading(true)
    setCountriesError(null)
    
    try {
      const result = await locationService.countries()
      
      if (result.success && result.data) {
        setCountries(result.data)
      } else {
        const error = result.error || 'Failed to load countries'
        setCountriesError(error)
        onError?.(error)
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      setCountriesError(errorMessage)
      onError?.(errorMessage)
    } finally {
      setCountriesLoading(false)
    }
  }, [onError])
  
  // Load states for a country
  const loadStates = useCallback(async (country: string) => {
    if (!country) {
      setStates([])
      return
    }
    
    setStatesLoading(true)
    setStatesError(null)
    
    try {
      const result = await locationService.states(country)
      
      if (result.success && result.data) {
        setStates(result.data)
      } else {
        const error = result.error || 'Failed to load states'
        setStatesError(error)
        onError?.(error)
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      setStatesError(errorMessage)
      onError?.(errorMessage)
    } finally {
      setStatesLoading(false)
    }
  }, [onError])
  
  // Load cities for a country and optional state
  const loadCities = useCallback(async (country: string, state?: string) => {
    if (!country) {
      setCities([])
      return
    }
    
    setCitiesLoading(true)
    setCitiesError(null)
    
    try {
      const result = await locationService.cities(country, state)
      
      if (result.success && result.data) {
        setCities(result.data)
      } else {
        const error = result.error || 'Failed to load cities'
        setCitiesError(error)
        onError?.(error)
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      setCitiesError(errorMessage)
      onError?.(errorMessage)
    } finally {
      setCitiesLoading(false)
    }
  }, [onError])
  
  // Clear cache
  const clearCache = useCallback(() => {
    locationService.clearCache()
  }, [])
  
  // Get cache statistics
  const getCacheStats = useCallback(() => {
    return locationService.getCacheStats()
  }, [])
  
  // Reset all state
  const reset = useCallback(() => {
    setCountries([])
    setCountriesLoading(false)
    setCountriesError(null)
    setStates([])
    setStatesLoading(false)
    setStatesError(null)
    setCities([])
    setCitiesLoading(false)
    setCitiesError(null)
  }, [])
  
  // Auto-load countries on mount
  useEffect(() => {
    if (autoLoadCountries) {
      loadCountries()
    }
  }, [autoLoadCountries, loadCountries])
  
  return {
    // Countries
    countries,
    countriesLoading,
    countriesError,
    loadCountries,
    
    // States
    states,
    statesLoading,
    statesError,
    loadStates,
    
    // Cities
    cities,
    citiesLoading,
    citiesError,
    loadCities,
    
    // Cache management
    clearCache,
    getCacheStats,
    
    // Utility functions
    reset
  }
}

export default useLocationData
