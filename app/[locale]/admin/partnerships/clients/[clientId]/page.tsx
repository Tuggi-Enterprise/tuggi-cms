import { NextIntlClientProvider } from 'next-intl'
import ptMessages from '@/messages/pt.json'
import { PartnershipDetail } from '@/components/admin/partnerships/PartnershipDetail'

/**
 * The pipeline of one partnership, from state 3 onwards — the identity of the row changes
 * halfway, and from the client's creation it is the client (spec §2).
 *
 * THREE NAMESPACES TRAVEL TOGETHER, and each one for a reason:
 *  · `Partnerships` — this screen's own copy, pt only, same decision as the queue;
 *  · `Modals` — `PlaceFormModal` reads `Modals.PlaceDetails`, and `Abrir o local` opens it
 *    right here (spec §6.3: it is a modal, so it comes back on its own);
 *  · `Common` — the primitives the modal borrows.
 * A missing one would print the key name inside the modal instead of a field label.
 */
export default async function PartnershipDetailPage({
  params,
}: {
  params: Promise<{ locale: string; clientId: string }>
}) {
  const { locale, clientId } = await params

  return (
    <NextIntlClientProvider
      locale="pt"
      messages={{
        Partnerships: ptMessages.Partnerships,
        Modals: ptMessages.Modals,
        Common: ptMessages.Common,
      }}
    >
      {/* The queue is behind this page, so the way back to it is drawn. The same component
          rendered as a tab of the client record gets no `backHref`: there the way out is the
          tab strip. */}
      <PartnershipDetail
        locale={locale}
        clientId={clientId}
        backHref={`/${locale}/admin/partnerships`}
      />
    </NextIntlClientProvider>
  )
}
