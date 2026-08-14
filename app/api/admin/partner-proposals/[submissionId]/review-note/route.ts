/**
 * PUT /api/admin/partner-proposals/{submissionId}/review-note — the reviewer's annotation.
 *
 * The three reading marks of gate 2 and a free-text observation. THIS IS NOT A VERDICT: it
 * writes no `status`, reaches no column of `core.clients`, and the proposal is exactly as
 * promotable after it as before (BR-B2B-011 — triage is another decision, with another owner
 * and another moment, and a place turned down there is still a partner).
 *
 * Nothing here is sent to the partner.
 */

import { NextResponse } from 'next/server'
import { withAuth, withRateLimit } from '@/lib/auth-middleware'
import { saveReviewNote } from '@/lib/services/partner-proposal-admin-service'
import { normalizeReviewNote } from '@/lib/partner-form/proposal-review'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const PUT = withRateLimit(30, 60_000)(
  withAuth<{ submissionId: string }>({ roles: ['admin'] }, async (req, ctx, auth) => {
    const params = await ctx.params
    const submissionId = params?.submissionId
    if (!submissionId || !UUID_PATTERN.test(submissionId)) {
      return NextResponse.json({ error: 'invalid_submission_id' }, { status: 400 })
    }

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
    }

    const note = normalizeReviewNote(body)
    if (!note) {
      return NextResponse.json({ error: 'invalid_note' }, { status: 400 })
    }

    const saved = await saveReviewNote(submissionId, note, auth.user.id)
    if (!saved) {
      return NextResponse.json({ error: 'note_not_saved' }, { status: 503 })
    }

    return NextResponse.json({ ok: true, note })
  })
)
