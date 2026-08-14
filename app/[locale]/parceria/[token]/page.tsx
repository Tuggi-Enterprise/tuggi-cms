import { redirect } from 'next/navigation'
import { PartnerForm } from '@/components/partner-form/PartnerForm'
import { PARTNER_FORM_LOCALE, partnerFormPath } from '@/lib/partner-form/link'

/**
 * The external partner form (#341). Public, no login: the invite token in the URL is the
 * credential (BR-B2B-026, item 2).
 *
 * The locale is pinned to `pt` by redirect, not by hope. `i18n.ts` falls back to `en` for
 * an invalid or missing locale, so `/parceria/<token>` or a link that lost its segment
 * would hand an English form to a Brazilian restaurant owner — and CNPJ and alvará are
 * Brazilian documents by definition (spec do `design`, §3.1 and §8.3). The copy therefore
 * lives only in `messages/pt.json`; `en` and `es` are unreachable here on purpose, and
 * inventing translations would be writing copy that the `design` did not write.
 */

export const metadata = {
  title: 'Cadastro de parceiro — Tuggi',
  // Not a page for search: it is a private link to one establishment.
  robots: { index: false, follow: false },
}

export default async function PartnerFormPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>
}) {
  const { locale, token } = await params

  if (locale !== PARTNER_FORM_LOCALE) {
    redirect(partnerFormPath(token))
  }

  return <PartnerForm token={token} />
}
