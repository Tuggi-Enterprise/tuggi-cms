'use client'

import { useEffect, useRef, useState } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMapEvents, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import 'leaflet-draw/dist/leaflet.draw.css'

// Fix for default markers in Leaflet
delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
})

interface MapComponentProps {
  center?: [number, number]
  zoom?: number
  markers?: Array<{
    id: string
    position: [number, number]
    title: string
    description?: string
  }>
  onMapClick?: (lat: number, lng: number) => void
  onMarkerClick?: (markerId: string) => void
  height?: string
  className?: string
  allowMarkerPlacement?: boolean
  selectedMarker?: [number, number] | null
}

function MapEvents({ onMapClick }: { onMapClick?: (lat: number, lng: number) => void }) {
  useMapEvents({
    click: (e) => {
      if (onMapClick) {
        onMapClick(e.latlng.lat, e.latlng.lng)
      }
    },
  })
  return null
}

function SelectedMarker({ position }: { position: [number, number] | null }) {
  const map = useMap()
  
  useEffect(() => {
    if (position) {
      map.setView(position, map.getZoom())
    }
  }, [position, map])

  if (!position) return null

  return (
    <Marker position={position}>
      <Popup>Selected location</Popup>
    </Marker>
  )
}

export function MapComponent({
  center = [40.7128, -74.0060], // Default to NYC
  zoom = 13,
  markers = [],
  onMapClick,
  onMarkerClick,
  height = '400px',
  className = '',
  allowMarkerPlacement = false,
  selectedMarker = null,
}: MapComponentProps) {
  const [isClient, setIsClient] = useState(false)

  useEffect(() => {
    setIsClient(true)
  }, [])

  if (!isClient) {
    return (
      <div 
        className={`bg-gray-200 dark:bg-gray-700 rounded-lg flex items-center justify-center ${className}`}
        style={{ height }}
      >
        <p className="text-gray-500 dark:text-gray-400">Loading map...</p>
      </div>
    )
  }

  return (
    <div className={className} style={{ height }}>
      <MapContainer
        center={center}
        zoom={zoom}
        style={{ height: '100%', width: '100%' }}
        className="rounded-lg"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        
        {/* Existing markers */}
        {markers.map((marker) => (
          <Marker
            key={marker.id}
            position={marker.position}
            eventHandlers={{
              click: () => onMarkerClick?.(marker.id),
            }}
          >
            <Popup>
              <div>
                <h3 className="font-semibold">{marker.title}</h3>
                {marker.description && (
                  <p className="text-sm mt-1">{marker.description}</p>
                )}
              </div>
            </Popup>
          </Marker>
        ))}

        {/* Selected marker for placement */}
        {allowMarkerPlacement && selectedMarker && (
          <SelectedMarker position={selectedMarker} />
        )}

        {/* Map click events */}
        {allowMarkerPlacement && onMapClick && (
          <MapEvents onMapClick={onMapClick} />
        )}
      </MapContainer>
    </div>
  )
} 