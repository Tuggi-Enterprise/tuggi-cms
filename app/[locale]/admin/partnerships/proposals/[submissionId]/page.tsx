import { NextIntlClientProvider } from 'next-intl'
import ptMessages from '@/messages/pt.json'
import { ProposalReview } from '@/components/admin/partner-proposals/ProposalReview'

/**
 * Conference and promotion of one proposal — BR-B2B-026, item 4. MOVED here from
 * `/admin/partner-proposals/{submissionId}` and NOT reopened: it is bands 1 and 2 of the
 * pipeline now, and `DS-COMPONENTE-018`, `DS-COPY-016`, `DS-COPY-017` and `DS-COPY-018` hold
 * in full. Only the route changed, and the links into it with it.
 *
 * `PartnerForm` travels alongside `PartnerProposals` because the review reads the FIELD LABELS
 * from it: the reviewer has to see the question exactly as the partner saw it, and a second
 * copy of those labels is the defect that duplication produces. An absent key would print the
 * key name in `/en/` and `/es/`.
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
        // The state and the next step are the pipeline's vocabulary, and there is one copy of
        // it: `Partnerships.states` / `Partnerships.nextSteps`, the same keys the board reads.
        // A second wording of `Proposta recebida` under this namespace is how the queue and the
        // detail start disagreeing about the same row (DS-COMPONENTE-020, point 4).
        Partnerships: ptMessages.Partnerships,
      }}
    >
      <ProposalReview locale={locale} submissionId={submissionId} />
    </NextIntlClientProvider>
  )
}
