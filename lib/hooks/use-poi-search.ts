import { useState, useCallback, useMemo } from 'react'
import { EnhancedPlaceResult } from '@/types/poi-importer'
import { POIImportService } from '@/lib/services/poi-import-service'
import { useSupabaseClient } from '@supabase/auth-helpers-react'

export function usePOISearch(selectedCountry: string = '') {
  const supabase = useSupabaseClient()
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

  // Create service instance
  const poiService = useMemo(() => {
    if (!apiKey) return null
    return new POIImportService(supabase, apiKey, selectedCountry)
  }, [supabase, apiKey, selectedCountry])

  // State
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [searchResults, setSearchResults] = useState<EnhancedPlaceResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [searchStatus, setSearchStatus] = useState<string>('')
  const [isImporting, setIsImporting] = useState(false)
  const [importStatus, setImportStatus] = useState<string>('')
  const [importedCount, setImportedCount] = useState(0)
  const [selectedPlaceDetails, setSelectedPlaceDetails] = useState<Record<string, any>>({})

  // Update service language when country changes
  if (poiService && selectedCountry) {
    poiService.setLanguage(selectedCountry)
  }

  // Search places in polygon
  const searchPlacesInPolygon = useCallback(async (
    category: string,
    polygonCoords: Array<{ lat: number; lng: number }>
  ) => {
    if (!poiService || polygonCoords.length === 0) {
      setSearchStatus('Invalid search parameters')
      return
    }

    setIsSearching(true)
    setSearchStatus('Searching for places...')
    setSearchResults([])
    setSelectedPlaceDetails({})

    try {
      const { results, status } = await poiService.searchPlacesInPolygon(category, polygonCoords)
      setSearchResults(results)
      setSearchStatus(status)
    } catch (error) {
      console.error('Error searching places:', error)
      setSearchStatus(`Search error: ${error instanceof Error ? error.message : 'Unknown error'}`)
      setSearchResults([])
    } finally {
      setIsSearching(false)
    }
  }, [poiService])

  // Toggle place selection
  const togglePlaceSelection = useCallback((placeId: string) => {
    setSearchResults(prev => prev.map(place => 
      place.place_id === placeId 
        ? { ...place, isSelected: !place.isSelected }
        : place
    ))
  }, [])

  // Get selected places
  const getSelectedPlaces = useCallback((): EnhancedPlaceResult[] => {
    return searchResults.filter(place => place.isSelected && !place.alreadyExists)
  }, [searchResults])

  // Import selected places
  const importSelectedPlaces = useCallback(async () => {
    if (!poiService) {
      setImportStatus('POI service not available')
      return
    }

    const selectedPlaces = getSelectedPlaces()
    if (selectedPlaces.length === 0) {
      setImportStatus('No places selected for import')
      return
    }

    setIsImporting(true)
    setImportedCount(0)
    setImportStatus(`Creating import batch for ${selectedPlaces.length} places...`)

    try {
      // Create import batch
      const batchId = await poiService.createImportBatch(selectedPlaces)
      setImportStatus('Import batch created. Starting imports...')

      let successCount = 0
      let errorCount = 0

      // Import each place
      for (let i = 0; i < selectedPlaces.length; i++) {
        const place = selectedPlaces[i]
        
        setImportStatus(`Importing ${place.name} (${i + 1}/${selectedPlaces.length})...`)
        
        try {
          const result = await poiService.importPOI(place, batchId)
          
          if (result.success) {
            successCount++
            setImportedCount(successCount)
            
            // Mark as imported in the UI
            setSearchResults(prev => prev.map(p => 
              p.place_id === place.place_id 
                ? { ...p, alreadyExists: true, isSelected: false }
                : p
            ))
          } else {
            errorCount++
            console.error(`Failed to import ${place.name}:`, result.error)
          }

          // Update batch progress
          await poiService.updateImportBatchProgress(batchId, i + 1, selectedPlaces.length)
          
          // Small delay to avoid overwhelming the API
          await new Promise(resolve => setTimeout(resolve, 100))
          
        } catch (error) {
          errorCount++
          console.error(`Error importing ${place.name}:`, error)
        }
      }

      const finalStatus = `Import completed! ${successCount} successful, ${errorCount} failed.`
      setImportStatus(finalStatus)
      
      return { successCount, errorCount }
    } catch (error) {
      console.error('Error during import process:', error)
      setImportStatus(`Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
      throw error
    } finally {
      setIsImporting(false)
    }
  }, [poiService, getSelectedPlaces])

  // Fetch place details
  const fetchPlaceDetails = useCallback(async (placeId: string) => {
    if (!poiService || selectedPlaceDetails[placeId]) return

    try {
      const details = await poiService.fetchPlaceDetails(placeId)
      if (details) {
        setSelectedPlaceDetails(prev => ({
          ...prev,
          [placeId]: details
        }))
      }
    } catch (error) {
      console.error('Error fetching place details:', error)
    }
  }, [poiService, selectedPlaceDetails])

  // Clear search results
  const clearSearchResults = useCallback(() => {
    setSearchResults([])
    setSelectedPlaceDetails({})
    setSearchStatus('')
    setImportStatus('')
    setImportedCount(0)
  }, [])

  // Computed values
  const searchStats = useMemo(() => {
    const total = searchResults.length
    const selected = searchResults.filter(p => p.isSelected).length
    const alreadyExists = searchResults.filter(p => p.alreadyExists).length
    const availableToSelect = searchResults.filter(p => !p.alreadyExists).length

    return {
      total,
      selected,
      alreadyExists,
      availableToSelect
    }
  }, [searchResults])

  return {
    // State
    selectedCategory,
    setSelectedCategory,
    searchResults,
    isSearching,
    searchStatus,
    isImporting,
    importStatus,
    importedCount,
    selectedPlaceDetails,
    searchStats,

    // Actions
    searchPlacesInPolygon,
    togglePlaceSelection,
    getSelectedPlaces,
    importSelectedPlaces,
    fetchPlaceDetails,
    clearSearchResults,
  }
} 