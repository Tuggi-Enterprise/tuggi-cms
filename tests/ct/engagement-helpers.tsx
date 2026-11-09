import { NextIntlClientProvider } from 'next-intl'
import { EngagementReport } from '@/components/dashboard/reports/engagement/EngagementReport'
import type { EngagementBankReport, EngagementFilters, EngagementGa4Report } from '@/lib/engagement/report'
import type { ActiveUsersReport } from '@/lib/engagement/active-users'
import type { ConversionFunnel } from '@/lib/conversion/funnel'
import type { FreeMinutesHistogram } from '@/lib/engagement/free-minutes'
import type { UsageReport } from '@/lib/engagement/usage'
import { summaryMonthOf } from '@/lib/engagement/summary'
import ptMessages from '@/messages/pt.json'

/** `EngagementReport` with pt copy, a fixed month ruler and a fixed today; the reads are the fixture (#1094). */
export function EngagementHarness(props: {
  months: string[]
  today: string
  filters?: EngagementFilters
  bank?: EngagementBankReport
  bankFailed?: boolean
  ga4?: EngagementGa4Report
  ga4Failed?: boolean
  /** Draws a stand-in for the all-time blocks, so the note above them renders (#1096). */
  allTime?: boolean
  /** `?month=`; the page resolves it with `summaryMonthOf`, so does this. */
  month?: string
  conversion?: ConversionFunnel
  conversionFailed?: boolean
  /** `null` = the function is not deployed; absent = loading. */
  freeMinutes?: FreeMinutesHistogram | null
  freeMinutesFailed?: boolean
  /** `drive.cms_get_usage_monthly` (#1161); absent = loading. */
  usage?: UsageReport
  usageFailed?: boolean
  /** `drive.cms_get_active_users_monthly` (#1162); absent = loading. */
  active?: ActiveUsersReport
  activeFailed?: boolean
  /** Opens Details (block 9) as the URL `#detalhes` does, for the tests of what lives inside it. */
  detailsOpen?: boolean
  /** Called with the filters the screen asks for (clear filters). */
  onFiltersChange?: (f: EngagementFilters) => void
}) {
  // the page opens Details from the hash on mount; set it before the screen mounts
  if (typeof window !== 'undefined') window.history.replaceState(null, '', props.detailsOpen ? '#detalhes' : '#')
  return (
    <NextIntlClientProvider locale="pt" timeZone="America/Sao_Paulo" messages={{ Pages: { Dashboard: ptMessages.Pages.Dashboard } }}>
      <EngagementReport
        filters={props.filters ?? { source: null, country: null, platform: null, account: null }}
        onFiltersChange={props.onFiltersChange ?? (() => {})}
        months={props.months}
        today={props.today}
        bank={props.bank}
        bankFailed={!!props.bankFailed}
        onBankRetry={() => {}}
        ga4={props.ga4}
        ga4Failed={!!props.ga4Failed}
        onGa4Retry={() => {}}
        month={summaryMonthOf(props.month ?? null, props.months, props.today)}
        onMonthChange={() => {}}
        conversion={props.conversion}
        conversionFailed={!!props.conversionFailed}
        onConversionRetry={() => {}}
        freeMinutes={props.freeMinutes}
        freeMinutesFailed={!!props.freeMinutesFailed}
        onFreeMinutesRetry={() => {}}
        usage={props.usage}
        usageFailed={!!props.usageFailed}
        onUsageRetry={() => {}}
        active={props.active}
        activeFailed={!!props.activeFailed}
        onActiveRetry={() => {}}
        isFetching={false}
        allTime={props.allTime ? <div data-testid="engagement-all-time" className="h-24 rounded-2xl border border-gray-200 bg-white" /> : undefined}
      />
    </NextIntlClientProvider>
  )
}
