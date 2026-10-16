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
 *    retry finishes a half-written POI instead of approving it without offer and without pin;
 *  · so is the tier's description (#888, `applyPrefillDescription`), which never writes over one.
 * A failure halfway leaves the submission `in_review`, gives the claim back, and the next click
 * converges; the transition, which is the only thing the portal shows the client, happens last.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseService } from '@/lib/core/supabase-client'
import { buildPromotionPlan, resolvePromotionWrite } from '@/lib/partner-form/promotion'
import { buildPlacePrefill } from '@/lib/partner-form/place-prefill'
import type { PartnerAnswers } from '@/lib/partner-form/schema'
import type { PlacePrefill } from '@/lib/partner-form/place-prefill'
import {
  applyPlacePrefill,
  applyPrefillDescription,
  createPrefilledPlace,
} from '@/lib/services/partner-place-provisioning'
import { PLAN_CHOICES, type PlanChoice } from '@/lib/partner-form/fields'
import { createPromotedClient, findClientByTaxId } from '@/lib/services/partner-proposal-admin-service'
import { ClientService } from '@/lib/services/client-service'
import ptMessages from '@/messages/pt.json'
import {
  clientTypeOfKind,
  hasNoPlace,
  noPlaceApprovalBlock,
  partnerKindOf,
  type PartnerKind,
} from '@/lib/partnerships/partner-kind'
import { copyGuidePhoto, guideRpcErrorOf } from '@/lib/services/guide-profile-service'

function partner() {
  return getSupabaseService().schema('partner')
}

/** The `partner` schema client, injectable so the publish → `live` path is tested without a database. */
type PartnerSchema = Pick<ReturnType<typeof partner>, 'from' | 'rpc'>

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
  /** #936: publishes an approved guide's profile — the retry of the approval's second half. */
  | { action: 'publish_guide' }
  | { action: 'request_changes'; note: string }
  | { action: 'reject'; note: string; reason: PortalRefusalReason }

/** The body of the decision route, or the code of what is wrong with it. */
export function parsePortalDecision(body: unknown): PortalDecision | { error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'invalid_body' }
  const record = body as Record<string, unknown>
  if (record.action === 'approve') return { action: 'approve' }
  if (record.action === 'publish_guide') return { action: 'publish_guide' }

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
  | {
      ok: true
      status: string
      attractionId?: string
      clientId?: string
      /**
       * #936: the guide was approved and the profile did not reach the app. The approval stands;
       * the screen says so and offers "Publicar o perfil" (`publish_guide`).
       */
      guidePublishError?: string
    }
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
  to: 'approved' | 'changes_requested' | 'rejected' | 'live',
  actorUserId: string,
  note: string | null,
  db: PartnerSchema = partner()
): Promise<PortalActOutcome> {
  const { data, error } = await db.rpc('transition_place_submission', {
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

/**
 * PUBLISHED → `live` AT THE ACT (#906, BR-B2B-049 item 8). Called by the publish route right after
 * `placeService.setApproved(…, true)` succeeded, so the portal says "Publicado" the moment the
 * operator publishes, not the next morning.
 *
 * "Published" is ONE criterion, `core.attractions.approved = true`, the column the act writes. The
 * daily `places-payment-sweep` (`runTransitionEmails`, `_shared/places-transition-email.ts`) reads
 * the same column and catches every other publish path, plus anything this call missed.
 *
 * Only a submission in `approved` moves: no submission, or one in another status, is nothing to do.
 * Never throws and never undoes the publication — a failure is logged and the sweep repairs it.
 * Returns the submissions that went live, so the caller sends their "no ar" e-mail (the sweep only
 * mails what IT moves).
 */
export async function markPortalSubmissionLive(
  attractionId: string,
  actorUserId: string,
  db: PartnerSchema = partner()
): Promise<string[]> {
  try {
    const { data, error } = await db
      .from('place_submissions')
      .select('id')
      .eq('attraction_id', attractionId)
      .eq('status', 'approved')
    if (error) {
      console.error('[portal-validation] live lookup failed', attractionId, error.code)
      return []
    }
    const live: string[] = []
    for (const row of (data ?? []) as { id: string }[]) {
      const outcome = await transition(row.id, 'live', actorUserId, null, db)
      if (outcome.ok) live.push(row.id)
    }
    return live
  } catch (error) {
    console.error('[portal-validation] live transition threw', attractionId, error instanceof Error ? error.message : 'unknown')
    return []
  }
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
  client_id: string | null
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
 * coordinate → client approved (status + CMS user, `ClientService.approveClient`) → transition. See the header for why each step is safe to run again.
 */
export async function approvePortalSubmission(
  submissionId: string,
  operator: SupabaseClient,
  actorUserId: string,
  /** `core.cms_users.id` of the operator — `partner.clients.approved_by` references it. */
  approverCmsUserId: string,
  now: Date = new Date()
): Promise<PortalActOutcome> {
  const { data, error } = await partner()
    .from('place_submissions')
    .select('id, status, answers, attraction_id, client_id')
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
  const kind = partnerKindOf(answers)
  if (hasNoPlace(kind)) {
    // BR-B2B-064 item 5: without the consent to show the contact, the guide does not approve —
    // refused here, before the claim and before any write, whatever the screen offered.
    const blocked = noPlaceApprovalBlock(answers)
    if (blocked) return { ok: false, httpStatus: 422, error: blocked }
    const claimed = await claimApproval(submission.id, now)
    if (claimed === 'error') return { ok: false, httpStatus: 503, error: 'claim_failed' }
    if (claimed === 'busy') return { ok: false, httpStatus: 409, error: 'approval_in_progress' }
    const done = await approveWithoutPlace(submission, answers, kind, operator, actorUserId, approverCmsUserId)
    if (!done.ok) await releaseApproval(submission.id)
    return done
  }

  const prefill = buildPlacePrefill(answers)
  if (!prefill) return { ok: false, httpStatus: 422, error: 'nothing_to_prefill' }

  const claim = await claimApproval(submission.id, now)
  if (claim === 'error') return { ok: false, httpStatus: 503, error: 'claim_failed' }
  if (claim === 'busy') return { ok: false, httpStatus: 409, error: 'approval_in_progress' }

  const outcome = await approveClaimed(submission, answers, prefill, operator, actorUserId, approverCmsUserId)
  if (!outcome.ok) await releaseApproval(submission.id)
  return outcome
}

async function approveClaimed(
  submission: SubmissionForApproval,
  answers: PartnerAnswers,
  prefill: PlacePrefill,
  operator: SupabaseClient,
  actorUserId: string,
  approverCmsUserId: string
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

  const acceptance = await acceptanceOf(submission.id)
  if (!acceptance) return { ok: false, httpStatus: 503, error: 'lookup_failed', attractionId }

  const client = await resolveApprovalClient(attractionId, answers, acceptance.email, operator)
  if (!client.ok) return { ok: false, httpStatus: 503, error: client.error, attractionId }

  const place = await applyPlacePrefill(attractionId, prefill, client.clientId, operator)
  if (place.status === 'failed') return { ok: false, httpStatus: 503, error: place.reason, attractionId }

  // #888: the place is born with its tier's description — `story_script` on the paid tier, the
  // name on the free one. The tier is the one the client accepted AND paid on the portal (payment
  // is confirmed before validation, BR-B2B-046 item 1), and `describeDescriptionPolicy` decides.
  // Text only: nothing here generates or queues audio (the app voices the description).
  const described = await applyPrefillDescription(
    attractionId,
    { story: answers.story_script ?? null, acceptedPlanChoice: acceptance.planChoice },
    operator
  )
  if (described.status === 'failed') {
    return { ok: false, httpStatus: 503, error: described.reason, attractionId }
  }

  // The relationship is approved by the same act (#872): `status = 'approved'` is what makes the
  // client attributable (BR-MONETIZACAO-027) and creates its CMS user — the SAME function as the
  // record's `Aprovar`, so there is one definition of "approved client".
  const approval = await approveRelationship(client.clientId, approverCmsUserId)
  if (!approval.ok) return { ok: false, httpStatus: 503, error: approval.error, attractionId }

  const outcome = await transition(submission.id, 'approved', actorUserId, null)
  return outcome.ok ? { ...outcome, attractionId, clientId: client.clientId } : { ...outcome, attractionId }
}

/**
 * THE PARTNER WITHOUT A PLACE (#936, BR-B2B-064, BR-B2B-065; contract §8.6). No POI is created and
 * `cms_create_place` never runs. Order, each step safe to run again:
 *   client (the one `client_id` already names — a retry —, else by CNPJ when there is one, else
 *   created as `tour_guide` / `driver`) → `client_id` → client approved → transition `approved`
 *   → for the guide only: photo copy → `core.cms_publish_guide_profile` → transition `live`.
 *
 * THE APPROVAL COMES BEFORE THE PUBLICATION, against the order of contract §8.6, on purpose: the
 * spec (#936 §3) wants "Aprovado, mas o perfil não foi para o app" when the publication fails, and
 * that sentence is only true if the approval already happened. `cms_publish_guide_profile` accepts
 * `approved`, so nothing in the database prefers the other order.
 */
async function approveWithoutPlace(
  submission: SubmissionForApproval,
  answers: PartnerAnswers,
  kind: PartnerKind,
  operator: SupabaseClient,
  actorUserId: string,
  approverCmsUserId: string
): Promise<PortalActOutcome> {
  let clientId = submission.client_id
  if (!clientId) {
    const acceptance = await acceptanceOf(submission.id)
    if (!acceptance) return { ok: false, httpStatus: 503, error: 'lookup_failed' }
    const existing = answers.tax_id ? await findClientByTaxId(answers.tax_id) : null
    // The CNPJ is public: a guide who types the CNPJ of a client of another type must not get that
    // client linked and approved here (security review of #936). Refused before any write — the
    // database would refuse the transition anyway (TGP10), but only after the approval.
    if (existing && existing.client_type !== clientTypeOfKind(kind)) {
      return { ok: false, httpStatus: 409, error: 'tax_id_other_client_type' }
    }
    if (existing) {
      clientId = existing.id as string
    } else {
      if (!acceptance.email) return { ok: false, httpStatus: 503, error: 'lookup_failed' }
      const plan = buildPromotionPlan({ ...answers, representative_email: acceptance.email }, null, {
        categoryLabel: CATEGORY_LABELS[answers.category ?? ''] ?? null,
      })
      const write = resolvePromotionWrite(plan, { approved: [] })
      const created = await createPromotedClient(write.updates, answers, clientTypeOfKind(kind))
      if (!created.ok) return { ok: false, httpStatus: 503, error: 'client_write_failed' }
      clientId = created.clientId
    }
    const { error: linkError } = await partner()
      .from('place_submissions')
      .update({ client_id: clientId })
      .eq('id', submission.id)
    if (linkError) {
      console.error('[portal-validation] client_id not written', linkError.code)
      return { ok: false, httpStatus: 503, error: 'link_failed' }
    }
  }

  const approval = await approveRelationship(clientId, approverCmsUserId)
  if (!approval.ok) return { ok: false, httpStatus: 503, error: approval.error }

  const outcome = await transition(submission.id, 'approved', actorUserId, null)
  if (!outcome.ok) return outcome
  if (kind !== 'guide') return { ...outcome, clientId }

  const published = await publishGuide(submission.id, clientId, answers, operator, actorUserId)
  return published.ok
    ? { ok: true, status: published.status, clientId }
    : { ...outcome, clientId, guidePublishError: published.error }
}

/**
 * The guide's publication: photo → profile → `live`. Shared by the approval and by
 * `publishApprovedGuide` (the "Publicar o perfil" retry), so the two cannot publish differently.
 * `live` is "Publicado" in the portal (contract §8.6); a failed `live` after a published profile
 * is logged and answered as published, because the app already lists the guide.
 */
async function publishGuide(
  submissionId: string,
  clientId: string,
  answers: PartnerAnswers,
  operator: SupabaseClient,
  actorUserId: string,
  alreadyLive = false
): Promise<{ ok: true; status: string } | { ok: false; httpStatus: number; error: string }> {
  const copied = await copyGuidePhoto(submissionId, clientId, answers.profile_photo)
  if (!copied.ok) return { ok: false, httpStatus: copied.error === 'invalid_photo' ? 422 : 503, error: copied.error }

  const { error } = await operator.schema('core').rpc('cms_publish_guide_profile', { p_submission_id: submissionId })
  if (error) {
    console.error('[portal-validation] guide publish failed', error.code)
    return { ok: false, ...guideRpcErrorOf(error.code, (error as { details?: string }).details) }
  }
  if (alreadyLive) return { ok: true, status: 'live' }
  const live = await transition(submissionId, 'live', actorUserId, null)
  if (!live.ok) console.error('[portal-validation] guide live transition failed', live.error)
  return { ok: true, status: live.ok ? live.status : 'approved' }
}

/** "Publicar o perfil" (#936 §3): an approved guide whose profile is not in the app yet. */
export async function publishApprovedGuide(
  submissionId: string,
  operator: SupabaseClient,
  actorUserId: string
): Promise<PortalActOutcome> {
  const { data, error } = await partner()
    .from('place_submissions')
    .select('id, status, answers, attraction_id, client_id')
    .eq('id', submissionId)
    .maybeSingle()
  if (error) {
    console.error('[portal-validation] submission read failed', error.code)
    return { ok: false, httpStatus: 503, error: 'lookup_failed' }
  }
  const submission = data as SubmissionForApproval | null
  if (!submission) return { ok: false, httpStatus: 404, error: 'not_found' }
  const answers = submission.answers ?? {}
  if (partnerKindOf(answers) !== 'guide') return { ok: false, httpStatus: 422, error: 'not_a_guide' }
  if (!['approved', 'live'].includes(submission.status) || !submission.client_id) {
    return { ok: false, httpStatus: 409, error: 'status_conflict' }
  }
  const blocked = noPlaceApprovalBlock(answers)
  if (blocked) return { ok: false, httpStatus: 422, error: blocked }
  const published = await publishGuide(
    submission.id,
    submission.client_id,
    answers,
    operator,
    actorUserId,
    submission.status === 'live'
  )
  return published.ok ? { ok: true, status: published.status, clientId: submission.client_id } : published
}

/**
 * The client of this submission: the one its POI is already linked to (a retry), else the one
 * with the same CNPJ, else a new one from `PROMOTION_MAP`. Read with the operator's session —
 * the POI is unapproved and only `CMS admins can read attractions` sees it.
 */
async function resolveApprovalClient(
  attractionId: string,
  answers: PartnerAnswers,
  acceptanceEmail: string | null,
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
  if (!acceptanceEmail) return { ok: false, error: 'lookup_failed' }
  const portalAnswers: PartnerAnswers = { ...answers, representative_email: acceptanceEmail }
  const plan = buildPromotionPlan(portalAnswers, null, {
    categoryLabel: CATEGORY_LABELS[answers.category ?? ''] ?? null,
  })
  const write = resolvePromotionWrite(plan, { approved: [] })
  const created = await createPromotedClient(write.updates, answers)
  return created.ok ? { ok: true, clientId: created.clientId } : { ok: false, error: 'client_write_failed' }
}

/**
 * `ClientService.approveClient` over the client's own e-mail and name — the same input the record's
 * `Aprovar` sends (`ApprovalHeaderControls`). Retry-safe: an approved client is left as it is.
 */
async function approveRelationship(
  clientId: string,
  approverCmsUserId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await partner()
    .from('clients')
    .select('email, name')
    .eq('id', clientId)
    .maybeSingle()
  const row = data as { email: string | null; name: string | null } | null
  const email = row?.email?.trim() ?? ''
  const name = row?.name?.trim() ?? ''
  if (error || !email || !name) {
    console.error('[portal-validation] client read for approval failed', error?.code ?? 'no_email_or_name')
    return { ok: false, error: 'client_approval_failed' }
  }
  try {
    await ClientService.approveClient(clientId, approverCmsUserId, email, name)
    return { ok: true }
  } catch (err) {
    console.error('[portal-validation] client approval failed', err instanceof Error ? err.message : err)
    return { ok: false, error: 'client_approval_failed' }
  }
}

/**
 * What the client accepted (`partner.place_acceptances`): the e-mail it accepted with, and the tier
 * it accepted and paid — the acceptance IS the instrument (BR-B2B-047, item 1). `null` when the
 * read failed or there is no acceptance; a tier the form no longer offers reads `null`.
 */
async function acceptanceOf(
  submissionId: string
): Promise<{ email: string | null; planChoice: PlanChoice | null } | null> {
  const { data, error } = await partner()
    .from('place_acceptances')
    .select('email, plan_choice')
    .eq('submission_id', submissionId)
    .maybeSingle()
  if (error || !data) {
    console.error('[portal-validation] acceptance read failed', error?.code ?? 'no_row')
    return null
  }
  const row = data as { email: string | null; plan_choice: string | null }
  const planChoice = PLAN_CHOICES.find((choice) => choice === row.plan_choice) ?? null
  return { email: row.email || null, planChoice }
}

/**
 * #916: the mirror submission of a client from before the portal (`legacy_client_id`, made by
 * `partner.place_seed_legacy_submission` so the client reaches `/status`) is no portal registration
 * while it has no acceptance: nobody registered the place through the portal and nobody accepted the
 * portal terms. Once the client accepts a portal plan on it (`core.portal_accept_legacy_plan`), it is.
 * Reads `legacy_client_id` (migration of #916): the CMS that carries this ships after it.
 */
export const PORTAL_REGISTRATION_COLUMNS = 'legacy_client_id, place_acceptances(id)'

export function isLegacyMirror(row: { legacy_client_id?: string | null; place_acceptances?: unknown }): boolean {
  const acceptance = Array.isArray(row.place_acceptances) ? row.place_acceptances[0] : row.place_acceptances
  return !!row.legacy_client_id && !acceptance
}

/**
 * The portal registration of ONE place (#885, `mergeRegistrationIntoPlace`): the answers of the
 * latest submission whose POI it is, and the tier accepted on it (`acceptanceOf`). `null` when the
 * place has no portal submission (#916: a legacy mirror is none); `undefined` when the read failed.
 */
export async function portalRegistrationOfPlace(
  attractionId: string
): Promise<{ answers: PartnerAnswers; acceptedPlanChoice: PlanChoice | null } | null | undefined> {
  const { data, error } = await partner()
    .from('place_submissions')
    .select(`id, answers, ${PORTAL_REGISTRATION_COLUMNS}`)
    .eq('attraction_id', attractionId)
    .order('submitted_at', { ascending: false })
    .limit(5)
  if (error) {
    console.error('[portal-validation] place registration lookup failed', error.code)
    return undefined
  }
  const submission = (data as ({ id: string; answers: PartnerAnswers | null } & Parameters<typeof isLegacyMirror>[0])[] | null)?.find(
    (row) => !isLegacyMirror(row)
  )
  if (!submission) return null
  const acceptance = await acceptanceOf(submission.id)
  return { answers: submission.answers ?? {}, acceptedPlanChoice: acceptance?.planChoice ?? null }
}

/** A portal submission of a client, as the client record and the contract guard read it. */
export interface ClientPortalSubmission {
  id: string
  status: string
  /** `null` for a partner without a place, linked by `client_id` (#936). */
  attraction_id: string | null
  submitted_at: string | null
}

/**
 * The portal submissions behind a client's places: a POI of theirs is the `attraction_id` of a
 * submission (the link `resolveApprovalClient` writes), a legacy mirror left out (#916,
 * `isLegacyMirror`). `null` when either read failed — the callers decide what failing means for them.
 */
export async function portalSubmissionsOfClient(clientId: string): Promise<ClientPortalSubmission[] | null> {
  // The id goes into a PostgREST `or` filter below: anything but a UUID never gets there.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId)) return []
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
  const placeIds = ((places ?? []) as { id: string }[]).map((place) => place.id)

  // #936: a partner without a place reaches its client through `client_id`, not through a POI.
  const filter = placeIds.length > 0 ? `attraction_id.in.(${placeIds.join(',')}),client_id.eq.${clientId}` : `client_id.eq.${clientId}`
  const { data, error } = await partner()
    .from('place_submissions')
    .select(`id, status, attraction_id, submitted_at, ${PORTAL_REGISTRATION_COLUMNS}`)
    .or(filter)
    .order('submitted_at', { ascending: false })
    .limit(50)
  if (error) {
    // Before migration 20261004120000 the table does not exist, and before 20261016120000 the
    // column `client_id` does not: both refuse, so the CMS that carries this ships after them.
    console.error('[portal-validation] portal origin lookup failed', error.code)
    return null
  }
  return ((data ?? []) as (ClientPortalSubmission & Parameters<typeof isLegacyMirror>[0])[])
    .filter((row) => !isLegacyMirror(row))
    .map(({ id, status, attraction_id, submitted_at }) => ({ id, status, attraction_id, submitted_at }))
}

/**
 * Whether a client came from the portal. The contract route refuses those: the portal's
 * acceptance IS the instrument (BR-B2B-047, item 1), and a second one would be generated over it.
 *
 * FAILS CLOSED (security review): `null` means the lookup failed, and the route refuses on it —
 * answering "not a portal client" on an error is how a second instrument gets generated.
 */
export async function isPortalClient(clientId: string): Promise<boolean | null> {
  const submissions = await portalSubmissionsOfClient(clientId)
  return submissions === null ? null : submissions.length > 0
}
