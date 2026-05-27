import { useQuery } from '@tanstack/react-query'
import { MapTriggerPoint } from './use-trigger-points-for-poi'

export interface BboxTriggerPoint extends MapTriggerPoint {
  attraction_id: string
}

interface Bbox {
  minLat: number
  minLng: number
  maxLat: number
  maxLng: number
}

function bboxQueryString(bbox: Bbox, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({
    min_lat: bbox.minLat.toString(),
    min_lng: bbox.minLng.toString(),
    max_lat: bbox.maxLat.toString(),
    max_lng: bbox.maxLng.toString(),
    ...extra
  })
  return params.toString()
}

async function fetchCount(bbox: Bbox): Promise<number> {
  const res = await fetch(`/api/trigger-points/in-bbox?${bboxQueryString(bbox, { count_only: '1' })}`)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `Failed to fetch TP count (${res.status})`)
  }
  const data = await res.json()
  return typeof data.count === 'number' ? data.count : 0
}

async function fetchTriggerPoints(bbox: Bbox, limit: number): Promise<BboxTriggerPoint[]> {
  const res = await fetch(
    `/api/trigger-points/in-bbox?${bboxQueryString(bbox, { limit: limit.toString() })}`
  )
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `Failed to fetch TPs in bbox (${res.status})`)
  }
  const data = await res.json()
  return data.trigger_points || []
}

// Round bbox to 4 decimals (~11m) so the cache key is stable across small pans
function roundBbox(bbox: Bbox): Bbox {
  return {
    minLat: Math.round(bbox.minLat * 10000) / 10000,
    minLng: Math.round(bbox.minLng * 10000) / 10000,
    maxLat: Math.round(bbox.maxLat * 10000) / 10000,
    maxLng: Math.round(bbox.maxLng * 10000) / 10000
  }
}

/**
 * Two-stage fetch with guardrail:
 *   1. Count TPs in bbox.
 *   2. If count <= threshold: fetch full list.
 *      If count > threshold: return empty list + `overLimit=true`.
 */
export function useTriggerPointsInBbox(
  bbox: Bbox | null,
  enabled: boolean,
  threshold: number = 500
) {
  const rounded = bbox ? roundBbox(bbox) : null

  const countQuery = useQuery({
    queryKey: ['tp-bbox-count', rounded],
    queryFn: () => fetchCount(rounded!),
    enabled: enabled && !!rounded,
    staleTime: 30 * 1000,
    gcTime: 2 * 60 * 1000
  })

  const count = countQuery.data ?? 0
  const overLimit = count > threshold

  const listQuery = useQuery({
    queryKey: ['tp-bbox-list', rounded],
    queryFn: () => fetchTriggerPoints(rounded!, threshold),
    enabled: enabled && !!rounded && countQuery.isSuccess && !overLimit && count > 0,
    staleTime: 30 * 1000,
    gcTime: 2 * 60 * 1000
  })

  return {
    triggerPoints: listQuery.data ?? [],
    count,
    overLimit,
    isLoading: countQuery.isLoading || listQuery.isLoading,
    isError: countQuery.isError || listQuery.isError
  }
}
