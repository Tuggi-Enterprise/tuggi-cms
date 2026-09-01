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
import { NextIntlClientProvider, useTranslations } from 'next-intl'
import { CheckCircle, Play, ShieldCheck, Timer, Users, Zap } from 'lucide-react'
import ptMessages from '@/messages/pt.json'
import { QueryProvider } from '@/components/providers/QueryProvider'
import { AppUserLink } from '@/components/dashboard/AppUserLink'
import { ClientDirectory } from '@/components/admin/clients/ClientDirectory'
import { ClientBoard } from '@/components/admin/clients/ClientBoard'
import { StatCard } from '@/components/ui/StatCard'
import { formatDuration } from '@/lib/format/duration'
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

/**
 * The provider stack the DASHBOARD screens get — `app/[locale]/layout.tsx` hands every
 * namespace at once, so a component mounted here sees the same message tree the operator's
 * browser does.
 *
 * Scoped rather than `messages={ptMessages}` for one reason: next-intl renders the KEY NAME
 * for a namespace it does not have, and a test asserting on `Pages.AppUsers.modal.hours`
 * would pass against the literal string `Pages.AppUsers.modal.hours`. Naming the three
 * namespaces makes the absence of one a failure instead of a coincidence.
 */
export function DashboardWrapper({ children }: { children: React.ReactNode }) {
  return (
    <NextIntlClientProvider
      locale="pt"
      messages={{
        Pages: { AppUsers: ptMessages.Pages.AppUsers, Dashboard: ptMessages.Pages.Dashboard },
        Common: ptMessages.Common,
      }}
    >
      <QueryProvider>{children}</QueryProvider>
    </NextIntlClientProvider>
  )
}

/**
 * The trigger as every one of the six surfaces mounts it: an identity row and nothing else.
 *
 * `AppUserLink` owns the modal, so this harness is the whole host. That is the point of the
 * component — there is no per-surface state to reproduce, which is why proving the door works
 * once proves it works from all six (the static suite in `tests/api/app-user-identity.test.ts`
 * is what proves all six use it).
 */
export function AppUserLinkHarness({
  nickname = 'hoppy-otter',
  userId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
}: {
  nickname?: string | null
  userId?: string
}) {
  return (
    <div>
      <button type="button">antes</button>
      <AppUserLink user={{ user_id: userId, nickname }} />
      <button type="button">depois</button>
    </div>
  )
}

/**
 * THE SIX KPI CARDS OF THE DASHBOARD, as `app/[locale]/dashboard/page.tsx` mounts them — same
 * grid classes, same page padding, same `<a>` wrapper each card sits inside, same `StatCard`
 * props. It exists to be MEASURED (#658): the row's complaint was geometric — the icon owning a
 * line of its own, and the one card with a `subtitle` standing taller than its five neighbours —
 * and geometry is not something a source scan can answer.
 *
 * The wrapper is a plain `<a>` and not `next/link` for the only reason that matters here: with
 * no app router in a component mount `Link` cannot render, and what is being measured is the
 * grid item's height — an `<a>` with no class is the exact element `Link` produces.
 *
 * The amounts are the ones on the operator's screen when the card was opened: 2 411 minutes
 * consumed, 1 309 of them paid and 1 102 granted (BR-MONETIZACAO-047). They are here so the
 * measurement is taken against the longest real string, never a placeholder that happens to fit.
 *
 * `stress` swaps them for the biggest numbers the row is claimed to survive — six digits of
 * count and four digits of hours — because the number's size now buys a ceiling, and a ceiling
 * nobody measures is a guess. Today's screen is nowhere near it; the row is meant to reach it
 * without the alignment moving.
 */
export function DashboardKpiRowHarness({
  split = true,
  stress = false,
}: {
  split?: boolean
  stress?: boolean
}) {
  const t = useTranslations('Pages.Dashboard')
  const n = (today: number, ceiling: number) => (stress ? ceiling : today)
  const consumed = n(2411, 1234 * 60 + 56)

  return (
    <div className="p-4 lg:p-6">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <a data-testid="kpi-approved">
          <StatCard size="compact" icon={CheckCircle} title={t('labels.approved')} value={n(1234, 123456)} color="#10B981" />
        </a>
        <a data-testid="kpi-users">
          <StatCard size="compact" icon={Users} title={t('labels.users')} value={n(900, 123456)} color="#8B5CF6" />
        </a>
        <a data-testid="kpi-active">
          <StatCard size="compact" icon={Zap} title={t('labels.active_30d')} value={n(318, 123456)} color="#10B981" />
        </a>
        <a data-testid="kpi-paid">
          <StatCard size="compact" icon={ShieldCheck} title={t('labels.paid_access')} value={n(412, 123456)} color="#FF6F00" />
        </a>
        <a data-testid="kpi-trips">
          <StatCard size="compact" icon={Play} title={t('labels.total_trips')} value={n(5871, 123456)} color="#00A8E8" />
        </a>
        <a data-testid="kpi-consumed">
          <StatCard
            size="compact"
            icon={Timer}
            title={t('labels.consumed_total')}
            value={formatDuration(consumed)}
            subtitle={
              split
                ? t('labels.consumption_split', {
                    paid: formatDuration(n(1309, 700 * 60)),
                    granted: formatDuration(n(1102, 534 * 60 + 56)),
                  })
                : undefined
            }
            color="#FF6F00"
          />
        </a>
      </div>
    </div>
  )
}
