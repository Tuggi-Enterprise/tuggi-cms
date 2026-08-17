'use client'

/**
 * LocationPicker — cadastro de localização no padrão POI (CreateTab/DetailsTab).
 *  • editable (criação): mapa Google, clique define lat/lng (igual ao CreateTab).
 *  • read-only (edição): coordenada + link p/ Google Maps (igual ao DetailsTab).
 * A localização do POI é definida na criação pelo mapa e fica read-only depois.
 *
 * ONDE O MAPA ABRE, e por que isso mudou (#371, decisão do operador em 2026-08-17): um local sem
 * coordenada abria em São Paulo, e o local de parceiro que a aprovação cria nasce exatamente
 * assim — sem coordenada e com o endereço preenchido (`core.attractions.formatted_address`). O
 * mapa passa a abrir sobre esse endereço, geocodificado.
 *
 * A GEOCODIFICAÇÃO MOVE A CÂMERA E NADA MAIS. Ela não vira coordenada, não é gravada e não
 * aparece como pino: `onChange` é chamado em UM lugar só, o clique do operador no mapa. Centro
 * errado o curador corrige arrastando; coordenada errada gravada tem aparência de verdade e
 * atravessa a triagem (BR-B2B-011, portão 1, e BR-POI-004). Falha de geocodificação cai no
 * comportamento antigo, sem bloquear nada.
 */
import { useEffect, useState } from 'react'
import { MapPin, ExternalLink } from 'lucide-react'
import { GoogleMapComponent } from '@/components/ui/GoogleMapComponent'
import { geocodeAddress } from '@/lib/maps/geocode-address'
import { pickLocationPickerView, type MapPoint } from '@/lib/maps/location-picker-view'

interface LocationPickerProps {
  editable: boolean
  latitude?: number | null
  longitude?: number | null
  name?: string
  /**
   * O endereço do local, só para CENTRALIZAR o mapa quando não há coordenada —
   * `core.attractions.formatted_address`. Nunca é gravado como coordenada.
   */
  address?: string | null
  /**
   * A legenda que avisa que a câmera veio do endereço e que a coordenada ainda não existe. Vem
   * traduzida de quem chama: este componente é usado em telas de namespaces diferentes, e chamar
   * `useTranslations` aqui imprimiria o nome da chave em quem não tem o namespace.
   */
  addressCaption?: string
  onChange?: (lat: number, lng: number) => void
}

export function LocationPicker({
  editable,
  latitude,
  longitude,
  name,
  address,
  addressCaption,
  onChange,
}: LocationPickerProps) {
  const hasCoord = typeof latitude === 'number' && typeof longitude === 'number'
  const [geocoded, setGeocoded] = useState<MapPoint | null>(null)

  const trimmedAddress = (address ?? '').trim()
  // Só quando falta a coordenada: com coordenada gravada, geocodificar seria pedir a um terceiro
  // uma resposta que o registro já tem — e correr o risco de discordarem na tela.
  const shouldGeocode = editable && !hasCoord && trimmedAddress.length > 0

  useEffect(() => {
    if (!shouldGeocode) {
      setGeocoded(null)
      return
    }

    let cancelled = false
    void geocodeAddress(trimmedAddress).then((result) => {
      if (cancelled || !result) return
      setGeocoded({ lat: result.lat, lng: result.lng })
    })

    return () => {
      cancelled = true
    }
  }, [shouldGeocode, trimmedAddress])

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

  const view = pickLocationPickerView({ latitude, longitude, geocoded })

  return (
    <div className="space-y-2">
      <div className="h-80 w-full rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700">
        <GoogleMapComponent
          componentId="entity-location-map"
          center={view.center}
          zoom={view.zoom}
          height="100%"
          markers={
            view.showMarker
              ? [{ id: 'entity-location', position: view.center, title: name || '', color: '#00A8E8' }]
              : []
          }
          onMapClick={(lat: number, lng: number) => onChange?.(lat, lng)}
        />
      </div>
      {/* O operador precisa saber que a câmera veio do endereço e que ainda não existe coordenada
          — sem esta linha, um mapa centrado no lugar certo parece um local já posicionado. */}
      {view.source === 'address' && addressCaption && (
        <p className="text-xs text-gray-700 dark:text-gray-300">{addressCaption}</p>
      )}
    </div>
  )
}
