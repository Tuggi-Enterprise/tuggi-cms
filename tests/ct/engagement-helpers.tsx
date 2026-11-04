import { NextIntlClientProvider } from 'next-intl'
import { EngagementReport } from '@/components/dashboard/reports/engagement/EngagementReport'
import type { EngagementBankReport, EngagementFilters, EngagementGa4Report, EngagementUse } from '@/lib/engagement/report'
import ptMessages from '@/messages/pt.json'

/** `EngagementReport` with pt copy, a fixed month ruler and a fixed today; the reads are the fixture (#1094). */
export function EngagementHarness(props: {
  months: string[]
  today: string
  use?: EngagementUse
  filters?: EngagementFilters
  bank?: EngagementBankReport
  bankFailed?: boolean
  ga4?: EngagementGa4Report
  ga4Failed?: boolean
}) {
  return (
    <NextIntlClientProvider locale="pt" timeZone="America/Sao_Paulo" messages={{ Pages: { Dashboard: ptMessages.Pages.Dashboard } }}>
      <EngagementReport
        use={props.use ?? 'audio'}
        onUseChange={() => {}}
        filters={props.filters ?? { source: null, country: null, platform: null, account: null }}
        onFiltersChange={() => {}}
        months={props.months}
        today={props.today}
        bank={props.bank}
        bankFailed={!!props.bankFailed}
        onBankRetry={() => {}}
        ga4={props.ga4}
        ga4Failed={!!props.ga4Failed}
        onGa4Retry={() => {}}
        clicksMonth={null}
        onClicksMonthChange={() => {}}
        isFetching={false}
      />
    </NextIntlClientProvider>
  )
}
