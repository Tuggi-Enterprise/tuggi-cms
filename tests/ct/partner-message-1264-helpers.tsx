/**
 * Mount harness for the partner message tab (#1264). The provider carries the namespaces the panel
 * reads, so a missing key renders its name and fails the assertions instead of passing silently.
 */

import { NextIntlClientProvider } from 'next-intl'
import ptMessages from '@/messages/pt.json'
import { PartnerMessagePanel } from '@/components/marketing/notifications/PartnerMessagePanel'

export function PartnerMessageHarness() {
  return (
    <NextIntlClientProvider
      locale="pt"
      timeZone="America/Sao_Paulo"
      messages={{
        PartnerMessages: ptMessages.PartnerMessages,
        Pages: { Marketing: { Audience: ptMessages.Pages.Marketing.Audience } },
      }}
    >
      <div className="p-4">
        <PartnerMessagePanel />
      </div>
    </NextIntlClientProvider>
  )
}
