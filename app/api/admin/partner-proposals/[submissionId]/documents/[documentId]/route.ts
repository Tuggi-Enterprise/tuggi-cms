/**
 * POST /api/admin/partner-proposals/{submissionId}/documents/{documentId} — opens one file.
 *
 * POST and not GET because it MINTS something: a signed URL that reaches a private bucket.
 * The screen asks for it on the click, so no document URL exists in the HTML before it
 * (criterion 14), it is valid for `DOCUMENT_SIGNED_URL_SECONDS`, and it is not offered for
 * copying. `storage_path` is resolved on the server and never leaves it.
 *
 * `submissionId` is a predicate of the lookup and not decoration: it is what stops a document
 * id belonging to one proposal from being read through the page of another.
 */

import { NextResponse } from 'next/server'
import { withAuth, withRateLimit } from '@/lib/auth-middleware'
import {
  DOCUMENT_SIGNED_URL_SECONDS,
  signDocument,
} from '@/lib/services/partner-proposal-admin-service'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const POST = withRateLimit(60, 60_000)(
  withAuth<{ submissionId: string; documentId: string }>(
    { roles: ['admin'] },
    async (_req, ctx) => {
      const params = await ctx.params
      const submissionId = params?.submissionId
      const documentId = params?.documentId

      if (!submissionId || !UUID_PATTERN.test(submissionId)) {
        return NextResponse.json({ error: 'invalid_submission_id' }, { status: 400 })
      }
      if (!documentId || !UUID_PATTERN.test(documentId)) {
        return NextResponse.json({ error: 'invalid_document_id' }, { status: 400 })
      }

      const signed = await signDocument(submissionId, documentId)
      if (!signed) {
        return NextResponse.json({ error: 'document_not_available' }, { status: 404 })
      }

      return NextResponse.json({
        url: signed.url,
        fileName: signed.fileName,
        expiresInSeconds: DOCUMENT_SIGNED_URL_SECONDS,
      })
    }
  )
)
