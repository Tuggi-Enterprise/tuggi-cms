'use client'

/**
 * LocationPicker — cadastro de localização no padrão POI (CreateTab/DetailsTab).
 *  • editable (criação): mapa Google, clique define lat/lng (igual ao CreateTab).
 *  • read-only (edição): coordenada + link p/ Google Maps (igual ao DetailsTab).
 * A localização do POI é definida na criação pelo mapa e fica read-only depois.
 */
import { MapPin, ExternalLink } from 'lucide-react'
import { GoogleMapComponent } from '@/components/ui/GoogleMapComponent'

interface LocationPickerProps {
  editable: boolean
  latitude?: number | null
  longitude?: number | null
  name?: string
  onChange?: (lat: number, lng: number) => void
}

const DEFAULT_CENTER = { lat: -23.5505, lng: -46.6333 } // São Paulo

export function LocationPicker({ editable, latitude, longitude, name, onChange }: LocationPickerProps) {
  const hasCoord = typeof latitude === 'number' && typeof longitude === 'number'
  const center = hasCoord ? { lat: latitude as number, lng: longitude as number } : DEFAULT_CENTER

  if (!editable) {
    return (
      <div className="flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-900/50 rounded-xl">
        <span className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
          <MapPin className="h-4 w-4 text-tuggi-blue" />
          {hasCoord ? `${(latitude as number).toFixed(6)}, ${(longitude as number).toFixed(6)}` : '—'}
        </span>
        {hasCoord && (
          <a
            href={`https://www.google.com/maps?q=${latitude},${longitude}`}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-tuggi-blue hover:underline flex items-center gap-1"
          >
            Google Maps <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    )
  }

  return (
    <div className="h-80 w-full rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700">
      <GoogleMapComponent
        componentId="entity-location-map"
        center={center}
        zoom={hasCoord ? 18 : 10}
        height="100%"
        markers={hasCoord ? [{ id: 'entity-location', position: center, title: name || '', color: '#00A8E8' }] : []}
        onMapClick={(lat: number, lng: number) => onChange?.(lat, lng)}
      />
    </div>
  )
}
