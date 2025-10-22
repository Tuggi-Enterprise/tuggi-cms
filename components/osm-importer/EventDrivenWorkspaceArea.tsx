'use client'

import { useEffect, useState } from 'react'
import { osmImporterEventBus, OSM_IMPORTER_EVENTS } from '../../lib/events/osm-importer-events'
import { FilterPanel } from './FilterPanel'
import { TableView } from './TableView'
import { MapView } from './MapView'
import { SplitView } from './SplitView'

interface EventDrivenWorkspaceAreaProps {
  viewMode: 'table' | 'map' | 'split'
}

// Event-driven component that listens to events
export function EventDrivenWorkspaceArea({ viewMode }: EventDrivenWorkspaceAreaProps) {
  const [state, setState] = useState({
    features: [] as any[],
    isLoading: false,
    error: null as string | null,
    availableCities: [] as string[],
    availableCategories: [] as any[],
    selectedFeatures: new Set<string>(),
    cityFilter: [] as string[],
    categoryFilter: [] as string[],
    searchTerm: ''
  })

  // Event listeners
  useEffect(() => {
    console.log('🎯 COMPONENT: Setting up event listeners')

    // File load events
    const unsubscribeFileLoadStart = osmImporterEventBus.on(
      OSM_IMPORTER_EVENTS.FILE_LOAD_START,
      (payload) => {
        console.log('📁 COMPONENT: File load started', payload)
        setState(prev => ({
          ...prev,
          isLoading: true,
          error: null
        }))
      }
    )

    const unsubscribeFileLoadComplete = osmImporterEventBus.on(
      OSM_IMPORTER_EVENTS.FILE_LOAD_COMPLETE,
      (payload) => {
        console.log('✅ COMPONENT: File load complete', payload)
        setState(prev => ({
          ...prev,
          isLoading: false,
          features: payload.features,
          availableCities: payload.cities,
          availableCategories: payload.categories
        }))
      }
    )

    const unsubscribeFileLoadError = osmImporterEventBus.on(
      OSM_IMPORTER_EVENTS.FILE_LOAD_ERROR,
      (payload) => {
        console.log('❌ COMPONENT: File load error', payload)
        setState(prev => ({
          ...prev,
          isLoading: false,
          error: payload.error
        }))
      }
    )

    // Features events
    const unsubscribeFeaturesUpdated = osmImporterEventBus.on(
      OSM_IMPORTER_EVENTS.FEATURES_UPDATED,
      (payload) => {
        console.log('🔄 COMPONENT: Features updated', payload)
        setState(prev => ({
          ...prev,
          features: payload.filteredFeatures
        }))
      }
    )

    // Filters events
    const unsubscribeFiltersApplied = osmImporterEventBus.on(
      OSM_IMPORTER_EVENTS.FILTERS_APPLIED,
      (payload) => {
        console.log('🔍 COMPONENT: Filters applied', payload)
        setState(prev => ({
          ...prev,
          features: payload.filteredFeatures,
          cityFilter: payload.cityFilter,
          categoryFilter: payload.categoryFilter,
          searchTerm: payload.searchTerm
        }))
      }
    )

    // Selection events
    const unsubscribeSelectionChanged = osmImporterEventBus.on(
      OSM_IMPORTER_EVENTS.SELECTION_CHANGED,
      (payload) => {
        console.log('✅ COMPONENT: Selection changed', payload)
        setState(prev => ({
          ...prev,
          selectedFeatures: payload.selectedFeatures
        }))
      }
    )

    // Cleanup
    return () => {
      console.log('🧹 COMPONENT: Cleaning up event listeners')
      unsubscribeFileLoadStart()
      unsubscribeFileLoadComplete()
      unsubscribeFileLoadError()
      unsubscribeFeaturesUpdated()
      unsubscribeFiltersApplied()
      unsubscribeSelectionChanged()
    }
  }, [])

  // Render logic
  if (state.isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading OSM data...</p>
        </div>
      </div>
    )
  }

  if (state.error) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <div className="text-red-600 text-6xl mb-4">⚠️</div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Error Loading Data</h3>
          <p className="text-gray-600 mb-4">{state.error}</p>
          <button 
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  if (state.features.length === 0) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <div className="text-gray-400 text-6xl mb-4">🗺️</div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">No POIs Found</h3>
          <p className="text-gray-600">
            Load a GeoJSON file to start exploring OSM data
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Debug Info (Development only) */}
      {process.env.NODE_ENV === 'development' && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
          <h4 className="font-semibold text-yellow-800 mb-2">Debug Info (Event-Driven)</h4>
          <div className="grid grid-cols-2 gap-4 text-sm text-yellow-700">
            <div>Features: {state.features.length}</div>
            <div>Loading: {state.isLoading ? 'Yes' : 'No'}</div>
            <div>Error: {state.error || 'None'}</div>
            <div>Cities: {state.availableCities.length}</div>
            <div>Categories: {state.availableCategories.length}</div>
            <div>Selected: {state.selectedFeatures.size}</div>
          </div>
        </div>
      )}

      {/* Filter Panel */}
      <div className="mb-4">
        <FilterPanel
          cities={state.availableCities}
          categories={state.availableCategories}
          selectedCities={state.cityFilter}
          selectedCategories={state.categoryFilter}
          searchTerm={state.searchTerm}
          onCityChange={(cities) => {
            osmImporterEventBus.emit(OSM_IMPORTER_EVENTS.FILTERS_APPLIED, {
              filteredFeatures: state.features,
              cityFilter: cities,
              categoryFilter: state.categoryFilter,
              searchTerm: state.searchTerm
            })
          }}
          onCategoryChange={(categories) => {
            osmImporterEventBus.emit(OSM_IMPORTER_EVENTS.FILTERS_APPLIED, {
              filteredFeatures: state.features,
              cityFilter: state.cityFilter,
              categoryFilter: categories,
              searchTerm: state.searchTerm
            })
          }}
          onSearchChange={(searchTerm) => {
            osmImporterEventBus.emit(OSM_IMPORTER_EVENTS.FILTERS_APPLIED, {
              filteredFeatures: state.features,
              cityFilter: state.cityFilter,
              categoryFilter: state.categoryFilter,
              searchTerm
            })
          }}
          onClearFilters={() => {
            osmImporterEventBus.emit(OSM_IMPORTER_EVENTS.FILTERS_APPLIED, {
              filteredFeatures: state.features,
              cityFilter: [],
              categoryFilter: [],
              searchTerm: ''
            })
          }}
        />
      </div>

      {/* Main Content */}
      <div className="flex-1">
        {viewMode === 'table' && (
          <TableView
            sortBy="name"
            sortOrder="asc"
          />
        )}
        
        {viewMode === 'map' && (
          <MapView />
        )}
        
        {viewMode === 'split' && (
          <SplitView
            sortBy="name"
            sortOrder="asc"
          />
        )}
      </div>
    </div>
  )
}
