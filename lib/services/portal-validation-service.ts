/**
 * The operator's three acts on a Portal Locais submission — approve, ask for changes, refuse
 * (#812, BR-B2B-049). Status is never written by UPDATE: every act ends in
 * `partner.transition_place_submission`, the one state machine (contract
 * `partner-proposal-answers.md` §8.4).
 *
 * APPROVING CREATES THE CLIENT AND THE POI (BR-B2B-049, item 7), from the same two allowlists the
 * old form uses — `PROMOTION_MAP` for `partner.clients`, `buildPlacePrefill` for the place — so
 * there is no second list in SQL to drift from them.
 *
 * NOT ONE TRANSACTION, AND RETRY-SAFE INSTEAD. No database function writes client + POI +
 * transition atomically (#805 shipped only the transition), so:
 *  · ONE APPROVAL AT A TIME per submission — a conditional UPDATE of `approval_claimed_at`
 *    (`claimApproval`) comes before any write, so a double click or two operators cannot create
 *    two clients and two POIs; a claim older than `PORTAL_APPROVAL_CLAIM_TTL_MS` is abandoned;
 *  · the POI row is the only non-repeatable write, and `attraction_id` is written the moment it
 *    exists, so a retry never creates a second one;
 *  · the client comes from the POI's own `partner_client_id` when it has one — deduplicated by
 *    the submission, not only by CNPJ, which a submission may not carry — then by CNPJ, then
 *    created;
 *  · link, details and coordinate are re-applied on EVERY attempt (`applyPlacePrefill`), so a
 *    retry finishes a half-written POI instead of approving it without offer and without pin.
 * A failure halfway leaves the submission `in_review`, gives the claim back, and the next click
 * converges; the transition, which is the only thing the portal shows the client, happens last.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseService } from '@/lib/core/supabase-client'
import { buildPromotionPlan, resolvePromotionWrite } from '@/lib/partner-form/promotion'
import { buildPlacePrefill } from '@/lib/partner-form/place-prefill'
import type { PartnerAnswers } from '@/lib/partner-form/schema'
import type { PlacePrefill } from '@/lib/partner-form/place-prefill'
import { applyPlacePrefill, createPrefilledPlace } from '@/lib/services/partner-place-provisioning'
import { createPromotedClient, findClientByTaxId } from '@/lib/services/partner-proposal-admin-service'
import ptMessages from '@/messages/pt.json'

function partner() {
  return getSupabaseService().schema('partner')
}

// The closed lists and limits live in the pure module, so the screen reads them without pulling
// this file (and the service client) into the browser bundle.
export {
  PORTAL_NOTE_MAX,
  PORTAL_NOTE_MIN,
  PORTAL_REFUSAL_REASONS,
  type PortalRefusalReason,
} from '@/lib/partnerships/portal-review'
import {
  PORTAL_NOTE_MAX,
  PORTAL_NOTE_MIN,
  PORTAL_REFUSAL_REASONS,
  type PortalRefusalReason,
} from '@/lib/partnerships/portal-review'

export type PortalDecision =
  | { action: 'approve' }
  | { action: 'request_changes'; note: string }
  | { action: 'reject'; note: string; reason: PortalRefusalReason }

/** The body of the decision route, or the code of what is wrong with it. */
export function parsePortalDecision(body: unknown): PortalDecision | { error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'invalid_body' }
  const record = body as Record<string, unknown>
  if (record.action === 'approve') return { action: 'approve' }

  const note = typeof record.note === 'string' ? record.note.trim() : ''
  if (record.action === 'request_changes' || record.action === 'reject') {
    if (note.length < PORTAL_NOTE_MIN || note.length > PORTAL_NOTE_MAX) return { error: 'invalid_note' }
  }
  if (record.action === 'request_changes') return { action: 'request_changes', note }
  if (record.action === 'reject') {
    const reason = record.reason
    if (!(PORTAL_REFUSAL_REASONS as readonly unknown[]).includes(reason)) {
      return { error: 'invalid_reason' }
    }
    return { action: 'reject', note, reason: reason as PortalRefusalReason }
  }
  return { error: 'unknown_action' }
}

export type PortalActOutcome =
  | { ok: true; status: string; attractionId?: string; clientId?: string }
  | {
      ok: false
      httpStatus: number
      error: string
      attractionId?: string | null
    }

/** `transition_place_submission`'s SQLSTATEs (contract §8.3) → the route's answer. */
export function transitionErrorOf(code: string | undefined): { httpStatus: number; error: string } {
  switch (code) {
    case 'TGP01':
      return { httpStatus: 404, error: 'not_found' }
    case 'TGP10':
      return { httpStatus: 409, error: 'status_conflict' }
    case 'TGP22':
      return { httpStatus: 422, error: 'invalid_note' }
    default:
      return { httpStatus: 503, error: 'transition_failed' }
  }
}

async function transition(
  submissionId: string,
  to: 'approved' | 'changes_requested' | 'rejected',
  actorUserId: string,
  note: string | null
): Promise<PortalActOutcome> {
  const { data, error } = await partner().rpc('transition_place_submission', {
    p_submission_id: submissionId,
    p_to: to,
    p_actor_kind: 'operator',
    p_actor_user_id: actorUserId,
    p_note: note,
  })
  if (error) {
    console.error('[portal-validation] transition failed', to, error.code)
    return { ok: false, ...transitionErrorOf(error.code) }
  }
  return { ok: true, status: String(data ?? to) }
}

export function requestPortalChanges(submissionId: string, actorUserId: string, note: string) {
  return transition(submissionId, 'changes_requested', actorUserId, note)
}

/** Refusing refunds (the database moves a paid subscription to `refund_pending`, BR-B2B-046). */
export function rejectPortalSubmission(submissionId: string, actorUserId: string, note: string) {
  return transition(submissionId, 'rejected', actorUserId, note)
}

interface SubmissionForApproval {
  id: string
  status: string
  answers: PartnerAnswers | null
  attraction_id: string | null
}

const CATEGORY_LABELS = ptMessages.PartnerForm.categories as Record<string, string>

/** An approval claim older than this belongs to a request that died, and can be taken again. */
export const PORTAL_APPROVAL_CLAIM_TTL_MS = 60_000

/** The `.or()` filter that admits an unclaimed submission or an abandoned claim. */
export function approvalClaimFilter(now: Date): string {
  const staleBefore = new Date(now.getTime() - PORTAL_APPROVAL_CLAIM_TTL_MS).toISOString()
  return `approval_claimed_at.is.null,approval_claimed_at.lt.${staleBefore}`
}

async function claimApproval(submissionId: string, now: Date): Promise<'claimed' | 'busy' | 'error'> {
  const { data, error } = await partner()
    .from('place_submissions')
    .update({ approval_claimed_at: now.toISOString() })
    .eq('id', submissionId)
    .eq('status', 'in_review')
    .or(approvalClaimFilter(now))
    .select('id')
  if (error) {
    console.error('[portal-validation] approval claim failed', error.code)
    return 'error'
  }
  return (data ?? []).length > 0 ? 'claimed' : 'busy'
}

async function releaseApproval(submissionId: string): Promise<void> {
  const { error } = await partner()
    .from('place_submissions')
    .update({ approval_claimed_at: null })
    .eq('id', submissionId)
  // A failed release only delays the retry by the TTL.
  if (error) console.error('[portal-validation] approval claim release failed', error.code)
}

/**
 * Approve: claim → POI (`createPrefilledPlace`, the operator's session, because
 * `cms_create_place` refuses `service_role`) → `attraction_id` → client → link, details and
 * coordinate → transition. See the header for why each step is safe to run again.
 */
export async function approvePortalSubmission(
  submissionId: string,
  operator: SupabaseClient,
  actorUserId: string,
  now: Date = new Date()
): Promise<PortalActOutcome> {
  const { data, error } = await partner()
    .from('place_submissions')
    .select('id, status, answers, attraction_id')
    .eq('id', submissionId)
    .maybeSingle()
  if (error) {
    console.error('[portal-validation] submission read failed', error.code)
    return { ok: false, httpStatus: 503, error: 'lookup_failed' }
  }
  const submission = data as SubmissionForApproval | null
  if (!submission) return { ok: false, httpStatus: 404, error: 'not_found' }
  if (submission.status !== 'in_review') return { ok: false, httpStatus: 409, error: 'status_conflict' }

  const answers = submission.answers ?? {}
  const prefill = buildPlacePrefill(answers)
  if (!prefill) return { ok: false, httpStatus: 422, error: 'nothing_to_prefill' }

  const claim = await claimApproval(submission.id, now)
  if (claim === 'error') return { ok: false, httpStatus: 503, error: 'claim_failed' }
  if (claim === 'busy') return { ok: false, httpStatus: 409, error: 'approval_in_progress' }

  const outcome = await approveClaimed(submission, answers, prefill, operator, actorUserId)
  if (!outcome.ok) await releaseApproval(submission.id)
  return outcome
}

async function approveClaimed(
  submission: SubmissionForApproval,
  answers: PartnerAnswers,
  prefill: PlacePrefill,
  operator: SupabaseClient,
  actorUserId: string
): Promise<PortalActOutcome> {
  let attractionId = submission.attraction_id
  if (!attractionId) {
    const created = await createPrefilledPlace(prefill, operator)
    if (created.status === 'failed') return { ok: false, httpStatus: 503, error: created.reason, attractionId: null }
    const { error: linkError } = await partner()
      .from('place_submissions')
      .update({ attraction_id: created.attractionId })
      .eq('id', submission.id)
    if (linkError) {
      console.error('[portal-validation] attraction_id not written', created.attractionId, linkError.code)
      return { ok: false, httpStatus: 503, error: 'link_failed', attractionId: created.attractionId }
    }
    attractionId = created.attractionId
  }

  const client = await resolveApprovalClient(submission.id, attractionId, answers, operator)
  if (!client.ok) return { ok: false, httpStatus: 503, error: client.error, attractionId }

  const place = await applyPlacePrefill(attractionId, prefill, client.clientId, operator)
  if (place.status === 'failed') return { ok: false, httpStatus: 503, error: place.reason, attractionId }

  const outcome = await transition(submission.id, 'approved', actorUserId, null)
  return outcome.ok ? { ...outcome, attractionId, clientId: client.clientId } : { ...outcome, attractionId }
}

/**
 * The client of this submission: the one its POI is already linked to (a retry), else the one
 * with the same CNPJ, else a new one from `PROMOTION_MAP`. Read with the operator's session —
 * the POI is unapproved and only `CMS admins can read attractions` sees it.
 */
async function resolveApprovalClient(
  submissionId: string,
  attractionId: string,
  answers: PartnerAnswers,
  operator: SupabaseClient
): Promise<{ ok: true; clientId: string } | { ok: false; error: string }> {
  const { data, error } = await operator
    .schema('core')
    .from('attractions')
    .select('partner_client_id')
    .eq('id', attractionId)
    .maybeSingle()
  if (error || !data) {
    console.error('[portal-validation] POI read failed', attractionId, error?.code ?? 'no_row')
    return { ok: false, error: 'lookup_failed' }
  }
  const linked = (data as { partner_client_id: string | null }).partner_client_id
  if (linked) return { ok: true, clientId: linked }

  const existing = answers.tax_id ? await findClientByTaxId(answers.tax_id) : null
  if (existing) return { ok: true, clientId: existing.id as string }

  // `partner.clients.email` is NOT NULL, and the portal never asks `representative_email` (the
  // public form's source for it in PROMOTION_MAP): the portal's e-mail is the acceptance's.
  const email = await acceptanceEmailOf(submissionId)
  if (!email) return { ok: false, error: 'lookup_failed' }
  const portalAnswers: PartnerAnswers = { ...answers, representative_email: email }
  const plan = buildPromotionPlan(portalAnswers, null, {
    categoryLabel: CATEGORY_LABELS[answers.category ?? ''] ?? null,
  })
  const write = resolvePromotionWrite(plan, { approved: [] })
  const created = await createPromotedClient(write.updates, answers)
  return created.ok ? { ok: true, clientId: created.clientId } : { ok: false, error: 'client_write_failed' }
}

/** The e-mail the client accepted the terms with (`partner.place_acceptances.email`). */
async function acceptanceEmailOf(submissionId: string): Promise<string | null> {
  const { data, error } = await partner()
    .from('place_acceptances')
    .select('email')
    .eq('submission_id', submissionId)
    .maybeSingle()
  if (error || !data) {
    console.error('[portal-validation] acceptance read failed', error?.code ?? 'no_row')
    return null
  }
  return (data as { email: string | null }).email || null
}

/**
 * Whether a client came from the portal — a POI of theirs is the `attraction_id` of a
 * submission. The contract route refuses those: the portal's acceptance IS the instrument
 * (BR-B2B-047, item 1), and a second one would be generated over it.
 *
 * FAILS CLOSED (security review): `null` means the lookup failed, and the route refuses on it —
 * answering "not a portal client" on an error is how a second instrument gets generated.
 */
export async function isPortalClient(clientId: string): Promise<boolean | null> {
  const { data: places, error: placesError } = await getSupabaseService()
    .schema('core')
    .from('attractions')
    .select('id')
    .eq('partner_client_id', clientId)
    .limit(50)
  if (placesError) {
    console.error('[portal-validation] client places lookup failed', placesError.code)
    return null
  }
  if (!places || places.length === 0) return false

  const { data, error } = await partner()
    .from('place_submissions')
    .select('id')
    .in(
      'attraction_id',
      (places as { id: string }[]).map((place) => place.id)
    )
    .limit(1)
  if (error) {
    // Before migration 20261004120000 the table does not exist: that also refuses, so the CMS
    // that carries this ships after the migration (release order, CLAUDE.md §2).
    console.error('[portal-validation] portal origin lookup failed', error.code)
    return null
  }
  return (data ?? []).length > 0
}
