/**
 * ONE PLACE'S DESCRIPTION POLICY — the facts gathered, the decision left where it lives.
 *
 * EVERY READ AND EVERY WRITE HERE IS AN RPC. Decision of the operator on 2026-08-26, and what it
 * buys is concrete: the `partner` schema is invisible to `authenticated` (no `USAGE`, error
 * 42501), so a screen reading `partner.clients` from the browser gets an `error` that a `?? null`
 * turns into "does not pay" — the same silent defect that produced the 64s seq scan on the
 * candidate search. A SECURITY DEFINER function crosses that boundary once, in one auditable
 * place. And `cms_apply_name_only_description` keeps the do-not-clobber guard inside a single
 * statement instead of an `if` in Node sitting between a SELECT and an UPDATE.
 *
 * WHICH IDENTITY ASKS: the OPERATOR's, always — the cookie-bound client of the route. The four
 * functions are gated on `core.is_active_cms_user()` / `core.is_active_cms_editor_or_admin()`,
 * which read `auth.jwt() ->> 'email'`, and the exception's author comes from `auth.uid()` inside
 * the function rather than from a parameter. Calling them with the service role would leave the
 * exception with no author and the gate with nobody to check.
 *
 * THE RULE ITSELF IS NOT HERE AND IS NOT IN SQL. `describeDescriptionPolicy` decides, it is pure,
 * and it is what `tests/api/place-description-policy.test.ts` proves.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { derivePartnerPlan, planFactsFromRow, type PartnerPlan } from '@/lib/clients/partner-plan'
import {
  describeDescriptionPolicy,
  partnerStoryInput,
  type DescriptionException,
  type DescriptionPolicyDecision,
  type PartnerStoryInput,
} from '@/lib/partnerships/place-description-policy'
import type { PartnerAnswers } from '@/lib/partner-form/schema'
import { operatorLabel } from '@/lib/services/operator-label'

/** The language a place's description is born in. Every other one is translated out of it. */
export const BASE_LANGUAGE = 'pt-br'

/**
 * The voice gender of the base row. `core.attraction_descriptions` is keyed by
 * `(attraction_id, language, gender)` and `generate-description` falls back to `"male"` when the
 * caller says nothing (`batch.gender || "male"`). Writing under another gender would create a
 * second row the app's audio never reaches.
 *
 * Both travel to the RPCs as ARGUMENTS: they are declared here, and hard-coding them in SQL would
 * be a second home for two values `generate-description` also reads.
 */
export const BASE_GENDER = 'male'

/** What `core.cms_place_description_facts` answers with. Snake case: it is a database row. */
interface FactsRow {
  attraction_id: string
  name: string | null
  city: string | null
  entity_kind: string | null
  partner_client_id: string | null
  exception_at: string | null
  exception_by: string | null
  exception_reason: string | null
  monthly_fee_cents: number | null
  is_courtesy: boolean | null
  courtesy_reason: string | null
  plan_choice: string | null
  contract_tier: string | null
  /**
   * The promoted proposal's answers, whole.
   *
   * IT NEVER LEAVES THIS SERVER: what the route returns to the browser is `story`, already
   * derived. It arrives whole because the list of the four story questions belongs to
   * `PARTNER_STORY_FIELDS` — carving it up in SQL would be a second declaration of that list, and
   * that is how a fifth question would enter the form and vanish from the audio.
   */
  proposal_answers: PartnerAnswers | null
  base_description: string | null
  base_has_audio: boolean | null
  base_generation_kind: string | null
}

export interface BaseDescription {
  text: string
  hasAudio: boolean
  /** `generation_meta.kind` — who wrote this row. Shown, never used to decide. */
  kind: string | null
}

export interface PlaceDescriptionPolicyView {
  attractionId: string
  name: string
  /** Where the place is, for the generator's prompt. It never becomes a claim about the place. */
  city: string | null
  entityKind: string | null
  partnerClientId: string | null
  /**
   * WHO PAYS AND WHO SAID SO, for the studio to show — the operator asked for it on the
   * description tab on 2026-08-26: *"leva essa info para a aba de descriçoes tmb, para
   * sabermos"*.
   *
   * It is the SAME `derivePartnerPlan` the Places card runs, over the same five columns, so the
   * two surfaces cannot disagree about the same partner. It travels beside `decision` rather than
   * inside it because they answer different questions: `decision.reason` says WHY the studio is
   * locked, and `plan.source` says whether that came from a signed contract, from what the Tuggi
   * recorded, or from what the establishment merely asked for — which is the difference between
   * "não paga" and "ninguém precificou ainda".
   *
   * `null` on every place with no partner behind it.
   */
  plan: PartnerPlan | null
  decision: DescriptionPolicyDecision
  /**
   * What the partner wrote, ready for the generator. `null` when no block survived — and that is
   * not a failure: it is gate 2 of BR-B2B-011, clause (a), which a person applies.
   */
  story: PartnerStoryInput | null
  /** Whether a description is already stored in the base language, and what it says today. */
  baseDescription: BaseDescription | null
}

/** The outcomes `core.cms_apply_name_only_description` reports. `blocked` is not a failure. */
export type NameOnlyOutcome = 'written' | 'unchanged' | 'skipped' | 'blocked' | 'not_applicable'

function core(db: SupabaseClient) {
  return db.schema('core')
}

/** `null` when the attraction does not exist, or when the caller is not a CMS user. */
export async function loadPlaceDescriptionPolicy(
  attractionId: string,
  db: SupabaseClient
): Promise<PlaceDescriptionPolicyView | null> {
  const { data, error } = await core(db).rpc('cms_place_description_facts', {
    p_attraction_id: attractionId,
    p_language: BASE_LANGUAGE,
    p_gender: BASE_GENDER,
  })

  if (error) throw new Error(error.message)
  const row = ((data as FactsRow[]) ?? [])[0]
  if (!row) return null

  const exception = await readException(row)
  // The five money columns become facts through the ONE reader that turns a row into them, and
  // `derivePartnerPlan` — contract over registration over proposal — is what ranks them.
  const plan = row.partner_client_id ? derivePartnerPlan(planFactsFromRow(row)) : null
  const decision = describeDescriptionPolicy({
    partnerClientId: row.partner_client_id,
    plan,
    exception,
  })

  const text = (row.base_description ?? '').trim()
  const baseDescription =
    text && text !== '[PROCESSING]'
      ? { text, hasAudio: row.base_has_audio === true, kind: row.base_generation_kind }
      : null

  return {
    attractionId: row.attraction_id,
    name: row.name ?? '',
    city: row.city,
    entityKind: row.entity_kind,
    partnerClientId: row.partner_client_id,
    plan,
    decision,
    // Only a partner has input, and only the ones that may generate need it.
    story: decision.policy === 'partner_story' ? partnerStoryInput(row.proposal_answers) : null,
    baseDescription,
  }
}

/**
 * The exception as the columns hold it, or `null`. `exception_at` is the flag: the CHECK of
 * migration `20260826_02` guarantees that if it exists, the other two do too.
 */
async function readException(row: FactsRow): Promise<DescriptionException | null> {
  if (!row.exception_at) return null
  return {
    at: row.exception_at,
    by: await operatorLabel(row.exception_by),
    reason: row.exception_reason ?? '',
  }
}

/**
 * THE POLICY, APPLIED — the one entry point for "make this place carry what its tier gives it".
 *
 * BR-B2B-016, item 9, refined on 2026-08-14: *"rendering the establishment's proper name is not
 * narration production"*. That is why a place the rule says has no description ends up carrying
 * text: without that row it is MUTE, because the app has a native guard against playing the
 * directional line alone (`if (!hasDescriptiveAudio) … return NO`).
 *
 * TWO CALLERS, TWO MOMENTS: the place form on every save, and the partnership link the moment a
 * catalogue row becomes a partner's. Neither decides the tier for itself — a form that did would
 * write a proper noun over a paid description whenever a contract was signed in another tab.
 *
 * `not_applicable` is the ordinary answer and what every curated POI and every paying partner
 * gets. `blocked` means a description this must not touch is in the way — the RPC refuses that in
 * one statement (BR-B2B-016, 5th edge case), and the screen says so instead of the place quietly
 * staying as it was.
 */
export async function applyDescriptionPolicyToPlace(
  attractionId: string,
  db: SupabaseClient
): Promise<NameOnlyOutcome> {
  const view = await loadPlaceDescriptionPolicy(attractionId, db)
  if (!view || view.decision.policy !== 'name_only') return 'not_applicable'

  const { data, error } = await core(db).rpc('cms_apply_name_only_description', {
    p_attraction_id: attractionId,
    p_language: BASE_LANGUAGE,
    p_gender: BASE_GENDER,
  })

  if (error) throw new Error(error.message)
  return (data as NameOnlyOutcome) ?? 'skipped'
}

/**
 * THE DECISION TO BREAK THE RULE, recorded. The author is `auth.uid()` INSIDE the function and
 * never an argument — an RPC that accepts "by whom" signs in somebody else's name for any caller.
 */
export async function saveDescriptionException(
  attractionId: string,
  reason: string,
  db: SupabaseClient
): Promise<void> {
  const { error } = await core(db).rpc('cms_set_partner_description_exception', {
    p_attraction_id: attractionId,
    p_reason: reason,
  })
  if (error) throw new Error(error.message)
}

/**
 * Undoes the exception. The three columns go back to `NULL` together — half an exception is the
 * state the CHECK exists to prevent — and what is left is the rule: the place is the name again.
 *
 * WHAT IT DOES NOT DO is delete the description the exception produced. Taking published content
 * off the air is another decision, with another ruler (BR-B2B-027), and it is the operator's.
 */
export async function clearDescriptionException(
  attractionId: string,
  db: SupabaseClient
): Promise<void> {
  const { error } = await core(db).rpc('cms_clear_partner_description_exception', {
    p_attraction_id: attractionId,
  })
  if (error) throw new Error(error.message)
}
