'use client'

/**
 * useReverseGeocode — city/state/country derived from the coordinate the operator clicked, the
 * same way POI creation does it (`POIDetailsModal.handleReverseGeocode`): same endpoint
 * (`/api/pois/reverse-geocode`, Nominatim) and the same 500 ms debounce.
 *
 * THE DIRECTION IS THE POINT: here the coordinate is the truth and the text is derived from it.
 * That is the opposite of `geocodeAddress` (LocationPicker), where the address only moves the
 * camera and never becomes a coordinate (#371). A human click is still the only writer of a
 * coordinate; this hook only fills the text fields the operator would type next — and can fix.
 *
 * Country and state come back through `normalizeLocation` (SSOT) because Nominatim answers in
 * its own language and form ("Brasil", "State of São Paulo") while the base uses the canonical
 * English form.
 */
import { useEffect, useRef, useState } from 'react'
import { normalizeLocation } from '@/lib/shared/location-normalize'

export interface DetectedLocation {
  city: string | null
  state: string | null
  country: string | null
  formatted_address?: string | null
}

interface UseReverseGeocodeParams {
  /** Turns the hook on. Outside create mode the record already carries these fields. */
  enabled: boolean
  latitude: number | null
  longitude: number | null
  /** Called on every successful lookup, with the already-normalized result. */
  onDetected: (location: DetectedLocation) => void
}

/** Same as the POI flow: one lookup per pin, not one per click while the operator adjusts it. */
const DEBOUNCE_MS = 500

export function useReverseGeocode({ enabled, latitude, longitude, onDetected }: UseReverseGeocodeParams) {
  const [detecting, setDetecting] = useState(false)
  const [detected, setDetected] = useState<DetectedLocation | null>(null)

  // The callback lives in a ref: callers pass a fresh arrow on every render, and the effect
  // depends on the coordinate alone — otherwise each render would fire another lookup.
  const onDetectedRef = useRef(onDetected)
  useEffect(() => {
    onDetectedRef.current = onDetected
  }, [onDetected])

  useEffect(() => {
    const hasCoord =
      typeof latitude === 'number' && typeof longitude === 'number' &&
      !Number.isNaN(latitude) && !Number.isNaN(longitude)

    if (!enabled || !hasCoord) {
      setDetected(null)
      setDetecting(false)
      return
    }

    let cancelled = false
    setDetecting(true)

    const timer = setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch('/api/pois/reverse-geocode', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lat: latitude, lng: longitude }),
          })
          if (!response.ok) {
            console.warn('[use-reverse-geocode] reverse geocoding failed:', response.status)
            return
          }
          const data = await response.json()
          if (cancelled) return

          const { country, state } = normalizeLocation(data.country, data.state, data.city)
          const location: DetectedLocation = {
            city: data.city ?? null,
            state,
            country,
            formatted_address: data.formatted_address ?? null,
          }
          setDetected(location)
          onDetectedRef.current(location)
        } catch (error) {
          // Failing here blocks nothing: the three fields stay editable by hand.
          console.warn('[use-reverse-geocode] reverse geocoding error:', error)
        } finally {
          if (!cancelled) setDetecting(false)
        }
      })()
    }, DEBOUNCE_MS)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [enabled, latitude, longitude])

  return { detecting, detected }
}
