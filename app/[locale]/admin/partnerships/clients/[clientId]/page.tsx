import { redirect } from 'next/navigation'
import { CLIENT_DIRECTORY_PATH } from '@/lib/clients/directory-filter'

/**
 * The standalone pipeline screen is gone (#875): the five bands are the `partnership` tab of the
 * client record, the same `PartnershipDetail`. This address only forwards the links already out
 * there — e-mails, bookmarks — to the record.
 */
export default async function PartnershipDetailRedirect({
  params,
}: {
  params: Promise<{ locale: string; clientId: string }>
}) {
  const { locale, clientId } = await params
  redirect(`/${locale}${CLIENT_DIRECTORY_PATH}?${new URLSearchParams({ clientId, tab: 'partnership' }).toString()}`)
}
