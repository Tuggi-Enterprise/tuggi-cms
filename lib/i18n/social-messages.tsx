import type { ReactNode } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import ptJson from '@/messages/pt.json'
import { SOCIAL_TIME_ZONE } from '@/lib/social/time'

/**
 * The social analytics (#1059) are Portuguese only: `Pages.Social` lives in `messages/pt.json` alone,
 * because its reader is the operator (copy, "Onde vive"). Under `/en/` and `/es/` a pt-only namespace
 * would print key names, so the server page reads the file here and sends the browser only the
 * namespaces the screen uses, in `pt` (the #341 pattern). Import it from a server page only: a client
 * import would put the whole file in the bundle.
 */
export function SocialMessagesProvider({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider
      locale="pt"
      timeZone={SOCIAL_TIME_ZONE}
      messages={{
        Pages: { Social: ptJson.Pages.Social },
        Common: { actions: ptJson.Common.actions, status: ptJson.Common.status },
      }}
    >
      {children}
    </NextIntlClientProvider>
  )
}
