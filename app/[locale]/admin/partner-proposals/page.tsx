import { NextIntlClientProvider } from 'next-intl'
import ptMessages from '@/messages/pt.json'
import { PartnerProposalsPageContent } from '@/components/admin/partner-proposals/PartnerProposalsPageContent'

/**
 * One route, two tabs (`Propostas` | `Convites`). They are the same queue at two moments and
 * the operator switches constantly, so two menu entries would send them back to the menu on
 * every switch (DS-LAYOUT-003).
 *
 * WHY THE PROVIDER IS HERE. The copy of these screens lives only in `messages/pt.json`
 * (spec §2): they are operated by the Tuggi commercial team, and copying the Portuguese into
 * `en.json`/`es.json` would create a second source of the same text. But an ABSENT key in
 * next-intl renders THE KEY NAME on screen, so "only pt" and "/en/ must not show
 * `PartnerProposals.title`" are both true only if the pt messages are handed to these
 * children explicitly. That is what this provider does, for these two namespaces and nothing
 * else — the rest of the CMS keeps the operator's locale.
 */
export default async function PartnerProposalsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params

  return (
    <NextIntlClientProvider
      locale="pt"
      messages={{
        PartnerProposals: ptMessages.PartnerProposals,
        PartnerForm: ptMessages.PartnerForm,
      }}
    >
      <PartnerProposalsPageContent locale={locale} />
    </NextIntlClientProvider>
  )
}
