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
import { ClientBoard } from '@/components/admin/clients/ClientBoard'
import { useClientDirectory } from '@/lib/hooks/use-client-directory'
import { EMPTY_FILTERS, type DirectoryFilters } from '@/lib/clients/directory-filter'

export function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <NextIntlClientProvider
      locale="pt"
      messages={{
        Partnerships: ptMessages.Partnerships,
        // The conference screen mounts here too, and next-intl renders the KEY NAME when a
        // namespace is absent — an `axe` scan over `PartnerProposals.review.back` proves
        // nothing about the copy the operator reads.
        PartnerProposals: ptMessages.PartnerProposals,
        PartnerForm: ptMessages.PartnerForm,
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
 * `ClientDirectory` and `ClientBoard` are CONTROLLED components: the filters are the URL's and
 * the ROWS are the host's. There is no Next app router in a component mount, so this harness
 * plays the host — the filters in `useState`, the rows from `useClientDirectory`, exactly as
 * `AdminClientsPageContent` hands them down.
 *
 * The rows come through the HOOK and not through props on purpose: it is the one read behind
 * both views, so mounting it here is what keeps `page.route('**\/api/admin/clients/directory')`
 * the way these tests state their fixtures — and what proves the loading, empty and error
 * states are the hook's, not a prop somebody remembered to pass.
 */
function useHarnessFilters(initial: DirectoryFilters) {
  return useState<DirectoryFilters>(initial)
}

export function DirectoryHarness({ initial = EMPTY_FILTERS }: { initial?: DirectoryFilters }) {
  const [filters, setFilters] = useHarnessFilters(initial)
  const directory = useClientDirectory()
  return (
    <ClientDirectory
      locale="pt"
      filters={filters}
      onFiltersChange={setFilters}
      rows={directory.rows}
      truncated={directory.truncated}
      loading={directory.loading}
      failed={directory.failed}
    />
  )
}

export function BoardHarness({ initial = EMPTY_FILTERS }: { initial?: DirectoryFilters }) {
  const [filters, setFilters] = useHarnessFilters(initial)
  const directory = useClientDirectory()
  return (
    <ClientBoard
      locale="pt"
      filters={filters}
      onFiltersChange={setFilters}
      rows={directory.rows}
      truncated={directory.truncated}
      loading={directory.loading}
      failed={directory.failed}
      onAct={() => {}}
    />
  )
}
