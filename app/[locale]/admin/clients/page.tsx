import ptJson from '@/messages/pt.json'
import { AdminClientsPageContent } from '@/components/admin/AdminClientsPageContent'
import type { PtOverlay } from '@/lib/i18n/pt-overlay'

/**
 * A server component on purpose (#875, item 5): `messages/pt.json` is read here, and only the
 * three Portuguese-only namespaces the screen overlays travel to the browser.
 */
export default function LocalizedAdminClientsPage() {
  const ptMessages: PtOverlay = {
    Partnerships: ptJson.Partnerships,
    Clients: { directory: ptJson.Clients.directory, board: ptJson.Clients.board },
  }
  // The portal validation is a tab of the client record (#890); the pt messages it reads.
  const validationMessages = {
    PartnerValidation: ptJson.PartnerValidation,
    PartnerForm: ptJson.PartnerForm,
    PartnerProposals: ptJson.PartnerProposals,
  }
  return <AdminClientsPageContent ptMessages={ptMessages} validationMessages={validationMessages} />
}
