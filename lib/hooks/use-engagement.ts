import { useQuery } from '@tanstack/react-query'
import { fetchDashboardRoute } from '@/lib/api/dashboard-fetch'
import {
  ga4Filterable,
  type EngagementBankReport,
  type EngagementFilters,
  type EngagementGa4Report,
} from '@/lib/engagement/report'
import type { UsageReport } from '@/lib/engagement/usage'

/**
 * The two reads of the Engagement report (#1094), one query per source so each fails and retries
 * on its own (spec §6). GA4 is not asked under a filter it does not have: the screen prints
 * `ga4_filter` for those rows instead.
 */
function query(filters: EngagementFilters, keys: Array<keyof EngagementFilters>): string {
  const p = new URLSearchParams()
  for (const k of keys) if (filters[k] !== null) p.set(k, String(filters[k]))
  const s = p.toString()
  return s ? `?${s}` : ''
}

async function unwrap<T>(path: string): Promise<T> {
  const { data, error } = await fetchDashboardRoute<T>(path)
  if (error || data === null) throw new Error(error?.code ?? error?.message ?? 'empty')
  return data
}

export function useEngagementBank(filters: EngagementFilters) {
  return useQuery({
    queryKey: ['engagement', 'bank', filters],
    queryFn: () => unwrap<EngagementBankReport>(`/api/dashboard/engagement${query(filters, ['source', 'country', 'platform', 'account'])}`),
    placeholderData: (previous) => previous,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 1,
  })
}

export function useEngagementGa4(filters: EngagementFilters) {
  return useQuery({
    queryKey: ['engagement', 'ga4', filters.country, filters.platform],
    queryFn: () => unwrap<EngagementGa4Report>(`/api/dashboard/engagement/ga4${query(filters, ['country', 'platform'])}`),
    enabled: ga4Filterable(filters),
    placeholderData: (previous) => previous,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 1,
  })
}

/** `drive.cms_get_usage_monthly` (#1161): its own query, so a function not applied yet fails only its blocks. */
export function useEngagementUsage(filters: EngagementFilters) {
  return useQuery({
    queryKey: ['engagement', 'usage', filters],
    queryFn: () => unwrap<UsageReport>(`/api/dashboard/engagement/usage${query(filters, ['source', 'country', 'platform', 'account'])}`),
    placeholderData: (previous) => previous,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 1,
  })
}
