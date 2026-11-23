/**
 * Mount wrapper of `venue-picker-1242.spec.tsx`. A component under test cannot be defined in the
 * spec file itself (Playwright CT registers imports, not locals).
 */

import { useState } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import ptMessages from '@/messages/pt.json'
import { VenuePicker, type VenueRef } from '@/components/entity-management/VenuePicker'

export function VenuePickerHost() {
  const [value, setValue] = useState<VenueRef | null>(null)
  return (
    <NextIntlClientProvider locale="pt" messages={{ Modals: ptMessages.Modals }}>
      <VenuePicker value={value} onChange={setValue} />
      <output data-testid="picked">{value ? `${value.kind}:${value.id}` : ''}</output>
    </NextIntlClientProvider>
  )
}
