'use client'

import { GoogleMapComponent } from '@/components/ui/GoogleMapComponent'
import { TriggerPoint } from '@/lib/services/trigger-points-google/types/interfaces'

interface POIInfo {
  id: string
  name: string
  location: { lat: number; lng: number }
  type: string
  country: string
  city: string
  state?: string
}

interface Boundary {
  coordinates: Array<{lat: number, lng: number}>
  classification?: {
    group?: string
    strategy?: string
    reasoning?: string
  }
}

interface TriggerPointsMapProps {
  poiInfo: POIInfo | null
  triggerPoints: TriggerPoint[]
  boundary: Boundary | null
  metadata?: {
    searchRadius?: number
  } | null
  showBoundary?: boolean
  showTriggerPoints?: boolean
  showSearchRadius?: boolean
  height?: string
}

// Função auxiliar para obter cor do trigger point
function getTriggerPointColor(type: string): string {
  switch (type) {
    case 'primary':
      return '#10B981' // Verde
    case 'secondary':
      return '#F59E0B' // Amarelo
    case 'fallback':
      return '#6B7280' // Cinza
    default:
      return '#3B82F6' // Azul
  }
}

export function TriggerPointsMap({
  poiInfo,
  triggerPoints,
  boundary,
  metadata,
  showBoundary = true,
  showTriggerPoints = true,
  showSearchRadius = true,
  height = '100%'
}: TriggerPointsMapProps) {
  // Preparar dados para o mapa
  const mapMarkers = poiInfo ? [{
    id: 'poi',
    position: poiInfo.location,
    title: poiInfo.name,
    description: `${poiInfo.type} - ${poiInfo.city}, ${poiInfo.country}`,
    color: '#FF0000'
  }] : []

  const mapCircles = [
    // Trigger points circles
    ...(showTriggerPoints ? triggerPoints.map(tp => ({
      id: tp.id,
      center: tp.location,
      radius: tp.radius,
      strokeColor: getTriggerPointColor(tp.type),
      strokeOpacity: 0.8,
      strokeWeight: 2,
      fillColor: getTriggerPointColor(tp.type),
      fillOpacity: 0.2
    })) : []),
    // Search radius circle
    ...(showSearchRadius && poiInfo && metadata?.searchRadius ? [{
      id: 'search-radius',
      center: poiInfo.location,
      radius: metadata.searchRadius,
      strokeColor: '#8B5CF6', // Purple
      strokeOpacity: 0.6,
      strokeWeight: 3,
      fillColor: '#8B5CF6',
      fillOpacity: 0.1
    }] : [])
  ]

  const mapPolygon = showBoundary && boundary ? boundary.coordinates : null

  return (
    <div className="h-96 rounded-lg overflow-hidden">
      <GoogleMapComponent
        center={poiInfo?.location || { lat: -23.5505, lng: -46.6333 }}
        zoom={15}
        markers={mapMarkers}
        circles={mapCircles}
        polygon={mapPolygon || undefined}
        height={height}
      />
    </div>
  )
}

