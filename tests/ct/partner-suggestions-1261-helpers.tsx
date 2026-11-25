/**
 * Mount wrappers of `partner-suggestions-1261.spec.tsx`. A component under test cannot be defined in
 * the spec file itself (Playwright CT registers imports, not locals).
 */

import { NextIntlClientProvider } from 'next-intl'
import ptMessages from '@/messages/pt.json'
import { PartnerBrandPageContent } from '@/components/admin/partner-brand/PartnerBrandPageContent'
import { BrandTab } from '@/components/admin/clients/tabs/BrandTab'
import { RouteReviewPageContent } from '@/components/admin/route-review/RouteReviewPageContent'

// `RevisionMap` reads `process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, which the CT Vite config does
// not define; without a `process` the read throws before React renders.
const g = globalThis as unknown as { process?: { env: Record<string, string | undefined> } }
g.process ??= { env: {} }

const messages = { PartnerBrand: ptMessages.PartnerBrand, Pages: { RouteReview: ptMessages.Pages.RouteReview } }

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

export function RouteReviewHost() {
  return (
    <NextIntlClientProvider locale="pt" messages={messages} timeZone="America/Sao_Paulo">
      <RouteReviewPageContent />
    </NextIntlClientProvider>
  )
}
