/**
 * The mount frame of the newsletter screen.
 *
 * A COMPONENT MOUNT AND NOT A PAGE NAVIGATION, for the reason `playwright-ct.config.ts` already
 * records: `proxy.ts` checks the session on the Next SERVER, where `page.route` — a browser hook
 * — cannot reach, and this suite has no CMS credential. Mounting `NewsletterManager` is the same
 * component, the same CSS and the same DOM the operator gets.
 *
 * IT HOLDS THE WRAPPER AND NOTHING ELSE, like `finance-helpers.tsx`: the runner refuses to mount
 * a component that shares a module with the test's own helpers. The network fixtures live in
 * `marketing-newsletter-fixtures.ts`.
 *
 * The provider is scoped to the namespaces the real page hands down. next-intl renders the KEY
 * NAME for a namespace it does not have, so an assertion over `Pages.Marketing.Audience.title`
 * would pass against the literal string `Pages.Marketing.Audience.title` — naming the namespaces
 * makes a missing one a failure instead of a coincidence.
 */

import { NextIntlClientProvider } from 'next-intl'
import ptMessages from '@/messages/pt.json'

export function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <NextIntlClientProvider
      locale="pt"
      messages={{ Pages: { Marketing: ptMessages.Pages.Marketing }, Common: ptMessages.Common }}
    >
      {children}
    </NextIntlClientProvider>
  )
}
