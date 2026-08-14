/**
 * GET /api/admin/partner-proposals/{submissionId} — everything the review screen reads.
 *
 * Two things it deliberately does NOT return:
 *
 *  · `storage_path` of any document. The bucket is private and the screen does not undo that:
 *    the path never reaches the DOM, and the URL is asked for on the click by
 *    `documents/{documentId}` (criterion 14).
 *  · any token, of any invite, in any form. The trail says a link was minted and when; the
 *    link itself existed once (DS-COMPONENTE-019).
 *
 * `emailConflict` is here and not on the promote route on purpose: `core.clients.email` is
 * unique, and DS-COMPONENTE-018 says a unique-key collision is resolved BEFORE the button
 * appears, with the options spelled out — never as a `23505` after the click.
 */

import { NextResponse } from 'next/server'
import { withAuth, withRateLimit } from '@/lib/auth-middleware'
import {
  findClientByEmail,
  loadProposalDetail,
} from '@/lib/services/partner-proposal-admin-service'

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

    const answers = detail.submission.answers ?? {}
    const representativeEmail = (answers.representative_email ?? '').trim()

    // Only worth asking when the promotion would actually create or move an e-mail: a
    // proposal already tied to that same client is not a collision.
    //
    // The WHOLE record travels and not just the name, because one of the two ways out is
    // "tie this proposal to that client and update their record" — and the panel cannot show
    // `Campo · No cadastro hoje · Da proposta` for a record it does not have.
    let emailConflict: { client: Record<string, unknown> } | null = null
    if (representativeEmail) {
      const existing = await findClientByEmail(representativeEmail)
      if (existing && existing.id !== detail.client?.id) {
        emailConflict = { client: existing }
      }
    }

    return NextResponse.json({
      submission: {
        id: detail.submission.id,
        status: detail.submission.status,
        answers,
        isPartial: detail.submission.is_partial,
        submittedAt: detail.submission.submitted_at,
        updatedAt: detail.submission.updated_at,
        createdAt: detail.submission.created_at,
        promotedAt: detail.submission.promoted_at,
        promotedBy: detail.submission.promoted_by,
        promotedClientId: detail.submission.promoted_client_id,
      },
      invites: detail.invites.map((invite) => ({
        id: invite.id,
        recipientEmail: invite.recipient_email,
        recipientName: invite.recipient_name,
        tradeName: invite.trade_name,
        expiresAt: invite.expires_at,
        usedAt: invite.used_at,
        revokedAt: invite.revoked_at,
        createdAt: invite.created_at,
      })),
      documents: detail.documents.map((document) => ({
        id: document.id,
        kind: document.kind,
        fileName: document.file_name,
        byteSize: document.byte_size,
        mimeType: document.mime_type,
        createdAt: document.created_at,
      })),
      client: detail.client,
      emailConflict,
    })
  })
)
