/**
 * #996 — "Ver como o lojista": the three server acts behind the CMS button and the portal's
 * read-only view of a partner's `/status`. Contract: `docs/contracts/places-cms.md` §11.
 *
 *  1. `issuePortalView` (admin route): a 5-minute access bound to the submission and the admin,
 *     and the audit row of who asked. No row, no access.
 *  2. `openPortalView` (portal Worker, `PLACES_CMS_SECRET`): spends the access once and answers a
 *     30-minute session. Single use is `core.audit_logs`' primary key: the opening row is written
 *     with `id` = the access's jti, and a second opening collides and is refused. Any failure to
 *     write that row refuses too.
 *  3. `readPortalView` (portal Worker): one `core.portal_*` read for the viewed submission, from
 *     the closed list in `portal-view-token.ts`, run by `partner.portal_view_call` as the
 *     submission's owner. Nothing that writes is on the list.
 *
 * Logs carry ids and error codes, never a name or an e-mail.
 */

import type { NextRequest } from 'next/server'
import { getSupabaseService } from '@/lib/core/supabase-client'
import { logAuditEvent } from '@/lib/services/audit-service'
import { rpcFailure } from '@/lib/services/portal-contract-service'
import { placesPortalOrigin } from '@/lib/partnerships/acceptance-link'
import { portalViewRead, portalViewSecret, signPortalView, verifyPortalView } from '@/lib/partnerships/portal-view-token'

/** The portal route that receives the access (`tuggi-places` `src/app/api/portal/view/route.ts`). */
export const PORTAL_VIEW_OPEN_PATH = '/api/portal/view'

export type ViewError = 'not_configured' | 'not_found' | 'audit_failed' | 'access_invalid' | 'view_ended' | 'read_only' | 'unavailable'
export type ViewOutcome<T> = { ok: true; data: T } | { ok: false; status: number; error: ViewError | string }

const nowSeconds = () => Math.floor(Date.now() / 1000)
const refuse = (status: number, error: ViewError) => ({ ok: false as const, status, error })

export async function issuePortalView(
  request: NextRequest,
  submissionId: string,
  admin: { id: string; email: string | null }
): Promise<ViewOutcome<{ url: string; expiresAt: number }>> {
  const secret = portalViewSecret()
  if (!secret) return refuse(503, 'not_configured')

  const { data, error } = await getSupabaseService()
    .schema('partner')
    .from('place_submissions')
    .select('id, status')
    .eq('id', submissionId)
    .maybeSingle()
  if (error) {
    console.error('[portal-view] submission read failed', error.code)
    return refuse(502, 'unavailable')
  }
  // A draft has no `/status` to show: the portal sends its owner back to the form.
  if (!data || (data as { status?: string }).status === 'draft') return refuse(404, 'not_found')

  const { token, claims } = signPortalView(secret, { kind: 'access', submissionId, adminId: admin.id, nowSeconds: nowSeconds() })
  const audited = await logAuditEvent({
    request,
    action: 'ISSUE_PORTAL_VIEW_ACCESS',
    entity: 'PARTNER_PROPOSAL',
    entityId: submissionId,
    userId: admin.id,
    userEmail: admin.email,
    description: `Portal submission ${submissionId}: read-only view access ${claims.jti} issued, valid until ${new Date(claims.expiresAt * 1000).toISOString()}`,
  })
  if (!audited) return refuse(503, 'audit_failed')

  const url = `${placesPortalOrigin(process.env.PLACES_PORTAL_ORIGIN)}${PORTAL_VIEW_OPEN_PATH}?t=${encodeURIComponent(token)}`
  return { ok: true, data: { url, expiresAt: claims.expiresAt } }
}

export async function openPortalView(
  request: NextRequest,
  access: unknown
): Promise<ViewOutcome<{ session: string; expiresAt: number; submissionId: string }>> {
  const secret = portalViewSecret()
  if (!secret) return refuse(503, 'not_configured')
  const now = nowSeconds()
  const checked = verifyPortalView(secret, access, 'access', now)
  if (!checked.ok) return refuse(401, 'access_invalid')
  const { submissionId, adminId, jti } = checked.claims

  // The spend. Same id twice is a primary-key violation, so only the first opening gets a session.
  const spent = await logAuditEvent({
    request,
    id: jti,
    action: 'OPEN_PORTAL_VIEW',
    entity: 'PARTNER_PROPOSAL',
    entityId: submissionId,
    userId: adminId,
    description: `Portal submission ${submissionId}: read-only view opened with access ${jti}`,
  })
  if (!spent) return refuse(401, 'access_invalid')

  const session = signPortalView(secret, { kind: 'session', submissionId, adminId, nowSeconds: now })
  return { ok: true, data: { session: session.token, expiresAt: session.claims.expiresAt, submissionId } }
}

export async function readPortalView(session: unknown, fn: unknown, args: unknown): Promise<ViewOutcome<unknown>> {
  const secret = portalViewSecret()
  if (!secret) return refuse(503, 'not_configured')
  const checked = verifyPortalView(secret, session, 'session', nowSeconds())
  if (!checked.ok) return refuse(401, 'view_ended')
  const { submissionId } = checked.claims
  const read = portalViewRead(fn, args, submissionId)
  if (!read) return refuse(403, 'read_only')

  const { data, error } = await getSupabaseService()
    .schema('partner')
    .rpc('portal_view_call', { p_submission_id: submissionId, p_fn: read.fn, p_args: read.args })
  if (error) {
    console.error('[portal-view] read failed', read.fn, error.code)
    const failure = rpcFailure(error)
    // The view has no portal session of its own to renew: a 401 from the database is not "log in again".
    return failure.status === 401 ? refuse(502, 'unavailable') : { ok: false, status: failure.status, error: failure.body.error }
  }
  // The owner may have other submissions; the view shows only the one it was opened for.
  if (read.fn === 'portal_list_submissions') {
    const rows = Array.isArray(data) ? data : []
    return { ok: true, data: rows.filter((row) => (row as { submission_id?: unknown } | null)?.submission_id === submissionId) }
  }
  return { ok: true, data }
}
