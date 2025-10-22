/**
 * Workspace Area Component
 * 
 * Main content area with toolbar, filters, and view modes
 * 
 * @module components/osm-importer/WorkspaceArea
 */

'use client'

import { useState } from 'react'
import { 
  Table2, Map, LayoutGrid, Filter, Search, 
  CheckSquare, Square, SortAsc, Eye, Download, 
  Upload, Settings, MoreHorizontal
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useOSMImporterUnified } from '@/lib/hooks/use-osm-importer-unified'
import { FilterPanel } from './FilterPanel'
import { TableView } from './TableView'
import { MapView } from './MapView'
import { SplitView } from './SplitView'

interface WorkspaceAreaProps {
  className?: string
}

export function WorkspaceArea({ className }: WorkspaceAreaProps) {
  const [viewMode, setViewMode] = useState<'table' | 'map' | 'split'>('table')
  const [filterPanelOpen, setFilterPanelOpen] = useState(false)
  const [sortBy, setSortBy] = useState<'name' | 'city' | 'category' | 'date'>('name')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')
  
  const { 
    features, 
    selectedFeatures, 
    availableCities,
    availableCategories,
    isLoading,
    error,
    toggleSelection, 
    selectAll,
    clearSelection,
    cityFilter,
    setCityFilter,
    categoryFilter,
    setCategoryFilter,
    searchTerm,
    setSearchTerm
  } = useOSMImporterUnified()

  // Debug logging for re-renders
  console.log('🖥️ COMPONENT STEP 1: WorkspaceArea render started', {
    featuresCount: features.length,
    isLoading,
    error,
    availableCities: availableCities.length,
    availableCategories: availableCategories.length,
    timestamp: new Date().toISOString()
  })

  const handleSelectAll = () => {
    if (selectedFeatures.size === features.length) {
      clearSelection()
    } else {
      selectAll()
    }
  }

  const handleSort = (field: typeof sortBy) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(field)
      setSortOrder('asc')
    }
  }

  return (
    <main className={cn("flex-1 flex flex-col overflow-hidden bg-gray-50 dark:bg-gray-900", className)}>
      {/* Toolbar */}
      <div className="h-14 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 flex items-center justify-between px-4">
        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search POIs..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 pr-4 py-1.5 text-sm border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-950"
            />
          </div>

          {/* Filter Toggle */}
          <button 
            onClick={() => setFilterPanelOpen(!filterPanelOpen)}
            className={cn(
              "p-2 rounded-lg transition flex items-center gap-2 text-sm",
              filterPanelOpen 
                ? "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300" 
                : "hover:bg-gray-100 dark:hover:bg-gray-800"
            )}
          >
            <Filter className="w-4 h-4" />
            Filters
            {(cityFilter.length > 0 || categoryFilter.length > 0) && (
              <span className="ml-1 px-1.5 py-0.5 text-xs bg-blue-600 text-white rounded-full">
                {cityFilter.length + categoryFilter.length}
              </span>
            )}
          </button>

          {/* Select All */}
          <button 
            onClick={handleSelectAll}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition"
            disabled={features.length === 0}
          >
            {selectedFeatures.size > 0 ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
          </button>

          {/* Sort Options */}
          <div className="flex items-center gap-1 ml-2">
            <button
              onClick={() => handleSort('name')}
              className={cn(
                "px-2 py-1 text-xs rounded transition",
                sortBy === 'name' 
                  ? "bg-gray-100 dark:bg-gray-800" 
                  : "hover:bg-gray-100 dark:hover:bg-gray-800"
              )}
            >
              Name
              {sortBy === 'name' && (
                <SortAsc className={cn("w-3 h-3 ml-1 inline", sortOrder === 'desc' && 'rotate-180')} />
              )}
            </button>
            <button
              onClick={() => handleSort('city')}
              className={cn(
                "px-2 py-1 text-xs rounded transition",
                sortBy === 'city' 
                  ? "bg-gray-100 dark:bg-gray-800" 
                  : "hover:bg-gray-100 dark:hover:bg-gray-800"
              )}
            >
              City
              {sortBy === 'city' && (
                <SortAsc className={cn("w-3 h-3 ml-1 inline", sortOrder === 'desc' && 'rotate-180')} />
              )}
            </button>
            <button
              onClick={() => handleSort('category')}
              className={cn(
                "px-2 py-1 text-xs rounded transition",
                sortBy === 'category' 
                  ? "bg-gray-100 dark:bg-gray-800" 
                  : "hover:bg-gray-100 dark:hover:bg-gray-800"
              )}
            >
              Category
              {sortBy === 'category' && (
                <SortAsc className={cn("w-3 h-3 ml-1 inline", sortOrder === 'desc' && 'rotate-180')} />
              )}
            </button>
          </div>

          {/* Results Count */}
          <span className="text-sm text-gray-600 dark:text-gray-400 ml-2">
            {features.length.toLocaleString()} POIs
            {selectedFeatures.size > 0 && ` · ${selectedFeatures.size} selected`}
          </span>
        </div>

        {/* View Controls */}
        <div className="flex items-center gap-2">
          {/* View Mode Toggle */}
          <div className="flex items-center bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
            <button
              onClick={() => setViewMode('table')}
              className={cn(
                "p-1.5 rounded transition",
                viewMode === 'table' && "bg-white dark:bg-gray-950 shadow-sm"
              )}
              title="Table View"
            >
              <Table2 className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('map')}
              className={cn(
                "p-1.5 rounded transition",
                viewMode === 'map' && "bg-white dark:bg-gray-950 shadow-sm"
              )}
              title="Map View"
            >
              <Map className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('split')}
              className={cn(
                "p-1.5 rounded transition",
                viewMode === 'split' && "bg-white dark:bg-gray-950 shadow-sm"
              )}
              title="Split View"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
          </div>

          {/* Action Buttons */}
          <button 
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition"
            title="Export Selected"
            disabled={selectedFeatures.size === 0}
          >
            <Download className="w-4 h-4" />
          </button>
          
          <button 
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition"
            title="Import POIs"
          >
            <Upload className="w-4 h-4" />
          </button>

          <button className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition">
            <MoreHorizontal className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Content Area with Filters */}
      <div className="flex-1 flex overflow-hidden">
        {/* Inline Filter Panel (slides from left) */}
        {filterPanelOpen && (
          <div className="w-80 border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 overflow-y-auto">
            <FilterPanel 
              cities={[]}
              categories={[]}
              selectedCities={[]}
              selectedCategories={[]}
              searchTerm=""
              onCityChange={() => {}}
              onCategoryChange={() => {}}
              onSearchChange={() => {}}
              onClearFilters={() => {}}
            />
          </div>
        )}

        {/* Main Content */}
        <div className="flex-1 overflow-hidden">
          {(() => {
            console.log('🖥️ COMPONENT STEP 2: Render logic evaluation', {
              isLoading,
              error,
              featuresLength: features.length,
              willShowLoading: isLoading,
              willShowError: !isLoading && error,
              willShowEmpty: !isLoading && !error && features.length === 0,
              willShowContent: !isLoading && !error && features.length > 0
            })
            
            if (isLoading) {
              console.log('🖥️ COMPONENT STEP 3: Rendering loading state')
              return (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
                    <p className="text-gray-600 dark:text-gray-400">Loading POIs...</p>
                  </div>
                </div>
              )
            }

            if (error) {
              console.log('🖥️ COMPONENT STEP 3: Rendering error state')
              return (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center">
                    <div className="text-red-500 mb-4">⚠️</div>
                    <p className="text-red-600 dark:text-red-400 mb-2">Error loading data</p>
                    <p className="text-sm text-gray-600 dark:text-gray-400">{error}</p>
                  </div>
                </div>
              )
            }

            if (features.length === 0) {
              console.log('🖥️ COMPONENT STEP 3: Rendering empty state')
              return (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center">
                    <div className="text-gray-400 mb-4">🗺️</div>
                    <p className="text-gray-600 dark:text-gray-400 mb-2">No POIs found</p>
                    <p className="text-sm text-gray-500 dark:text-gray-500">
                      Load a GeoJSON file to get started
                    </p>
                  </div>
                </div>
              )
            }

            console.log('🖥️ COMPONENT STEP 3: Rendering content with features', { 
              featuresLength: features.length,
              viewMode 
            })
            return (
              <>
                {viewMode === 'table' && <TableView sortBy={sortBy} sortOrder={sortOrder} />}
                {viewMode === 'map' && <MapView />}
                {viewMode === 'split' && <SplitView sortBy={sortBy} sortOrder={sortOrder} />}
              </>
            )
          })()}

          {/* Debug Info - Remove in production */}
          {process.env.NODE_ENV === 'development' && (
            <div className="fixed bottom-4 right-4 bg-black/80 text-white p-2 rounded text-xs z-50">
              <div>Features: {features.length}</div>
              <div>Loading: {isLoading ? 'Yes' : 'No'}</div>
              <div>Error: {error || 'None'}</div>
              <div>Cities: {availableCities.length}</div>
              <div>Categories: {availableCategories.length}</div>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
