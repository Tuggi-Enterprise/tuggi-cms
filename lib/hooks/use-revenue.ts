import { useQuery } from '@tanstack/react-query'
import { revenueService } from '@/lib/services/revenue-service'

/** The twelve months up to `month` of `core.cms_get_revenue_monthly`, one call per month chosen (#1157). */
export function useRevenue(month: string) {
  return useQuery({
    queryKey: ['revenue', month],
    queryFn: () => revenueService.get(month),
    placeholderData: (previousData) => previousData,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    enabled: !!month,
  })
}
