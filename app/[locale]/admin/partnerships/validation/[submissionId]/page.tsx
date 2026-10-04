import { NextIntlClientProvider } from 'next-intl'
import ptMessages from '@/messages/pt.json'
import { ValidationReview } from '@/components/admin/partner-proposals/ValidationReview'

/**
 * Validation of one Portal Locais submission (#812, BR-B2B-049, BR-B2B-048, BR-B2B-053) — spec
 * `docs/design/spec-validacao-portal-locais-2026-10.md`. The board's "Conferir o cadastro"
 * lands here (`lib/clients/record-href.ts`, target `validation`).
 *
 * `PartnerForm` travels along for the category labels — one copy of them, the one the
 * presential review reads too.
 */
export default async function PortalValidationPage({
  params,
}: {
  params: Promise<{ locale: string; submissionId: string }>
}) {
  const { locale, submissionId } = await params

  return (
    <NextIntlClientProvider
      locale="pt"
      messages={{ PartnerValidation: ptMessages.PartnerValidation, PartnerForm: ptMessages.PartnerForm }}
    >
      <ValidationReview locale={locale} submissionId={submissionId} />
    </NextIntlClientProvider>
  )
}
