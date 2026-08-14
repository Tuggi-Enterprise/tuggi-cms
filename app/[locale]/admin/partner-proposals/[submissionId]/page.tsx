import { NextIntlClientProvider } from 'next-intl'
import ptMessages from '@/messages/pt.json'
import { ProposalReview } from '@/components/admin/partner-proposals/ProposalReview'

/**
 * Conference and promotion of one proposal — BR-B2B-026, item 4.
 *
 * `PartnerForm` travels alongside `PartnerProposals` because the review reads the FIELD
 * LABELS from it: the reviewer has to see the question exactly as the partner saw it, and a
 * second copy of those labels is the defect that duplication produces. Same reason as the
 * provider on the list page — an absent key would print the key name in `/en/` and `/es/`.
 */
export default async function PartnerProposalReviewPage({
  params,
}: {
  params: Promise<{ locale: string; submissionId: string }>
}) {
  const { locale, submissionId } = await params

  return (
    <NextIntlClientProvider
      locale="pt"
      messages={{
        PartnerProposals: ptMessages.PartnerProposals,
        PartnerForm: ptMessages.PartnerForm,
      }}
    >
      <ProposalReview locale={locale} submissionId={submissionId} />
    </NextIntlClientProvider>
  )
}
