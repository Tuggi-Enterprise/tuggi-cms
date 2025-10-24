/**
 * OSM Importer Hook - KISS SIMPLIFIED
 * 
 * Single source of truth with no race conditions:
 * - File loading and parsing
 * - POI editing and selection
 * - Import operations
 * - Simple state management
 * 
 * @module lib/hooks/use-osm-importer-simple
 */

import { useState, useCallback, useMemo } from 'react'
import { OSMService } from '../services/osm-service-simple'

export interface SimpleOSMPOI {
  _id: string
  properties: {
    name?: string
    city?: string
    state?: string
    country?: string
    category?: string
    [key: string]: any
  }
  geometry: {
    type: string
    coordinates: [number, number]
  }
}

export interface ImportResults {
  success: boolean
  imported: number
  errors: string[]
}

export interface LocalDBStats {
  features: number
  coordinates: number
}

export function useOSMImporterSimple() {
  // Single state object - no race conditions
  const [state, setState] = useState({
    selectedFeatures: new Set<string>(),
    isLoading: false,
    error: null as string | null,
    currentFile: null as { name: string; size: number } | null,
    importResults: null as ImportResults | null,
    localDBStats: null as LocalDBStats | null,
    dbFeatures: [] as any[],
    dbCities: [] as string[],
    dbCategories: [] as string[],
    dbPagination: {
      page: 1,
      limit: 50,
      total: 0,
      totalPages: 0
    }
  })

  // Derived state - computed values
  const selectedPOIs = useMemo(() => 
    state.dbFeatures.filter(f => state.selectedFeatures.has(f.id)),
    [state.dbFeatures, state.selectedFeatures]
  )

  // Actions - all mutations go through setState
  const loadFile = useCallback(async (file: File) => {
    console.log('🚀 [HOOK] Starting file load:', { name: file.name, size: file.size, type: file.type })
    setState(prev => ({ ...prev, isLoading: true, error: null }))
    
    try {
      // Always parse and save directly to local database
      console.log('💾 [HOOK] Parsing and saving to local database...')
      const results = await OSMService.parseGeoJSONToDB(file)
      
      if (results.success) {
        // Load data from database
        await loadDBFeatures()
        await loadDBCities()
        await loadDBCategories()
        await refreshLocalStats()
      }
      
      setState(prev => ({
        ...prev,
        isLoading: false,
        currentFile: { name: file.name, size: file.size },
        importResults: results
      }))
      
      console.log('🎯 [HOOK] State updated')
    } catch (error) {
      console.error('❌ [HOOK] File load failed:', error)
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to load file'
      }))
    }
  }, [])

  const loadDBFeatures = useCallback(async (page = 1, limit = 50, filters = {}) => {
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString(),
        ...filters
      })
      
      const response = await fetch(`/api/local-db/features?${params}`)
      const data = await response.json()
      
      if (data.success) {
        setState(prev => ({
          ...prev,
          dbFeatures: data.data.features,
          dbPagination: data.data.pagination
        }))
      }
    } catch (error) {
      console.error('❌ [HOOK] Error loading DB features:', error)
    }
  }, [])

  const loadDBCities = useCallback(async () => {
    try {
      const response = await fetch('/api/local-db/cities')
      const data = await response.json()
      
      if (data.success) {
        setState(prev => ({
          ...prev,
          dbCities: data.data.map((item: any) => item.city)
        }))
      }
    } catch (error) {
      console.error('❌ [HOOK] Error loading DB cities:', error)
    }
  }, [])

  const loadDBCategories = useCallback(async () => {
    try {
      const response = await fetch('/api/local-db/categories')
      const data = await response.json()
      
      if (data.success) {
        setState(prev => ({
          ...prev,
          dbCategories: data.data.map((item: any) => item.primary_category)
        }))
      }
    } catch (error) {
      console.error('❌ [HOOK] Error loading DB categories:', error)
    }
  }, [])


  const toggleSelection = useCallback((id: string) => {
    setState(prev => {
      const newSelection = new Set(prev.selectedFeatures)
      if (newSelection.has(id)) {
        newSelection.delete(id)
      } else {
        newSelection.add(id)
      }
      return { ...prev, selectedFeatures: newSelection }
    })
  }, [])

  const selectAll = useCallback(() => {
    setState(prev => ({
      ...prev,
      selectedFeatures: new Set(prev.dbFeatures.map(f => f.id))
    }))
  }, [])

  const clearSelection = useCallback(() => {
    setState(prev => ({ ...prev, selectedFeatures: new Set() }))
  }, [])

  const refreshLocalStats = useCallback(async () => {
    try {
      const stats = await OSMService.getLocalStats()
      setState(prev => ({ ...prev, localDBStats: stats }))
    } catch (error) {
      console.error('❌ [HOOK] Error refreshing local stats:', error)
    }
  }, [])

  const importSelected = useCallback(async () => {
    console.log('📤 [HOOK] Starting import process:', { selectedCount: selectedPOIs.length })
    if (selectedPOIs.length === 0) {
      console.log('⚠️ [HOOK] No POIs selected for import')
      return
    }

    setState(prev => ({ ...prev, isLoading: true, error: null }))
    console.log('🔄 [HOOK] Loading state set, calling import service...')
    
    try {
      // Convert DB features to SimpleOSMPOI format for Supabase import
      const poisForSupabase = selectedPOIs.map(f => ({
        _id: f.id,
        properties: {
          name: f.name,
          city: f.city,
          state: f.state,
          country: f.country,
          category: f.primary_category,
          ...JSON.parse(f.osm_tags || '{}')
        },
        geometry: {
          type: 'Point' as const,
          coordinates: [f.longitude, f.latitude] as [number, number]
        }
      }))
      
      console.log('🌐 [HOOK] Importing to Supabase')
      const results = await OSMService.importPOIs(poisForSupabase)
      
      console.log('✅ [HOOK] Import completed:', results)
      setState(prev => ({
        ...prev,
        isLoading: false,
        importResults: results
      }))
      
      // Refresh local DB stats
      await refreshLocalStats()
    } catch (error) {
      console.error('❌ [HOOK] Import failed:', error)
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Import failed'
      }))
    }
  }, [selectedPOIs, refreshLocalStats])

  const clearData = useCallback(() => {
    setState({
      selectedFeatures: new Set(),
      isLoading: false,
      error: null,
      currentFile: null,
      importResults: null,
      localDBStats: null,
      dbFeatures: [],
      dbCities: [],
      dbCategories: [],
      dbPagination: {
        page: 1,
        limit: 50,
        total: 0,
        totalPages: 0
      }
    })
  }, [])

  // Return unified interface
  return {
    // State
    features: state.dbFeatures,
    selectedFeatures: state.selectedFeatures,
    selectedPOIs,
    availableCities: state.dbCities,
    availableCategories: state.dbCategories,
    isLoading: state.isLoading,
    error: state.error,
    currentFile: state.currentFile,
    importResults: state.importResults,
    localDBStats: state.localDBStats,
    dbPagination: state.dbPagination,
    
    // Actions
    loadFile,
    toggleSelection,
    selectAll,
    clearSelection,
    importSelected,
    clearData,
    
    // Local DB Actions
    refreshLocalStats,
    loadDBFeatures,
    loadDBCities,
    loadDBCategories
  }
}
