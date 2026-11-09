'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

import { EngagementReport } from '@/components/dashboard/reports/engagement/EngagementReport'
import { AllTimeBlocks } from '@/components/dashboard/reports/engagement/AllTimeBlocks'
import { dashboardService, DashboardStats, EMPTY_DASHBOARD_STATS } from '@/lib/services/dashboard-service'
import { useEngagementBank, useEngagementGa4, useEngagementUsage } from '@/lib/hooks/use-engagement'
import { useConversion, useFreeMinutes } from '@/lib/hooks/use-conversion'
import { summaryMonthOf } from '@/lib/engagement/summary'
import { engagementMonths, isMonth, saoPauloDay } from '@/lib/engagement/months'
import {
  ENGAGEMENT_DEFAULT_USE,
  ENGAGEMENT_USES,
  parseEngagementFilters,
  NO_FILTERS,
  type EngagementFilters,
  type EngagementUse,
} from '@/lib/engagement/report'

/**
 * Engagement and conversion report (#1094, #1101): the page owns `?use=`, the four filters, the one
 * `?month=` of the page (§C8) and the queries; the screen is `EngagementReport`. The month ruler comes from `engagementMonths`, the
 * same list the API route reads, not from the database.
 */
export default function EngagementReportPage() {
  const router = useRouter()
  const params = useSearchParams()

  const useParam = params.get('use')
  const use: EngagementUse = (ENGAGEMENT_USES as readonly string[]).includes(useParam ?? '') ? (useParam as EngagementUse) : ENGAGEMENT_DEFAULT_USE
  const parsed = parseEngagementFilters(params)
  const filters: EngagementFilters = parsed === 'invalid' ? NO_FILTERS : parsed
  const monthParam = params.get('month')

  const months = useMemo(() => engagementMonths(), [])
  const today = useMemo(() => saoPauloDay(), [])
  const month = summaryMonthOf(isMonth(monthParam) ? monthParam : null, months, today)

  const bank = useEngagementBank(filters)
  const ga4 = useEngagementGa4(filters)
  const usage = useEngagementUsage(filters)
  // The RPC has no filter: under any filter the funnels refuse it (§C1 item 8), the read stays the cohort's.
  const conversion = useConversion(`${month}-01`)
  const conversionFailed = conversion.isError || (!!conversion.data && !conversion.data.success)
  const freeMinutes = useFreeMinutes(month)
  const freeMinutesFailed = freeMinutes.isError || (!!freeMinutes.data && !freeMinutes.data.success)

  const [stats, setStats] = useState<DashboardStats>(EMPTY_DASHBOARD_STATS)
  useEffect(() => {
    dashboardService.getDashboardData().then((result) => {
      if (result.success && result.data) setStats(result.data)
    })
  }, [])

  const write = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(Array.from(params.entries()))
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) next.delete(key)
      else next.set(key, value)
    }
    const s = next.toString()
    router.replace(s ? `?${s}` : '?', { scroll: false })
  }

  return (
    <EngagementReport
      use={use}
      onUseChange={(u) => write({ use: u })}
      filters={filters}
      onFiltersChange={(f) => write({ source: f.source, country: f.country, platform: f.platform, account: f.account })}
      months={months}
      today={today}
      bank={bank.isError ? undefined : bank.data}
      bankFailed={bank.isError}
      onBankRetry={() => void bank.refetch()}
      ga4={ga4.isError ? undefined : ga4.data}
      ga4Failed={ga4.isError}
      onGa4Retry={() => void ga4.refetch()}
      month={month}
      onMonthChange={(m) => write({ month: m })}
      conversion={conversion.data?.success ? conversion.data.data : undefined}
      conversionFailed={conversionFailed}
      onConversionRetry={() => void conversion.refetch()}
      freeMinutes={freeMinutes.data?.success ? freeMinutes.data.data : undefined}
      freeMinutesFailed={freeMinutesFailed}
      onFreeMinutesRetry={() => void freeMinutes.refetch()}
      usage={usage.isError ? undefined : usage.data}
      usageFailed={usage.isError}
      onUsageRetry={() => void usage.refetch()}
      isFetching={(bank.isFetching && !bank.isLoading) || (ga4.isFetching && !ga4.isLoading) || (usage.isFetching && !usage.isLoading)}
      allTime={<AllTimeBlocks stats={stats} />}
    />
  )
}
