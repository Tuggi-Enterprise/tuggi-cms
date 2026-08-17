/**
 * Where the location map OPENS, and whether it shows a pin — the whole decision of #371, pure.
 *
 * THE PIN IS THE COORDINATE, AND THE CENTRE IS NOT. That is the distinction the card turns on: a
 * place whose coordinate nobody has set yet may open over its own address (so the curator does not
 * scroll from São Paulo to Búzios), and it must NOT show a marker there — a pin the operator did
 * not put is a coordinate the record does not have, wearing the clothes of one.
 *
 * The three sources, in order:
 *  1. the coordinate on the record (`core.attraction_coordinate`) — pin, and the close zoom;
 *  2. the geocoded address (`core.attractions.formatted_address`, written by the partner-approval
 *     prefill) — camera only, no pin, and a zoom that shows the street without claiming the door;
 *  3. São Paulo — the last resort, and the only reason it is still here is that a map has to open
 *     somewhere when there is neither a coordinate nor an address.
 */

export interface MapPoint {
  lat: number
  lng: number
}

/** Zoom on a coordinate somebody set: the door of the establishment. */
export const COORDINATE_ZOOM = 18
/** Zoom on a geocoded address: the street, because the door is not what was resolved. */
export const ADDRESS_ZOOM = 16
/** Zoom over the fallback: a whole city, which is all it means. */
export const FALLBACK_ZOOM = 10

/** São Paulo. Not a default anybody chose — the place a map opens when nothing is known. */
export const FALLBACK_CENTER: MapPoint = { lat: -23.5505, lng: -46.6333 }

export interface LocationPickerView {
  center: MapPoint
  zoom: number
  /** True ONLY for a coordinate on the record. The geocoded centre never carries a marker. */
  showMarker: boolean
  /** Which of the three sources the camera came from — what the caption tells the operator. */
  source: 'coordinate' | 'address' | 'fallback'
}

export function pickLocationPickerView(input: {
  latitude?: number | null
  longitude?: number | null
  /** The result of geocoding the place's address, when there was one. Camera only. */
  geocoded?: MapPoint | null
}): LocationPickerView {
  const { latitude, longitude, geocoded } = input

  if (typeof latitude === 'number' && typeof longitude === 'number') {
    return {
      center: { lat: latitude, lng: longitude },
      zoom: COORDINATE_ZOOM,
      showMarker: true,
      source: 'coordinate',
    }
  }

  if (geocoded) {
    return { center: geocoded, zoom: ADDRESS_ZOOM, showMarker: false, source: 'address' }
  }

  return { center: FALLBACK_CENTER, zoom: FALLBACK_ZOOM, showMarker: false, source: 'fallback' }
}
