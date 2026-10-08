'use client'

/**
 * The messages the client record needs on top of the locale's, in one place for every screen that
 * opens `ClientEditorModal`: the Portuguese-only `Partnerships` and `Clients.directory/board`
 * overlay (#875), and the pt namespaces of the Parceria tab (`PartnerValidation`, `PartnerForm`,
 * `PartnerProposals`, #890).
 *
 * `/admin/clients` had them inline and the contract page (`ContractManager`) opened the record
 * without them, so clicking Parceria there threw `usePtOverlay outside PtOverlayProvider` and took
 * the page down (#911). Both screens wrap the record here now; the server side is
 * `lib/i18n/client-record-messages.ts`.
 */

import type { ReactNode } from 'react'
import { NextIntlClientProvider, useLocale, useMessages, type AbstractIntlMessages } from 'next-intl'
import { PtOverlayProvider, type PtOverlay } from '@/lib/i18n/pt-overlay'

export interface ClientRecordMessages {
  ptMessages: PtOverlay
  validationMessages: Record<'PartnerValidation' | 'PartnerForm' | 'PartnerProposals', AbstractIntlMessages>
}

export function ClientRecordProviders({ messages, children }: { messages: ClientRecordMessages; children: ReactNode }) {
  const locale = useLocale()
  const current = useMessages()
  return (
    <NextIntlClientProvider locale={locale} messages={{ ...current, ...messages.validationMessages }}>
      <PtOverlayProvider value={messages.ptMessages}>{children}</PtOverlayProvider>
    </NextIntlClientProvider>
  )
}
