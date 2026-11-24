/**
 * Mount wrappers of `partner-brand-1257.spec.tsx`. A component under test cannot be defined in the
 * spec file itself (Playwright CT registers imports, not locals).
 */

import { NextIntlClientProvider } from 'next-intl'
import ptMessages from '@/messages/pt.json'
import { PartnerBrandPageContent } from '@/components/admin/partner-brand/PartnerBrandPageContent'
import { BrandTab } from '@/components/admin/clients/tabs/BrandTab'

const messages = { PartnerBrand: ptMessages.PartnerBrand }

export function PartnerBrandPageHost() {
  return (
    <NextIntlClientProvider locale="pt" messages={messages} timeZone="America/Sao_Paulo">
      <PartnerBrandPageContent />
    </NextIntlClientProvider>
  )
}

export function BrandTabHost({ clientId }: { clientId: string }) {
  return (
    <NextIntlClientProvider locale="pt" messages={messages} timeZone="America/Sao_Paulo">
      <BrandTab client={null} edited={{}} updateField={() => {}} canEdit clientId={clientId} />
    </NextIntlClientProvider>
  )
}
