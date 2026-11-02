'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

import { ConversionReport } from '@/components/dashboard/reports/conversion/ConversionReport'
import { useAcquisitionMonths } from '@/lib/hooks/use-acquisition'
import { useConversion } from '@/lib/hooks/use-conversion'

const currentMonth = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

/** Conversion report (#1068): the page owns `?month=` and the query; the screen is `ConversionReport`. */
export default function ConversionReportPage() {
  const router = useRouter()
  const params = useSearchParams()

  const [month, setMonth] = useState<string>(params.get('month') || currentMonth())
  const { data: monthsRes } = useAcquisitionMonths()
  const { data: res, isLoading, isFetching, refetch } = useConversion(month)

  const months: string[] = monthsRes?.data?.length ? monthsRes.data : [currentMonth()]

  const onMonthChange = (value: string) => {
    setMonth(value)
    const next = new URLSearchParams(Array.from(params.entries()))
    next.set('month', value)
    router.replace(`?${next.toString()}`, { scroll: false })
  }

  return (
    <ConversionReport
      month={month}
      months={months}
      onMonthChange={onMonthChange}
      funnel={res?.success ? res.data : undefined}
      isLoading={isLoading}
      isFetching={isFetching}
      isError={!!res && !res.success}
      onRetry={() => void refetch()}
    />
  )
}
