/**
 * One place's description policy, and the operator's exception to it.
 *
 * GET    — what this place may carry in the description's place, and why.
 * PUT    — applies the free tier's content: the name, in the description's place.
 * POST   — records the exception: a free-tier partner may now have a structured description.
 * DELETE — undoes it. A description already on air is NOT deleted (BR-B2B-027 is another decision).
 *
 * A ROUTE, AND NOT A DIRECT READ FROM THE SCREEN, because the partner's tier lives in
 * `partner.clients` and `partner.partner_contracts`, and `authenticated` has no `USAGE` on that
 * schema — from the browser the answer is 42501, which PostgREST returns in `error` and a `?? null`
 * turns into "does not pay".
 *
 * `editor` writes. The exception is a CONTENT decision — what Tuggi says about the place — and not
 * a commercial one: the tier is the contract's, and nothing here alters it. Demanding `admin` would
 * make the curator ask somebody else to open the screen for them.
 */

import { NextResponse } from 'next/server'
import { withAuth, withRateLimit } from '@/lib/auth-middleware'
import { logAuditEvent } from '@/lib/services/audit-service'
import {
  applyDescriptionPolicyToPlace,
  clearDescriptionException,
  loadPlaceDescriptionPolicy,
  saveDescriptionException,
} from '@/lib/services/place-description-policy-service'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The reason is the half of the exception that outlives today. Too short is not a reason. */
const REASON_MIN = 10
const REASON_MAX = 500

type Params = { attractionId: string }

function idOf(params: Params | undefined): string | null {
  const id = params?.attractionId
  return id && UUID_PATTERN.test(id) ? id : null
}

export const GET = withAuth<Params>(
  { roles: ['admin', 'editor', 'viewer'] },
  async (_req, ctx, auth) => {
    const attractionId = idOf(await ctx.params)
    if (!attractionId) return NextResponse.json({ error: 'invalid_id' }, { status: 400 })

    // The message and not just a status: `loadPlaceDescriptionPolicy` throws whatever PostgREST
    // said, and the commonest failure here — a schema cache from before the RPC existed — is
    // diagnosable only if that sentence reaches the screen.
    try {
      const view = await loadPlaceDescriptionPolicy(attractionId, auth.supabase)
      if (!view) return NextResponse.json({ error: 'not_found' }, { status: 404 })
      return NextResponse.json(view)
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)
      console.error('[description-policy] read failed:', message)
      return NextResponse.json({ error: message }, { status: 503 })
    }
  }
)

export const POST = withRateLimit(20, 60_000)(
  withAuth<Params>({ roles: ['admin', 'editor'] }, async (req, ctx, auth) => {
    const attractionId = idOf(await ctx.params)
    if (!attractionId) return NextResponse.json({ error: 'invalid_id' }, { status: 400 })

    const body = (await req.json().catch(() => null)) as { reason?: string } | null
    const reason = (body?.reason ?? '').trim()
    if (reason.length < REASON_MIN || reason.length > REASON_MAX) {
      return NextResponse.json({ error: 'invalid_reason' }, { status: 400 })
    }

    const view = await loadPlaceDescriptionPolicy(attractionId, auth.supabase)
    if (!view) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    // Nothing to except on a curated POI or on a paying partner — the description is already
    // theirs. An exception recorded where there is no rule is a record lying about a decision
    // nobody took.
    if (!view.decision.mayException) {
      return NextResponse.json({ error: 'no_rule_to_except' }, { status: 409 })
    }

    try {
      await saveDescriptionException(attractionId, reason, auth.supabase)
    } catch {
      return NextResponse.json({ error: 'write_failed' }, { status: 503 })
    }

    await logAuditEvent({
      request: req,
      action: 'PARTNER_DESCRIPTION_EXCEPTION_OPENED',
      entity: 'POI',
      entityId: attractionId,
      userId: auth.user.id,
      userEmail: auth.user.email ?? auth.cmsUser.email,
      description: `Exceção à faixa gratuita aberta em "${view.name}": ${reason}`,
    })

    return NextResponse.json(await loadPlaceDescriptionPolicy(attractionId, auth.supabase))
  })
)

export const DELETE = withRateLimit(20, 60_000)(
  withAuth<Params>({ roles: ['admin', 'editor'] }, async (req, ctx, auth) => {
    const attractionId = idOf(await ctx.params)
    if (!attractionId) return NextResponse.json({ error: 'invalid_id' }, { status: 400 })

    try {
      await clearDescriptionException(attractionId, auth.supabase)
    } catch {
      return NextResponse.json({ error: 'write_failed' }, { status: 503 })
    }

    await logAuditEvent({
      request: req,
      action: 'PARTNER_DESCRIPTION_EXCEPTION_CLOSED',
      entity: 'POI',
      entityId: attractionId,
      userId: auth.user.id,
      userEmail: auth.user.email ?? auth.cmsUser.email,
      description: 'Exceção à faixa gratuita desfeita — o local volta a ser só o nome.',
    })

    return NextResponse.json(await loadPlaceDescriptionPolicy(attractionId, auth.supabase))
  })
)

/**
 * THE FREE TIER'S CONTENT, APPLIED — the name in the description's place.
 *
 * Called by the place form on every save, which is what the operator chose on 2026-08-26: no
 * partner should stay mute because nobody remembered to open their record. It is idempotent and it
 * refuses to overwrite a description it did not write, so calling it on every save is cheap and
 * safe — see `applyNameOnlyDescription`.
 *
 * THE POLICY IS RE-READ HERE and not trusted from the caller. The form knows what the screen was
 * showing when it opened; the tier can have moved since, and a contract signed in another tab must
 * not be undone by a stale form writing a proper noun over a paid description.
 */
export const PUT = withRateLimit(60, 60_000)(
  withAuth<Params>({ roles: ['admin', 'editor'] }, async (_req, ctx, auth) => {
    const attractionId = idOf(await ctx.params)
    if (!attractionId) return NextResponse.json({ error: 'invalid_id' }, { status: 400 })

    try {
      // `not_applicable` is the ordinary answer — the form calls this for every place it saves.
      return NextResponse.json({ outcome: await applyDescriptionPolicyToPlace(attractionId, auth.supabase) })
    } catch {
      return NextResponse.json({ error: 'write_failed' }, { status: 503 })
    }
  })
)
