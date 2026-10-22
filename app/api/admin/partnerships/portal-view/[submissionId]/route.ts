/**
 * #996 — "Ver como o lojista": `GET /api/admin/partnerships/portal-view/{submissionId}`.
 *
 * Admin only. Mints a 5-minute, single-use access to the partner's `/status` in the portal, bound to
 * this submission and this admin, leaves the audit row, and redirects (303) to the portal, which
 * spends it. The record's `Portal` block opens this URL in a new tab, so it is a GET: a POST answered
 * with a URL would need `window.open` after an await, which Safari blocks. A GET forced on an admin
 * from elsewhere opens the view in the admin's own tab and leaves a row; nothing reaches the forger.
 * The access never touches the page: it exists only in the `Location` header.
 */

import { NextResponse } from 'next/server'
import { withAuth, withRateLimit } from '@/lib/auth-middleware'
import { issuePortalView } from '@/lib/services/portal-view-service'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const GET = withRateLimit(20, 60_000)(
  withAuth<{ submissionId: string }>({ roles: ['admin'] }, async (req, ctx, auth) => {
    const params = await ctx.params
    const submissionId = params?.submissionId
    if (!submissionId || !UUID_PATTERN.test(submissionId)) {
      return NextResponse.json({ error: 'invalid_submission_id' }, { status: 400 })
    }
    const issued = await issuePortalView(req, submissionId, { id: auth.user.id, email: auth.user.email ?? null })
    if (!issued.ok) return NextResponse.json({ error: issued.error }, { status: issued.status, headers: { 'Cache-Control': 'no-store' } })
    const res = NextResponse.redirect(issued.data.url, 303)
    res.headers.set('Cache-Control', 'no-store')
    res.headers.set('Referrer-Policy', 'no-referrer')
    return res
  })
)
