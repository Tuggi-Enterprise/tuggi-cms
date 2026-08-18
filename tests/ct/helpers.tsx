/**
 * Shared mount wrapper for the partnerships (#359) component tests — the same provider stack
 * `app/[locale]/admin/{partnerships,partnerships/clients/[clientId]}/page.tsx` hands these two
 * screens (`NextIntlClientProvider`, scoped to exactly the namespaces those pages pass) plus
 * `QueryProvider`, which `PlaceFormModal` needs even when it never opens (`react-query`'s
 * `useQuery` throws at mount with no `QueryClientProvider` above it, not only when a query
 * actually runs).
 *
 * Deliberately NOT included: `components/ui/Header.tsx`. It needs `SessionContextProvider`
 * (`@supabase/auth-helpers-react`) and next-intl's typed `usePathname`/`useRouter`, neither of
 * which resolves outside a real Next.js app-router request — mounting it here would be testing
 * whether Playwright can fake a router, not whether this screen is accessible. One consequence
 * is written down where it matters: criterion 25's shared-chrome gap (`Header`'s active-nav
 * `text-tuggi-blue`) is a code-read finding, not an assertion in this suite — see the #359 card
 * comment.
 */

import { useState } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import ptMessages from '@/messages/pt.json'
import { QueryProvider } from '@/components/providers/QueryProvider'
import { ClientDirectory } from '@/components/admin/clients/ClientDirectory'
import { EMPTY_FILTERS, type DirectoryFilters } from '@/lib/clients/directory-filter'

export function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <NextIntlClientProvider
      locale="pt"
      messages={{
        Partnerships: ptMessages.Partnerships,
        Modals: ptMessages.Modals,
        Common: ptMessages.Common,
        // The unified list is the screen that absorbed the queue, and its own copy is
        // translated — only the pipeline vocabulary inside it is Portuguese-only.
        Clients: ptMessages.Clients,
      }}
    >
      <QueryProvider>{children}</QueryProvider>
    </NextIntlClientProvider>
  )
}

/**
 * `ClientDirectory` is a CONTROLLED component: the filters are the URL's, and the host reads
 * and writes them. There is no Next app router in a component mount, so this harness plays the
 * host — it holds the same state in `useState` and hands it back exactly as
 * `AdminClientsPageContent` hands back what it parsed from the query string.
 *
 * Without it the rail would render and never change, and every filter assertion below would be
 * testing a screenshot rather than a screen.
 */
export function DirectoryHarness({ initial = EMPTY_FILTERS }: { initial?: DirectoryFilters }) {
  const [filters, setFilters] = useState<DirectoryFilters>(initial)
  return <ClientDirectory locale="pt" filters={filters} onFiltersChange={setFilters} />
}
