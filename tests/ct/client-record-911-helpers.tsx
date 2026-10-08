/**
 * Harness for #911: the real `ClientEditorModal` with the providers `/admin/clients` gives it, plus a
 * `SessionContextProvider` over a stub Supabase client, because Pessoas mounts `AppUsersTab`, which
 * reads the app users through `supabase.schema('core').rpc(...)`. The stub answers those two RPCs and
 * nothing else; every HTTP read is `page.route` in the spec.
 */

import type { ReactNode } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { SessionContextProvider } from '@supabase/auth-helpers-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import ptMessages from '@/messages/pt.json'
import { QueryProvider } from '@/components/providers/QueryProvider'
import { ClientEditorModal, type ClientEditorTab } from '@/components/admin/clients/ClientEditorModal'
import { ClientRecordProviders } from '@/components/admin/clients/ClientRecordProviders'
import { CouponsListAdmin } from '@/components/admin/CouponsListAdmin'
import { ContractManager } from '@/components/admin/contract/ContractManager'
import { clientRecordMessages } from '@/lib/i18n/client-record-messages'

const NOOP = () => {}

export interface AppUserRow {
  user_id: string
  full_name: string | null
  nickname: string | null
  email: string | null
  client_id?: string | null
}

function stubSupabase(linked: AppUserRow[], search: AppUserRow[]): SupabaseClient {
  return {
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: NOOP } } }),
    },
    schema: () => ({
      rpc: async (name: string) => ({ data: name === 'client_app_users' ? linked : search, error: null }),
    }),
  } as unknown as SupabaseClient
}

function Providers({ children, linked = [], search = [] }: { children: ReactNode; linked?: AppUserRow[]; search?: AppUserRow[] }) {
  return (
    <NextIntlClientProvider locale="pt" messages={ptMessages}>
      <SessionContextProvider supabaseClient={stubSupabase(linked, search)}>
        <QueryProvider>{children}</QueryProvider>
      </SessionContextProvider>
    </NextIntlClientProvider>
  )
}

/** What `AdminClientsPageContent` mounts for `?clientId=<id>&tab=<tab>`, or `?mode=new`. */
export function ClientRecordModal({
  clientId,
  initialTab = 'profile',
  linkedAppUsers,
  searchAppUsers,
}: {
  clientId?: string
  initialTab?: ClientEditorTab
  linkedAppUsers?: AppUserRow[]
  searchAppUsers?: AppUserRow[]
}) {
  return (
    <Providers linked={linkedAppUsers} search={searchAppUsers}>
      <ClientRecordProviders messages={clientRecordMessages()}>
        <ClientEditorModal
          clientId={clientId}
          isOpen
          mode={clientId ? 'edit' : 'new'}
          initialTab={initialTab}
          onClose={NOOP}
        />
      </ClientRecordProviders>
    </Providers>
  )
}

/** The global coupons page's list (`/admin/coupons`): no owner. */
export function GlobalCouponsList() {
  return (
    <Providers>
      <CouponsListAdmin onCreateNew={NOOP} />
    </Providers>
  )
}

/** The contract page, which opens the record from its checklist (the #911 crash on Parceria). */
export function ContractPage({ clientId }: { clientId: string }) {
  return (
    <Providers>
      <ContractManager clientId={clientId} recordMessages={clientRecordMessages()} />
    </Providers>
  )
}
