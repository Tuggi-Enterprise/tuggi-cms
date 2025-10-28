/**
 * Homolog POI Viewer Hook - KISS SIMPLIFIED
 * 
 * Single source of truth with no race conditions:
 * - POI viewing and editing
 * - POI selection and deletion
 * - Simple state management
 * 
 * @module lib/hooks/use-homolog-poi-viewer
 */

import { useState, useCallback, useMemo, useEffect } from 'react'

export interface HomologPOI {
  uuid_id: string
  name?: string
  city?: string
  state?: string
  country?: string
  category?: string
  primary_category?: string
  latitude?: number
  longitude?: number
  [key: string]: any
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
interface HomologPOIViewerState {
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
  importResults: ImportResults | null
  
  // Progress State
  progress: {
    current: number
    total: number
    message: string
  } | null
  
  // View State
  viewMode: 'table' | 'map'
  
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

export function useHomologPOIViewer() {
  // KISS: Single unified state object
  const [state, setState] = useState<HomologPOIViewerState>({
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
    importResults: null,
    
    // Progress State
    progress: null,
    
    // View State
    viewMode: 'table',
    
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
    (state.features || []).filter(f => state.selectedFeatures.has(f.uuid_id)),
    [state.features, state.selectedFeatures]
  )

  // KISS: Single function to load all data (eliminates race conditions)
  const loadAllData = useCallback(async (page = 1, limit = 1000) => {
    console.log('🔄 [HOMOLOG-HOOK] Loading data from homolog.pois...', { page, limit })
    setState(prev => ({ ...prev, isLoading: true, error: null }))
    
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString()
      })
      
      const response = await fetch(`/api/supabase/pois?${params}`)
      const result = await response.json()
      
      if (result.success) {
        setState(prev => ({
          ...prev,
          features: result.data,
          totalCount: result.pagination?.total || result.data?.length || 0,
          pagination: result.pagination,
          currentPage: page
        }))
        console.log('✅ [HOOK] Data loaded:', {
          features: result.data?.length || 0,
          totalCount: result.pagination?.total || 0,
          page: page,
          totalPages: result.pagination?.totalPages || 0
        })
      } else {
        throw new Error(result.error || 'Failed to load data')
      }
    } catch (error) {
      console.error('❌ [HOOK] Error loading data:', error)
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
      
      const response = await fetch(`/api/supabase/pois?${params}`)
      const result = await response.json()
      
      if (result.success) {
        setState(prev => ({
          ...prev,
          features: result.data,
          totalCount: result.pagination?.total || result.data?.length || 0,
          pagination: result.pagination
        }))
        console.log('✅ [HOOK] Data loaded for mode:', {
          mode,
          features: result.data?.length || 0,
          totalCount: result.pagination?.total || 0
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
      selectedFeatures: new Set((state.features || []).map(f => f.uuid_id))
    }))
  }, [state.features])

  const clearSelection = useCallback(() => {
    setState(prev => ({ ...prev, selectedFeatures: new Set() }))
  }, [])

  // NEW: Update POI action (for inline edit)
  const updatePOI = useCallback(async (id: string, updates: any) => {
    try {
      const response = await fetch('/api/supabase/pois/update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, updates })
      })
      
      if (!response.ok) throw new Error('Update failed')
      
      // Reload data
      await loadAllData()
    } catch (error) {
      console.error('Update failed:', error)
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Update failed'
      }))
    }
  }, [loadAllData])

  // NEW: Delete POIs action (with confirmation)
  const deletePOIs = useCallback(async (ids: string[]) => {
    setState(prev => ({ ...prev, isLoading: true, isDeleting: true }))
    
    try {
      const response = await fetch('/api/supabase/pois/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids })
      })
      
      if (!response.ok) throw new Error('Delete failed')
      
      // Reload data
      await loadAllData()
      
      // Clear selection
      setState(prev => ({ ...prev, selectedFeatures: new Set() }))
    } catch (error) {
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Delete failed'
      }))
    } finally {
      setState(prev => ({ ...prev, isLoading: false, isDeleting: false }))
    }
  }, [loadAllData])

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
      importResults: null,
      
      // Progress State
      progress: null,
      
      // View State
      viewMode: 'table',
      
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
    loadAllData(1, 1000) // Load first page with 1000 items
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
    totalCount: state.pagination.total,
    hasData: (state.pagination?.total || 0) > 0,
    
    // UI State
    isLoading: state.isLoading,
    error: state.error,
    importResults: state.importResults,
    
    // Progress State
    progress: state.progress,
    
    // View State
    viewMode: state.viewMode,
    
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
    toggleSelection,
    selectAll,
    clearSelection,
    updatePOI,  // NEW
    deletePOIs, // NEW
    clearData,
    
    // State Setters
    setViewMode: (mode: 'table' | 'map') => setState(prev => ({ ...prev, viewMode: mode })),
    setSearchTerm: (term: string) => setState(prev => ({ ...prev, searchTerm: term })),
    setCityFilter: (city: string) => setState(prev => ({ ...prev, cityFilter: city })),
    setStateFilter: (stateFilter: string) => setState(prev => ({ ...prev, stateFilter })),
    setCategoryFilter: (category: string) => setState(prev => ({ ...prev, categoryFilter: category })),
    setCurrentPage: (page: number) => setState(prev => ({ ...prev, currentPage: page })),
    setIsDeleting: (deleting: boolean) => setState(prev => ({ ...prev, isDeleting: deleting })),
    
    // Local DB Actions (simplified - now just one function)
    loadAllData, // Main data loading function
    refreshLocalStats: () => loadAllData(),
    loadDBFeatures: (page = 1, limit = 50000) => loadAllData(page, limit),
    loadDBCities: () => loadAllData(), // Cities are loaded with all data
    loadDBCategories: () => loadAllData(), // Categories are loaded with all data
    loadDataForMode // New optimized loading function
  }
}
