/**
 * Mount wrapper of `place-form-modal-partner.spec.tsx` — a component under test cannot be defined
 * in the spec file itself (Playwright CT registers imports, not locals).
 */

import { NextIntlClientProvider } from 'next-intl'
import ptMessages from '@/messages/pt.json'
import { QueryProvider } from '@/components/providers/QueryProvider'
import { PlaceFormModal } from '@/components/place-management/PlaceFormModal'

const NOOP = () => {}

export function PlaceFormHost({ placeId }: { placeId: string }) {
  return (
    <NextIntlClientProvider
      locale="pt"
      messages={{ Modals: ptMessages.Modals, Common: ptMessages.Common, Partnerships: ptMessages.Partnerships }}
    >
      <QueryProvider>
        <PlaceFormModal placeId={placeId} isOpen onClose={NOOP} />
      </QueryProvider>
    </NextIntlClientProvider>
  )
}
