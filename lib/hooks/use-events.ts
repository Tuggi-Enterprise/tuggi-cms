import { useQuery } from '@tanstack/react-query'
import { eventService, type EventFilters } from '@/lib/core/event-service'

/** Lista paginada de eventos (espelha usePOIs). `enabled` permite gatear (ex.: só no modo mapa). */
export function useEvents(filters: EventFilters, enabled: boolean = true) {
  return useQuery({
    queryKey: ['events', filters],
    queryFn: () => eventService.list(filters),
    placeholderData: (previousData) => previousData,
    staleTime: 0,
    gcTime: 5 * 60 * 1000,
    enabled,
  })
}

/** Contadores/facets (chave sem a página — virar de página reusa o cache). */
export function useEventFacets(filters: EventFilters, enabled: boolean = true) {
  return useQuery({
    queryKey: ['events-facets', filters],
    queryFn: () => eventService.getFacets(filters),
    placeholderData: (previousData) => previousData,
    staleTime: 30 * 1000,
    enabled,
  })
}

/** Detalhe de 1 evento. */
export function useEventDetails(id: string | null, enabled: boolean = true) {
  return useQuery({
    queryKey: ['event-details', id],
    queryFn: () => eventService.getDetails(id as string),
    enabled: !!id && enabled,
    staleTime: 0,
  })
}
