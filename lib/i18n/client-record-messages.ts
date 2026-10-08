import ptJson from '@/messages/pt.json'
import type { ClientRecordMessages } from '@/components/admin/clients/ClientRecordProviders'

/**
 * Server side of `ClientRecordProviders`: read `messages/pt.json` on the server and send the
 * browser only the namespaces the client record overlays (#875 item 5). Import it from a server
 * page only; a client import would put the whole file in the bundle again.
 */
export function clientRecordMessages(): ClientRecordMessages {
  return {
    ptMessages: {
      Partnerships: ptJson.Partnerships,
      Clients: { directory: ptJson.Clients.directory, board: ptJson.Clients.board },
    },
    validationMessages: {
      PartnerValidation: ptJson.PartnerValidation,
      PartnerForm: ptJson.PartnerForm,
      PartnerProposals: ptJson.PartnerProposals,
    },
  }
}
