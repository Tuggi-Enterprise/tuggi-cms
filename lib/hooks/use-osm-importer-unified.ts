/**
 * OSM Importer Hook - UNIFIED (DRY + SSOT + Event-Driven)
 * 
 * Single source of truth for OSM data import workflow:
 * - File loading and parsing
 * - Filtering and search  
 * - Selection management
 * - Import operations
 * - Event-driven architecture
 * 
 * @module lib/hooks/use-osm-importer-unified
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import { EditableOSMPOI, OSMCategory, ImportResults } from '../../types/osm-importer'
import { OSMImporterService } from '../services/osm-importer-service'
import { GeoJSONParserService } from '../services/geojson-parser-service'
import { osmImporterEventBus, OSM_IMPORTER_EVENTS } from '../events/osm-importer-events'

// Unified state interface (SSOT)
interface OSMImporterState {
  // Core data
  features: EditableOSMPOI[]
  filteredFeatures: EditableOSMPOI[]
  selectedFeatures: Set<string>
  
  // UI state
  isLoading: boolean
  loadingProgress: number
  loadingStep: string
  loadingDetails: string
  error: string | null
  
  // Filters
  cityFilter: string[]
  categoryFilter: string[]
  searchTerm: string
  
  // Available options
  availableCities: string[]
  availableCategories: OSMCategory[]
  
  // Import results
  importResults: ImportResults | null
  
  // Current file
  currentFile: {
    name: string
    size: number
    type: string
  } | null
}

// Unified hook with DRY principles
export function useOSMImporterUnified() {
  // SSOT: Single source of truth
  const [state, setState] = useState<OSMImporterState>({
    features: [],
    filteredFeatures: [],
    selectedFeatures: new Set(),
    isLoading: false,
    loadingProgress: 0,
    loadingStep: '',
    loadingDetails: '',
    error: null,
    cityFilter: [],
    categoryFilter: [],
    searchTerm: '',
    availableCities: [],
    availableCategories: [],
    importResults: null,
    currentFile: null
  })

  // Services (singleton pattern)
  const parserService = useRef(new GeoJSONParserService())
  const importerService = useRef(new OSMImporterService())

  // Event-driven state updates (DRY)
  const updateState = useCallback((updates: Partial<OSMImporterState>) => {
    setState(prev => ({ ...prev, ...updates }))
  }, [])

  // Unified event handlers (DRY)
  useEffect(() => {
    const unsubscribers = [
      // File load events
      osmImporterEventBus.on(OSM_IMPORTER_EVENTS.FILE_LOAD_START, () => {
        updateState({ isLoading: true, loadingProgress: 0, error: null })
      }),
      
      osmImporterEventBus.on(OSM_IMPORTER_EVENTS.FILE_LOAD_PROGRESS, (payload) => {
        updateState({ loadingProgress: payload.progress })
      }),
      
      osmImporterEventBus.on(OSM_IMPORTER_EVENTS.FILE_LOAD_COMPLETE, (payload) => {
        updateState({
          isLoading: false,
          loadingProgress: 100,
          features: payload.features,
          filteredFeatures: payload.features,
          availableCities: payload.cities,
          availableCategories: payload.categories,
          currentFile: payload.file
        })
      }),
      
      osmImporterEventBus.on(OSM_IMPORTER_EVENTS.FILE_LOAD_ERROR, (payload) => {
        updateState({
          isLoading: false,
          error: payload.error,
          loadingProgress: 0
        })
      }),
      
      // Features events
      osmImporterEventBus.on(OSM_IMPORTER_EVENTS.FEATURES_UPDATED, (payload) => {
        updateState({
          features: payload.features,
          filteredFeatures: payload.filteredFeatures
        })
      }),
      
      // Filters events
      osmImporterEventBus.on(OSM_IMPORTER_EVENTS.FILTERS_APPLIED, (payload) => {
        updateState({
          filteredFeatures: payload.filteredFeatures,
          cityFilter: payload.cityFilter,
          categoryFilter: payload.categoryFilter,
          searchTerm: payload.searchTerm
        })
      }),
      
      // Selection events
      osmImporterEventBus.on(OSM_IMPORTER_EVENTS.SELECTION_CHANGED, (payload) => {
        updateState({ selectedFeatures: payload.selectedFeatures })
      }),
      
      // Import events
      osmImporterEventBus.on(OSM_IMPORTER_EVENTS.IMPORT_COMPLETE, (payload) => {
        updateState({ importResults: payload.results })
      }),
      
      osmImporterEventBus.on(OSM_IMPORTER_EVENTS.IMPORT_ERROR, (payload) => {
        updateState({ error: payload.error })
      })
    ]

    return () => unsubscribers.forEach(unsub => unsub())
  }, [updateState])

  // Unified file loading (DRY)
  const loadGeoJSONFromText = useCallback(async (content: string, filename: string) => {
    // Start loading with initial state
    updateState({
      isLoading: true,
      loadingProgress: 0,
      loadingStep: 'Iniciando carregamento',
      loadingDetails: `Arquivo: ${filename} (${(content.length / 1024 / 1024).toFixed(1)} MB)`,
      error: null
    })

    try {
      // Emit start event
      osmImporterEventBus.emit(OSM_IMPORTER_EVENTS.FILE_LOAD_START, {
        filename,
        contentLength: content.length
      })
      
      // Step 1: Parse GeoJSON
      updateState({
        loadingProgress: 25,
        loadingStep: 'Analisando GeoJSON',
        loadingDetails: 'Convertendo dados do arquivo...'
      })
      
      const rawFeatures = parserService.current.parseGeoJSONFromText(content)
      
      // Step 2: Convert to EditableOSMPOI
      updateState({
        loadingProgress: 50,
        loadingStep: 'Processando features',
        loadingDetails: `Convertendo ${rawFeatures.length.toLocaleString()} features...`
      })
      
      const editableFeatures: EditableOSMPOI[] = rawFeatures.map((f, index) => {
        // Generate truly unique ID using hash of feature content
        const generateUniqueId = (feature: any): string => {
          try {
            // Create hash from feature content
            const content = JSON.stringify({
              geometry: feature.geometry,
              properties: feature.properties,
              type: feature.type
            })
            
            // Simple hash function (for browser compatibility)
            let hash = 0
            for (let i = 0; i < content.length; i++) {
              const char = content.charCodeAt(i)
              hash = ((hash << 5) - hash) + char
              hash = hash & hash // Convert to 32-bit integer
            }
            
            // Add timestamp and index for extra uniqueness
            const timestamp = Date.now()
            const random = Math.random().toString(36).substr(2, 5)
            
            return `osm-${Math.abs(hash).toString(36)}-${timestamp}-${random}-${index}`
          } catch (error) {
            // Fallback to UUID if hash fails
            return `osm-${crypto.randomUUID()}-${index}`
          }
        }
        
        return {
          ...f,
          _id: generateUniqueId(f),
          _selected: false,
          _edited: false,
          _editedFields: {}
        }
      })
      
      // Step 3: Extract metadata
      updateState({
        loadingProgress: 75,
        loadingStep: 'Extraindo metadados',
        loadingDetails: 'Analisando cidades e categorias...'
      })
      
      const cities = parserService.current.extractUniqueCities(editableFeatures)
      const categories = parserService.current.extractOSMCategories(editableFeatures)

      // Step 4: Finalize loading
      updateState({
        loadingProgress: 100,
        loadingStep: 'Finalizando',
        loadingDetails: `Processamento completo! ${editableFeatures.length.toLocaleString()} features carregadas`
      })

      // ATOMIC STATE UPDATE - Single update to prevent race conditions
      updateState({
        features: editableFeatures,
        filteredFeatures: editableFeatures,
        availableCities: cities,
        availableCategories: categories,
        currentFile: { name: filename, size: content.length, type: 'geojson' },
        isLoading: false,
        loadingStep: 'Concluído',
        loadingDetails: `✅ ${editableFeatures.length.toLocaleString()} features processadas com sucesso`,
        error: null
      })

      // Small delay to show completion before hiding overlay
      setTimeout(() => {
        updateState({
          loadingProgress: 0,
          loadingStep: '',
          loadingDetails: ''
        })
      }, 2000) // Show completion for 2 seconds

      // Single completion event
      osmImporterEventBus.emit(OSM_IMPORTER_EVENTS.FILE_LOAD_COMPLETE, {
        features: editableFeatures,
        cities,
        categories,
        file: { name: filename, size: content.length, type: 'geojson' }
      })

    } catch (err) {
      // Atomic error state update
      updateState({
        isLoading: false,
        loadingStep: 'Erro',
        loadingDetails: '❌ Falha no processamento',
        error: err instanceof Error ? err.message : 'Failed to load GeoJSON'
      })
      
      osmImporterEventBus.emit(OSM_IMPORTER_EVENTS.FILE_LOAD_ERROR, {
        error: err instanceof Error ? err.message : 'Failed to load GeoJSON'
      })
    }
  }, [updateState])

  // Unified filtering (DRY)
  const applyFilters = useCallback((filters: {
    cities?: string[]
    categories?: string[]
    searchTerm?: string
  }) => {
    if (state.features.length === 0) {
      osmImporterEventBus.emit(OSM_IMPORTER_EVENTS.FILTERS_APPLIED, {
        filteredFeatures: [],
        cityFilter: filters.cities || [],
        categoryFilter: filters.categories || [],
        searchTerm: filters.searchTerm || ''
      })
      return
    }

    // Convert to OSMFeature for filtering
    const osmFeatures = state.features.map(f => ({
      type: f.type,
      id: f.id,
      properties: f.properties,
      geometry: f.geometry
    }))

    // Apply filters
    const filtered = parserService.current.filterFeatures(osmFeatures, {
      cities: filters.cities?.length ? filters.cities : undefined,
      categories: filters.categories?.length ? filters.categories : undefined,
      search_term: filters.searchTerm || undefined
    })

    // Convert back to EditableOSMPOI and maintain selection state
    const filteredEditable = filtered.map((f, index) => {
      // Find existing feature to maintain selection state
      const existing = state.features.find(ef => 
        ef.geometry?.coordinates?.[0] === f.geometry?.coordinates?.[0] &&
        ef.geometry?.coordinates?.[1] === f.geometry?.coordinates?.[1] &&
        JSON.stringify(ef.properties) === JSON.stringify(f.properties)
      )
      
      return existing || {
        ...f,
        _id: `osm-${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${index}`,
        _selected: false,
        _edited: false,
        _editedFields: {}
      }
    })

    // ATOMIC FILTER UPDATE - Single state update to prevent race conditions
    updateState({
      filteredFeatures: filteredEditable,
      cityFilter: filters.cities || [],
      categoryFilter: filters.categories || [],
      searchTerm: filters.searchTerm || ''
    })

    // Single filter event
    osmImporterEventBus.emit(OSM_IMPORTER_EVENTS.FILTERS_APPLIED, {
      filteredFeatures: filteredEditable,
      cityFilter: filters.cities || [],
      categoryFilter: filters.categories || [],
      searchTerm: filters.searchTerm || ''
    })
  }, [state.features, updateState])

  // Unified selection management (DRY)
  const toggleSelection = useCallback((id: string) => {
    const newSelection = new Set(state.selectedFeatures)
    if (newSelection.has(id)) {
      newSelection.delete(id)
    } else {
      newSelection.add(id)
    }
    
    osmImporterEventBus.emit(OSM_IMPORTER_EVENTS.SELECTION_CHANGED, {
      selectedFeatures: newSelection,
      selectionCount: newSelection.size
    })
  }, [state.selectedFeatures])

  const selectAll = useCallback(() => {
    const allIds = new Set(state.filteredFeatures.map(f => f._id))
    osmImporterEventBus.emit(OSM_IMPORTER_EVENTS.SELECTION_CHANGED, {
      selectedFeatures: allIds,
      selectionCount: allIds.size
    })
  }, [state.filteredFeatures])

  const clearSelection = useCallback(() => {
    osmImporterEventBus.emit(OSM_IMPORTER_EVENTS.SELECTION_CHANGED, {
      selectedFeatures: new Set(),
      selectionCount: 0
    })
  }, [])

  // Unified import management (DRY)
  const importSelectedPOIs = useCallback(async (duplicateStrategy: 'skip' | 'replace' | 'merge' = 'skip') => {
    const selectedPOIs = state.filteredFeatures.filter(f => state.selectedFeatures.has(f._id))
    
    if (selectedPOIs.length === 0) {
      console.warn('No POIs selected for import')
      return
    }

    // Start import loading
    updateState({
      isLoading: true,
      loadingProgress: 0,
      loadingStep: 'Iniciando importação',
      loadingDetails: `Preparando ${selectedPOIs.length.toLocaleString()} POIs para importação...`,
      error: null
    })

    osmImporterEventBus.emit(OSM_IMPORTER_EVENTS.IMPORT_START, {
      selectedCount: selectedPOIs.length,
      duplicateStrategy
    })

    try {
      // Step 1: Check duplicates
      updateState({
        loadingProgress: 25,
        loadingStep: 'Verificando duplicatas',
        loadingDetails: 'Analisando POIs existentes no banco de dados...'
      })

      const response = await fetch('/api/osm-importer/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pois: selectedPOIs,
          sourceFile: state.currentFile?.name,
          duplicateStrategy
        })
      })

      if (!response.ok) {
        throw new Error(`Import failed: ${response.statusText}`)
      }

      // Step 2: Processing import
      updateState({
        loadingProgress: 75,
        loadingStep: 'Processando importação',
        loadingDetails: 'Salvando POIs no banco de dados...'
      })

      const results = await response.json()
      
      // Step 3: Complete
      updateState({
        loadingProgress: 100,
        loadingStep: 'Importação concluída',
        loadingDetails: `✅ ${results.summary.imported} POIs importados com sucesso!`
      })

      // Small delay to show completion
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      // Update import results
      updateState({ 
        importResults: results,
        isLoading: false,
        loadingStep: 'Concluído',
        loadingDetails: `Importação finalizada: ${results.summary.imported} importados, ${results.summary.skipped} ignorados`
      })
      
      osmImporterEventBus.emit(OSM_IMPORTER_EVENTS.IMPORT_COMPLETE, { results })
      
    } catch (err) {
      updateState({ 
        isLoading: false,
        loadingStep: 'Erro na importação',
        loadingDetails: '❌ Falha durante a importação',
        error: err instanceof Error ? err.message : 'Import failed' 
      })
      
      osmImporterEventBus.emit(OSM_IMPORTER_EVENTS.IMPORT_ERROR, {
        error: err instanceof Error ? err.message : 'Import failed'
      })
    }
  }, [state.filteredFeatures, state.selectedFeatures, state.currentFile, updateState])

  // Auto-apply filters when they change (event-driven) - OPTIMIZED
  useEffect(() => {
    if (state.features.length > 0) {
      // Debounced filter application to prevent race conditions
      const timeoutId = setTimeout(() => {
        applyFilters({
          cities: state.cityFilter,
          categories: state.categoryFilter,
          searchTerm: state.searchTerm
        })
      }, 50) // 50ms debounce
      
      return () => clearTimeout(timeoutId)
    }
  }, [state.features, applyFilters, state.categoryFilter, state.cityFilter, state.searchTerm]) // Include all dependencies

  // Unified return interface (DRY)
  return {
    // SSOT data
    features: state.filteredFeatures,
    allFeatures: state.features,
    selectedFeatures: state.selectedFeatures,
    availableCities: state.availableCities,
    availableCategories: state.availableCategories,
    
    // UI state
    isLoading: state.isLoading,
    loadingProgress: state.loadingProgress,
    loadingStep: state.loadingStep,
    loadingDetails: state.loadingDetails,
    error: state.error,
    currentFile: state.currentFile,
    
    // Filters
    cityFilter: state.cityFilter,
    categoryFilter: state.categoryFilter,
    searchTerm: state.searchTerm,
    
    // Import results
    importResults: state.importResults,
    
    // Actions
    loadGeoJSONFromText,
    clearData: () => updateState({
      features: [],
      filteredFeatures: [],
      selectedFeatures: new Set(),
      availableCities: [],
      availableCategories: [],
      currentFile: null,
      isLoading: false,
      loadingProgress: 0,
      loadingStep: '',
      loadingDetails: '',
      error: null,
      cityFilter: [],
      categoryFilter: [],
      searchTerm: '',
      importResults: null
    }),
    applyFilters,
    toggleSelection,
    selectAll,
    clearSelection,
    editPOI: (id: string, updates: Partial<EditableOSMPOI>) => {
      const updatedFeatures = state.features.map(f => 
        f._id === id ? { ...f, ...updates, _edited: true } : f
      )
      updateState({ features: updatedFeatures })
    },
    importSelected: importSelectedPOIs,
    checkDuplicates: async () => {
      const response = await fetch('/api/osm-importer/check-duplicates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          pois: state.filteredFeatures.filter(f => state.selectedFeatures.has(f._id))
        })
      })
      return response.json()
    },
    importSelectedPOIs,
    
    // Filter functions
    setCityFilter: (cities: string[]) => updateState({ cityFilter: cities }),
    setCategoryFilter: (categories: string[]) => updateState({ categoryFilter: categories }),
    setSearchTerm: (term: string) => updateState({ searchTerm: term }),
    
    // Utility functions (DRY - single source)
    extractLocationFromOSMTags: importerService.current.extractLocationFromOSMTags,
    getPrimaryCategory: importerService.current.getPrimaryCategory,
    getSelectionCount: () => state.selectedFeatures.size
  }
}
