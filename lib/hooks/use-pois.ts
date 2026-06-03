import { useQuery } from '@tanstack/react-query'
import { poiService, POISearchFilters } from '@/lib/core/poi-service'

export function usePOIs(filters: POISearchFilters) {
  return useQuery({
    queryKey: ['pois', filters],
    queryFn: async () => {
      console.log('🔍 [HOOK] Fetching POIs with filters:', filters)
      const result = await poiService.search(filters)
      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch POIs')
      }
      return result
    },
    placeholderData: (previousData) => previousData,
    staleTime: 0, // Always refetch when invalidated
    gcTime: 5 * 60 * 1000, // Keep in cache for 5 minutes (formerly cacheTime)
  })
}
// Contadores/total (paginação + cards). Chave SEM a página: virar de página reusa o cache;
// só re-busca quando um filtro real muda.
export function usePOIFacets(filters: POISearchFilters, enabled: boolean = true) {
  return useQuery({
    queryKey: ['pois-facets', filters],
    queryFn: () => poiService.getFacets(filters),
    placeholderData: (previousData) => previousData,
    staleTime: 30 * 1000,
    enabled,
  })
}

export function usePOIsWithTriggers(filters: { city: string; state?: string; country?: string }, enabled: boolean = true) {
  return useQuery({
    queryKey: ['pois-with-triggers', filters],
    queryFn: () => poiService.getWithTriggers(filters),
    enabled: !!filters.city && enabled,
    staleTime: 60 * 1000 // 1 minute
  })
}
