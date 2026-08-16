/**
 * GET /api/admin/partner-proposals/{submissionId} — everything the review screen reads.
 *
 * `duplicates` is the one thing here that is not a plain projection of the row. A CNPJ with a
 * proposal already waiting may send another (the form refuses only a CNPJ that is already a
 * CLIENT), so the screen has to say "there is another one of these" and let a person choose.
 * Nothing merges; nothing is decided here.
 *
 * There is no `emailConflict` any more. It existed because `core.clients.email` was unique,
 * and it is not: one owner has several places and each is its own record.
 */

import { NextResponse } from 'next/server'
import { withAuth, withRateLimit } from '@/lib/auth-middleware'
import { loadProposalDetail } from '@/lib/services/partner-proposal-admin-service'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const GET = withRateLimit(60, 60_000)(
  withAuth<{ submissionId: string }>({ roles: ['admin'] }, async (_req, ctx) => {
    const params = await ctx.params
    const submissionId = params?.submissionId
    if (!submissionId || !UUID_PATTERN.test(submissionId)) {
      return NextResponse.json({ error: 'invalid_submission_id' }, { status: 400 })
    }

    const detail = await loadProposalDetail(submissionId)
    if (!detail) {
      return NextResponse.json({ error: 'proposal_not_found' }, { status: 404 })
    }

    return NextResponse.json({
      submission: {
        id: detail.submission.id,
        status: detail.submission.status,
        answers: detail.submission.answers ?? {},
        submittedAt: detail.submission.submitted_at,
        updatedAt: detail.submission.updated_at,
        createdAt: detail.submission.created_at,
        promotedAt: detail.submission.promoted_at,
        promotedBy: detail.submission.promoted_by,
        promotedClientId: detail.submission.promoted_client_id,
      },
      note: detail.note,
      conference: detail.conference,
      client: detail.client,
      duplicates: detail.duplicates,
    })
  })
)
