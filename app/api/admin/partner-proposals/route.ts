/**
 * GET /api/admin/partner-proposals — the review queue.
 *
 * Drafts are out of the list by default: a proposal nobody has sent is not work waiting for
 * the team, and the invite tab already shows that somebody started typing. `?status=draft`
 * opens it for the operator who is chasing a specific establishment.
 *
 * The answers travel whole because the list shows the trade name, the CNPJ and the city, and
 * a second round trip per row to fetch three strings would cost more than the row.
 */

import { NextResponse } from 'next/server'
import { withAuth, withRateLimit } from '@/lib/auth-middleware'
import {
  listProposals,
  type ProposalStatus,
} from '@/lib/services/partner-proposal-admin-service'
import { buildRegularityReport } from '@/lib/partner-form/regularity'

const KNOWN_STATUSES: ProposalStatus[] = ['draft', 'submitted', 'promoted', 'discarded']

export const GET = withRateLimit(60, 60_000)(
  withAuth({ roles: ['admin'] }, async (req) => {
    const requested = req.nextUrl.searchParams.get('status')
    const statuses =
      requested && KNOWN_STATUSES.indexOf(requested as ProposalStatus) >= 0
        ? [requested as ProposalStatus]
        : undefined

    const proposals = await listProposals(statuses ? { statuses } : {})

    return NextResponse.json({
      proposals: proposals.map((proposal) => {
        const answers = proposal.answers ?? {}
        return {
          id: proposal.id,
          status: proposal.status,
          isPartial: proposal.is_partial,
          tradeName: answers.trade_name ?? proposal.invite?.trade_name ?? null,
          taxId: answers.tax_id ?? null,
          city: answers.city ?? null,
          state: answers.state ?? null,
          recipientEmail: proposal.invite?.recipient_email ?? null,
          documentCount: proposal.document_kinds.length,
          submittedAt: proposal.submitted_at,
          updatedAt: proposal.updated_at,
          promotedAt: proposal.promoted_at,
          promotedClientId: proposal.promoted_client_id,
          // The queue's own reason to exist: which ones can already produce a contract.
          // Computed from the same module the review band uses, so the badge in the list and
          // the band on the page cannot disagree (BR-B2B-022).
          missingForContract: buildRegularityReport(answers, proposal.document_kinds).missing,
        }
      }),
    })
  })
)
