/**
 * POI Map Component - KISS SIMPLIFIED
 * 
 * Simple map view for POIs with selection
 * 
 * @module components/osm-importer/POIMap
 */

'use client'

import { useEffect, useRef, useCallback } from 'react'
import { SimpleOSMPOI } from '@/lib/hooks/use-osm-importer-simple'
import { OSMService } from '@/lib/services/osm-service-simple'

interface POIMapProps {
  features: SimpleOSMPOI[]
  selectedFeatures: Set<string>
  onToggleSelection: (id: string) => void
  height?: string
  className?: string
}

export function POIMap({ 
  features, 
  selectedFeatures, 
  onToggleSelection, 
  height = "600px",
  className = ""
}: POIMapProps) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<any>(null)

  const renderMarkers = useCallback(() => {
    if (!mapRef.current) return

    // Clear existing markers
    mapRef.current.innerHTML = ''

    // Create simple markers (replace with your map library)
    features.forEach(poi => {
      const marker = document.createElement('div')
      marker.className = `absolute w-4 h-4 rounded-full cursor-pointer transform -translate-x-1/2 -translate-y-1/2 ${
        selectedFeatures.has(poi._id) 
          ? 'bg-blue-600 border-2 border-white' 
          : 'bg-gray-400 border-2 border-white'
      }`
      
      marker.style.left = `${50 + (poi.geometry.coordinates[0] * 0.1)}%`
      marker.style.top = `${50 - (poi.geometry.coordinates[1] * 0.1)}%`
      
      marker.onclick = () => onToggleSelection(poi._id)
      
      // Tooltip
      marker.title = OSMService.extractLocation(poi).name
      
      mapRef.current?.appendChild(marker)
    })
  }, [features, selectedFeatures, onToggleSelection])

  useEffect(() => {
    if (!mapRef.current || features.length === 0) return

    // Initialize map
    if (!mapInstanceRef.current) {
      // Simple map initialization (you can replace with your preferred map library)
      mapInstanceRef.current = {
        center: [0, 0],
        zoom: 2
      }
    }

    // Calculate center from features
    if (features.length > 0) {
      const coords = features.map(f => f.geometry.coordinates)
      const avgLat = coords.reduce((sum, [lng, lat]) => sum + lat, 0) / coords.length
      const avgLng = coords.reduce((sum, [lng, lat]) => sum + lng, 0) / coords.length
      
      mapInstanceRef.current.center = [avgLng, avgLat]
      mapInstanceRef.current.zoom = 10
    }

    // Render markers
    renderMarkers()
  }, [features, selectedFeatures, renderMarkers])

  return (
    <div className={className} style={{ height }}>
      <div 
        ref={mapRef}
        className="relative w-full h-full bg-gray-100 dark:bg-gray-800 rounded-lg overflow-hidden"
        style={{ backgroundImage: 'radial-gradient(circle, #e5e7eb 1px, transparent 1px)', backgroundSize: '20px 20px' }}
      >
        {/* Map placeholder - replace with actual map implementation */}
        <div className="absolute inset-0 flex items-center justify-center text-gray-500">
          <div className="text-center">
            <div className="text-4xl mb-2">🗺️</div>
            <p className="text-sm">Map View</p>
            <p className="text-xs text-gray-400">{features.length} POIs</p>
          </div>
        </div>
      </div>
    </div>
  )
}
