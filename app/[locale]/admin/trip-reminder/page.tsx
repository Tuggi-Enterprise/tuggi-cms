import { NextIntlClientProvider } from 'next-intl'
import ptMessages from '@/messages/pt.json'
import { TripReminderPageContent } from '@/components/admin/trip-reminder/TripReminderPageContent'

/**
 * /admin/trip-reminder (#1233, épico #1226): the planned trips panel, the switches and numbers of
 * the trip reminder, the provider secrets and the send log. Internal screen in Portuguese only: the
 * `TripReminder` namespace lives in `pt.json` alone, so the provider pins `pt` and names it (an
 * absent namespace would print the key path in `/en/` and `/es/`).
 *
 * Page gate: `resolveAccess` (proxy, `/admin/*` is admin only). API gate: `withAuth` admin.
 */
export default function TripReminderPage() {
  return (
    <NextIntlClientProvider
      locale="pt"
      timeZone="America/Sao_Paulo"
      messages={{ TripReminder: ptMessages.TripReminder }}>
      <TripReminderPageContent />
    </NextIntlClientProvider>
  )
}
