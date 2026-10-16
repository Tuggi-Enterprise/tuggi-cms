/**
 * The tour guide's public profile in the client record (#936, BR-B2B-064 items 4, 10 and 11).
 * `lib/services/guide-profile-service.ts` holds the reads and the RPCs; this only gates, parses
 * and audits.
 *
 * GET   → `{ profile: GuideProfile | null }` (`null` = not published yet).
 * PATCH `{ "bio": string }` → `{ updatedAt }` — the curator rewrites the bio (1 to 400).
 * POST  `{ "hidden": true, "reason": GuideHideReason, "other"?: string }` hides the guide from the
 *       app (reason required); `{ "hidden": false }` shows it again. Nothing is deleted.
 *
 * Every write runs with the operator's session: `core.cms_*` answers for the person on the screen.
 */

import { NextResponse } from 'next/server'
import { withAuth, withRateLimit } from '@/lib/auth-middleware'
import { logAuditEvent } from '@/lib/services/audit-service'
import {
  GUIDE_BIO_MAX,
  guideHideReasonText,
  loadGuideProfile,
  setGuideHidden,
  updateGuideBio,
} from '@/lib/services/guide-profile-service'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NO_STORE = { 'Cache-Control': 'no-store' }

async function clientIdOf(ctx: { params?: Promise<{ clientId: string }> }): Promise<string | null> {
  const params = await ctx.params
  const clientId = params?.clientId
  return clientId && UUID_PATTERN.test(clientId) ? clientId : null
}

async function bodyOf(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = (await req.json()) as unknown
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export const GET = withRateLimit(120, 60_000)(
  withAuth<{ clientId: string }>({ roles: ['admin'] }, async (_req, ctx) => {
    const clientId = await clientIdOf(ctx)
    if (!clientId) return NextResponse.json({ error: 'invalid_client_id' }, { status: 400 })
    const read = await loadGuideProfile(clientId)
    if (!read.ok) return NextResponse.json({ error: 'lookup_failed' }, { status: 503 })
    return NextResponse.json({ profile: read.profile }, { headers: NO_STORE })
  })
)

export const PATCH = withRateLimit(30, 60_000)(
  withAuth<{ clientId: string }>({ roles: ['admin'] }, async (req, ctx, auth) => {
    const clientId = await clientIdOf(ctx)
    if (!clientId) return NextResponse.json({ error: 'invalid_client_id' }, { status: 400 })
    const body = await bodyOf(req)
    const bio = typeof body?.bio === 'string' ? body.bio.trim() : ''
    if (bio.length < 1 || bio.length > GUIDE_BIO_MAX) return NextResponse.json({ error: 'invalid_bio' }, { status: 400 })

    const outcome = await updateGuideBio(auth.supabase, clientId, bio)
    if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.httpStatus })
    await logAuditEvent({
      request: req,
      action: 'UPDATE_GUIDE_BIO',
      entity: 'CLIENT',
      entityId: clientId,
      userId: auth.user.id,
      userEmail: auth.user.email ?? null,
      description: `Guide ${clientId}: bio rewritten by the curator`,
    })
    return NextResponse.json({ updatedAt: outcome.value })
  })
)

export const POST = withRateLimit(30, 60_000)(
  withAuth<{ clientId: string }>({ roles: ['admin'] }, async (req, ctx, auth) => {
    const clientId = await clientIdOf(ctx)
    if (!clientId) return NextResponse.json({ error: 'invalid_client_id' }, { status: 400 })
    const body = await bodyOf(req)
    if (!body || typeof body.hidden !== 'boolean') return NextResponse.json({ error: 'invalid_body' }, { status: 400 })

    const reason = body.hidden ? guideHideReasonText(body.reason, body.other) : null
    // BR-B2B-064 item 11: hiding records why. Checked here and again by `cms_set_guide_hidden`.
    if (body.hidden && !reason) return NextResponse.json({ error: 'invalid_reason' }, { status: 400 })

    // The audit line carries the reason's id, never the free text of `other` (no PII in logs).
    const outcome = await setGuideHidden(auth.supabase, clientId, body.hidden, reason)
    if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.httpStatus })
    await logAuditEvent({
      request: req,
      action: body.hidden ? 'HIDE_GUIDE_PROFILE' : 'SHOW_GUIDE_PROFILE',
      entity: 'CLIENT',
      entityId: clientId,
      userId: auth.user.id,
      userEmail: auth.user.email ?? null,
      description: body.hidden ? `Guide ${clientId} hidden from the app (${String(body.reason)})` : `Guide ${clientId} shown in the app again`,
    })
    return NextResponse.json({ hidden: outcome.value })
  })
)
