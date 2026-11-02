import { NextIntlClientProvider } from 'next-intl'
import { ConversionReport } from '@/components/dashboard/reports/conversion/ConversionReport'
import type { ConversionFunnel } from '@/lib/conversion/funnel'
import ptMessages from '@/messages/pt.json'

/** `ConversionReport` with pt copy and a fixed month list; the funnel state is the fixture (#1068). */
export function ConversionHarness(props: { funnel?: ConversionFunnel; isLoading?: boolean; isError?: boolean }) {
  return (
    <NextIntlClientProvider locale="pt" messages={{ Pages: { Dashboard: ptMessages.Pages.Dashboard } }}>
      <ConversionReport
        month="2026-10-01"
        months={['2026-10-01', '2026-09-01']}
        onMonthChange={() => {}}
        funnel={props.funnel}
        isLoading={!!props.isLoading}
        isFetching={false}
        isError={!!props.isError}
        onRetry={() => {}}
      />
    </NextIntlClientProvider>
  )
}
