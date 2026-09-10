/**
 * Mount harness for the push composer (#marketing-correcoes).
 *
 * The provider stack is `app/[locale]/layout.tsx`'s, narrowed to the namespaces this screen
 * reads. Scoped rather than the whole message tree for the reason `helpers.tsx` already gives:
 * next-intl renders the KEY NAME for a namespace it does not have, so a test asserting there is
 * no English in the DOM would pass against the literal `Pages.Notifications.title`.
 *
 * `NotificationManager` reaches four places over the network, and every one is intercepted by
 * `page.route` in the specs: `/api/auth/check` (the role that decides whether the send button
 * renders at all), `rest/v1/rpc/estimate_notification_audience`, `rest/v1/subscription_tiers`
 * and the Edge Function itself.
 */

import { NextIntlClientProvider } from 'next-intl'
import ptMessages from '@/messages/pt.json'
import enMessages from '@/messages/en.json'
import { NotificationManager } from '@/components/marketing/notifications/NotificationManager'
import { NotificationHistory } from '@/components/marketing/notifications/NotificationHistory'

const trees: Record<string, any> = { pt: ptMessages, en: enMessages }

export function PushComposerHarness({ locale = 'pt' }: { locale?: 'pt' | 'en' }) {
  const messages = trees[locale]
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={{
        Pages: {
          Notifications: messages.Pages.Notifications,
          Marketing: { Audience: messages.Pages.Marketing.Audience },
        },
        Common: messages.Common,
      }}
    >
      <NotificationManager />
    </NextIntlClientProvider>
  )
}

/** The history tab on its own — it is what the queue and the counters live in. */
export function PushHistoryHarness({ locale = 'pt' }: { locale?: 'pt' | 'en' }) {
  const messages = trees[locale]
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={{
        Pages: {
          Notifications: messages.Pages.Notifications,
          Marketing: { Audience: messages.Pages.Marketing.Audience },
        },
        Common: messages.Common,
      }}
    >
      <NotificationHistory />
    </NextIntlClientProvider>
  )
}
