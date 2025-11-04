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
import { useRouter, useSearchParams } from 'next/navigation'
import { OSMService } from '../services/osm-service-simple'

export interface SimpleOSMPOI {
  _id: string
  uuid_id?: string // Deterministic UUID for Supabase
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
  
  // Progress State
  progress: {
    current: number
    total: number
    message: string
  } | null
  
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

export function useOSMImporterSimple(initialHasData: boolean | null = null) {
  const router = useRouter()
  const searchParams = useSearchParams()
  
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
    
    // Progress State
    progress: null,
    
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
    (state.features || []).filter(f => state.selectedFeatures.has(f.id)),
    [state.features, state.selectedFeatures]
  )

  // Extract unique states and cities from all loaded features
  const availableStates = useMemo(() => {
    if (!state.features || state.features.length === 0) return []
    
    const states = new Set<string>()
    state.features.forEach(feature => {
      // Handle both in-memory and database data structures
      const isDbData = !feature.properties && !feature.geometry
      const state = isDbData ? (feature as any).state : feature.properties?.state
      if (state && state !== 'Unknown' && state.trim() !== '') {
        states.add(state)
      }
    })
    
    return Array.from(states).sort()
  }, [state.features])

  const availableCities = useMemo(() => {
    if (!state.features || state.features.length === 0) return []
    
    const cityStateMap = new Map<string, string>()
    state.features.forEach(feature => {
      // Handle both in-memory and database data structures
      const isDbData = !feature.properties && !feature.geometry
      const city = isDbData ? (feature as any).city : feature.properties?.city
      const state = isDbData ? (feature as any).state : feature.properties?.state
      
      if (city && city !== 'Unknown' && city.trim() !== '' && 
          state && state !== 'Unknown' && state.trim() !== '') {
        cityStateMap.set(city, state)
      }
    })
    
    return Array.from(cityStateMap.entries()).map(([name, state]) => ({ name, state }))
  }, [state.features])

  const availableCategories = useMemo(() => {
    if (!state.features || state.features.length === 0) return []
    
    const categories = new Set<string>()
    state.features.forEach(feature => {
      // Handle both in-memory and database data structures
      const isDbData = !feature.properties && !feature.geometry
      const category = isDbData 
        ? ((feature as any).primary_category || (feature as any).category)
        : (feature.properties?.primary_category || feature.properties?.category)
      if (category && category !== 'Unknown' && category.trim() !== '') {
        categories.add(category)
      }
    })
    
    return Array.from(categories).sort()
  }, [state.features])

  // KISS: Single function to load all data (eliminates race conditions)
  const loadAllData = useCallback(async (page = 1, limit = 50) => {
    console.log('🔄 [HOOK] Loading all data from Supabase...')
    setState(prev => ({ ...prev, isLoading: true, error: null }))
    
    try {
      // Get total count from stats API (more reliable than RPC pagination)
      let totalCount = 0
      try {
        const statsResponse = await fetch('/api/supabase/stats')
        const statsResult = await statsResponse.json()
        if (statsResult.success && statsResult.data) {
          totalCount = statsResult.data.total_pois || 0
          console.log(`📊 [HOOK] Total POIs from stats: ${totalCount}`)
        }
      } catch (statsError) {
        console.warn('⚠️ [HOOK] Stats API failed, will use fallback method:', statsError)
      }
      
      // If stats didn't work, try getting first page to check if data exists
      if (totalCount === 0) {
        const firstPageResponse = await fetch('/api/supabase/pois?page=1&limit=1')
        const firstPageResult = await firstPageResponse.json()
        if (firstPageResult.success && firstPageResult.data && firstPageResult.data.length > 0) {
          // Data exists but we don't know the total, so we'll load in batches until empty
          console.log('📊 [HOOK] Found data but no total count, will load in batches...')
          totalCount = 1 // Signal that we should start loading
        }
      }
      
      // Load all data in batches of 1000 (Supabase RPC limit)
      const allFeatures: any[] = []
      const batchSize = 1000
      let currentBatch = 1
      let hasMoreData = true
      
      // If we have totalCount, calculate batches, otherwise load until empty
      const estimatedBatches = totalCount > 0 ? Math.ceil(totalCount / batchSize) : null
      
      console.log(`🔄 [HOOK] Loading batches (estimated: ${estimatedBatches || 'unknown'})...`)
      
      // Load all data: continue until we get an empty response or error
      // Don't rely on estimatedBatches as it might be inaccurate
      while (hasMoreData) {
        const params = new URLSearchParams({
          page: currentBatch.toString(),
          limit: batchSize.toString()
        })
        
        console.log(`🔄 [HOOK] Loading batch ${currentBatch}...`)
        const response = await fetch(`/api/supabase/pois?${params}`)
        const result = await response.json()
        
        if (result.success && result.data && result.data.length > 0) {
          // Normalize data: ensure each feature has an 'id' field (use uuid_id if available)
          const normalizedData = result.data.map((feature: any) => ({
            ...feature,
            id: feature.id || feature.uuid_id || `poi-${feature.uuid_id || Math.random()}`
          }))
          allFeatures.push(...normalizedData)
          console.log(`✅ [HOOK] Batch ${currentBatch} loaded: ${normalizedData.length} items (total so far: ${allFeatures.length})`)
          
          // If we got less than batchSize, we've reached the end
          if (result.data.length < batchSize) {
            console.log(`📊 [HOOK] Batch ${currentBatch} returned ${result.data.length} items (less than batchSize ${batchSize}), stopping load`)
            hasMoreData = false
          }
          currentBatch++
          
          // Safety limit: calculate based on totalCount if available, otherwise use a reasonable default
          const maxBatches = totalCount > 0 
            ? Math.ceil(totalCount / batchSize) + 2 // Add 2 extra batches for safety
            : 10 // Default to 10 batches (10,000 POIs) if we don't know the total
          
          if (currentBatch > maxBatches) {
            console.warn(`⚠️ [HOOK] Reached safety limit of ${maxBatches} batches (${maxBatches * batchSize} POIs). Stopping load.`)
            hasMoreData = false
          }
        } else {
          // No more data or error
          hasMoreData = false
          if (!result.success) {
            console.warn(`⚠️ [HOOK] Batch ${currentBatch} failed:`, result.error)
          } else {
            console.log(`📊 [HOOK] Batch ${currentBatch} returned no data, stopping load`)
          }
        }
      }
      
      // Update totalCount with actual loaded count if we didn't have it before
      const finalTotal = totalCount > 0 ? totalCount : allFeatures.length
      
      setState(prev => ({
        ...prev,
        features: allFeatures,
        pagination: {
          page: 1,
          limit: 50,
          total: finalTotal,
          totalPages: Math.ceil(finalTotal / 50),
          hasNext: false,
          hasPrev: false
        }
      }))
      
      console.log('✅ [HOOK] All data loaded:', {
        totalFeatures: allFeatures.length,
        totalCount: finalTotal
      })
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
    setState(prev => ({ ...prev, viewMode: mode }))
    
    // Since we load all data at once, just change the view mode
    // No need to reload data
    console.log('✅ [HOOK] View mode changed to:', mode)
  }, [])

  // File loading (unchanged functionality)
  const loadFile = useCallback(async (file: File) => {
    console.log('🚀 [HOOK] Starting file load:', { name: file.name, size: file.size, type: file.type })
    setState(prev => ({ ...prev, isLoading: true, error: null, progress: null }))
    
    // Generate unique upload ID for this session
    const uploadId = `upload_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    
    try {
      // Always parse and save directly to local database
      console.log('💾 [HOOK] Parsing and saving to local database...')
      const results = await OSMService.parseFileToDB(file, (current, total, message) => {
        setState(prev => ({
          ...prev,
          progress: { current, total, message }
        }))
      }, uploadId)
      
      if (results.success) {
        // Reload all data from database (single call, no race conditions)
        await loadAllData()
      }
      
      setState(prev => ({
        ...prev,
        isLoading: false,
        progress: null,
        currentFile: { name: file.name, size: file.size },
        importResults: results
      }))
      
      console.log('🎯 [HOOK] File load completed')
    } catch (error) {
      console.error('❌ [HOOK] File load failed:', error)
      setState(prev => ({
        ...prev,
        isLoading: false,
        progress: null,
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
      selectedFeatures: new Set((state.features || []).map(f => f.id))
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
      
      // Progress State
      progress: null,
      
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
  // Only load data if we know there is data in the database
  useEffect(() => {
    if (initialHasData === null) {
      // If we don't know yet, check first
      console.log('🔍 [HOOK] Checking for data before loading...')
      const checkAndLoad = async () => {
        try {
          const response = await fetch('/api/supabase/pois?page=1&limit=1')
          const result = await response.json()
          const totalCount = result.pagination?.total || 0
          
          if (totalCount > 0) {
            console.log(`📊 [HOOK] Found ${totalCount} POIs, loading data...`)
            loadAllData()
          } else {
            console.log('📊 [HOOK] No data found in database, skipping load')
          }
        } catch (error) {
          console.error('❌ [HOOK] Error checking for data:', error)
        }
      }
      checkAndLoad()
    } else if (initialHasData === true) {
      // If we know there's data, load it
      console.log('🔄 [HOOK] Auto-loading data on mount (data exists)...')
      loadAllData()
    } else {
      // If we know there's no data, don't load
      console.log('📊 [HOOK] No data in database, skipping auto-load')
    }
  }, [loadAllData, initialHasData]) // Include initialHasData dependency


  // Sync current page with URL
  useEffect(() => {
    const pageFromUrl = searchParams.get('page')
    if (pageFromUrl) {
      const page = parseInt(pageFromUrl, 10)
      if (page > 0 && page !== state.pagination.page) {
        console.log('🔄 [HOOK] Syncing page from URL:', page)
        setState(prev => ({
          ...prev,
          pagination: {
            ...prev.pagination,
            page
          }
        }))
      }
    }
  }, [searchParams, state.pagination.page])

  // Return unified interface (enhanced with new state)
  return {
    // Data State
    features: state.features,
    selectedFeatures: state.selectedFeatures,
    selectedPOIs,
    availableStates,
    availableCities,
    availableCategories,
    localDBStats: state.stats,
    dbPagination: state.pagination,
    
    // UI State
    isLoading: state.isLoading,
    error: state.error,
    currentFile: state.currentFile,
    importResults: state.importResults,
    
    // Progress State
    progress: state.progress,
    
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
    setCurrentPage: (page: number) => {
      setState(prev => ({ ...prev, currentPage: page }))
      // Update URL with new page
      const params = new URLSearchParams(searchParams.toString())
      params.set('page', page.toString())
      router.push(`?${params.toString()}`, { scroll: false })
    },
    setIsDeleting: (deleting: boolean) => setState(prev => ({ ...prev, isDeleting: deleting })),
    
    // Local DB Actions (simplified - now just one function)
    refreshLocalStats: () => loadAllData(),
    loadDBFeatures: (page = 1, limit = 50000) => loadAllData(page, limit),
    loadDBCities: () => loadAllData(), // Cities are loaded with all data
    loadDBCategories: () => loadAllData(), // Categories are loaded with all data
    loadDataForMode // New optimized loading function
  }
}