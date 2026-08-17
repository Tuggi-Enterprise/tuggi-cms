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

import { NextIntlClientProvider } from 'next-intl'
import ptMessages from '@/messages/pt.json'
import { QueryProvider } from '@/components/providers/QueryProvider'

export function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <NextIntlClientProvider
      locale="pt"
      messages={{ Partnerships: ptMessages.Partnerships, Modals: ptMessages.Modals, Common: ptMessages.Common }}
    >
      <QueryProvider>{children}</QueryProvider>
    </NextIntlClientProvider>
  )
}
