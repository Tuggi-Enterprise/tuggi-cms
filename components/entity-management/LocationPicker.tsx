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
 *
 * E FALHAR EM SILÊNCIO NO FLUXO NÃO É FALHAR EM SILÊNCIO NA TELA (#371, `design`, item 1). Sem
 * coordenada, este componente SEMPRE tem legenda, em uma das quatro formas que
 * `pickLocationCaption` decide — porque o mapa de São Paulo sem uma linha de texto não diz ao
 * operador se está esperando algo, se o endereço não resolveu ou se é assim que a tela é. Nas três
 * formas em que o clique é o caminho, a legenda diz `clique no mapa`.
 */
import { useEffect, useState } from 'react'
import { MapPin, ExternalLink } from 'lucide-react'
import { GoogleMapComponent } from '@/components/ui/GoogleMapComponent'
import { geocodeAddress } from '@/lib/maps/geocode-address'
import {
  pickLocationCaption,
  pickLocationPickerView,
  type LocationCaption,
  type MapPoint,
} from '@/lib/maps/location-picker-view'

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
   * AS QUATRO LEGENDAS, já traduzidas por quem chama: este componente é usado em telas de
   * namespaces diferentes, e chamar `useTranslations` aqui imprimiria o nome da chave em quem não
   * tem o namespace.
   *
   * São quatro e não uma porque a coordenada pode faltar de quatro maneiras, e a única frase que
   * ensina o caminho (`clique no mapa`) tem de aparecer nas três em que ele é o caminho — inclusive
   * quando a geocodificação falha, que é justamente onde a legenda não existia (#371, item 1).
   * O objeto inteiro é obrigatório de propósito: quem passa metade deixa um mapa mudo.
   */
  captions?: Record<LocationCaption, string>
  onChange?: (lat: number, lng: number) => void
}

export function LocationPicker({
  editable,
  latitude,
  longitude,
  name,
  address,
  captions,
  onChange,
}: LocationPickerProps) {
  const hasCoord = typeof latitude === 'number' && typeof longitude === 'number'
  const [geocoded, setGeocoded] = useState<MapPoint | null>(null)
  /**
   * A geocodificação está fora. Estado próprio porque `geocoded === null` responde a duas
   * perguntas diferentes — "ainda não voltou" e "não achou" —, e a legenda de cada uma é outra.
   */
  const [locating, setLocating] = useState(false)

  const trimmedAddress = (address ?? '').trim()
  // Só quando falta a coordenada: com coordenada gravada, geocodificar seria pedir a um terceiro
  // uma resposta que o registro já tem — e correr o risco de discordarem na tela.
  const shouldGeocode = editable && !hasCoord && trimmedAddress.length > 0

  useEffect(() => {
    if (!shouldGeocode) {
      setGeocoded(null)
      setLocating(false)
      return
    }

    let cancelled = false
    setGeocoded(null)
    setLocating(true)
    void geocodeAddress(trimmedAddress)
      .then((result) => {
        if (cancelled || !result) return
        setGeocoded({ lat: result.lat, lng: result.lng })
      })
      // `finally` e não o ramo de sucesso: `geocodeAddress` falha para null, mas se algum dia
      // rejeitar, a legenda ficaria presa em `Localizando…` para sempre.
      .finally(() => {
        if (!cancelled) setLocating(false)
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
  const caption = pickLocationCaption({
    editable,
    source: view.source,
    hasAddress: trimmedAddress.length > 0,
    locating,
  })

  return (
    <div className="space-y-2">
      <div className="h-80 w-full rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700">
        <GoogleMapComponent
          componentId="entity-location-map"
          center={view.center}
          zoom={view.zoom}
          height="100%"
          /* DRAWING OFF, AND THAT IS WHAT MAKES THE CLICK WORK. `GoogleMapComponent` defaults
             `enableDrawing`/`showDrawingButton` to `true`, so it starts a polygon on mount — and
             while a polygon is being drawn its click listener returns before calling `onMapClick`.
             Observed in place creation: the operator clicked, the map dropped a vertex, no
             coordinate was ever written, and saving complained about fields that were filled in.
             Here ONE point is picked; the polygon has its own tab in the drawer. */
          enableDrawing={false}
          showDrawingButton={false}
          markers={
            view.showMarker
              ? [{ id: 'entity-location', position: view.center, title: name || '', color: '#00A8E8' }]
              : []
          }
          onMapClick={(lat: number, lng: number) => onChange?.(lat, lng)}
        />
      </div>
      {/* SEMPRE que falta a coordenada, e o espaço é reservado desde o primeiro render (duas linhas
          de `text-xs`): a legenda troca quando a geocodificação responde, e um parágrafo que nasce
          ali empurraria o mapa que o operador está usando. O mapa continua renderizado enquanto
          localiza — é ele que carrega o SDK que a geocodificação espera. */}
      {caption !== null && (
        <p className="min-h-[2rem] text-xs text-gray-700 dark:text-gray-300" aria-live="polite">
          {captions?.[caption] ?? ''}
        </p>
      )}
    </div>
  )
}
