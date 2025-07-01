'use client'

import { GoogleMapComponent } from './GoogleMapComponent'

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
  // Convert markers format to Google Maps format
  const googleMarkers = markers.map(marker => ({
    id: marker.id,
    position: { lat: marker.position[0], lng: marker.position[1] },
    title: marker.title,
    description: marker.description
  }))

  // Add selected marker if provided
  if (allowMarkerPlacement && selectedMarker) {
    googleMarkers.push({
      id: 'selected-marker',
      position: { lat: selectedMarker[0], lng: selectedMarker[1] },
      title: 'Selected location',
      description: 'Selected location'
    })
  }

  return (
    <GoogleMapComponent
      center={{ lat: center[0], lng: center[1] }}
      zoom={zoom}
      height={height}
      className={className}
      enableDrawing={false}
      markers={googleMarkers}
      onMarkerClick={onMarkerClick}
    />
  )
} 