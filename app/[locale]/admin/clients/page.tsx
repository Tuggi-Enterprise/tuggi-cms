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
  // The portal validation opens in a drawer over this list (#870); the messages its page used.
  const validationMessages = {
    PartnerValidation: ptJson.PartnerValidation,
    PartnerForm: ptJson.PartnerForm,
    Clients: ptJson.Clients,
  }
  return <AdminClientsPageContent ptMessages={ptMessages} validationMessages={validationMessages} />
}
