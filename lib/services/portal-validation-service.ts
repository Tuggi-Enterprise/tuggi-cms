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
 * transition atomically (#805 shipped only the transition), so every step is idempotent on
 * retry: the client is found by CNPJ before it is created, `attraction_id` is written the moment
 * the POI exists, and a submission that already has one skips the creation. A failure halfway
 * leaves the submission `in_review` and the next click converges; the transition, which is the
 * only thing the portal shows the client, happens last.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseService } from '@/lib/core/supabase-client'
import { buildPromotionPlan, resolvePromotionWrite } from '@/lib/partner-form/promotion'
import { buildPlacePrefill } from '@/lib/partner-form/place-prefill'
import type { PartnerAnswers } from '@/lib/partner-form/schema'
import { createPlaceFromPrefill } from '@/lib/services/partner-place-provisioning'
import { createPromotedClient, findClientByTaxId } from '@/lib/services/partner-proposal-admin-service'
import ptMessages from '@/messages/pt.json'

function partner() {
  return getSupabaseService().schema('partner')
}

/** Closed list of refusal reasons, from the #812 spec. The id goes to the audit log. */
export const PORTAL_REFUSAL_REASONS = [
  'ineligible',
  'duplicate',
  'nothing_to_tell',
  'irregular_company',
  'other',
] as const
export type PortalRefusalReason = (typeof PORTAL_REFUSAL_REASONS)[number]

/** The note the spec asks for: at least 10 characters after trimming. */
export const PORTAL_NOTE_MIN = 10
export const PORTAL_NOTE_MAX = 2000

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

/**
 * Approve: client (found or created) → POI (`createPlaceFromPrefill`, the operator's session,
 * because `cms_create_place` refuses `service_role`) → `attraction_id` → transition.
 */
export async function approvePortalSubmission(
  submissionId: string,
  operator: SupabaseClient,
  actorUserId: string
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
  let attractionId = submission.attraction_id
  let clientId: string | undefined

  if (!attractionId) {
    const prefill = buildPlacePrefill(answers)
    if (!prefill) return { ok: false, httpStatus: 422, error: 'nothing_to_prefill' }

    const existing = answers.tax_id ? await findClientByTaxId(answers.tax_id) : null
    if (existing) {
      clientId = existing.id as string
    } else {
      const plan = buildPromotionPlan(answers, null, {
        categoryLabel: CATEGORY_LABELS[answers.category ?? ''] ?? null,
      })
      const write = resolvePromotionWrite(plan, { approved: [] })
      const created = await createPromotedClient(write.updates, answers)
      if (!created.ok) return { ok: false, httpStatus: 503, error: 'client_write_failed' }
      clientId = created.clientId
    }

    const place = await createPlaceFromPrefill(prefill, clientId, operator)
    if (place.attractionId) {
      const { error: linkError } = await partner()
        .from('place_submissions')
        .update({ attraction_id: place.attractionId })
        .eq('id', submission.id)
      if (linkError) {
        console.error('[portal-validation] attraction_id not written', place.attractionId, linkError.code)
        return { ok: false, httpStatus: 503, error: 'link_failed', attractionId: place.attractionId }
      }
    }
    if (place.status === 'failed') {
      return { ok: false, httpStatus: 503, error: place.reason, attractionId: place.attractionId }
    }
    attractionId = place.attractionId
  }

  const outcome = await transition(submission.id, 'approved', actorUserId, null)
  return outcome.ok ? { ...outcome, attractionId, clientId } : { ...outcome, attractionId }
}

/**
 * Whether a client came from the portal — a POI of theirs is the `attraction_id` of a
 * submission. The contract route refuses those: the portal's acceptance IS the instrument
 * (BR-B2B-047, item 1), and a second one would be generated over it.
 */
export async function isPortalClient(clientId: string): Promise<boolean> {
  const { data: places, error: placesError } = await getSupabaseService()
    .schema('core')
    .from('attractions')
    .select('id')
    .eq('partner_client_id', clientId)
    .limit(50)
  if (placesError || !places || places.length === 0) return false

  const { data, error } = await partner()
    .from('place_submissions')
    .select('id')
    .in(
      'attraction_id',
      (places as { id: string }[]).map((place) => place.id)
    )
    .limit(1)
  if (error) {
    // Before migration 20261004120000 the table does not exist, and no portal client either.
    console.error('[portal-validation] portal origin lookup failed', error.code)
    return false
  }
  return (data ?? []).length > 0
}
