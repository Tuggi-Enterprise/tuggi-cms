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
 * THE BROWSER'S SDK AND NOT THE HTTP API, on purpose: the Maps JS SDK is already loaded by
 * `GoogleMapComponent` (`@googlemaps/react-wrapper`) wherever a map is on the screen, the
 * geocoding quota is the same one, and going through a route of ours would mean a second place
 * holding a Google key.
 *
 * IT FAILS TO NULL, ALWAYS. A geocoding that answers nothing is a map that opens where it opened
 * before — never an error in front of the operator, and never a blocked form (#371, item 3).
 */

/** The SDK is loaded by whichever map is on the screen; this is how long we wait for it. */
const SDK_WAIT_TIMEOUT_MS = 10_000
const SDK_POLL_INTERVAL_MS = 100

export interface GeocodedAddress {
  lat: number
  lng: number
  /** What Google calls the place it found — the label `searchCity` shows. */
  formattedAddress: string
}

/**
 * Resolve when `google.maps` is available, or false when it never arrives.
 *
 * The same 100 ms / 10 s convention `GoogleMapComponent` polls with, and for the same reason:
 * `@googlemaps/react-wrapper` injects the script when a map mounts, so a sibling of the map
 * cannot assume the SDK is there on its first render.
 */
export async function waitForGoogleMaps(timeoutMs: number = SDK_WAIT_TIMEOUT_MS): Promise<boolean> {
  const ready = () =>
    typeof window !== 'undefined' &&
    typeof (window as any).google?.maps?.Geocoder === 'function'

  if (ready()) return true
  if (typeof window === 'undefined') return false

  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, SDK_POLL_INTERVAL_MS))
    if (ready()) return true
  }
  return false
}

export async function geocodeAddress(
  address: string,
  options: { timeoutMs?: number } = {}
): Promise<GeocodedAddress | null> {
  const query = address.trim()
  if (query.length === 0) return null
  if (!(await waitForGoogleMaps(options.timeoutMs))) return null

  try {
    const geocoder = new google.maps.Geocoder()
    const results = await new Promise<google.maps.GeocoderResult[]>((resolve, reject) => {
      geocoder.geocode({ address: query }, (found, status) => {
        if (status === 'OK' && found && found.length > 0) resolve(found)
        else reject(new Error(`Geocoding failed: ${status}`))
      })
    })

    const location = results[0].geometry.location
    return {
      lat: location.lat(),
      lng: location.lng(),
      formattedAddress: results[0].formatted_address,
    }
  } catch (error) {
    // `ZERO_RESULTS` for an address a partner typed by hand is ordinary, not exceptional.
    console.warn('[geocode-address] could not resolve the address:', error)
    return null
  }
}
