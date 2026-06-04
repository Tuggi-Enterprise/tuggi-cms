'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchBoundary,
  saveBoundary,
  deleteBoundary,
  sanitizeBoundary,
  type BoundaryPoint,
} from '@/lib/core/poi-boundary-service'

const boundaryKey = (poiId: string | null) => ['poi-boundary', poiId] as const

/** Read the persisted boundary for a POI. */
export function usePoiBoundary(poiId: string | null, enabled: boolean = true) {
  return useQuery({
    queryKey: boundaryKey(poiId),
    queryFn: () => fetchBoundary(poiId!),
    enabled: !!poiId && enabled,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
  })
}

/** Save / delete mutations for a POI boundary, with cache invalidation. */
export function usePoiBoundaryMutations(poiId: string | null) {
  const queryClient = useQueryClient()
  const invalidate = () => queryClient.invalidateQueries({ queryKey: boundaryKey(poiId) })

  const save = useMutation({
    mutationFn: (coordinates: BoundaryPoint[]) => saveBoundary(poiId!, sanitizeBoundary(coordinates)),
    onSuccess: invalidate,
  })

  const remove = useMutation({
    mutationFn: () => deleteBoundary(poiId!),
    onSuccess: invalidate,
  })

  return { save, remove }
}
