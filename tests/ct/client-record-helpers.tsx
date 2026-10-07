/**
 * Harness for the client record's tabs (#875, #871): the provider `ClientEditorModal` wraps its
 * tabs in, with the tab strip played by buttons. The modal itself is not mounted — it needs the
 * Supabase session and the router — but the cache, the tabs and the hook are the real ones.
 */

import { useState } from 'react'
import { RecordCacheProvider, type RecordRead } from '@/lib/hooks/use-record-cache'
import { PartnershipDetail } from '@/components/admin/partnerships/PartnershipDetail'
import type { ClientEditorTabProps } from '@/components/admin/clients/tabs/ProfileTab'
import { ContractTab } from '@/components/admin/clients/tabs/ContractTab'
import { FiscalPaymentsTab } from '@/components/admin/clients/tabs/FiscalPaymentsTab'

export type HarnessTab = 'partnership' | 'contract' | 'fiscal'

const NOOP = () => {}

const tabProps = (clientId: string): ClientEditorTabProps =>
  ({ client: null, edited: {}, updateField: NOOP, canEdit: true, clientId }) as unknown as ClientEditorTabProps

export function RecordHarness({ clientId, initial = 'partnership' }: { clientId: string; initial?: HarnessTab }) {
  const [tab, setTab] = useState<HarnessTab>(initial)
  const [cache] = useState(() => new Map<string, Promise<RecordRead>>())
  const props = tabProps(clientId)

  return (
    <RecordCacheProvider cache={cache}>
      <nav>
        {(['partnership', 'contract', 'fiscal'] as const).map((name) => (
          <button key={name} type="button" onClick={() => setTab(name)}>
            {`tab-${name}`}
          </button>
        ))}
        {/* What a save or an approval does in the modal. */}
        <button type="button" onClick={() => cache.clear()}>
          drop-cache
        </button>
      </nav>
      {tab === 'partnership' && <PartnershipDetail locale="pt" clientId={clientId} onOpenTab={NOOP} />}
      {tab === 'contract' && <ContractTab {...props} />}
      {tab === 'fiscal' && <FiscalPaymentsTab {...props} />}
    </RecordCacheProvider>
  )
}

/** The tab mounted with no provider around it — the fallback is a plain fetch. */
export function BareContractTab({ clientId }: { clientId: string }) {
  return <ContractTab {...tabProps(clientId)} />
}

export function BareFiscalTab({ clientId }: { clientId: string }) {
  return <FiscalPaymentsTab {...tabProps(clientId)} />
}
