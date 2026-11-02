/**
 * `/dashboard/reports/push` (#1051, #1070) mounted outside Next: the pt namespaces it reads (named on
 * purpose, a missing one would print key paths) and a stand-in App Router, because the page reads
 * `useSearchParams` and `useRouter`. The report itself comes from `page.route` in the spec.
 */

import type { ReactNode } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime'
import { PathnameContext, SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime'
import ptMessages from '@/messages/pt.json'
import PushReportRoute from '@/app/[locale]/dashboard/reports/push/page'

const noop = () => undefined
const router = { push: noop, replace: noop, refresh: noop, back: noop, forward: noop, prefetch: noop, hmrRefresh: noop }

function Frame({ children }: { children: ReactNode }) {
  return (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <AppRouterContext.Provider value={router as any}>
      <PathnameContext.Provider value="/pt/dashboard/reports/push">
        <SearchParamsContext.Provider value={new URLSearchParams('from=2026-10-20&to=2026-11-02') as never}>
          <NextIntlClientProvider
            locale="pt"
            timeZone="America/Sao_Paulo"
            messages={{
              Pages: {
                Dashboard: { push: ptMessages.Pages.Dashboard.push },
                WeeklyPush: ptMessages.Pages.WeeklyPush,
                Notifications: { history: ptMessages.Pages.Notifications.history },
              },
            }}
          >
            {children}
          </NextIntlClientProvider>
        </SearchParamsContext.Provider>
      </PathnameContext.Provider>
    </AppRouterContext.Provider>
  )
}

export function PushReportHarness() {
  return (
    <Frame>
      <PushReportRoute />
    </Frame>
  )
}
