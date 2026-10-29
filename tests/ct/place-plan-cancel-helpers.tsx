/**
 * Harness for the Locais tab of the client record (#1054): the providers `ClientEditorModal` hands
 * it (the record cache and the Portuguese overlay), the tab itself, and the portal records and the
 * client row the modal would pass down.
 */

import { useState } from 'react'
import { RecordCacheProvider, type RecordRead } from '@/lib/hooks/use-record-cache'
import { PtOverlayProvider } from '@/lib/i18n/pt-overlay'
import { PlacesTab } from '@/components/admin/clients/tabs/PlacesTab'
import type { ClientEditorTabProps } from '@/components/admin/clients/tabs/ProfileTab'
import type { ClientPortalRecord } from '@/lib/services/portal-submission-review-service'
import ptMessages from '@/messages/pt.json'

const NOOP = () => {}

export function PlacesHarness({
  clientId,
  client,
  records,
}: {
  clientId: string
  client: Record<string, unknown> | null
  records: ClientPortalRecord[]
}) {
  const [cache] = useState(() => new Map<string, Promise<RecordRead>>())
  const props = { client, edited: {}, updateField: NOOP, canEdit: true, clientId } as unknown as ClientEditorTabProps
  return (
    <PtOverlayProvider
      value={{ Partnerships: ptMessages.Partnerships, Clients: { directory: ptMessages.Clients.directory, board: ptMessages.Clients.board } }}
    >
      <RecordCacheProvider cache={cache}>
        <PlacesTab {...props} onOpenPipeline={NOOP} portalRecords={records} />
      </RecordCacheProvider>
    </PtOverlayProvider>
  )
}
