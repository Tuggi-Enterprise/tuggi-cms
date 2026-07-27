import { useQuery } from '@tanstack/react-query'
import { placeService, type PlaceFilters } from '@/lib/core/place-service'

/** Lista paginada de locais (espelha useEvents). `enabled` permite gatear (ex.: só no modo mapa). */
export function usePlaces(filters: PlaceFilters, enabled: boolean = true) {
  return useQuery({
    queryKey: ['places', filters],
    queryFn: () => placeService.list(filters),
    placeholderData: (previousData) => previousData,
    staleTime: 0,
    gcTime: 5 * 60 * 1000,
    enabled,
  })
}

export function usePlaceFacets(filters: PlaceFilters, enabled: boolean = true) {
  return useQuery({
    queryKey: ['places-facets', filters],
    queryFn: () => placeService.getFacets(filters),
    placeholderData: (previousData) => previousData,
    staleTime: 30 * 1000,
    enabled,
  })
}

export function usePlaceDetails(id: string | null, enabled: boolean = true) {
  return useQuery({
    queryKey: ['place-details', id],
    queryFn: () => placeService.getDetails(id as string),
    enabled: !!id && enabled,
    staleTime: 0,
  })
}
