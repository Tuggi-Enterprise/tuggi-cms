import { redirect } from 'next/navigation'
import { PartnerForm } from '@/components/partner-form/PartnerForm'
import { PARTNER_FORM_LOCALE, partnerFormPath } from '@/lib/partner-form/link'

/**
 * The external partner form (#341). Public, no login and — since 2026-08-16 — no token: one
 * address for every partner, and the CNPJ is what keeps an establishment from being
 * registered twice.
 *
 * The locale is pinned to `pt` by redirect, not by hope. `i18n.ts` falls back to `en` for an
 * invalid or missing locale, so `/en/parceria` would hand an English form to a Brazilian
 * restaurant owner — and the CNPJ is a Brazilian document by definition (spec do `design`,
 * §3.1 and §8.3). The copy therefore lives only in `messages/pt.json`; `en` and `es` are
 * unreachable here on purpose, and inventing translations would be writing copy that the
 * `design` did not write.
 */

export const metadata = {
  title: 'Cadastro de parceiro — Tuggi',
  // The link is sent by the team to establishments whose papers were already checked in
  // person; it is not a page we want strangers to find in a search result.
  robots: { index: false, follow: false },
}

export default async function PartnerFormPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params

  if (locale !== PARTNER_FORM_LOCALE) {
    redirect(partnerFormPath())
  }

  return <PartnerForm />
}
