/**
 * POST   /api/admin/clients/cancellations/<feedbackId>/contacted  → "Marcar que falamos"
 * DELETE /api/admin/clients/cancellations/<feedbackId>/contacted  → "Desfazer"
 *
 * Admin-only (#913, BR-B2B-060 item 7: the mark records who and when; marking never erases the
 * answer). `partner.mark_place_cancellation_contacted` / `unmark_…` check
 * `core.is_caller_platform_admin()` in the body and write `contacted_by = auth.uid()`, so they run
 * on the admin's own session: under service_role `contacted_by` would be NULL.
 *
 * 42501 → 403, 22023 `no_contact_consent` → 409, P0002 `feedback_not_found` → 404.
 */

import { NextRequest, NextResponse } from 'next/server'
import { withAuth, type AuthContext } from '@/lib/auth-middleware'
import { UUID } from '@/lib/finance/input'
import { contactErrorStatus } from '@/lib/clients/cancellations'

type Params = { feedbackId: string }

async function call(fn: 'mark_place_cancellation_contacted' | 'unmark_place_cancellation_contacted', feedbackId: string | undefined, auth: AuthContext) {
  if (!feedbackId || !UUID.test(feedbackId)) return NextResponse.json({ error: 'invalid_id' }, { status: 400 })
  const { error } = await auth.supabase.schema('partner').rpc(fn, { p_feedback_id: feedbackId })
  if (error) {
    console.error('[cancellations]', fn, 'refused:', error.code)
    const e = contactErrorStatus(error.code)
    return NextResponse.json({ error: e.error }, { status: e.status })
  }
  return NextResponse.json({ ok: true })
}

export const POST = withAuth<Params>({ roles: ['admin'] }, async (_req: NextRequest, ctx, auth) =>
  call('mark_place_cancellation_contacted', (await ctx.params)?.feedbackId, auth)
)

export const DELETE = withAuth<Params>({ roles: ['admin'] }, async (_req: NextRequest, ctx, auth) =>
  call('unmark_place_cancellation_contacted', (await ctx.params)?.feedbackId, auth)
)
