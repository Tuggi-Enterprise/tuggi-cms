/**
 * The i18n frame the weekly push screen (#1047) needs to mount, in a module of components only
 * (the CT runner refuses to mount a component declared in the spec). The namespaces are named on
 * purpose: next-intl prints the key path when one is missing, and the whole `pt.json` would let a
 * test pass against `Pages.WeeklyPush.x`.
 */

import { NextIntlClientProvider } from 'next-intl'
import ptMessages from '@/messages/pt.json'
import { WeeklyPushPageContent } from '@/components/admin/weekly-push/WeeklyPushPageContent'

export function WeeklyPushHarness() {
  return (
    <NextIntlClientProvider
      locale="pt"
      timeZone="America/Sao_Paulo"
      messages={{
        Pages: {
          WeeklyPush: ptMessages.Pages.WeeklyPush,
          Marketing: { Audience: { language: ptMessages.Pages.Marketing.Audience.language } },
          Notifications: { preview: ptMessages.Pages.Notifications.preview },
        },
        Common: { actions: ptMessages.Common.actions },
      }}>
      <WeeklyPushPageContent />
    </NextIntlClientProvider>
  )
}
