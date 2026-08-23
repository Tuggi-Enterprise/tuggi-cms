/**
 * Address → coordinate, ONCE, for the whole CMS.
 *
 * IT EXISTS BECAUSE THERE WAS ALREADY ONE, and #371 was about to write the second. The first is
 * `searchCity` in `lib/hooks/use-map-state.ts` (the POI importer's map state), which asks the
 * Maps JS SDK `Geocoder` for a city and re-centres the map on it. This module is that call,
 * lifted out, and `searchCity` now goes through it — two answers to "where is this address" is
 * how one of them starts putting pins in the wrong country (CLAUDE.md §6, DRY).
 *
 * WHAT IT IS FOR, AND THE LIMIT IS THE POINT: it moves a CAMERA. Nothing here writes a
 * coordinate, and no caller may treat what comes back as the location of anything —
 * `cms_set_attraction_coordinate` is reached by exactly one path, and that path starts with a
 * human clicking on the map (#371, operator decision of 2026-08-17). A wrong map centre is
 * corrected by dragging; a wrong coordinate on the record has the appearance of truth and travels
 * through the triage.
 *
 * IT WENT THROUGH OUR OWN ROUTE ON 2026-08-23, AND THAT WAS A REPAIR. It used to ask the
 * browser's `google.maps.Geocoder`, and Google's own documentation requires the **Geocoding API**
 * for that service: *"Before using the Geocoding service in the Maps JavaScript API, first ensure
 * that the Geocoding API is enabled in the Google Cloud console"*. Measured against this
 * project's key, that API answers:
 *
 *     REQUEST_DENIED — "This API key is not authorized to use this service or API."
 *
 * So the centring #371 shipped never worked, and — because this module fails to `null` on
 * purpose — it never worked IN SILENCE: the map opened at the fallback centre and the legend
 * read `não localizamos`, which is the state #371 existed to remove. `/api/maps/geocode` asks
 * `places:searchText`, which the same key answers.
 *
 * IT FAILS TO NULL, ALWAYS. A geocoding that answers nothing is a map that opens where it opened
 * before — never an error in front of the operator, and never a blocked form (#371, item 3).
 */

/** A rota que responde. Nomeada uma vez, para o teste e o chamador concordarem. */
export const GEOCODE_ENDPOINT = '/api/maps/geocode'

/** Uma busca que não respondeu neste tempo não vale segurar a montagem de um mapa. */
const REQUEST_TIMEOUT_MS = 10_000

export interface GeocodedAddress {
  lat: number
  lng: number
  /** O que a Google chama o lugar que achou — o rótulo que `searchCity` mostra. */
  formattedAddress: string
}

export async function geocodeAddress(
  address: string,
  options: { timeoutMs?: number } = {}
): Promise<GeocodedAddress | null> {
  const query = address.trim()
  // Um endereço em branco não é uma requisição.
  if (query.length === 0) return null

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(GEOCODE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: query }),
      signal: controller.signal,
    })
    if (!response.ok) return null

    const payload = (await response.json()) as { result: GeocodedAddress | null }
    return payload.result ?? null
  } catch (error) {
    // `ZERO_RESULTS` para um endereço que um parceiro digitou à mão é o caso comum, não a
    // exceção — e o mesmo vale para a rede cair no meio.
    console.warn('[geocode-address] could not resolve the address:', error)
    return null
  } finally {
    clearTimeout(timer)
  }
}
