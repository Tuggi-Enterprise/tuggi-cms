/**
 * Hosts for `side-drawer-flush-right.spec.tsx`. Playwright CT only mounts components imported from
 * a file, so the providers each drawer needs in the app are put around it here.
 */

import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { POIDetailsModal } from '@/components/poi-management/POIDetailsModal'

const NOOP = () => {}

/** `/pois` gets its QueryClient from the app's providers. */
export function PoiDrawerHost() {
  const [client] = useState(() => new QueryClient())
  return (
    <QueryClientProvider client={client}>
      <POIDetailsModal poi={null} isOpen mode="create" onClose={NOOP} onUpdate={NOOP} />
    </QueryClientProvider>
  )
}
