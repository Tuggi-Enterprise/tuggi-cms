import { NextIntlClientProvider } from 'next-intl'
import { RevenueReport } from '@/components/dashboard/reports/revenue/RevenueReport'
import type { RevenueReport as RevenueData } from '@/lib/revenue/monthly'
import ptMessages from '@/messages/pt.json'

/** `RevenueReport` with pt copy, a fixed ruler and a fixed today (#1157). */
export function RevenueHarness(props: { months: string[]; today: string; month: string; report?: RevenueData | null; failed?: boolean }) {
  return (
    <NextIntlClientProvider locale="pt" timeZone="America/Sao_Paulo" messages={{ Pages: { Dashboard: ptMessages.Pages.Dashboard } }}>
      <RevenueReport months={props.months} today={props.today} month={props.month} onMonthChange={() => {}} report={props.report} failed={!!props.failed} onRetry={() => {}} />
    </NextIntlClientProvider>
  )
}
