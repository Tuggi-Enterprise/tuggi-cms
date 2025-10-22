/**
 * Base OSM Component - DRY Component Architecture
 * 
 * Single source of truth for common OSM component patterns:
 * - Event handling
 * - State management
 * - Logging
 * - Error handling
 * 
 * @module components/osm-importer/BaseOSMComponent
 */

import React, { useEffect, useState } from 'react'
import { osmImporterEventBus, OSM_IMPORTER_EVENTS } from '../../lib/events/osm-importer-events'
import { logger, LogCategory } from '../../lib/utils/logger'
import { EditableOSMPOI, OSMCategory } from '../../types/osm-importer'

// Base props interface (DRY)
export interface BaseOSMComponentProps {
  features: EditableOSMPOI[]
  selectedFeatures: Set<string>
  availableCities: string[]
  availableCategories: OSMCategory[]
  isLoading: boolean
  error: string | null
  onSelectionChange?: (id: string) => void
  onMarkerClick?: (id: string) => void
  className?: string
}

// Base component state (DRY)
interface BaseOSMComponentState {
  features: EditableOSMPOI[]
  selectedFeatures: Set<string>
  availableCities: string[]
  availableCategories: OSMCategory[]
  isLoading: boolean
  error: string | null
  cityFilter: string[]
  categoryFilter: string[]
  searchTerm: string
  onSelectionChange?: (id: string) => void
  onMarkerClick?: (id: string) => void
}

// Base OSM Component (DRY)
export function BaseOSMComponent<P extends BaseOSMComponentProps>({
  componentName,
  children,
  ...props
}: {
  componentName: string
  children: (state: BaseOSMComponentState) => React.ReactNode
} & P) {
  const [state, setState] = useState<BaseOSMComponentState>({
    features: props.features,
    selectedFeatures: props.selectedFeatures,
    availableCities: props.availableCities,
    availableCategories: props.availableCategories,
    isLoading: props.isLoading,
    error: props.error,
    cityFilter: [],
    categoryFilter: [],
    searchTerm: ''
  })

  // Event listeners (DRY)
  useEffect(() => {
    logger.componentRender(componentName, { featuresCount: props.features.length })

    const unsubscribers = [
      // File load events
      osmImporterEventBus.on(OSM_IMPORTER_EVENTS.FILE_LOAD_START, () => {
        setState(prev => ({ ...prev, isLoading: true, error: null }))
        logger.debug(LogCategory.COMPONENT, `${componentName}: File load started`)
      }),

      osmImporterEventBus.on(OSM_IMPORTER_EVENTS.FILE_LOAD_COMPLETE, (payload) => {
        setState(prev => ({
          ...prev,
          isLoading: false,
          features: payload.features,
          availableCities: payload.cities,
          availableCategories: payload.categories
        }))
        logger.debug(LogCategory.COMPONENT, `${componentName}: File load complete`, {
          featuresCount: payload.features.length
        })
      }),

      osmImporterEventBus.on(OSM_IMPORTER_EVENTS.FILE_LOAD_ERROR, (payload) => {
        setState(prev => ({
          ...prev,
          isLoading: false,
          error: payload.error
        }))
        logger.error(LogCategory.COMPONENT, `${componentName}: File load error`, payload)
      }),

      // Features events
      osmImporterEventBus.on(OSM_IMPORTER_EVENTS.FEATURES_UPDATED, (payload) => {
        setState(prev => ({
          ...prev,
          features: payload.filteredFeatures
        }))
        logger.debug(LogCategory.COMPONENT, `${componentName}: Features updated`, {
          featuresCount: payload.filteredFeatures.length
        })
      }),

      // Filters events
      osmImporterEventBus.on(OSM_IMPORTER_EVENTS.FILTERS_APPLIED, (payload) => {
        setState(prev => ({
          ...prev,
          features: payload.filteredFeatures,
          cityFilter: payload.cityFilter,
          categoryFilter: payload.categoryFilter,
          searchTerm: payload.searchTerm
        }))
        logger.debug(LogCategory.COMPONENT, `${componentName}: Filters applied`, {
          featuresCount: payload.filteredFeatures.length
        })
      }),

      // Selection events
      osmImporterEventBus.on(OSM_IMPORTER_EVENTS.SELECTION_CHANGED, (payload) => {
        setState(prev => ({
          ...prev,
          selectedFeatures: payload.selectedFeatures
        }))
        logger.debug(LogCategory.COMPONENT, `${componentName}: Selection changed`, {
          selectionCount: payload.selectedFeatures.size
        })
      })
    ]

    return () => {
      logger.debug(LogCategory.COMPONENT, `${componentName}: Cleaning up event listeners`)
      unsubscribers.forEach(unsub => unsub())
    }
  }, [componentName, props.features.length])

  // Unified event handlers (DRY)
  const handleSelectionChange = (id: string) => {
    if (props.onSelectionChange) {
      props.onSelectionChange(id)
    }
    logger.debug(LogCategory.COMPONENT, `${componentName}: Selection changed`, { id })
  }

  const handleMarkerClick = (id: string) => {
    if (props.onMarkerClick) {
      props.onMarkerClick(id)
    }
    logger.debug(LogCategory.COMPONENT, `${componentName}: Marker clicked`, { id })
  }

  // Error boundary (DRY)
  if (state.error) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <div className="text-red-600 text-6xl mb-4">⚠️</div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Error in {componentName}</h3>
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

  // Loading state (DRY)
  if (state.isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading {componentName}...</p>
        </div>
      </div>
    )
  }

  // Empty state (DRY)
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

  // Render children with unified state (DRY)
  return (
    <div className={props.className}>
      {children({
        ...state,
        onSelectionChange: handleSelectionChange,
        onMarkerClick: handleMarkerClick
      })}
    </div>
  )
}

// Specialized components using BaseOSMComponent (DRY)
export function DRYTableView(props: BaseOSMComponentProps) {
  return (
    <BaseOSMComponent componentName="TableView" {...props}>
      {(state) => (
        <div className="h-full overflow-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="px-4 py-2 text-left">Name</th>
                <th className="px-4 py-2 text-left">Type</th>
                <th className="px-4 py-2 text-left">City</th>
                <th className="px-4 py-2 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {state.features.map((feature) => (
                <tr key={feature._id} className="border-b">
                  <td className="px-4 py-2">{feature.properties.name || 'Unnamed'}</td>
                  <td className="px-4 py-2">{feature.properties.type}</td>
                  <td className="px-4 py-2">
                    {feature.properties.tags?.['addr:city'] || 'Unknown'}
                  </td>
                  <td className="px-4 py-2">
                    <button
                      onClick={() => state.onSelectionChange?.(feature._id)}
                      className={`px-3 py-1 rounded ${
                        state.selectedFeatures.has(feature._id)
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-200 text-gray-700'
                      }`}
                    >
                      {state.selectedFeatures.has(feature._id) ? 'Selected' : 'Select'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </BaseOSMComponent>
  )
}

export function DRYMapView(props: BaseOSMComponentProps) {
  return (
    <BaseOSMComponent componentName="MapView" {...props}>
      {(state) => (
        <div className="h-full">
          <div className="text-center py-8">
            <h3 className="text-lg font-semibold mb-2">Map View</h3>
            <p className="text-gray-600">
              {state.features.length} POIs loaded
            </p>
            <p className="text-sm text-gray-500">
              Map integration with Google Maps Component
            </p>
          </div>
        </div>
      )}
    </BaseOSMComponent>
  )
}

export function DRYSplitView(props: BaseOSMComponentProps) {
  return (
    <BaseOSMComponent componentName="SplitView" {...props}>
      {(state) => (
        <div className="flex h-full">
          <div className="w-1/2 border-r">
            <DRYTableView {...state} />
          </div>
          <div className="w-1/2">
            <DRYMapView {...state} />
          </div>
        </div>
      )}
    </BaseOSMComponent>
  )
}
