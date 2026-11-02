import { useQuery } from '@tanstack/react-query'
import { conversionService } from '@/lib/services/conversion-service'

/** One month of the Conversion report. The months of the selector come from `useAcquisitionMonths`. */
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
