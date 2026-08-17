/**
 * The CMS door to the hour-credit ledger — card #310, phase 3 of epic #283.
 *
 * `GET`  reads `drive.get_time_credit_ledger` (state, balance, grants, usage).
 * `POST` grants, `minutes` or `until`, through `drive.grant_time_credit`.
 *
 * It replaced `PATCH /api/admin/users/[userId]/subscription`, which wrote
 * `drive.profiles` directly with `service_role`. Under the hour model that handler was
 * a second writer of both the balance and `subscription_end_date`, and
 * BR-MONETIZACAO-047 allows exactly one door. Four things it did wrong are fixed here:
 *
 * 1. **The grant runs on the operator's cookie-bound client, not the service one.**
 *    `drive.grant_time_credit` records `p_granted_by => auth.uid()`; called as
 *    `service_role` that is `NULL`, and "Granted by" would be empty forever in an
 *    immutable ledger. `core.is_caller_platform_admin()` accepts the CMS admin's JWT,
 *    so the operator's own token is what opens the door.
 * 2. **`source` is fixed to `cms` on the server** and is never read from the body.
 *    `source` is attribution, not authorization (BR-MONETIZACAO-064): letting the form
 *    choose it would let the same admin, on the same screen, relabel their own act.
 * 3. **`subscription_end_date` is never written from here.** For `until` the access
 *    period is applied by the existing writer (`drive.apply_non_renewing_pass`) and the
 *    ledger row is recorded afterwards, with the date that writer actually produced.
 *    Inverted, `drive.record_time_credit_grant` raises `22023` on purpose.
 * 4. **BR-MONETIZACAO-017 is enforced here**, which is the divergence that rule names:
 *    the old handler took `subscription_end_date` straight from the body, accepted a
 *    date in the past, and accepted `null` — an indefinite grant, in silence.
 *
 * The route authenticates itself: `/api/*` is outside the proxy matcher, so `withAuth`
 * is the whole gate (`lib/auth-middleware.ts`), and it is the one that calls
 * `getUser()` — `getSession()` does not revalidate the token on the server.
 */

import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { withAuth, type AuthContext } from '@/lib/auth-middleware'
import { getSupabaseService } from '@/lib/core/supabase-client'
import { logAuditEvent } from '@/lib/services/audit-service'
import { classifyLedgerError, creditErrorStatus, type CreditError } from '@/lib/credit/errors'
import { tierGrantsAccess } from '@/lib/credit/tiers'

/**
 * The only `source` this door writes. Not a default, not a fallback: the body is not
 * consulted. See point 2 of the header.
 */
const CMS_SOURCE = 'cms'

/** BR-MONETIZACAO-017 — a CMS access grant lasts at most one year from the grant date. */
const MAX_PERIOD_YEARS = 1

/** `source_ref` is immutable. A cap keeps a paste from becoming a permanent ledger row. */
const MAX_SOURCE_REF_LENGTH = 200

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const DAY_MS = 24 * 60 * 60 * 1000

function refuse(error: CreditError): NextResponse {
  return NextResponse.json({ error }, { status: creditErrorStatus(error) })
}

function badRequest(code: string): NextResponse {
  return NextResponse.json({ error: { code } }, { status: 400 })
}

/** One year from `from`, by calendar, so a leap year is not 365 days of arithmetic. */
export function maxPeriodEnd(from: Date): Date {
  const max = new Date(from.getTime())
  max.setFullYear(max.getFullYear() + MAX_PERIOD_YEARS)
  return max
}

export const GET = withAuth<{ userId: string }>(
  { roles: ['admin'] },
  async (req, ctx, auth) => {
    const params = await ctx.params
    const userId = params?.userId
    if (!userId || !UUID_RE.test(userId)) return badRequest('invalid_user_id')

    const url = new URL(req.url)
    const rawLimit = Number.parseInt(url.searchParams.get('session_limit') ?? '', 10)
    const rawOffset = Number.parseInt(url.searchParams.get('session_offset') ?? '', 10)

    // Out-of-range paging is corrected and echoed by the RPC, never in silence — the
    // envelope carries the effective `session_limit`/`session_offset` back.
    const { data, error } = await auth.supabase
      .schema('drive')
      .rpc('get_time_credit_ledger', {
        p_user_id: userId,
        p_session_limit: Number.isFinite(rawLimit) ? rawLimit : 50,
        p_session_offset: Number.isFinite(rawOffset) ? rawOffset : 0,
      })

    if (error) {
      // No SQLERRM, no uuid, no operator email in the log: these land in Vercel logs.
      console.error('[credit] ledger read refused:', error.code)
      return refuse(classifyLedgerError(error, 'read'))
    }

    return NextResponse.json(data)
  }
)

export const POST = withAuth<{ userId: string }>(
  { roles: ['admin'] },
  async (req, ctx, auth) => {
    const params = await ctx.params
    const userId = params?.userId
    if (!userId || !UUID_RE.test(userId)) return badRequest('invalid_user_id')

    let body: Record<string, unknown>
    try {
      body = await req.json()
    } catch {
      return badRequest('invalid_body')
    }

    const grantType = body.grant_type
    if (grantType !== 'minutes' && grantType !== 'until') return badRequest('invalid_grant_type')

    const sourceRef = typeof body.source_ref === 'string' ? body.source_ref.trim() : ''
    if (sourceRef.length > MAX_SOURCE_REF_LENGTH) return badRequest('source_ref_too_long')

    return grantType === 'minutes'
      ? grantMinutes(req, auth, userId, body, sourceRef)
      : grantUntil(req, auth, userId, body, sourceRef)
  }
)

async function grantMinutes(
  req: NextRequest,
  auth: AuthContext,
  userId: string,
  body: Record<string, unknown>,
  sourceRef: string
): Promise<NextResponse> {
  const minutes = body.minutes
  // Shape only. The granularity (multiple of 5, BR-MONETIZACAO-049) and the cap per act
  // (BR-MONETIZACAO-063) belong to `drive.record_time_credit_grant` and are NOT restated
  // here — a number with one owner does not get a second copy in a route handler.
  if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes <= 0) {
    return badRequest('invalid_minutes')
  }

  const { data, error } = await auth.supabase.schema('drive').rpc('grant_time_credit', {
    p_user_id: userId,
    p_grant_type: 'minutes',
    p_source: CMS_SOURCE,
    p_source_ref: sourceRef || null,
    p_minutes: minutes,
  })

  if (error) {
    console.error('[credit] minutes grant refused:', error.code)
    return refuse(classifyLedgerError(error, 'grant'))
  }

  await logAuditEvent({
    request: req,
    action: 'GRANT_TIME_CREDIT',
    entity: 'USER',
    entityId: userId,
    userId: auth.user.id,
    userEmail: auth.cmsUser.email,
    description: `Granted ${minutes} minutes of time credit (source ${CMS_SOURCE}) to app user ${userId}.`,
  })

  return NextResponse.json(data)
}

async function grantUntil(
  req: NextRequest,
  auth: AuthContext,
  userId: string,
  body: Record<string, unknown>,
  sourceRef: string
): Promise<NextResponse> {
  const tierId = body.tier_id
  if (typeof tierId !== 'string' || !UUID_RE.test(tierId)) return badRequest('invalid_tier')

  // BR-MONETIZACAO-017, the three refusals the old handler did not have. `until_required`
  // is first because an absent date used to mean "no end date", granted in silence. They
  // come before the licence lookup so a malformed request is refused without touching the
  // database at all.
  const raw = body.ends_at
  if (typeof raw !== 'string' || !raw.trim()) return badRequest('until_required')
  const endsAt = new Date(raw)
  if (Number.isNaN(endsAt.getTime())) return badRequest('until_required')

  const now = new Date()
  if (endsAt.getTime() <= now.getTime()) return badRequest('until_past')
  if (endsAt.getTime() > maxPeriodEnd(now).getTime()) return badRequest('until_too_far')

  // A uuid is a shape, not a licence. `drive.subscription_tiers` has Free, Premium and Pro
  // all active, so the shape check alone accepted a period on `free` — which writes a paid
  // end date onto a profile the published app still reads as free, answers **Ilimitado** on
  // this very panel, and delivers nothing to the tourist (`lib/credit/tiers.ts`). The
  // `<select>` no longer offers it; this is the refusal that makes that true, because a
  // list that filters without a server that refuses is a control that only looks closed.
  const { data: tier, error: tierError } = await auth.supabase
    .schema('drive')
    .from('subscription_tiers')
    .select('id, name, is_active')
    .eq('id', tierId)
    .maybeSingle()

  if (tierError) {
    // "We could not read the licence" is not "the licence is wrong": fail closed, and do
    // not tell the operator to pick another one.
    console.error('[credit] licence lookup failed:', tierError.code)
    return refuse({ code: 'unknown' })
  }
  if (!tier?.is_active || !tierGrantsAccess(tier.name)) return badRequest('invalid_tier')

  // Two calls, in this order, with two different clients — one click for the operator.
  // The period is applied by its existing owner (service_role only), and the ledger row
  // is recorded afterwards by the operator's own client, so `granted_by` is a person.
  const durationDays = Math.ceil((endsAt.getTime() - now.getTime()) / DAY_MS)

  const { data: applied, error: applyError } = await getSupabaseService()
    .schema('drive')
    .rpc('apply_non_renewing_pass', {
      p_user_id: userId,
      p_tier_id: tierId,
      p_duration_days: durationDays,
      p_action: 'non_renewing_purchase',
      // Random on purpose: a CMS grant is NOT idempotent (spec §5), and a deterministic
      // key would make the operator's second, deliberate grant a silent no-op.
      p_provider_event_id: `cms:${randomUUID()}`,
      p_provider: 'admin',
    })

  if (applyError) {
    console.error('[credit] access period refused:', applyError.code)
    return refuse(classifyLedgerError(applyError, 'apply_period'))
  }

  // The date the writer actually produced, not the one that was asked for: a
  // non-renewing pass stacks on live access, so the two can differ. The ledger row must
  // never claim a right that `drive.profiles` does not hold — `record_time_credit_grant`
  // refuses with `22023` when it does.
  const effectiveEndsAt = applied?.new_end_date as string | undefined
  if (!effectiveEndsAt) {
    console.error('[credit] access period applied without a new end date')
    return refuse({ code: 'unknown' })
  }

  const { data, error } = await auth.supabase.schema('drive').rpc('grant_time_credit', {
    p_user_id: userId,
    p_grant_type: 'until',
    p_source: CMS_SOURCE,
    p_source_ref: sourceRef || null,
    p_ends_at: effectiveEndsAt,
  })

  if (error) {
    // From here on the tourist HOLDS the right and the ledger has no row for it. Every
    // failure of this second call means the same thing to the operator, whatever SQLSTATE
    // it carries, and it is the opposite of every other refusal on this screen: do not
    // send it again. `drive.apply_non_renewing_pass` stacks on live access
    // (BR-MONETIZACAO-065), so a retry does not "fix" the missing row — it doubles the
    // period. That is why this is its own code and not `classifyLedgerError`, which reads
    // SQLSTATEs and would land on `unknown` — a sentence that says nothing about the right
    // the tourist already holds. Mitigation of F1 of the #310 review; the real fix is a
    // single atomic door in the database, card #328.
    console.error('[credit] period applied but the ledger row failed:', error.code)

    // The audit row is the only trace left of who applied this period — `granted_by` lives
    // in the ledger, and the ledger is what is missing. It is also where the operator's
    // ticket gets resolved from.
    await logAuditEvent({
      request: req,
      action: 'GRANT_TIME_CREDIT_UNRECORDED',
      entity: 'USER',
      entityId: userId,
      userId: auth.user.id,
      userEmail: auth.cmsUser.email,
      description: `Access period applied until ${effectiveEndsAt} for app user ${userId}, but the ledger row was refused (SQLSTATE ${error.code ?? 'unknown'}). The right exists without a grant row; it must be recorded manually, and the period must NOT be granted again.`,
    })

    return refuse({ code: 'period_applied_no_record', sqlstate: error.code ?? undefined })
  }

  await logAuditEvent({
    request: req,
    action: 'GRANT_TIME_CREDIT',
    entity: 'USER',
    entityId: userId,
    userId: auth.user.id,
    userEmail: auth.cmsUser.email,
    description: `Granted unlimited access until ${effectiveEndsAt} (source ${CMS_SOURCE}) to app user ${userId}.`,
  })

  return NextResponse.json({ ...data, requested_ends_at: endsAt.toISOString() })
}
