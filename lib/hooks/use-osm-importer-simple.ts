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

import { useState, useCallback, useMemo, useEffect } from 'react'
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

// KISS: Single unified state structure
interface OSMImporterState {
  // Data
  features: any[]
  cities: Array<{ name: string; state: string }>
  categories: string[]
  stats: LocalDBStats | null
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
  
  // UI State
  selectedFeatures: Set<string>
  isLoading: boolean
  error: string | null
  currentFile: { name: string; size: number } | null
  importResults: ImportResults | null
  
  // View State
  viewMode: 'table' | 'map'
  showUploadModal: boolean
  
  // Filter State
  searchTerm: string
  cityFilter: string
  stateFilter: string
  categoryFilter: string
  
  // Pagination State
  currentPage: number
  itemsPerPage: number
  
  // Delete State
  isDeleting: boolean
}

export function useOSMImporterSimple() {
  // KISS: Single unified state object
  const [state, setState] = useState<OSMImporterState>({
    // Data
    features: [],
    cities: [],
    categories: [],
    stats: null,
    pagination: {
      page: 1,
      limit: 50000,
      total: 0,
      totalPages: 0
    },
    
    // UI State
    selectedFeatures: new Set(),
    isLoading: false,
    error: null,
    currentFile: null,
    importResults: null,
    
    // View State
    viewMode: 'table',
    showUploadModal: false,
    
    // Filter State
    searchTerm: '',
    cityFilter: '',
    stateFilter: '',
    categoryFilter: '',
    
    // Pagination State
    currentPage: 1,
    itemsPerPage: 100,
    
    // Delete State
    isDeleting: false
  })

  // Derived state - computed values (no race conditions)
  const selectedPOIs = useMemo(() => 
    state.features.filter(f => state.selectedFeatures.has(f.id)),
    [state.features, state.selectedFeatures]
  )

  // KISS: Single function to load all data (eliminates race conditions)
  const loadAllData = useCallback(async (page = 1, limit = 50000) => {
    console.log('🔄 [HOOK] Loading all data from local DB...')
    setState(prev => ({ ...prev, isLoading: true, error: null }))
    
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString()
      })
      
      const response = await fetch(`/api/local-db/all-data?${params}`)
      const result = await response.json()
      
      if (result.success) {
        setState(prev => ({
          ...prev,
          features: result.data.features,
          cities: result.data.cities,
          categories: result.data.categories,
          stats: result.data.stats,
          pagination: result.data.pagination
        }))
        console.log('✅ [HOOK] All data loaded:', {
          features: result.data.features.length,
          cities: result.data.cities.length,
          categories: result.data.categories.length,
          stats: result.data.stats
        })
      } else {
        throw new Error(result.error || 'Failed to load data')
      }
    } catch (error) {
      console.error('❌ [HOOK] Error loading all data:', error)
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to load data'
      }))
    } finally {
      setState(prev => ({ ...prev, isLoading: false }))
    }
  }, [])

  // Optimized data loading for different modes
  const loadDataForMode = useCallback(async (mode: 'table' | 'map') => {
    console.log('🔄 [HOOK] Loading data for mode:', mode)
    setState(prev => ({ ...prev, isLoading: true, error: null, viewMode: mode }))
    
    try {
      // For table mode, load fewer features for better performance
      // For map mode, load all features
      const limit = mode === 'table' ? 1000 : 50000
      
      const params = new URLSearchParams({
        page: '1',
        limit: limit.toString()
      })
      
      const response = await fetch(`/api/local-db/all-data?${params}`)
      const result = await response.json()
      
      if (result.success) {
        setState(prev => ({
          ...prev,
          features: result.data.features,
          cities: result.data.cities,
          categories: result.data.categories,
          stats: result.data.stats,
          pagination: result.data.pagination
        }))
        console.log('✅ [HOOK] Data loaded for mode:', {
          mode,
          features: result.data.features.length,
          cities: result.data.cities.length,
          categories: result.data.categories.length
        })
      } else {
        throw new Error(result.error || 'Failed to load data')
      }
    } catch (error) {
      console.error('❌ [HOOK] Error loading data for mode:', error)
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to load data'
      }))
    } finally {
      setState(prev => ({ ...prev, isLoading: false }))
    }
  }, [])

  // File loading (unchanged functionality)
  const loadFile = useCallback(async (file: File) => {
    console.log('🚀 [HOOK] Starting file load:', { name: file.name, size: file.size, type: file.type })
    setState(prev => ({ ...prev, isLoading: true, error: null }))
    
    try {
      // Always parse and save directly to local database
      console.log('💾 [HOOK] Parsing and saving to local database...')
      const results = await OSMService.parseFileToDB(file)
      
      if (results.success) {
        // Reload all data from database (single call, no race conditions)
        await loadAllData()
      }
      
      setState(prev => ({
        ...prev,
        isLoading: false,
        currentFile: { name: file.name, size: file.size },
        importResults: results
      }))
      
      console.log('🎯 [HOOK] File load completed')
    } catch (error) {
      console.error('❌ [HOOK] File load failed:', error)
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to load file'
      }))
    }
  }, [loadAllData])

  // Selection actions (unchanged functionality)
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
      selectedFeatures: new Set(state.features.map(f => f.id))
    }))
  }, [state.features])

  const clearSelection = useCallback(() => {
    setState(prev => ({ ...prev, selectedFeatures: new Set() }))
  }, [])

  // Import to Supabase (unchanged functionality)
  const importSelected = useCallback(async () => {
    console.log('📤 [HOOK] Starting import process:', {
      selectedCount: selectedPOIs.length,
      selectedPOIs: selectedPOIs.map(p => p.name)
    })

    setState(prev => ({ ...prev, isLoading: true, error: null }))
    
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
      const results = await OSMService.saveToLocalDB(poisForSupabase, 'supabase-import')
      
      console.log('✅ [HOOK] Import completed:', results)
      setState(prev => ({
        ...prev,
        isLoading: false,
        importResults: results
      }))
      
      // Refresh all data
      await loadAllData()
    } catch (error) {
      console.error('❌ [HOOK] Import failed:', error)
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Import failed'
      }))
    }
  }, [selectedPOIs, loadAllData])

  // Clear all data (unchanged functionality)
  const clearData = useCallback(() => {
    setState({
      // Data
      features: [],
      cities: [],
      categories: [],
      stats: null,
      pagination: {
        page: 1,
        limit: 50000,
        total: 0,
        totalPages: 0
      },
      
      // UI State
      selectedFeatures: new Set(),
      isLoading: false,
      error: null,
      currentFile: null,
      importResults: null,
      
      // View State
      viewMode: 'table',
      showUploadModal: false,
      
      // Filter State
      searchTerm: '',
      cityFilter: '',
      stateFilter: '',
      categoryFilter: '',
      
      // Pagination State
      currentPage: 1,
      itemsPerPage: 100,
      
      // Delete State
      isDeleting: false
    })
  }, [])

  // KISS: Simple auto-load on mount (no race conditions)
  useEffect(() => {
    console.log('🔄 [HOOK] Auto-loading data on mount...')
    loadAllData()
  }, []) // No dependencies = no race conditions

  // Return unified interface (enhanced with new state)
  return {
    // Data State
    features: state.features,
    selectedFeatures: state.selectedFeatures,
    selectedPOIs,
    availableCities: state.cities,
    availableCategories: state.categories,
    localDBStats: state.stats,
    dbPagination: state.pagination,
    
    // UI State
    isLoading: state.isLoading,
    error: state.error,
    currentFile: state.currentFile,
    importResults: state.importResults,
    
    // View State
    viewMode: state.viewMode,
    showUploadModal: state.showUploadModal,
    
    // Filter State
    searchTerm: state.searchTerm,
    cityFilter: state.cityFilter,
    stateFilter: state.stateFilter,
    categoryFilter: state.categoryFilter,
    
    // Pagination State
    currentPage: state.currentPage,
    itemsPerPage: state.itemsPerPage,
    
    // Delete State
    isDeleting: state.isDeleting,
    
    // Actions (enhanced with new state setters)
    loadFile,
    toggleSelection,
    selectAll,
    clearSelection,
    importSelected,
    clearData,
    
    // State Setters
    setViewMode: (mode: 'table' | 'map') => setState(prev => ({ ...prev, viewMode: mode })),
    setShowUploadModal: (show: boolean) => setState(prev => ({ ...prev, showUploadModal: show })),
    setSearchTerm: (term: string) => setState(prev => ({ ...prev, searchTerm: term })),
    setCityFilter: (city: string) => setState(prev => ({ ...prev, cityFilter: city })),
    setStateFilter: (stateFilter: string) => setState(prev => ({ ...prev, stateFilter })),
    setCategoryFilter: (category: string) => setState(prev => ({ ...prev, categoryFilter: category })),
    setCurrentPage: (page: number) => setState(prev => ({ ...prev, currentPage: page })),
    setIsDeleting: (deleting: boolean) => setState(prev => ({ ...prev, isDeleting: deleting })),
    
    // Local DB Actions (simplified - now just one function)
    refreshLocalStats: () => loadAllData(),
    loadDBFeatures: (page = 1, limit = 50000) => loadAllData(page, limit),
    loadDBCities: () => loadAllData(), // Cities are loaded with all data
    loadDBCategories: () => loadAllData(), // Categories are loaded with all data
    loadDataForMode // New optimized loading function
  }
}