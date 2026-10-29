/**
 * The frame `/admin/social` (#1059) needs to mount outside Next: the pt namespaces it reads (named on
 * purpose, a missing one would print key paths), a fresh react-query client, and a stand-in App
 * Router, because the page reads `useSearchParams`, `usePathname` and `useRouter`. Components only:
 * the fixtures live in `social-fixtures.ts`.
 */

import { useState, type ReactNode } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime'
import {
  PathParamsContext,
  PathnameContext,
  SearchParamsContext,
} from 'next/dist/shared/lib/hooks-client-context.shared-runtime'
import ptMessages from '@/messages/pt.json'
import { SocialPageContent } from '@/components/admin/social/SocialPageContent'

const noop = () => undefined
const router = { push: noop, replace: noop, refresh: noop, back: noop, forward: noop, prefetch: noop, hmrRefresh: noop }

function Frame({ search, children }: { search: string; children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }))
  return (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <AppRouterContext.Provider value={router as any}>
      <PathnameContext.Provider value="/pt/admin/social">
        <SearchParamsContext.Provider value={new URLSearchParams(search) as never}>
          <PathParamsContext.Provider value={{ locale: 'pt' }}>
            <QueryClientProvider client={client}>
              <NextIntlClientProvider
                locale="pt"
                timeZone="America/Sao_Paulo"
                messages={{
                  Pages: { Social: ptMessages.Pages.Social },
                  Common: { actions: ptMessages.Common.actions, status: ptMessages.Common.status },
                }}
              >
                {children}
              </NextIntlClientProvider>
            </QueryClientProvider>
          </PathParamsContext.Provider>
        </SearchParamsContext.Provider>
      </PathnameContext.Provider>
    </AppRouterContext.Provider>
  )
}

export function SocialHarness({ search }: { search: string }) {
  return (
    <Frame search={search}>
      <SocialPageContent />
    </Frame>
  )
}
