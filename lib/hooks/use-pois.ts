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

