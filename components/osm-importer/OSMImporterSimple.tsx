/**
 * OSM Importer Simple Component - KISS SIMPLIFIED
 * 
 * Main component with simplified logic and no race conditions
 * 
 * @module components/osm-importer/OSMImporterSimple
 */

'use client'

import { useState, useEffect, useMemo } from 'react'
import { Table2, Map, Download, Upload, CheckSquare, Square, Trash2, Database, RefreshCw, X, Search, Filter } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useOSMImporterSimple } from '@/lib/hooks/use-osm-importer-simple'
import { useUploadProgress } from '@/lib/hooks/use-upload-progress'
import { FileUpload } from './FileUpload'
import { POITable } from './POITable'
import { POIMap } from './POIMap'

export function OSMImporterSimple() {
  console.log('🏗️ [COMPONENT] OSMImporterSimple rendering')
  
  // KISS: Single hook call with all functionality and state
  const {
    // Data State
    features,
    selectedFeatures,
    selectedPOIs,
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
  } = useOSMImporterSimple()

  // KISS: Simple derived state
  const currentFeatures = features
  const currentFeaturesCount = dbPagination.total
  const hasData = currentFeaturesCount > 0
  const isInitialLoad = !isLoading && currentFeaturesCount === 0 && !error

  // Filter logic - reusing POI Management pattern
  const filteredFeatures = useMemo(() => {
    if (!currentFeatures.length) return []
    
    return currentFeatures.filter(feature => {
      // Handle both in-memory and database data structures
      const isDbData = !feature.properties && !feature.geometry
      const location = isDbData ? {
        name: (feature as any).name || 'Unnamed POI',
        city: (feature as any).city || 'Unknown',
        state: (feature as any).state || 'Unknown',
        country: (feature as any).country || 'Unknown',
        category: (feature as any).primary_category || 'Unknown'
      } : {
        name: feature.properties?.name || 'Unnamed POI',
        city: feature.properties?.city || 'Unknown',
        state: feature.properties?.state || 'Unknown',
        country: feature.properties?.country || 'Unknown',
        category: feature.properties?.category || 'Unknown'
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

  // Pagination logic for table mode
  const paginatedFeatures = useMemo(() => {
    if (viewMode === 'map') {
      // Map mode: show all filtered features (no pagination)
      return filteredFeatures
    } else {
      // Table mode: apply pagination
      const startIndex = (currentPage - 1) * itemsPerPage
      const endIndex = startIndex + itemsPerPage
      return filteredFeatures.slice(startIndex, endIndex)
    }
  }, [filteredFeatures, viewMode, currentPage, itemsPerPage])

  // Pagination info
  const totalPages = Math.ceil(filteredFeatures.length / itemsPerPage)
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
    availableCities: availableCities.length,
    availableCategories: availableCategories.length,
    citiesSample: availableCities.slice(0, 3)
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
                    No POIs found in the local database. Upload a GeoJSON file to get started.
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
                        {availableCities
                          .map(city => city.state)
                          .filter((state, index, self) => self.indexOf(state) === index)
                          .sort()
                          .map((state) => (
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
                        {availableCities
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
                        {availableCategories
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
              <div className="flex-1 overflow-hidden">
                {viewMode === 'table' ? (
                  <>
                    <POITable
                      features={paginatedFeatures}
                      selectedFeatures={selectedFeatures}
                      onToggleSelection={toggleSelection}
                    />
                    
                    {/* Pagination Controls */}
                    {totalPages > 1 && (
                      <div className="bg-white dark:bg-gray-950 border-t border-gray-200 dark:border-gray-800 px-6 py-4">
                        <div className="flex items-center justify-between">
                          <div className="text-sm text-gray-600 dark:text-gray-400">
                            Showing {((currentPage - 1) * itemsPerPage) + 1} to {Math.min(currentPage * itemsPerPage, filteredFeatures.length)} of {filteredFeatures.length} results
                          </div>
                          
                          <div className="flex items-center space-x-2">
                            <button
                              onClick={() => handlePageChange(currentPage - 1)}
                              disabled={!hasPrevPage}
                              className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              Previous
                            </button>
                            
                            <div className="flex items-center space-x-1">
                              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                                const page = i + 1
                                const isActive = page === currentPage
                                return (
                                  <button
                                    key={page}
                                    onClick={() => handlePageChange(page)}
                                    className={`px-3 py-2 text-sm border rounded-lg ${
                                      isActive
                                        ? 'bg-blue-600 text-white border-blue-600'
                                        : 'border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800'
                                    }`}
                                  >
                                    {page}
                                  </button>
                                )
                              })}
                              {totalPages > 5 && (
                                <>
                                  <span className="px-2 text-gray-500">...</span>
                                  <button
                                    onClick={() => handlePageChange(totalPages)}
                                    className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800"
                                  >
                                    {totalPages}
                                  </button>
                                </>
                              )}
                            </div>
                            
                            <button
                              onClick={() => handlePageChange(currentPage + 1)}
                              disabled={!hasNextPage}
                              className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              Next
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <POIMap
                    features={filteredFeatures}
                    selectedFeatures={selectedFeatures}
                    onToggleSelection={toggleSelection}
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
                  Add More GeoJSON Data
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
                  Upload additional GeoJSON data to merge with existing POIs in the database.
                </p>
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                  <p className="text-sm text-blue-800 dark:text-blue-200">
                    <strong>Note:</strong> New data will be added to the existing database. 
                    Duplicate POIs will be handled automatically.
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
      </div>
    </div>
  )
}