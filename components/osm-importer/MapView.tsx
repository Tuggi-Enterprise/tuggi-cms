/**
 * Map View Component
 * 
 * Full-screen map view for OSM POIs
 * 
 * @module components/osm-importer/MapView
 */

'use client'

import { useMemo } from 'react'
import { OSMPOIMap } from './OSMPOIMap'
import { useOSMImporterUnified } from '@/lib/hooks/use-osm-importer-unified'

export function MapView() {
  const {
    features,
    selectedFeatures,
    toggleSelection,
    extractLocationFromOSMTags,
    getPrimaryCategory
  } = useOSMImporterUnified()

  // Convert features to map markers
  const markers = useMemo(() => {
    return features.map(poi => {
      const location = extractLocationFromOSMTags(poi.properties)
      const category = getPrimaryCategory(poi.properties)
      
      // Extract coordinates from geometry
      let coordinates: [number, number] | null = null
      
      if (poi.geometry.type === 'Point') {
        coordinates = poi.geometry.coordinates as [number, number]
      } else if (poi.geometry.type === 'LineString' || poi.geometry.type === 'Polygon') {
        // For non-point geometries, use the first coordinate
        const coords = poi.geometry.coordinates as number[][]
        if (coords.length > 0 && coords[0].length >= 2) {
          coordinates = [coords[0][0], coords[0][1]]
        }
      }

      if (!coordinates) return null

      return {
        id: poi._id,
        position: { lat: coordinates[1], lng: coordinates[0] },
        title: location.name || 'Unnamed POI',
        description: category || 'OSM POI',
        color: selectedFeatures.has(poi._id) ? '#FF6F00' : '#00A8E8',
        osm_type: poi.properties.type,
        osm_id: poi.properties.id,
        osm_tags: poi.properties.tags
      }
    }).filter(Boolean)
  }, [features, selectedFeatures, extractLocationFromOSMTags, getPrimaryCategory])

  // Calculate map center from features
  const mapCenter = useMemo(() => {
    if (markers.length === 0) return { lat: -23.5505, lng: -46.6333 } // São Paulo default

    const lats = markers.map(m => m?.position?.lat).filter((lat): lat is number => lat != null)
    const lngs = markers.map(m => m?.position?.lng).filter((lng): lng is number => lng != null)
    
    return {
      lat: (Math.min(...lats) + Math.max(...lats)) / 2,
      lng: (Math.min(...lngs) + Math.max(...lngs)) / 2
    }
  }, [markers])

  const handleMarkerClick = (markerId: string) => {
    toggleSelection(markerId)
  }

  return (
    <div className="h-full flex flex-col">
      {/* Map Header */}
      <div className="bg-white dark:bg-gray-950 border-b border-gray-200 dark:border-gray-800 px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">
              Map View
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {markers.length} POIs • {selectedFeatures.size} selected
            </p>
          </div>
          
          <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
              <span>Unselected</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 bg-orange-500 rounded-full"></div>
              <span>Selected</span>
            </div>
          </div>
        </div>
      </div>

      {/* Map Container */}
      <div className="flex-1">
        <OSMPOIMap
          height="calc(100vh - 250px)"
          features={[]}
          selectedFeatures={new Set()}
          onMarkerClick={() => {}}
        />
      </div>
    </div>
  )
}
