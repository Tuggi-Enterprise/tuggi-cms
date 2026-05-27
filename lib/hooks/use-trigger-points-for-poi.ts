import { useQuery } from '@tanstack/react-query'

export interface MapTriggerPoint {
  id: string
  latitude: number
  longitude: number
  bearing: number | null
  is_active: boolean
  type: string
  priority: number
  radius_meters: number
}

export interface POIBoundaryPoint {
  lat: number
  lng: number
}

export interface POIHoverData {
  triggerPoints: MapTriggerPoint[]
  boundary: POIBoundaryPoint[] | null
}

async function fetchPOIHoverData(poiId: string): Promise<POIHoverData> {
  const res = await fetch(`/api/pois/${poiId}/trigger-points`)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `Failed to fetch POI hover data (${res.status})`)
  }
  const data = await res.json()
  return {
    triggerPoints: data.trigger_points || [],
    boundary: data.boundary || null
  }
}

export function useTriggerPointsForPOI(poiId: string | null, enabled: boolean = true) {
  return useQuery({
    queryKey: ['poi-trigger-points', poiId],
    queryFn: () => fetchPOIHoverData(poiId!),
    enabled: !!poiId && enabled,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000
  })
}
