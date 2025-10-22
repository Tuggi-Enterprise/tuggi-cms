/**
 * OSM POI Map Component
 * 
 * Map visualization for OSM POIs using Google Maps
 * 
 * @module components/osm-importer/OSMPOIMap
 */

'use client'

import { useMemo, useState, useEffect } from 'react'
import { GoogleMapComponent } from '@/components/ui/GoogleMapComponent'
import { EditableOSMPOI, OSMMarker } from '@/types/osm-importer'
import { MapPin, Info } from 'lucide-react'

interface OSMPOIMapProps {
  features: EditableOSMPOI[]
  selectedFeatures: Set<string>
  onMarkerClick: (id: string) => void
  height?: string
  className?: string
}

export function OSMPOIMap({ 
  features, 
  selectedFeatures, 
  onMarkerClick,
  height = "600px",
  className = ""
}: OSMPOIMapProps) {
  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number } | null>(null)

  // Convert OSM features to map markers
  const markers = useMemo(() => {
    return features.map(f => {
      const coords = f.geometry.type === 'Point' 
        ? f.geometry.coordinates 
        : null

      if (!coords) return null

      const isSelected = selectedFeatures.has(f._id)
      const name = f.properties.tags.name || f.properties.tags['name:en'] || f.properties.tags['name:pt'] || 'Unnamed'
      const category = f.properties.tags.tourism || f.properties.tags.amenity || f.properties.tags.historic || 'OSM POI'

      return {
        id: f._id,
        position: { lat: coords[1], lng: coords[0] },
        title: name,
        description: category,
        color: isSelected ? '#FF6F00' : '#00A8E8',
        category,
        selected: isSelected,
        osmData: {
          type: f.properties.type,
          id: f.properties.id,
          tags: f.properties.tags
        }
      }
    }).filter(Boolean) as OSMMarker[]
  }, [features, selectedFeatures])

  // Calculate map center from markers
  useEffect(() => {
    if (markers.length > 0) {
      const validMarkers = markers.filter(m => m.position)
      if (validMarkers.length > 0) {
        const lats = validMarkers.map(m => m.position.lat)
        const lngs = validMarkers.map(m => m.position.lng)
        
        const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2
        const centerLng = (Math.min(...lngs) + Math.max(...lngs)) / 2
        
        setMapCenter({ lat: centerLat, lng: centerLng })
      }
    }
  }, [markers])

  // Handle marker click
  const handleMarkerClick = (markerId: string) => {
    onMarkerClick(markerId)
  }

  // Get map bounds for better view
  const getMapBounds = () => {
    if (markers.length === 0) return null

    const validMarkers = markers.filter(m => m.position)
    if (validMarkers.length === 0) return null

    const lats = validMarkers.map(m => m.position.lat)
    const lngs = validMarkers.map(m => m.position.lng)

    return {
      north: Math.max(...lats),
      south: Math.min(...lats),
      east: Math.max(...lngs),
      west: Math.min(...lngs)
    }
  }

  const bounds = getMapBounds()

  return (
    <div className={className}>
      {/* Map Info Header */}
      <div className="mb-4 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-blue-600" />
              <span className="font-medium">{markers.length} POIs</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
              <span>Unselected</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-orange-500 rounded-full"></div>
              <span>Selected ({selectedFeatures.size})</span>
            </div>
          </div>
          
          {bounds && (
            <div className="text-xs text-gray-500">
              Bounds: {bounds.north.toFixed(3)}, {bounds.south.toFixed(3)} | {bounds.east.toFixed(3)}, {bounds.west.toFixed(3)}
            </div>
          )}
        </div>
      </div>

      {/* Google Map */}
      <GoogleMapComponent
        height={height}
        markers={markers}
        onMarkerClick={handleMarkerClick}
        zoom={markers.length === 1 ? 15 : 12}
        center={mapCenter || { lat: 0, lng: 0 }}
        className="rounded-lg border border-gray-200 dark:border-gray-700"
      />

      {/* Map Legend */}
      <div className="mt-4 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
        <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
          <Info className="w-4 h-4" />
          Map Legend
        </h4>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
            <span>Unselected POIs</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-orange-500 rounded-full"></div>
            <span>Selected POIs</span>
          </div>
        </div>
      </div>
    </div>
  )
}
