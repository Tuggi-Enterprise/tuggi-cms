/**
 * The Acquisition page (#1171) mounted outside Next: the pt namespaces it reads, a fresh react-query
 * client and a stand-in App Router (the page reads `useSearchParams` and `useRouter`). Components only:
 * the fixtures live in `acquisition-fixtures.ts`.
 */

import { useState } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime'
import { PathParamsContext, PathnameContext, SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime'
import ptMessages from '@/messages/pt.json'
import AcquisitionReportPage from '@/app/[locale]/dashboard/reports/acquisition/page'

const noop = () => undefined
const router = { push: noop, replace: noop, refresh: noop, back: noop, forward: noop, prefetch: noop, hmrRefresh: noop }

export function AcquisitionHarness({ month }: { month: string }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }))
  return (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <AppRouterContext.Provider value={router as any}>
      <PathnameContext.Provider value="/pt/dashboard/reports/acquisition">
        <SearchParamsContext.Provider value={new URLSearchParams(`month=${month}`) as never}>
          <PathParamsContext.Provider value={{ locale: 'pt' }}>
            <QueryClientProvider client={client}>
              <NextIntlClientProvider
                locale="pt"
                timeZone="America/Sao_Paulo"
                messages={{ Pages: { Dashboard: ptMessages.Pages.Dashboard, Social: ptMessages.Pages.Social } }}
              >
                <AcquisitionReportPage />
              </NextIntlClientProvider>
            </QueryClientProvider>
          </PathParamsContext.Provider>
        </SearchParamsContext.Provider>
      </PathnameContext.Provider>
    </AppRouterContext.Provider>
  )
}
