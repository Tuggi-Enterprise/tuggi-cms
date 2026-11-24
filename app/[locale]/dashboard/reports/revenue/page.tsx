'use client'

import { useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

import { RevenueReport } from '@/components/dashboard/reports/revenue/RevenueReport'
import { useRevenue } from '@/lib/hooks/use-revenue'
import { engagementMonths, isMonth, saoPauloDay } from '@/lib/engagement/months'
import { summaryMonthOf } from '@/lib/engagement/summary'

/**
 * Revenue (#1157, spec §D6): admin only, as every `/dashboard/reports/*` in `resolveAccess` and as
 * the function's own gate. The page owns `?month=` (the last closed month by default, the ruler of
 * the Engagement page) and the query; the screen is `RevenueReport`.
 */
export default function RevenueReportPage() {
  const router = useRouter()
  const params = useSearchParams()
  const months = useMemo(() => engagementMonths(), [])
  const today = useMemo(() => saoPauloDay(), [])
  const monthParam = params.get('month')
  const month = summaryMonthOf(isMonth(monthParam) ? monthParam : null, months, today)
  const revenue = useRevenue(month)
  const failed = revenue.isError || (!!revenue.data && !revenue.data.success)

  return (
    <RevenueReport
      months={months}
      today={today}
      month={month}
      onMonthChange={(m) => router.replace(`?month=${m}`, { scroll: false })}
      report={revenue.data?.success ? revenue.data.data : undefined}
      failed={failed}
      onRetry={() => void revenue.refetch()}
    />
  )
}
