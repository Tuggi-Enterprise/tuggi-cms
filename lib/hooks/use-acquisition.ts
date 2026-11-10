import { useQuery } from '@tanstack/react-query'
import { acquisitionService } from '@/lib/services/acquisition-service'

/**
 * Aquisição de um mês. O cron que materializa core.profile_origin roda a cada
 * 10 min, então uma janela menor que isso só geraria round-trip sem dado novo.
 */
export function useAcquisition(month: string, ownerId?: string, enabled: boolean = true) {
  return useQuery({
    queryKey: ['acquisition', month, ownerId ?? null],
    queryFn: () => acquisitionService.get(month, ownerId),
    placeholderData: (previousData) => previousData,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    enabled: enabled && !!month,
  })
}

/** Meses disponíveis para o filtro. Muda uma vez por mês; cache longo. */
export function useAcquisitionMonths() {
  return useQuery({
    queryKey: ['acquisition-months'],
    queryFn: () => acquisitionService.getMonths(),
    staleTime: 30 * 60 * 1000,
  })
}

/**
 * The acquisition funnel of a month (#1171). The collectors write once a day, so a short cache buys no
 * new data; a failure stays a failure (`success: false`), never an empty month.
 */
export function useAcquisitionFunnel(month: string) {
  return useQuery({
    queryKey: ['acquisition-funnel', month],
    queryFn: async () => {
      const res = await acquisitionService.getFunnel(month)
      if (!res.success || !res.data) throw new Error(res.error ?? 'acquisition_funnel failed')
      return res.data
    },
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 1,
    enabled: !!month,
  })
}
