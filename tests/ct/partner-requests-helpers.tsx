/**
 * #1139 — the queue band of app partner requests, in the frame of the partners board (the same
 * `cms-width` and padding), with the Portuguese messages of the esteira. Components only: the
 * runner refuses to mount from a module that also exports data (fixtures live in
 * `partner-requests-fixtures.ts`).
 */

import { NextIntlClientProvider } from 'next-intl'
import ptMessages from '@/messages/pt.json'
import { PartnerRequestsBand } from '@/components/admin/clients/board/PartnerRequests'

export function PartnerRequestsBandHarness() {
  return (
    <NextIntlClientProvider
      locale="pt"
      timeZone="America/Sao_Paulo"
      messages={{ Clients: { board: { requests: ptMessages.Clients.board.requests } } }}
    >
      <div className="cms-width min-h-screen bg-gray-50 p-4 lg:p-8">
        <PartnerRequestsBand />
      </div>
    </NextIntlClientProvider>
  )
}
