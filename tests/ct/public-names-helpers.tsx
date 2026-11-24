/**
 * #1144 — the moderation of public names, in the frame of an admin page (`cms-width`, the same
 * padding), with the Portuguese messages the curator reads. Components only: the runner refuses to
 * mount from a module that also exports data (fixtures live in `public-names-fixtures.ts`).
 */

import { NextIntlClientProvider } from 'next-intl'
import ptMessages from '@/messages/pt.json'
import { PublicNamesPageContent } from '@/components/admin/public-names/PublicNamesPageContent'
import { PublicIdentityModeration } from '@/components/admin/PublicIdentityModeration'

export function PublicNamesHarness() {
  return (
    <NextIntlClientProvider
      locale="pt"
      timeZone="America/Sao_Paulo"
      messages={{ Pages: { PublicNames: ptMessages.Pages.PublicNames, AppUsers: ptMessages.Pages.AppUsers } }}
    >
      <div className="cms-width min-h-screen bg-gray-50">
        <PublicNamesPageContent />
      </div>
    </NextIntlClientProvider>
  )
}

/** The block of the account record, in the width of one column of the drawer overview. */
export function PublicIdentityHarness({ userId }: { userId: string }) {
  return (
    <NextIntlClientProvider
      locale="pt"
      timeZone="America/Sao_Paulo"
      messages={{ Pages: { AppUsers: { public_identity: ptMessages.Pages.AppUsers.public_identity } } }}
    >
      <div className="min-h-screen bg-white p-6">
        <div className="max-w-xl">
          <PublicIdentityModeration userId={userId} />
        </div>
      </div>
    </NextIntlClientProvider>
  )
}
