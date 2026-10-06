import { NextIntlClientProvider } from 'next-intl'
import ptMessages from '@/messages/pt.json'
import { ValidationReview } from '@/components/admin/partner-proposals/ValidationReview'
import { RETURN_TO_PARAM, parseReturnTo } from '@/lib/navigation/return-to'

/**
 * Validation of one Portal Locais submission (#812, BR-B2B-049, BR-B2B-048, BR-B2B-053) — spec
 * `docs/design/spec-validacao-portal-locais-2026-10.md`. The board's "Conferir o cadastro"
 * lands here (`lib/clients/record-href.ts`, target `validation`).
 *
 * `PartnerForm` travels along for the category labels — one copy of them, the one the
 * presential review reads too — and `Clients` for the acceptance and subscription cards, which are
 * the client record's own (`PortalRecord`, #870).
 */
export default async function PortalValidationPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; submissionId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { locale, submissionId } = await params
  // The board this screen was opened from, filters and all (#870) — the `X` goes back to it.
  const raw = (await searchParams)[RETURN_TO_PARAM]
  const returnTo = parseReturnTo(Array.isArray(raw) ? raw[0] : raw)

  return (
    <NextIntlClientProvider
      locale="pt"
      messages={{
        PartnerValidation: ptMessages.PartnerValidation,
        PartnerForm: ptMessages.PartnerForm,
        Clients: ptMessages.Clients,
      }}
    >
      <ValidationReview locale={locale} submissionId={submissionId} returnTo={returnTo} />
    </NextIntlClientProvider>
  )
}
