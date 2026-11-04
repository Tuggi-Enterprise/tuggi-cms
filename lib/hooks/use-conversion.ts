import { useQuery } from '@tanstack/react-query'
import { conversionService } from '@/lib/services/conversion-service'

/** One month of `core.dashboard_conversion_funnel`, the two funnels of the Engagement page (#1101). */
export function useConversion(month: string) {
  return useQuery({
    queryKey: ['conversion', month],
    queryFn: () => conversionService.get(month),
    placeholderData: (previousData) => previousData,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    enabled: !!month,
  })
}
