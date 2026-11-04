import { NextIntlClientProvider } from 'next-intl'
import { EngagementReport } from '@/components/dashboard/reports/engagement/EngagementReport'
import type { EngagementBankReport, EngagementFilters, EngagementGa4Report, EngagementUse } from '@/lib/engagement/report'
import type { ConversionFunnel } from '@/lib/conversion/funnel'
import { summaryMonthOf } from '@/lib/engagement/summary'
import { Sparkline } from '@/components/ui/Sparkline'
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
  /** Draws a stand-in for the all-time blocks, so the note above them renders (#1096). */
  allTime?: boolean
  /** `?month=`; the page resolves it with `summaryMonthOf`, so does this. */
  month?: string
  conversion?: ConversionFunnel
  conversionFailed?: boolean
  /** Called with the filters the screen asks for (clear filters). */
  onFiltersChange?: (f: EngagementFilters) => void
}) {
  return (
    <NextIntlClientProvider locale="pt" timeZone="America/Sao_Paulo" messages={{ Pages: { Dashboard: ptMessages.Pages.Dashboard } }}>
      <EngagementReport
        use={props.use ?? 'audio'}
        onUseChange={() => {}}
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
        isFetching={false}
        allTime={props.allTime ? <div data-testid="engagement-all-time" className="h-24 rounded-2xl border border-gray-200 bg-white" /> : undefined}
      />
    </NextIntlClientProvider>
  )
}

/** The tile line alone, for its slots and gaps (#1099, spec §B15 item 6). */
export function SparklineHarness(props: { points: (number | null)[] }) {
  return (
    <div style={{ width: 300, height: 32 }}>
      <Sparkline points={props.points} accentIndex={props.points.length - 1} title={props.points.map((p) => String(p)).join(' · ')} />
    </div>
  )
}
