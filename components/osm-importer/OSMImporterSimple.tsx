/**
 * OSM Importer Simple Component - KISS SIMPLIFIED
 * 
 * Main component with simplified logic and no race conditions
 * 
 * @module components/osm-importer/OSMImporterSimple
 */

'use client'

import { useState, useEffect, useMemo } from 'react'
import { Table2, Map, Download, Upload, CheckSquare, Square, Trash2, Database, RefreshCw, X, Search, Filter, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useOSMImporterSimple, SimpleOSMPOI } from '@/lib/hooks/use-osm-importer-simple'
import { useUploadProgress } from '@/lib/hooks/use-upload-progress'
import { FileUpload } from './FileUpload'
import { POITable } from './POITable'
import { POIMap } from './POIMap'
import { POIDetailsModal, type POI } from '@/components/poi-management/POIDetailsModal'

interface OSMImporterSimpleProps {
  initialHasData?: boolean | null
}

// Transform SimpleOSMPOI to POI format for POIDetailsModal
// Maps all fields from homolog.pois table
function transformOSMPOIToPOI(osmPoi: SimpleOSMPOI): POI {
  const isDbData = !osmPoi.properties && !osmPoi.geometry
  const dbPoi = isDbData ? (osmPoi as any) : null
  const poiId = isDbData ? dbPoi.id || dbPoi.uuid_id : osmPoi._id
  
  // Extract coordinates
  let latitude = 0
  let longitude = 0
  
  if (dbPoi?.lat !== undefined && dbPoi?.lon !== undefined) {
    latitude = Number(dbPoi.lat)
    longitude = Number(dbPoi.lon)
  } else if (dbPoi?.latitude !== undefined && dbPoi?.longitude !== undefined) {
    latitude = Number(dbPoi.latitude)
    longitude = Number(dbPoi.longitude)
  } else if (osmPoi.geometry?.coordinates) {
    longitude = Number(osmPoi.geometry.coordinates[0])
    latitude = Number(osmPoi.geometry.coordinates[1])
  }
  
  // Extract location data
  const name = dbPoi?.name || osmPoi.properties?.name || 'Unnamed POI'
  const city = dbPoi?.city || osmPoi.properties?.city || 'Unknown'
  const state = dbPoi?.state || osmPoi.properties?.state || null
  const country = dbPoi?.country || osmPoi.properties?.country || 'Unknown'
  const category = dbPoi?.primary_category || dbPoi?.category || osmPoi.properties?.primary_category || osmPoi.properties?.category || 'point_of_interest'
  
  // Extract categories
  let categories: string[] = []
  if (dbPoi?.categories) {
    categories = Array.isArray(dbPoi.categories) ? dbPoi.categories : []
  } else if (osmPoi.properties?.categories) {
    categories = Array.isArray(osmPoi.properties.categories) ? osmPoi.properties.categories : []
  }
  
  // Transform to POI format with all homolog.pois fields
  return {
    id: poiId,
    name,
    city,
    country,
    state,
    category,
    approved: dbPoi?.approved || false,
    approved_by: null,
    approved_at: null,
    rating: null,
    image_url: null,
    created_at: dbPoi?.created_at || new Date().toISOString(),
    updated_at: dbPoi?.updated_at || new Date().toISOString(),
    user_ratings_total: null,
    formatted_address: dbPoi?.formatted_address || null,
    vicinity: null,
    website: dbPoi?.website || null,
    formatted_phone_number: dbPoi?.contact_phone || null,
    business_status: null,
    price_level: null,
    opening_hours: dbPoi?.opening_hours || null,
    google_types: null,
    photos_references: null,
    google_place_id: null,
    user_id: null,
    coordinates: latitude && longitude ? {
      latitude,
      longitude
    } : undefined,
    has_description: false,
    has_audio: false,
    description_count: 0,
    audio_count: 0,
    available_languages: [],
    trigger_points_count: 0,
    active_trigger_points_count: 0,
    reference_links: [],
    descriptions: [],
    verification_score: null,
    // Additional homolog.pois fields stored as any for now
    // Will be displayed in modal sections
    _homologData: isDbData ? {
      // OSM fields
      osm_id: dbPoi.osm_id,
      osm_type: dbPoi.osm_type,
      place_id: dbPoi.place_id,
      // Categories
      primary_category: dbPoi.primary_category,
      primary_category_type: dbPoi.primary_category_type,
      categories: categories,
      // Address details
      description: dbPoi.description,
      neighborhood: dbPoi.neighborhood,
      street_name: dbPoi.street_name,
      house_number: dbPoi.house_number,
      postal_code: dbPoi.postal_code,
      // Contact
      contact_phone: dbPoi.contact_phone,
      contact_email: dbPoi.contact_email,
      operator_name: dbPoi.operator_name,
      // Brand
      brand: dbPoi.brand,
      brand_wikidata: dbPoi.brand_wikidata,
      brand_wikipedia: dbPoi.brand_wikipedia,
      // Accessibility
      wheelchair_accessible: dbPoi.wheelchair_accessible,
      wheelchair_toilets: dbPoi.wheelchair_toilets,
      accessibility_notes: dbPoi.accessibility_notes,
      // Physical
      height: dbPoi.height,
      building_material: dbPoi.building_material,
      building_colour: dbPoi.building_colour,
      architectural_style: dbPoi.architectural_style,
      // Historical
      historic_period: dbPoi.historic_period,
      landmark_type: dbPoi.landmark_type,
      architect: dbPoi.architect,
      heritage_status: dbPoi.heritage_status,
      unesco_status: dbPoi.unesco_status,
      unesco_inscription_date: dbPoi.unesco_inscription_date,
      landmark_level: dbPoi.landmark_level,
      start_date: dbPoi.start_date,
      // Type-specific
      museum_type: dbPoi.museum_type,
      leisure_type: dbPoi.leisure_type,
      monument_type: dbPoi.monument_type,
      // Infrastructure
      parking_capacity: dbPoi.parking_capacity,
      entrance_fee: dbPoi.entrance_fee,
      // Flags
      is_historic: dbPoi.is_historic,
      is_touristic: dbPoi.is_touristic,
      has_wheelchair_access: dbPoi.has_wheelchair_access,
      is_building: dbPoi.is_building,
      // Metadata
      importance: dbPoi.importance,
      importance_level: dbPoi.importance_level,
      source_file: dbPoi.source_file,
      source_type: dbPoi.source_type,
      processing_status: dbPoi.processing_status,
      is_complete: dbPoi.is_complete,
      osm_properties: dbPoi.osm_properties
    } : null
  } as any
}

export function OSMImporterSimple({ initialHasData = null }: OSMImporterSimpleProps = {}) {
  console.log('🏗️ [COMPONENT] OSMImporterSimple rendering', { initialHasData })
  
  // Modal state
  const [selectedPOI, setSelectedPOI] = useState<POI | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  
  // KISS: Single hook call with all functionality and state
  const {
    // Data State
    features,
    selectedFeatures,
    selectedPOIs,
    availableStates,
    availableCities,
    availableCategories,
    localDBStats,
    dbPagination,
    
    // UI State
    isLoading,
    error,
    currentFile,
    importResults,
    
    // Progress State
    progress,
    
    // View State
    viewMode,
    showUploadModal,
    
    // Filter State
    searchTerm,
    cityFilter,
    stateFilter,
    categoryFilter,
    
    // Pagination State
    currentPage,
    itemsPerPage,
    
    // Delete State
    isDeleting,
    
    // Actions
    loadFile,
    toggleSelection,
    selectAll,
    clearSelection,
    importSelected,
    clearData,
    refreshLocalStats,
    loadDBFeatures,
    loadDBCities,
    loadDBCategories,
    loadDataForMode,
    
    // State Setters
    setViewMode,
    setShowUploadModal,
    setSearchTerm,
    setCityFilter,
    setStateFilter,
    setCategoryFilter,
    setCurrentPage,
    setIsDeleting
  } = useOSMImporterSimple(initialHasData)

  // KISS: Simple derived state
  const currentFeatures = useMemo(() => features || [], [features])
  // Use actual features count if pagination total is not available (RPC issue)
  const currentFeaturesCount = dbPagination?.total || currentFeatures.length || 0
  // hasData is true if we have loaded features OR if we know there's data in DB (initialHasData === true)
  // This ensures we show loading state when we know data exists but haven't loaded it yet
  const hasData = currentFeaturesCount > 0 || currentFeatures.length > 0 || initialHasData === true
  // isInitialLoad is true when we've confirmed there's no data and we're not loading
  const isInitialLoad = !isLoading && currentFeaturesCount === 0 && currentFeatures.length === 0 && !error && initialHasData === false

  // Filter logic - reusing POI Management pattern
  const filteredFeatures = useMemo(() => {
    if (!currentFeatures || !currentFeatures.length) return []
    
    return currentFeatures.filter(feature => {
      // Handle both in-memory and database data structures
      const isDbData = !feature.properties && !feature.geometry
      const location = isDbData ? {
        name: (feature as any).name || 'Unnamed POI',
        city: (feature as any).city || 'Unknown',
        state: (feature as any).state || 'Unknown',
        country: (feature as any).country || 'Unknown',
        category: (feature as any).primary_category || (feature as any).category || 'Unknown'
      } : {
        name: feature.properties?.name || 'Unnamed POI',
        city: feature.properties?.city || 'Unknown',
        state: feature.properties?.state || 'Unknown',
        country: feature.properties?.country || 'Unknown',
        category: feature.properties?.primary_category || feature.properties?.category || 'Unknown'
      }

      // Search filter
      if (searchTerm) {
        const term = searchTerm.toLowerCase()
        if (!location.name.toLowerCase().includes(term) &&
            !location.city.toLowerCase().includes(term) &&
            !location.state.toLowerCase().includes(term)) {
          return false
        }
      }

      // City filter
      if (cityFilter && location.city !== cityFilter) {
        return false
      }

      // State filter
      if (stateFilter && location.state !== stateFilter) {
        return false
      }

      // Category filter
      if (categoryFilter && location.category !== categoryFilter) {
        return false
      }

      return true
    })
  }, [currentFeatures, searchTerm, cityFilter, stateFilter, categoryFilter])

  // Pagination logic for table mode (50 items per page)
  const paginatedFeatures = useMemo(() => {
    if (viewMode === 'map') {
      // Map mode: show all filtered features (no pagination)
      return filteredFeatures
    } else {
      // Table mode: apply pagination with 50 items per page
      const startIndex = (currentPage - 1) * 50
      const endIndex = startIndex + 50
      return filteredFeatures.slice(startIndex, endIndex)
    }
  }, [filteredFeatures, viewMode, currentPage])

  // Pagination info (50 items per page)
  const totalPages = Math.ceil(filteredFeatures.length / 50)
  const hasNextPage = currentPage < totalPages
  const hasPrevPage = currentPage > 1


  // Clear filters function
  const clearFilters = () => {
    setSearchTerm('')
    setCityFilter('')
    setStateFilter('')
    setCategoryFilter('')
    setCurrentPage(1) // Reset to first page
  }

  // Handle page change
  const handlePageChange = (page: number) => {
    setCurrentPage(page)
  }

  // Handle view mode change with optimized loading
  const handleViewModeChange = (mode: 'table' | 'map') => {
    setViewMode(mode)
    // Reset to first page when switching modes
    setCurrentPage(1)
    // Load optimized data for the new mode
    loadDataForMode(mode)
  }

  // Delete selected features
  const handleDeleteSelected = async () => {
    if (selectedFeatures.size === 0) return
    
    const confirmed = window.confirm(
      `Are you sure you want to delete ${selectedFeatures.size} selected features? This action cannot be undone.`
    )
    
    if (!confirmed) return
    
    setIsDeleting(true)
    
    try {
      const featureIds = Array.from(selectedFeatures)
      console.log('🗑️ [COMPONENT] Deleting selected features:', { count: featureIds.length })
      
      const response = await fetch('/api/local-db/delete-selected', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ featureIds }),
      })
      
      const result = await response.json()
      
      if (result.success) {
        console.log('✅ [COMPONENT] Features deleted successfully:', result)
        // Clear selection and refresh data
        clearSelection()
        // Reload data to reflect changes
        loadDataForMode(viewMode)
        // Show success message
        alert(`${result.deleted} features deleted successfully`)
      } else {
        console.error('❌ [COMPONENT] Error deleting features:', result.error)
        alert(`Error deleting features: ${result.error}`)
      }
    } catch (error) {
      console.error('❌ [COMPONENT] Error deleting features:', error)
      alert(`Error deleting features: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setIsDeleting(false)
    }
  }

  console.log('📊 [COMPONENT] Current state:', {
    featuresCount: currentFeaturesCount,
    filteredCount: filteredFeatures.length,
    selectedCount: selectedFeatures.size,
    isLoading,
    hasError: !!error,
    currentFile: currentFile?.name,
    hasData,
    isInitialLoad,
    availableStates: availableStates?.length || 0,
    availableCities: availableCities?.length || 0,
    availableCategories: availableCategories?.length || 0,
    statesSample: availableStates?.slice(0, 5) || [],
    citiesSample: availableCities?.slice(0, 3) || []
  })

  // KISS: Simple event handlers
  const handleSelectAll = () => {
    if (selectedFeatures.size === currentFeaturesCount) {
      clearSelection()
    } else {
      selectAll()
    }
  }

  const handleImport = async () => {
    await importSelected()
  }

  const handleRefresh = () => {
    loadDBFeatures(1, 50000) // Load all POIs for map view (up to 50k)
    loadDBCities()
    loadDBCategories()
    refreshLocalStats()
  }

  const handleClearAll = async () => {
    if (confirm('Are you sure you want to clear all data? This action cannot be undone.')) {
      try {
        const response = await fetch('/api/local-db/clear', { method: 'POST' })
        if (response.ok) {
          clearData()
          window.location.reload()
        } else {
          alert('Error clearing data')
        }
      } catch (error) {
        console.error('Error clearing data:', error)
        alert('Error clearing data')
      }
    }
  }

  // Handle POI click to open modal
  const handlePOIClick = (poi: SimpleOSMPOI) => {
    const transformedPOI = transformOSMPOIToPOI(poi)
    setSelectedPOI(transformedPOI)
    setIsModalOpen(true)
  }

  // Handle modal close
  const handleModalClose = () => {
    setIsModalOpen(false)
    setSelectedPOI(null)
  }

  // Handle POI update (refresh data after update)
  const handlePOIUpdate = () => {
    loadDataForMode(viewMode)
  }

  return (
    <div className="h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="bg-white dark:bg-gray-950 border-b border-gray-200 dark:border-gray-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              OSM Importer
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Import and manage OpenStreetMap POIs
            </p>
          </div>
          
          <div className="flex items-center space-x-4">
            {currentFile && (
              <div className="text-sm text-gray-600 dark:text-gray-400">
                {currentFeaturesCount} POIs loaded
              </div>
            )}
            
            {currentFeaturesCount > 0 && (
              <div className="flex items-center space-x-2">
                <button
                  onClick={handleRefresh}
                  className="px-4 py-2 text-sm text-blue-600 hover:text-blue-700 border border-blue-300 rounded-lg hover:bg-blue-50"
                >
                  Refresh Data
                </button>
                <button
                  onClick={() => setShowUploadModal(true)}
                  className="px-4 py-2 text-sm text-green-600 hover:text-green-700 border border-green-300 rounded-lg hover:bg-green-50"
                >
                  Add More Data
                </button>
                <button
                  onClick={handleClearAll}
                  className="px-4 py-2 text-sm text-red-600 hover:text-red-700 border border-red-300 rounded-lg hover:bg-red-50"
                >
                  Clear All Data
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Loading State */}
        {isLoading && !hasData && (
          <div className="flex-1 flex items-center justify-center p-8">
            <div className="text-center w-full max-w-md">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
              <p className="text-gray-600 dark:text-gray-400 mb-4">Loading data from local database...</p>
              
              {/* Progress Bar */}
              {progress && (
                <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      {progress.message}
                    </span>
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                      {progress.current}/{progress.total}
                    </span>
                  </div>
                  
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                    <div 
                      className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                      style={{ 
                        width: `${Math.min((progress.current / progress.total) * 100, 100)}%` 
                      }}
                    ></div>
                  </div>
                  
                  <div className="mt-2 text-xs text-gray-500 dark:text-gray-400 text-center">
                    {Math.round((progress.current / progress.total) * 100)}% complete
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* File Upload - Show when no data or initial load */}
        {!hasData && !isLoading && (
          <div className="flex-1 flex items-center justify-center p-8">
            <div className="w-full max-w-2xl">
              {isInitialLoad ? (
                <div className="text-center">
                  <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
                    No Data Found
                  </h2>
                  <p className="text-gray-600 dark:text-gray-400 mb-8">
                    No POIs found in the local database. Upload a GeoJSON or CSV file to get started.
                  </p>
                </div>
              ) : null}
              <FileUpload
                onFileSelect={loadFile}
                isLoading={isLoading}
                error={error}
                currentFile={currentFile}
              />
            </div>
          </div>
        )}

        {/* Data View */}
        {hasData && (
          <>
            {/* Toolbar */}
            <div className="bg-white dark:bg-gray-950 border-b border-gray-200 dark:border-gray-800 px-6 py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-4">
                  {/* View Mode Toggle */}
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => handleViewModeChange('table')}
                      className={cn(
                        "px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                        viewMode === 'table'
                          ? "bg-blue-600 text-white"
                          : "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
                      )}
                    >
                      <Table2 className="w-4 h-4 mr-2 inline" />
                      Table
                    </button>
                    <button
                      onClick={() => handleViewModeChange('map')}
                      className={cn(
                        "px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                        viewMode === 'map'
                          ? "bg-blue-600 text-white"
                          : "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
                      )}
                    >
                      <Map className="w-4 h-4 mr-2 inline" />
                      Map
                    </button>
                  </div>

                  {/* Selection Controls */}
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={handleSelectAll}
                      className="flex items-center space-x-2 px-3 py-2 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
                    >
                      {selectedFeatures.size === currentFeaturesCount ? (
                        <Square className="w-4 h-4" />
                      ) : (
                        <CheckSquare className="w-4 h-4" />
                      )}
                      <span>
                        {selectedFeatures.size === currentFeaturesCount ? 'Deselect All' : 'Select All'}
                      </span>
                    </button>
                    
                    {selectedFeatures.size > 0 && (
                      <button
                        onClick={clearSelection}
                        className="px-3 py-2 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
                      >
                        Clear Selection
                      </button>
                    )}
                  </div>
                </div>

                {/* Local DB Stats */}
                {localDBStats && (
                  <div className="flex items-center space-x-2 text-sm text-gray-600 dark:text-gray-400">
                    <Database className="w-4 h-4" />
                    <span>{localDBStats.features} features</span>
                    <span>•</span>
                    <span>{localDBStats.coordinates} coordinates</span>
                    <button
                      onClick={refreshLocalStats}
                      className="ml-2 p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                    >
                      <RefreshCw className="w-4 h-4" />
                    </button>
                  </div>
                )}

                {/* Import Button */}
                <div className="flex items-center space-x-4">
                  <div className="text-sm text-gray-600 dark:text-gray-400">
                    {selectedFeatures.size} selected
                  </div>
                  
                  <button
                    onClick={handleDeleteSelected}
                    disabled={selectedFeatures.size === 0 || isDeleting}
                    className={cn(
                      "px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                      selectedFeatures.size === 0 || isDeleting
                        ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                        : "bg-red-600 text-white hover:bg-red-700"
                    )}
                  >
                    <Trash2 className="w-4 h-4 mr-2 inline" />
                    {isDeleting ? 'Deleting...' : 'Delete Selected'}
                  </button>
                  
                  <button
                    onClick={handleImport}
                    disabled={selectedFeatures.size === 0 || isLoading}
                    className={cn(
                      "px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                      selectedFeatures.size === 0 || isLoading
                        ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                        : "bg-green-600 text-white hover:bg-green-700"
                    )}
                  >
                    <Download className="w-4 h-4 mr-2 inline" />
                    Import to Supabase
                  </button>
                </div>
              </div>
            </div>

            {/* Content Area with Sidebar */}
            <div className="flex-1 flex overflow-hidden">
              {/* Left Sidebar - Filters (only show in table mode) */}
              {viewMode === 'table' && (
                <div className="w-80 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 p-6 overflow-y-auto">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center">
                      <Filter className="h-5 w-5 mr-2 text-tuggi-blue" />
                      Filters
                    </h2>
                    <button
                      onClick={clearFilters}
                      className="px-3 py-1 text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                    >
                      Clear All
                    </button>
                  </div>

                  {/* Search Bar */}
                  <div className="mb-4">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                      <input
                        type="text"
                        placeholder="Search POIs..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-tuggi-blue focus:border-transparent"
                      />
                    </div>
                  </div>

                  {/* Filters */}
                  <div className="space-y-4">
                    {/* State Filter */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        State
                      </label>
                      <select
                        value={stateFilter}
                        onChange={(e) => setStateFilter(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-tuggi-blue focus:border-transparent"
                      >
                        <option value="">All States</option>
                        {(availableStates || []).map((state) => (
                          <option key={state} value={state}>
                            {state}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* City Filter */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        City
                      </label>
                      <select
                        value={cityFilter}
                        onChange={(e) => setCityFilter(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-tuggi-blue focus:border-transparent"
                        disabled={!stateFilter}
                      >
                        <option value="">All Cities</option>
                        {(availableCities || [])
                          .filter(city => !stateFilter || city.state === stateFilter)
                          .map(city => city.name)
                          .filter((name, index, self) => self.indexOf(name) === index)
                          .sort()
                          .map((city) => (
                            <option key={city} value={city}>
                              {city}
                            </option>
                          ))}
                      </select>
                    </div>

                    {/* Category Filter */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Category
                      </label>
                      <select
                        value={categoryFilter}
                        onChange={(e) => setCategoryFilter(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-tuggi-blue focus:border-transparent"
                      >
                        <option value="">All Categories</option>
                        {(availableCategories || [])
                          .sort()
                          .map((category) => (
                            <option key={category} value={category}>
                              {category}
                            </option>
                          ))}
                      </select>
                    </div>
                  </div>

                  {/* Filter Results Summary */}
                  <div className="mt-6 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                    <div className="text-sm text-gray-600 dark:text-gray-400">
                      <div className="flex justify-between">
                        <span>Total:</span>
                        <span>{currentFeaturesCount}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Filtered:</span>
                        <span className="font-medium">{filteredFeatures.length}</span>
                      </div>
                      {viewMode === 'table' && (
                        <div className="flex justify-between">
                          <span>Page:</span>
                          <span className="font-medium">{currentPage} of {totalPages}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Main Content */}
              <div className="flex-1 overflow-auto">
                {viewMode === 'table' ? (
                  <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
                    <POITable
                      features={paginatedFeatures}
                      selectedFeatures={selectedFeatures}
                      onToggleSelection={toggleSelection}
                      onPOIClick={handlePOIClick}
                    />
                    
                    {/* Pagination */}
                    {totalPages > 1 && (
                      <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
                        <div className="flex items-center gap-4 text-sm text-gray-500 dark:text-gray-400">
                          <span>
                            Showing {((currentPage - 1) * 50) + 1} to {Math.min(currentPage * 50, filteredFeatures.length)} of {filteredFeatures.length} results
                          </span>
                          <div className="flex items-center gap-2">
                            <label htmlFor="itemsPerPage" className="text-sm font-medium">
                              Items per page:
                            </label>
                            <select
                              id="itemsPerPage"
                              value={50}
                              disabled
                              className="px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                            >
                              <option value={50}>50</option>
                            </select>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handlePageChange(currentPage - 1)}
                            disabled={currentPage === 1}
                            className="px-3 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
                          >
                            <ChevronLeft className="h-4 w-4 mr-1" />
                            Previous
                          </button>
                          <span className="px-3 py-1 text-sm text-gray-700 dark:text-gray-300">
                            Page {currentPage} of {totalPages}
                          </span>
                          <button
                            onClick={() => handlePageChange(currentPage + 1)}
                            disabled={currentPage === totalPages}
                            className="px-3 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
                          >
                            Next
                            <ChevronRight className="h-4 w-4 ml-1" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <POIMap
                    features={filteredFeatures}
                    selectedFeatures={selectedFeatures}
                    onToggleSelection={toggleSelection}
                    onPOIClick={handlePOIClick}
                    searchTerm={searchTerm}
                    stateFilter={stateFilter}
                    cityFilter={cityFilter}
                    categoryFilter={categoryFilter}
                  />
                )}
              </div>
            </div>
          </>
        )}

        {/* Import Results */}
        {importResults && (
          <div className="bg-white dark:bg-gray-950 border-t border-gray-200 dark:border-gray-800 px-6 py-4">
            <div className={cn(
              "p-4 rounded-lg",
              importResults.success 
                ? "bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200"
                : "bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200"
            )}>
              <div className="flex items-center space-x-2">
                {importResults.success ? (
                  <CheckSquare className="w-5 h-5" />
                ) : (
                  <Trash2 className="w-5 h-5" />
                )}
                <span className="font-medium">
                  {importResults.success 
                    ? `Successfully imported ${importResults.imported} POIs`
                    : `Import failed: ${importResults.errors.join(', ')}`
                  }
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Upload Modal */}
        {showUploadModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-gray-900 rounded-lg p-6 max-w-2xl w-full mx-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Add More Data
                </h3>
                <button
                  onClick={() => setShowUploadModal(false)}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
              
              <div className="mb-4">
                <p className="text-gray-600 dark:text-gray-400 mb-2">
                  Upload additional GeoJSON or CSV data to merge with existing POIs in the database.
                </p>
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                  <p className="text-sm text-blue-800 dark:text-blue-200">
                    <strong>Note:</strong> New data will be added to the existing database. 
                    Duplicate POIs will be handled automatically. CSV files must contain latitude and longitude columns.
                  </p>
                </div>
              </div>
              
              <FileUpload
                onFileSelect={(file) => {
                  loadFile(file)
                  setShowUploadModal(false)
                }}
                isLoading={isLoading}
                error={error}
                currentFile={currentFile}
              />
            </div>
          </div>
        )}

        {/* POI Details Modal */}
        {selectedPOI && isModalOpen && (
          <POIDetailsModal
            poi={selectedPOI}
            isOpen={isModalOpen}
            onClose={handleModalClose}
            onUpdate={handlePOIUpdate}
          />
        )}
      </div>
    </div>
  )
}