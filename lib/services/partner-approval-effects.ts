/**
 * Partner approval/rejection side-effects.
 *
 * ⚠️ THE NOTIFICATIONS MOVED TO THE DATABASE and they are not coming back. The Pro grant, the
 * push and the e-mail run from DB triggers on `core.clients` — migration
 * `20260624140300_partner_notifications_db.sql` (`core.notify_partner_status_change`). The DB
 * path is reliable regardless of the CMS runtime env/deploy; the previous Next.js
 * implementation depended on `process.env.SUPABASE_SERVICE_ROLE_KEY` and was not firing (no
 * approval e-mails in Resend, no `notification_logs`). Do NOT re-add the grant/notifications
 * here.
 *
 * WHAT DOES LIVE HERE, since #360: approving the client CREATES THE PLACE, already linked by
 * `core.attractions.partner_client_id` and prefilled with what the partner wrote in the form,
 * in the curation state. Before it, the two acts had nothing in common — not the `clientId`,
 * not the insumo — and the measurement in the card is what that costs: of the 6 clients with a
 * `welcome_poi_id`, 3 had zero trigger points and 1 was an `event` that the app's read model
 * does not even carry.
 *
 * THE FOUR THINGS THIS IS NOT, each one a rule and each one visible in the code below:
 *  · it does not APPROVE the place — `core.cms_create_place` inserts `approved = false`, and
 *    BR-B2B-011 keeps the three triage gates as a human decision;
 *  · it does not start the BILLING — BR-B2B-018, item 1: the fee starts on the publication of
 *    the POI with the description on air, and nothing here writes a description;
 *  · it does not give PROMINENCE — BR-B2B-010, item 6. See `PLACE_PREFILL_NEVER_WRITES`;
 *  · it does not make the client's place UNIQUE — BR-B2B-033, item 3, is 1 client : N places.
 *    The guard below stops THIS AUTOMATIC ACT from running twice, not the operator from
 *    registering the second address of the same CNPJ.
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
import { buildPlacePrefill } from '@/lib/partner-form/place-prefill'
import { findPromotedSubmission } from '@/lib/services/partner-proposal-admin-service'

/**
 * What the approval did about the place, as data. The route reports it and never fails on it:
 * approving the partnership is the decision the operator made (BR-B2B-010, item 1), and the
 * place is the convenience that follows. An approval that 500s because a catalogue write
 * failed would leave the operator re-clicking an act that already happened.
 */
export type PartnerPlaceOutcome =
  | { status: 'created'; attractionId: string }
  | {
      status: 'skipped'
      reason: 'no_promoted_proposal' | 'nothing_to_prefill' | 'already_provisioned'
    }
  | { status: 'failed'; reason: 'lookup_failed' | 'create_failed' | 'link_failed'; attractionId: string | null }

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
 * Creates the partner's place out of the proposal that was promoted into this client.
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
export async function applyPartnerApprovalEffects(
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

  let attractionId: string
  try {
    attractionId = await placeService.create(prefill.create, operator)
  } catch (error) {
    console.error('[partner-approval] place creation refused for client', clientId, error)
    return { status: 'failed', reason: 'create_failed', attractionId: null }
  }

  try {
    await placeService.updateAttraction(
      attractionId,
      { ...prefill.attraction, partner_client_id: clientId },
      operator
    )
  } catch (error) {
    console.error('[partner-approval] place created but not linked', attractionId, error)
    return { status: 'failed', reason: 'link_failed', attractionId }
  }

  return { status: 'created', attractionId }
}

export async function applyPartnerRejectionEffects(
  _clientId: string,
  _reason: string
): Promise<void> {
  // no-op — handled by core.notify_partner_status_change (DB trigger)
}
