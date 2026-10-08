import { AdminClientsPageContent } from '@/components/admin/AdminClientsPageContent'
import { clientRecordMessages } from '@/lib/i18n/client-record-messages'

/**
 * A server component on purpose (#875, item 5): `messages/pt.json` is read here, and only the
 * Portuguese-only namespaces the screen overlays travel to the browser.
 */
export default function LocalizedAdminClientsPage() {
  return <AdminClientsPageContent recordMessages={clientRecordMessages()} />
}
