/**
 * The i18n frame `/admin/trip-reminder` (#1233) mounts in, in a module of components only (the CT
 * runner refuses to mount a component declared in the spec). Same namespace the page provides:
 * `TripReminder`, in Portuguese.
 */

import { NextIntlClientProvider } from 'next-intl'
import ptMessages from '@/messages/pt.json'
import { TripReminderPageContent } from '@/components/admin/trip-reminder/TripReminderPageContent'

export function TripReminderHarness() {
  return (
    <NextIntlClientProvider locale="pt" timeZone="America/Sao_Paulo" messages={{ TripReminder: ptMessages.TripReminder }}>
      <TripReminderPageContent />
    </NextIntlClientProvider>
  )
}
