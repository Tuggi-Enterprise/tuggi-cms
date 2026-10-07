/**
 * Provisioning the partner's place out of the proposal — the MANUAL act, and the word manual is
 * the whole point.
 *
 * ⚠️ THE NOTIFICATIONS LIVE IN THE DATABASE and they are not coming back. The Pro grant, the
 * push and the e-mail run from DB triggers on `partner.clients` — migration
 * `20260624140300_partner_notifications_db.sql` (`core.notify_partner_status_change`). Do NOT
 * re-add them here.
 *
 * ⚠️ APPROVING THE CLIENT NO LONGER CALLS THIS, and that is the fix of 2026-08-23. Since #360
 * approval created the place by itself, and every client it touched got a duplicate: the
 * establishment was already in the catalogue, published and pinned, and approval put an empty
 * row beside it with no coordinate and no trigger point.
 *
 *   BAIRES BISTRO       catalogue → `Baires Bistrô`        approval → `BAIRES BISTRO` (empty)
 *   Tucas               catalogue → `Tucas Empório Bistrô` approval → `Tucas` (empty)
 *   CAFETERIA ENCONTROS catalogue → `Cafeteria Encontros`  approval → `CAFETERIA ENCONTROS` (empty)
 *   Faella Bistrô       catalogue → `Faella Bistrô`        approval → `Faella Bistro` (empty)
 *
 * An automatic act cannot search first, and searching first is what stops the duplicate — so
 * the act moved to where a human is looking at the answer: the `Locais` tab, where the
 * catalogue search comes BEFORE this button (`PlaceLinkPanel`). Creating is now the exception,
 * for an establishment the catalogue does not carry yet.
 *
 * THE FOUR THINGS THIS IS NOT, each one a rule and each one visible in the code below:
 *  · it does not APPROVE the place — `core.cms_create_place` inserts `approved = false`, and
 *    BR-B2B-011 keeps the three triage gates as a human decision;
 *  · it does not start the BILLING — BR-B2B-018, item 1: the fee starts on the PUBLICATION of
 *    the POI with the description on air. Since #888 the place is born WITH its tier's description
 *    (`applyPartnerPlaceDescription`: the name on the free tier, `story_script` on the paid one),
 *    but it is born unapproved, so nothing is on air until a person publishes it;
 *  · it does not give PROMINENCE — BR-B2B-010, item 6. See `PLACE_PREFILL_NEVER_WRITES`;
 *  · it does not make the client's place UNIQUE — BR-B2B-033, item 3, is 1 client : N places.
 *    The guard below stops THIS act from running twice, not the operator from registering the
 *    second address of the same CNPJ.
 *
 * AND ONE DECISION THAT HAS TO BE DELIBERATE, because a POI can be invisible for two different
 * reasons and they are not interchangeable. The place is born `approved = false` and
 * `is_active = true` — the RPC's own values, untouched here. What keeps it away from the
 * tourist is `approved`: `core.app_get_nearby_places` and `core.app_get_place_details` require
 * `approved = true AND is_active = true` and a non-null coordinate, and this place has none of
 * the three. Setting `is_active = false` on top would ALSO hide it (BR-POI-005) while saying
 * something false — that a registration was taken out of operation — and BR-POI-005, item 5,
 * is explicit that inactivity is not to be used to produce a commercial effect.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { placeService } from '@/lib/core/place-service'
import {
  buildPlacePrefill,
  CATALOGUE_WINS_COLUMNS,
  mergePlacePrefill,
  type CataloguePlace,
  type PlacePrefill,
  type PrefillWrite,
} from '@/lib/partner-form/place-prefill'
import type { PartnerAnswers } from '@/lib/partner-form/schema'
import type { PlanChoice } from '@/lib/partner-form/fields'
import { findPromotedSubmission } from '@/lib/services/partner-proposal-admin-service'
import { portalRegistrationOfPlace } from '@/lib/services/portal-validation-service'
import {
  applyPartnerPlaceDescription,
  type PartnerDescriptionInput,
  type PartnerDescriptionOutcome,
} from '@/lib/services/place-description-policy-service'

/**
 * What the act did about the place, as data. The route reports it and never throws on it: the
 * operator asked for a place, and a screen that 500s over a catalogue write leaves them
 * re-clicking an act that already happened.
 */
export type PartnerPlaceOutcome =
  | { status: 'created'; attractionId: string }
  | {
      status: 'skipped'
      reason: 'no_promoted_proposal' | 'nothing_to_prefill' | 'already_provisioned' | 'not_linked'
    }
  | {
      // #885 — the registration merged into a catalogue POI (`mergeRegistrationIntoPlace`).
      // `prefill` says whether there was a registration to bring; the description runs either way.
      status: 'merged'
      attractionId: string
      prefill: 'applied' | 'no_promoted_proposal' | 'nothing_to_prefill'
      description: PartnerDescriptionOutcome
    }
  | {
      status: 'failed'
      // `details_failed` / `coordinate_failed` only from the portal's keys (`createPlaceFromPrefill`);
      // the old form's prefill has no details and no coordinate, so its route never sees them.
      reason:
        | 'lookup_failed'
        | 'create_failed'
        | 'link_failed'
        | 'details_failed'
        | 'coordinate_failed'
        | 'description_failed'
      attractionId: string | null
    }

/**
 * A place already linked to this client, if there is one.
 *
 * Read with the OPERATOR's client, the same identity that is about to write: the policy `CMS
 * admins can read attractions` is what lets an unapproved row be seen at all, and asking with
 * `service_role` would answer for an identity that is not the one doing the act.
 *
 * `undefined` means the lookup itself failed, and that is NOT the same as "no place": creating
 * on a failed read is how the same client ends up with two identical places on the second
 * click. It fails closed.
 */
async function findLinkedPlace(
  clientId: string,
  operator: SupabaseClient
): Promise<string | null | undefined> {
  const { data, error } = await operator
    .schema('core')
    .from('attractions')
    .select('id')
    .eq('partner_client_id', clientId)
    .limit(1)

  if (error) return undefined
  return (data as { id: string }[] | null)?.[0]?.id ?? null
}

/**
 * Creates the partner's place out of the proposal that was promoted into this client. Called by
 * ONE route — `POST /api/admin/partnerships/clients/{id}/places`, the button behind the
 * catalogue search.
 *
 * `operator` is the route handler's client, carrying the admin's session — see the note on
 * `place-service.ts`: `core.cms_create_place` is gated on `is_active_cms_editor_or_admin()`,
 * which reads the JWT's e-mail, and writing `partner_client_id` needs the `CMS admins can
 * update attractions` policy. `service_role` satisfies neither the gate nor the intent.
 *
 * THE RESIDUE THIS LEAVES, and it is the honest one: the place is created and the link is not.
 * PostgREST has no transaction across statements and `cms_create_place` takes no
 * `partner_client_id`, so the two writes cannot be one. Deleting the place to clean up is not
 * an option — it is a destructive act on the catalogue (CLAUDE.md §3) — so the outcome carries
 * the `attractionId` and the operator links it by hand. The guard above then sees no link and
 * a retry would create a SECOND place; that is why `link_failed` names the place it created.
 */
export async function provisionPartnerPlace(
  clientId: string,
  operator: SupabaseClient
): Promise<PartnerPlaceOutcome> {
  const submission = await findPromotedSubmission(clientId)
  if (!submission) return { status: 'skipped', reason: 'no_promoted_proposal' }

  const prefill = buildPlacePrefill(submission.answers ?? {})
  if (!prefill) return { status: 'skipped', reason: 'nothing_to_prefill' }

  const linked = await findLinkedPlace(clientId, operator)
  if (linked === undefined) {
    console.error('[partner-approval] place lookup failed for client', clientId)
    return { status: 'failed', reason: 'lookup_failed', attractionId: null }
  }
  if (linked) return { status: 'skipped', reason: 'already_provisioned' }

  // The old form's `plan_choice` is a REQUEST, not a payment, so no `acceptedPlanChoice`: the tier
  // is whatever the client record says (`derivePartnerPlan`).
  return createPlaceFromPrefill(prefill, clientId, operator, {
    story: submission.answers?.story_script ?? null,
    acceptedPlanChoice: null,
  })
}

/**
 * The writes of one prefill, shared by the old form (`provisionPartnerPlace`) and the portal's
 * approval (`approvePortalSubmission`, #812) — one path, so the allowlist cannot be honoured by
 * one and skipped by the other.
 *
 * `operator` is the operator's session client: `cms_create_place` and
 * `cms_set_attraction_coordinate` refuse `service_role` (their gate reads the JWT e-mail).
 */
export async function createPlaceFromPrefill(
  prefill: PlacePrefill,
  clientId: string,
  operator: SupabaseClient,
  description: PartnerDescriptionInput
): Promise<PrefillWriteOutcome> {
  const created = await createPrefilledPlace(prefill, operator)
  if (created.status === 'failed') return created
  const applied = await applyPlacePrefill(created.attractionId, prefill, clientId, operator)
  if (applied.status === 'failed') return applied
  return applyPrefillDescription(created.attractionId, description, operator)
}

/**
 * The tier's description (#888), after the place is linked — the policy reads the client through
 * `partner_client_id`. Repeatable: it never writes over a description, so a retry converges.
 */
export async function applyPrefillDescription(
  attractionId: string,
  description: PartnerDescriptionInput,
  operator: SupabaseClient
): Promise<PrefillWriteOutcome> {
  try {
    await applyPartnerPlaceDescription(attractionId, description, operator)
  } catch (error) {
    console.error('[partner-approval] place description not written', attractionId, error)
    return { status: 'failed', reason: 'description_failed', attractionId }
  }
  return { status: 'created', attractionId }
}

type PrefillWriteOutcome =
  | { status: 'created'; attractionId: string }
  | Extract<PartnerPlaceOutcome, { status: 'failed' }>

/** The one non-repeatable write: the row itself (`cms_create_place`). */
export async function createPrefilledPlace(
  prefill: PlacePrefill,
  operator: SupabaseClient
): Promise<PrefillWriteOutcome> {
  try {
    return { status: 'created', attractionId: await placeService.create(prefill.create, operator) }
  } catch (error) {
    console.error('[partner-approval] place creation refused', error)
    return { status: 'failed', reason: 'create_failed', attractionId: null }
  }
}

/**
 * Everything after the row — client link, details, coordinate. Every write is an UPDATE of the
 * same values, so running it again on a place that already has them is a no-op: that is what
 * lets the portal's approval retry a half-written POI instead of approving it without offer
 * and without pin.
 *
 * `mode`: `replace` is the place this act just created — nothing to protect. `merge` is a POI
 * the catalogue already carries (#885): the writes go through `mergePlacePrefill`, BR-B2B-033
 * item 5 — the catalogue keeps its identity and coordinate, the partner wins on the operational
 * facts, tags unite. One path for both, so the allowlist cannot be honoured by one and skipped by
 * the other.
 */
export async function applyPlacePrefill(
  attractionId: string,
  prefill: PlacePrefill,
  clientId: string,
  operator: SupabaseClient,
  mode: 'replace' | 'merge' = 'replace'
): Promise<PrefillWriteOutcome> {
  let write: PrefillWrite = {
    attraction: prefill.attraction,
    details: prefill.details,
    coordinate: prefill.coordinate,
  }
  if (mode === 'merge') {
    const catalogue = await readCataloguePlace(attractionId, operator)
    if (!catalogue) return { status: 'failed', reason: 'lookup_failed', attractionId }
    write = mergePlacePrefill(prefill, catalogue)
  }

  try {
    await placeService.updateAttraction(
      attractionId,
      { ...write.attraction, partner_client_id: clientId },
      operator
    )
  } catch (error) {
    console.error('[partner-approval] place created but not linked', attractionId, error)
    return { status: 'failed', reason: 'link_failed', attractionId }
  }

  if (Object.keys(write.details).length > 0) {
    try {
      await placeService.updateDetails(attractionId, write.details, operator)
    } catch (error) {
      console.error('[partner-approval] place details not written', attractionId, error)
      return { status: 'failed', reason: 'details_failed', attractionId }
    }
  }

  if (write.coordinate) {
    try {
      await placeService.setCoordinate(
        attractionId,
        write.coordinate.latitude,
        write.coordinate.longitude,
        operator
      )
    } catch (error) {
      console.error('[partner-approval] place coordinate not written', attractionId, error)
      return { status: 'failed', reason: 'coordinate_failed', attractionId }
    }
  }

  return { status: 'created', attractionId }
}

/**
 * What the catalogue POI carries that the merge must not overwrite — read with the operator's
 * session, the identity about to write. `null` when any read failed: merging blind would let the
 * registration's spelling overwrite the curated name, so it fails closed.
 */
async function readCataloguePlace(
  attractionId: string,
  operator: SupabaseClient
): Promise<CataloguePlace | null> {
  const core = operator.schema('core')
  const [attraction, details, coordinate] = await Promise.all([
    core.from('attractions').select(CATALOGUE_WINS_COLUMNS.join(', ')).eq('id', attractionId).maybeSingle(),
    core.from('place_details').select('tags').eq('attraction_id', attractionId).maybeSingle(),
    core
      .from('attraction_coordinate')
      .select('attraction_id', { count: 'exact', head: true })
      .eq('attraction_id', attractionId),
  ])
  if (attraction.error || !attraction.data || details.error || coordinate.error) {
    console.error('[partner-link] catalogue place read failed', attractionId)
    return null
  }
  const tags = (details.data as { tags: unknown } | null)?.tags
  return {
    identity: attraction.data as unknown as CataloguePlace['identity'],
    tags: Array.isArray(tags) ? tags.filter((tag): tag is string => typeof tag === 'string') : null,
    hasCoordinate: (coordinate.count ?? 0) > 0,
  }
}

/**
 * The registration behind a place: the portal submission of THIS place when there is one (its
 * answers, and the tier the client accepted and paid there), else the old form's proposal promoted
 * into the client — whose `plan_choice` is a request, not a payment, so no accepted tier.
 * `undefined` when the portal lookup failed.
 */
async function registrationOf(
  clientId: string,
  attractionId: string
): Promise<{ answers: PartnerAnswers; acceptedPlanChoice: PlanChoice | null } | null | undefined> {
  const portal = await portalRegistrationOfPlace(attractionId)
  if (portal === undefined) return undefined
  if (portal) return portal
  const submission = await findPromotedSubmission(clientId)
  return submission ? { answers: submission.answers ?? {}, acceptedPlanChoice: null } : null
}

/**
 * #885 — THE CLIENT'S REGISTRATION ON A CATALOGUE POI LINKED TO IT. Called by the link route,
 * right after the link, and by `Puxar dados do cadastro` on a place already linked (the clients
 * linked before this existed). Same act both times, and idempotent: the merge writes the same
 * values again (BR-B2B-033, item 5) and the description never writes over one (#888).
 *
 * The description runs even without a registration — a free-tier partner's place is owed its name
 * (BR-B2B-016, item 9) whatever the form said.
 *
 * Answers as data, never throws: the link is done before this runs, and a 500 would read as the
 * link having failed.
 */
export async function mergeRegistrationIntoPlace(
  clientId: string,
  attractionId: string,
  operator: SupabaseClient
): Promise<PartnerPlaceOutcome> {
  const { data, error } = await operator
    .schema('core')
    .from('attractions')
    .select('partner_client_id')
    .eq('id', attractionId)
    .maybeSingle()
  if (error) return { status: 'failed', reason: 'lookup_failed', attractionId }
  if ((data as { partner_client_id: string | null } | null)?.partner_client_id !== clientId) {
    return { status: 'skipped', reason: 'not_linked' }
  }

  const registration = await registrationOf(clientId, attractionId)
  if (registration === undefined) return { status: 'failed', reason: 'lookup_failed', attractionId }

  let prefillState: Extract<PartnerPlaceOutcome, { status: 'merged' }>['prefill'] = 'no_promoted_proposal'
  if (registration) {
    const prefill = buildPlacePrefill(registration.answers)
    prefillState = 'nothing_to_prefill'
    if (prefill) {
      const applied = await applyPlacePrefill(attractionId, prefill, clientId, operator, 'merge')
      if (applied.status === 'failed') return applied
      prefillState = 'applied'
    }
  }

  try {
    const description = await applyPartnerPlaceDescription(
      attractionId,
      {
        story: registration?.answers.story_script ?? null,
        acceptedPlanChoice: registration?.acceptedPlanChoice ?? null,
      },
      operator
    )
    return { status: 'merged', attractionId, prefill: prefillState, description }
  } catch (descriptionError) {
    console.error('[partner-link] place description not written', attractionId, descriptionError)
    return { status: 'failed', reason: 'description_failed', attractionId }
  }
}
