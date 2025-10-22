/**
 * OSM Importer Hook
 * 
 * Main state management hook for OSM data import workflow:
 * - File loading and parsing
 * - Filtering and search
 * - Selection management
 * - Import operations
 * 
 * @module lib/hooks/use-osm-importer
 */

import { useState, useCallback, useEffect } from 'react'
import { EditableOSMPOI, OSMCategory, ImportResults, DuplicateMatch } from '@/types/osm-importer'
import { OSMImporterService } from '@/lib/services/osm-importer-service'
import { GeoJSONParserService } from '@/lib/services/geojson-parser-service'

export function useOSMImporter() {
  // Services
  const [importerService] = useState(() => new OSMImporterService())
  const [parserService] = useState(() => new GeoJSONParserService())

  // Core data state
  const [features, setFeatures] = useState<EditableOSMPOI[]>([])
  const [filteredFeatures, setFilteredFeatures] = useState<EditableOSMPOI[]>([])
  const [selectedFeatures, setSelectedFeatures] = useState<Set<string>>(new Set())
  
  // Loading states
  const [isLoading, setIsLoading] = useState(false)
  const [loadingProgress, setLoadingProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  
  // Import states
  const [isImporting, setIsImporting] = useState(false)
  const [importProgress, setImportProgress] = useState(0)
  const [importResults, setImportResults] = useState<ImportResults | null>(null)
  const [duplicates, setDuplicates] = useState<DuplicateMatch[]>([])

  // Filters
  const [cityFilter, setCityFilter] = useState<string[]>([])
  const [categoryFilter, setCategoryFilter] = useState<string[]>([])
  const [searchTerm, setSearchTerm] = useState('')

  // Available options (extracted from data)
  const [availableCities, setAvailableCities] = useState<string[]>([])
  const [availableCategories, setAvailableCategories] = useState<OSMCategory[]>([])

  // Current file info
  const [currentFile, setCurrentFile] = useState<{
    name: string
    size: number
    type: 'pbf' | 'geojson'
  } | null>(null)

  /**
   * Load GeoJSON file
   */
  const loadGeoJSON = useCallback(async (file: File) => {
    setIsLoading(true)
    setLoadingProgress(0)
    setError(null)
    setCurrentFile({
      name: file.name,
      size: file.size,
      type: 'geojson'
    })

    try {
      const allFeatures: EditableOSMPOI[] = []
      let processedCount = 0

      for await (const chunk of parserService.parseGeoJSON(file)) {
        const editableChunk = chunk.map(f => ({
          ...f,
          _id: crypto.randomUUID(),
          _selected: false,
          _edited: false,
          _editedFields: {}
        }))
        
        allFeatures.push(...editableChunk)
        processedCount += chunk.length
        
        // Update progress (estimate based on file size)
        const estimatedTotal = Math.max(1000, file.size / 1000) // Rough estimate
        setLoadingProgress(Math.min(95, (processedCount / estimatedTotal) * 100))
      }

      setFeatures(allFeatures)
      setFilteredFeatures(allFeatures)

      // Extract metadata
      const cities = parserService.extractUniqueCities(allFeatures)
      setAvailableCities(cities)

      const categories = parserService.extractOSMCategories(allFeatures)
      setAvailableCategories(categories)

      setLoadingProgress(100)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load GeoJSON')
    } finally {
      setIsLoading(false)
    }
  }, [parserService])

  /**
   * Load GeoJSON from text content
   */
  const loadGeoJSONFromText = useCallback(async (content: string, filename: string) => {
    setIsLoading(true)
    setLoadingProgress(0)
    setError(null)
    setCurrentFile({
      name: filename,
      size: content.length,
      type: 'geojson'
    })

    try {
      const rawFeatures = parserService.parseGeoJSONFromText(content)
      
      const editableFeatures: EditableOSMPOI[] = rawFeatures.map(f => ({
        ...f,
        _id: crypto.randomUUID(),
        _selected: false,
        _edited: false,
        _editedFields: {}
      }))

      setFeatures(editableFeatures)
      setFilteredFeatures(editableFeatures)

      // Extract metadata
      const cities = parserService.extractUniqueCities(editableFeatures)
      setAvailableCities(cities)

      const categories = parserService.extractOSMCategories(editableFeatures)
      setAvailableCategories(categories)

      setLoadingProgress(100)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load GeoJSON')
    } finally {
      setIsLoading(false)
    }
  }, [parserService])

  /**
   * Apply filters to features
   */
  const applyFilters = useCallback(() => {
    const filtered = parserService.filterFeatures(features, {
      cities: cityFilter.length > 0 ? cityFilter : undefined,
      categories: categoryFilter.length > 0 ? categoryFilter : undefined,
      search_term: searchTerm || undefined
    })

    setFilteredFeatures(filtered as EditableOSMPOI[])
  }, [features, cityFilter, categoryFilter, searchTerm, parserService])

  // Auto-apply filters when they change
  useEffect(() => {
    applyFilters()
  }, [applyFilters])

  /**
   * Selection management
   */
  const toggleSelection = useCallback((id: string) => {
    setSelectedFeatures(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const selectAll = useCallback(() => {
    setSelectedFeatures(new Set(filteredFeatures.map(f => f._id)))
  }, [filteredFeatures])

  const selectByFilter = useCallback((filter: string) => {
    const filtered = parserService.filterFeatures(features, {
      cities: filter.includes('city:') ? [filter.split('city:')[1]] : undefined,
      categories: filter.includes('category:') ? [filter.split('category:')[1]] : undefined
    })
    setSelectedFeatures(new Set((filtered as EditableOSMPOI[]).map(f => f._id)))
  }, [features, parserService])

  const clearSelection = useCallback(() => {
    setSelectedFeatures(new Set())
  }, [])

  /**
   * Edit POI
   */
  const editPOI = useCallback((id: string, field: string, value: any) => {
    setFeatures(prev => prev.map(f => 
      f._id === id 
        ? { ...f, _edited: true, _editedFields: { ...f._editedFields, [field]: value } }
        : f
    ))
  }, [])

  /**
   * Check for duplicates
   */
  const checkDuplicates = useCallback(async () => {
    if (selectedFeatures.size === 0) return

    const selectedPOIs = features.filter(f => selectedFeatures.has(f._id)) as EditableOSMPOI[]
    const duplicates = await importerService.checkDuplicates(selectedPOIs)
    setDuplicates(duplicates)
    return duplicates
  }, [features, selectedFeatures, importerService])

  /**
   * Import selected POIs
   */
  const importSelected = useCallback(async (
    duplicateStrategy: 'skip' | 'replace' | 'merge' = 'skip'
  ) => {
    if (selectedFeatures.size === 0) return

    setIsImporting(true)
    setImportProgress(0)
    setError(null)

    try {
      const selectedPOIs = features.filter(f => selectedFeatures.has(f._id)) as EditableOSMPOI[]
      const batchId = await importerService.createImportBatch(
        currentFile?.name || 'unknown',
        'geojson'
      )

      // Simulate progress
      const progressInterval = setInterval(() => {
        setImportProgress(prev => Math.min(90, prev + 10))
      }, 200)

      const results = await importerService.importPOIs(selectedPOIs, batchId, duplicateStrategy)

      clearInterval(progressInterval)
      setImportProgress(100)
      setImportResults(results)

      // Clear selection after successful import
      if (results.summary.failed === 0) {
        clearSelection()
      }

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setIsImporting(false)
    }
  }, [features, selectedFeatures, currentFile, importerService, clearSelection])

  /**
   * Clear all data
   */
  const clearData = useCallback(() => {
    setFeatures([])
    setFilteredFeatures([])
    setSelectedFeatures(new Set())
    setAvailableCities([])
    setAvailableCategories([])
    setCurrentFile(null)
    setError(null)
    setImportResults(null)
    setDuplicates([])
  }, [])

  /**
   * Get selected POIs
   */
  const getSelectedPOIs = useCallback(() => {
    return features.filter(f => selectedFeatures.has(f._id))
  }, [features, selectedFeatures])

  /**
   * Get filtered POIs count
   */
  const getFilteredCount = useCallback(() => {
    return filteredFeatures.length
  }, [filteredFeatures])

  /**
   * Get selection count
   */
  const getSelectionCount = useCallback(() => {
    return selectedFeatures.size
  }, [selectedFeatures])

  return {
    // Data
    features: filteredFeatures,
    allFeatures: features,
    selectedFeatures,
    availableCities,
    availableCategories,
    currentFile,
    
    // Loading states
    isLoading,
    loadingProgress,
    isImporting,
    importProgress,
    error,
    
    // Results
    importResults,
    duplicates,
    
    // Actions
    loadGeoJSON,
    loadGeoJSONFromText,
    clearData,
    
    // Selection
    toggleSelection,
    selectAll,
    selectByFilter,
    clearSelection,
    getSelectedPOIs,
    
    // Editing
    editPOI,
    
    // Import
    checkDuplicates,
    importSelected,
    
    // Filters
    cityFilter,
    setCityFilter,
    categoryFilter,
    setCategoryFilter,
    searchTerm,
    setSearchTerm,
    applyFilters,
    
    // Stats
    getFilteredCount,
    getSelectionCount,
    
    // Utility functions
    extractLocationFromOSMTags: importerService.extractLocationFromOSMTags.bind(importerService),
    getPrimaryCategory: importerService.getPrimaryCategory.bind(importerService)
  }
}
