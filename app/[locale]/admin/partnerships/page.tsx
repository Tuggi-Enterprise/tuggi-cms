import { NextIntlClientProvider } from 'next-intl'
import ptMessages from '@/messages/pt.json'
import { PartnershipsQueue } from '@/components/admin/partnerships/PartnershipsQueue'

/**
 * The pipeline queue. It replaces `/admin/partner-proposals` (the list), which is gone: the
 * queue absorbs it, and a screen with no route is an orphan (CLAUDE.md §6).
 *
 * WHY THE PROVIDER IS HERE. The copy of the partnership surfaces lives only in
 * `messages/pt.json` (spec §2): they are operated by the Tuggi commercial team, and copying
 * the Portuguese into `en.json`/`es.json` would create a second source of the same text. But
 * an ABSENT key in next-intl renders THE KEY NAME on screen, so "only pt" and "`/en/` must not
 * show `Partnerships.title`" are both true only if the pt messages are handed to these
 * children explicitly. That is what this provider does, for this namespace and nothing else —
 * the rest of the CMS keeps the operator's locale.
 */
export default async function PartnershipsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params

  return (
    <NextIntlClientProvider locale="pt" messages={{ Partnerships: ptMessages.Partnerships }}>
      <PartnershipsQueue locale={locale} />
    </NextIntlClientProvider>
  )
}
