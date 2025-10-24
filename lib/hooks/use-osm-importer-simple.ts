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

export function useOSMImporterSimple() {
  // Single state object - no race conditions
  const [state, setState] = useState({
    features: [] as SimpleOSMPOI[],
    selectedFeatures: new Set<string>(),
    isLoading: false,
    error: null as string | null,
    currentFile: null as { name: string; size: number } | null,
    importResults: null as ImportResults | null
  })

  // Derived state - computed values
  const selectedPOIs = useMemo(() => 
    state.features.filter(f => state.selectedFeatures.has(f._id)),
    [state.features, state.selectedFeatures]
  )

  const availableCities = useMemo(() => 
    [...new Set(state.features.map(f => f.properties.city).filter(Boolean))],
    [state.features]
  )

  const availableCategories = useMemo(() => 
    [...new Set(state.features.map(f => f.properties.category).filter(Boolean))],
    [state.features]
  )

  // Actions - all mutations go through setState
  const loadFile = useCallback(async (file: File) => {
    setState(prev => ({ ...prev, isLoading: true, error: null }))
    
    try {
      const features = await OSMService.parseGeoJSON(file)
      setState(prev => ({
        ...prev,
        features,
        selectedFeatures: new Set(),
        isLoading: false,
        currentFile: { name: file.name, size: file.size }
      }))
    } catch (error) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to load file'
      }))
    }
  }, [])

  const editPOI = useCallback((id: string, updates: Partial<SimpleOSMPOI['properties']>) => {
    setState(prev => ({
      ...prev,
      features: prev.features.map(f => 
        f._id === id 
          ? { ...f, properties: { ...f.properties, ...updates } }
          : f
      )
    }))
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
      selectedFeatures: new Set(prev.features.map(f => f._id))
    }))
  }, [])

  const clearSelection = useCallback(() => {
    setState(prev => ({ ...prev, selectedFeatures: new Set() }))
  }, [])

  const importSelected = useCallback(async () => {
    if (selectedPOIs.length === 0) return

    setState(prev => ({ ...prev, isLoading: true, error: null }))
    
    try {
      const results = await OSMService.importPOIs(selectedPOIs)
      setState(prev => ({
        ...prev,
        isLoading: false,
        importResults: results
      }))
    } catch (error) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Import failed'
      }))
    }
  }, [selectedPOIs])

  const clearData = useCallback(() => {
    setState({
      features: [],
      selectedFeatures: new Set(),
      isLoading: false,
      error: null,
      currentFile: null,
      importResults: null
    })
  }, [])

  // Return unified interface
  return {
    // State
    features: state.features,
    selectedFeatures: state.selectedFeatures,
    selectedPOIs,
    availableCities,
    availableCategories,
    isLoading: state.isLoading,
    error: state.error,
    currentFile: state.currentFile,
    importResults: state.importResults,
    
    // Actions
    loadFile,
    editPOI,
    toggleSelection,
    selectAll,
    clearSelection,
    importSelected,
    clearData
  }
}
