/**
 * Homolog POI Viewer Component - KISS SIMPLIFIED
 * 
 * Main component for viewing and managing POIs from homolog.pois
 * 
 * @module components/poi-importer/HomologPOIViewer
 */

'use client'

import { useState, useEffect, useMemo } from 'react'
import { Table2, Map, CheckSquare, Square, Trash2, Database, RefreshCw, Search, Filter } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'
import { useHomologPOIViewer } from '@/lib/hooks/use-homolog-poi-viewer'
import { POITable } from './POITable'
import { OptimizedOSMMap } from '@/components/osm-importer/OptimizedOSMMap'

export function HomologPOIViewer() {
  const t = useTranslations('Pages.POIImporter.viewer')
  const tImporter = useTranslations('Pages.POIImporter')
  const tShared = useTranslations('Shared')
  const tCommon = useTranslations('Common')
  console.log('🏗️ [HOMOLOG-POI-VIEWER] Component rendering')
  
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
    totalCount,
    hasData,
    
    // UI State
    isLoading,
    error,
    importResults,
    
    // Progress State
    progress,
    
    // View State
    viewMode,
    
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
    toggleSelection,
    selectAll,
    clearSelection,
    updatePOI,  // NEW
    deletePOIs, // NEW
    clearData,
    loadAllData, // Main data loading function
    refreshLocalStats,
    loadDBFeatures,
    loadDBCities,
    loadDBCategories,
    loadDataForMode,
    
    // State Setters
    setViewMode,
    setSearchTerm,
    setCityFilter,
    setStateFilter,
    setCategoryFilter,
    setCurrentPage,
    setIsDeleting
  } = useHomologPOIViewer()

  // Load data on mount
  useEffect(() => {
    console.log('🔄 [COMPONENT] Loading initial data...')
    loadAllData(1, 1000)
  }, [loadAllData])

  // Load data when page changes
  useEffect(() => {
    if (currentPage > 1) {
      console.log('🔄 [COMPONENT] Loading page:', currentPage)
      loadAllData(currentPage, itemsPerPage)
    }
  }, [currentPage, itemsPerPage, loadAllData])

  // KISS: Simple derived state
  const currentFeatures = features || []
  const currentFeaturesCount = totalCount || 0
  const isInitialLoad = !isLoading && currentFeaturesCount === 0 && !error

  // Filter logic - reusing POI Management pattern
  const filteredFeatures = useMemo(() => {
    if (!currentFeatures || !currentFeatures.length) return []
    
    return currentFeatures.filter(feature => {
      const location = {
        name: feature.name || tImporter('table.unnamed'),
        city: feature.city || tCommon('labels.unknown'),
        state: feature.state || tCommon('labels.unknown'),
        country: feature.country || tCommon('labels.unknown'),
        category: feature.primary_category || tCommon('labels.unknown')
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

  // Use server-side pagination - no client-side pagination needed
  const paginatedFeatures = useMemo(() => {
    if (viewMode === 'map') {
      // Map mode: show all filtered features (no pagination)
      return filteredFeatures
    } else {
      // Table mode: use server-paginated data directly
      return currentFeatures
    }
  }, [currentFeatures, viewMode])

  // Server-side pagination info
  const totalPages = Math.ceil((totalCount || 0) / itemsPerPage)
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
    loadAllData(page, itemsPerPage)
  }

  // Handle view mode change with optimized loading
  const handleViewModeChange = (mode: 'table' | 'map') => {
    setViewMode(mode)
    // Reset to first page when switching modes
    setCurrentPage(1)
    // Load optimized data for the new mode
    loadDataForMode(mode)
  }

  // NEW: Delete single POI with confirmation
  const handleDelete = (id: string) => {
    if (window.confirm(t('delete_confirm'))) {
      deletePOIs([id])
    }
  }

  // NEW: Delete selected POIs with confirmation
  const handleDeleteSelected = () => {
    const count = selectedFeatures.size
    if (count === 0) return
    
    if (window.confirm(t('delete_selected_confirm', { count }))) {
      deletePOIs(Array.from(selectedFeatures))
    }
  }

  console.log('📊 [COMPONENT] Current state:', {
    featuresCount: currentFeaturesCount,
    filteredCount: filteredFeatures.length,
    selectedCount: selectedFeatures.size,
    isLoading,
    hasError: !!error,
    hasData,
    isInitialLoad,
    availableCities: availableCities?.length || 0,
    availableCategories: availableCategories?.length || 0,
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

  const handleRefresh = () => {
    loadDBFeatures(1, 50000) // Load all POIs for map view (up to 50k)
    loadDBCities()
    loadDBCategories()
    refreshLocalStats()
  }

  return (
    <div className="h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="bg-white dark:bg-gray-950 border-b border-gray-200 dark:border-gray-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {t('title')}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t('subtitle')}
            </p>
          </div>
          
          <div className="flex items-center space-x-4">
            {hasData && (
              <div className="text-sm text-gray-600 dark:text-gray-400">
                {t('loaded_count', { count: currentFeaturesCount })}
              </div>
            )}
            
            {currentFeaturesCount > 0 && (
              <div className="flex items-center space-x-2">
                <button
                  onClick={handleRefresh}
                  className="px-4 py-2 text-sm text-blue-600 hover:text-blue-700 border border-blue-300 rounded-lg hover:bg-blue-50"
                >
                  {t('refresh_btn')}
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
              <p className="text-gray-600 dark:text-gray-400 mb-4">{t('loading')}</p>
            </div>
          </div>
        )}

        {/* Empty State */}
        {!hasData && !isLoading && (
          <div className="flex-1 flex items-center justify-center p-8">
            <div className="text-center">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
                {t('empty.title')}
              </h2>
              <p className="text-gray-600 dark:text-gray-400 mb-8">
                {t('empty.subtitle')}
              </p>
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
                      {tShared('ViewModeToggle.table')}
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
                      {tShared('ViewModeToggle.map')}
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
                        {selectedFeatures.size === currentFeaturesCount ? tImporter('actions.deselect_all') : tImporter('actions.select_all')}
                      </span>
                    </button>
                    
                    {selectedFeatures.size > 0 && (
                      <button
                        onClick={clearSelection}
                        className="px-3 py-2 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
                      >
                        {tImporter('actions.clear_selection', { count: selectedFeatures.size })}
                      </button>
                    )}
                  </div>
                </div>

                {/* Database Stats */}
                {localDBStats && (
                  <div className="flex items-center space-x-2 text-sm text-gray-600 dark:text-gray-400">
                    <Database className="w-4 h-4" />
                    <span>{t('stats.features', { count: localDBStats.features })}</span>
                    <span>•</span>
                    <span>{t('stats.coordinates', { count: localDBStats.coordinates })}</span>
                    <button
                      onClick={refreshLocalStats}
                      className="ml-2 p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                    >
                      <RefreshCw className="w-4 h-4" />
                    </button>
                  </div>
                )}

                {/* Delete Button */}
                <div className="flex items-center space-x-4">
                  <div className="text-sm text-gray-600 dark:text-gray-400">
                    {tImporter('actions.clear_selection', { count: selectedFeatures.size })}
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
                    {isDeleting ? tImporter('actions.deleting') : tImporter('actions.delete_selected')}
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
                      {tShared('FiltersSidebar.title')}
                    </h2>
                    <button
                      onClick={clearFilters}
                      className="px-3 py-1 text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                    >
                      {tShared('FiltersSidebar.clear')}
                    </button>
                  </div>

                  {/* Search Bar */}
                  <div className="mb-4">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                      <input
                        type="text"
                        placeholder={tShared('FiltersSidebar.search')}
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
                        {tShared('FiltersSidebar.state')}
                      </label>
                      <select
                        value={stateFilter}
                        onChange={(e) => setStateFilter(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-tuggi-blue focus:border-transparent"
                      >
                        <option value="">{tShared('FiltersSidebar.all_states')}</option>
                        {(availableCities || [])
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
                        {tShared('FiltersSidebar.city')}
                      </label>
                      <select
                        value={cityFilter}
                        onChange={(e) => setCityFilter(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-tuggi-blue focus:border-transparent"
                        disabled={!stateFilter}
                      >
                        <option value="">{tShared('FiltersSidebar.all_cities')}</option>
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
                        {tShared('FiltersSidebar.category')}
                      </label>
                      <select
                        value={categoryFilter}
                        onChange={(e) => setCategoryFilter(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-tuggi-blue focus:border-transparent"
                      >
                        <option value="">{tShared('FiltersSidebar.all_categories')}</option>
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
                        <span>{tShared('FiltersSidebar.total')}</span>
                        <span>{currentFeaturesCount}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>{tShared('FiltersSidebar.filtered')}</span>
                        <span className="font-medium">{filteredFeatures.length}</span>
                      </div>
                      {viewMode === 'table' && (
                        <div className="flex justify-between">
                          <span>{tShared('FiltersSidebar.page')}</span>
                          <span className="font-medium">{tShared('FiltersSidebar.page_x_of_y', { current: currentPage, total: totalPages })}</span>
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
                      onEditPOI={updatePOI}
                      onDeletePOI={handleDelete}
                    />
                    
                    {/* Pagination Controls */}
                    {totalPages > 1 && (
                      <div className="bg-white dark:bg-gray-950 border-t border-gray-200 dark:border-gray-800 px-6 py-4">
                        <div className="flex items-center justify-between">
                          <div className="text-sm text-gray-600 dark:text-gray-400">
                            {tShared('Pagination.showing', { 
                              from: ((currentPage - 1) * itemsPerPage) + 1, 
                              to: Math.min(currentPage * itemsPerPage, totalCount || 0), 
                              total: totalCount || 0 
                            })}
                          </div>
                          
                          <div className="flex items-center space-x-2">
                            <button
                              onClick={() => handlePageChange(currentPage - 1)}
                              disabled={!hasPrevPage}
                              className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {tShared('Pagination.prev')}
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
                              {tShared('Pagination.next')}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <OptimizedOSMMap
                    searchTerm={searchTerm}
                    countryFilter="Brazil"
                    stateFilter={stateFilter}
                    cityFilter={cityFilter}
                    categoryFilter={categoryFilter}
                    selectedFeatureIds={selectedFeatures}
                    height="100%"
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
                    ? t('import_success', { count: importResults.imported })
                    : t('import_failed', { errors: importResults.errors.join(', ') })
                  }
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
