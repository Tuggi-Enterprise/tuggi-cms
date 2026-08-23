/**
 * POST /api/maps/geocode — endereço → ponto, para MOVER UMA CÂMERA.
 *
 * POR QUE ELA EXISTE, e é um conserto e não um recurso novo. `lib/maps/geocode-address` pedia o
 * ponto ao `google.maps.Geocoder` do SDK do navegador, e a documentação da própria Google diz
 * que esse serviço exige a **Geocoding API** habilitada: *"Before using the Geocoding service in
 * the Maps JavaScript API, first ensure that the Geocoding API is enabled in the Google Cloud
 * console"*. Medido em 2026-08-23 contra a chave do projeto, ela responde:
 *
 *     REQUEST_DENIED — "This API key is not authorized to use this service or API."
 *
 * Ou seja: a centralização que o #371 entregou nunca funcionou. E como o módulo falha para
 * `null` de propósito, ela falhava **em silêncio** — o mapa abria no centro do Brasil e a
 * legenda dizia `não localizamos`, que é exatamente o estado que o #371 existia para evitar.
 *
 * `places:searchText` responde nessa mesma chave, e é a busca certa para este uso: procurar
 * `Tucas Empório Bistrô, R. Espírito Santo, Cabo Frio` acha a porta do estabelecimento, enquanto
 * geocodificar o logradouro acha o meio da quadra.
 *
 * O LIMITE CONTINUA SENDO O MESMO, e é o motivo de a rota devolver tão pouco: ela move uma
 * câmera. Nada aqui escreve coordenada, e `cms_set_attraction_coordinate` continua sendo
 * alcançado por um caminho só, que começa num humano clicando no mapa (#371, decisão do operador
 * de 2026-08-17).
 */

import { NextResponse } from 'next/server'
import { withAuth, withRateLimit } from '@/lib/auth-middleware'
import { pickSuggestion, type PlaceResult } from '@/lib/maps/place-search'

const SEARCH_ENDPOINT = 'https://places.googleapis.com/v1/places:searchText'

/** Só o que move a câmera e rotula o que foi achado. Mask largo é dado e custo a mais. */
const FIELD_MASK = 'places.location,places.formattedAddress'

/** Um endereço mais longo que isto é ruído de formulário, não endereço. */
const MAX_ADDRESS_LENGTH = 300

export const POST = withRateLimit(60, 60_000)(
  withAuth({ roles: ['admin', 'editor'] }, async (req) => {
    const body = (await req.json().catch(() => null)) as { address?: string } | null
    const address = (body?.address ?? '').trim().slice(0, MAX_ADDRESS_LENGTH)
    if (!address) return NextResponse.json({ result: null })

    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
    if (!apiKey) return NextResponse.json({ result: null })

    try {
      const response = await fetch(SEARCH_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': FIELD_MASK,
        },
        body: JSON.stringify({ textQuery: address, languageCode: 'pt-BR' }),
      })
      if (!response.ok) {
        console.error('[maps/geocode] places search failed:', response.status)
        return NextResponse.json({ result: null })
      }
      const payload = (await response.json()) as { places?: PlaceResult[] }
      const suggestion = pickSuggestion(payload.places)
      if (!suggestion) return NextResponse.json({ result: null })

      return NextResponse.json({
        result: {
          lat: suggestion.latitude,
          lng: suggestion.longitude,
          formattedAddress: suggestion.formattedAddress,
        },
      })
    } catch (error) {
      // Falhar para `null` é o contrato: um mapa que abre onde abria antes, nunca um erro na
      // cara do operador e nunca um formulário travado (#371, item 3).
      console.warn('[maps/geocode] could not resolve the address:', error)
      return NextResponse.json({ result: null })
    }
  })
)
