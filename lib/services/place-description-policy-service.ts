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
  partnerNarrationFacts,
  partnerStoryInput,
  type PartnerNarrationFacts,
  type PlaceFactsRow,
  type DescriptionException,
  type DescriptionPolicyDecision,
  type PartnerStoryInput,
} from '@/lib/partnerships/place-description-policy'
import type { PartnerAnswers } from '@/lib/partner-form/schema'
import { PLAN_CHOICES, type PlanChoice } from '@/lib/partner-form/fields'
import { operatorLabel } from '@/lib/services/operator-label'
import { portalRegistrationOfPlace } from '@/lib/services/portal-validation-service'
import {
  partnerRegistrationSummary,
  type PartnerRegistrationSource,
  type PartnerRegistrationSummary,
} from '@/lib/partnerships/partner-registration'

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
  /**
   * The tier accepted in the places portal (`partner.place_acceptances`), migration
   * `20261006250000` — the LAST column. OPTIONAL ON PURPOSE: until the operator applies it the RPC
   * does not return the column, and `undefined` must read as "no acceptance", never as a failure.
   */
  accepted_plan_choice?: string | null
}

/** `accepted_plan_choice` as a `PlanChoice`, or `null` — absent column and unknown value included. */
function acceptedPlanChoiceOf(row: FactsRow): PlanChoice | null {
  const v = row.accepted_plan_choice
  return (PLAN_CHOICES as readonly string[]).includes(v ?? '') ? (v as PlanChoice) : null
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
  /**
   * #886 — what the partner informed that has no column on the place, allowlisted
   * (`partnerRegistrationSummary`; nothing of the representative, BR-B2B-030). `null` on every place
   * with no partner, and on a partner with no registration.
   */
  registration: PartnerRegistrationSummary | null
  /**
   * #887 — the registration's facts for the generator (`partner_input.facts`), the place editor's
   * values first (`partnerNarrationFacts`). Only under `partner_story`, like `story`.
   */
  facts: PartnerNarrationFacts | null
}

/** The outcomes `core.cms_apply_name_only_description` reports. `blocked` is not a failure. */
export type NameOnlyOutcome = 'written' | 'unchanged' | 'skipped' | 'blocked' | 'not_applicable'

function core(db: SupabaseClient) {
  return db.schema('core')
}

/** `null` when the attraction does not exist, or when the caller is not a CMS user. */
export async function loadPlaceDescriptionPolicy(
  attractionId: string,
  db: SupabaseClient,
  /** The portal's paid tier, when the caller is the portal's approval — `DescriptionPolicyFacts`. */
  acceptedPlanChoice: PlanChoice | null = null
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
    // The approval's explicit argument wins; otherwise the acceptance the database recorded.
    acceptedPlanChoice: acceptedPlanChoice ?? acceptedPlanChoiceOf(row),
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
    ...(await registrationOfPlace(attractionId, row, decision.policy === 'partner_story', db)),
  }
}

/**
 * What the partner registered, for the editor's read-only panel (#886) and the generator's facts
 * (#887). `registration`/`facts` are `null` on a place with no partner, and `facts` is `null` unless
 * the place may generate.
 */
async function registrationOfPlace(
  attractionId: string,
  row: FactsRow,
  wantsFacts: boolean,
  db: SupabaseClient
): Promise<Pick<PlaceDescriptionPolicyView, 'registration' | 'facts'>> {
  if (!row.partner_client_id) return { registration: null, facts: null }
  const [registered, place] = await Promise.all([
    registrationAnswersOf(attractionId, row),
    wantsFacts
      ? placeFactsOf(attractionId, db).catch((e: unknown) => {
          console.error('[description-policy] place facts read failed:', e instanceof Error ? e.message : e)
          return null
        })
      : Promise.resolve(null),
  ])
  return {
    registration: partnerRegistrationSummary(registered.answers, registered.source),
    facts: wantsFacts ? partnerNarrationFacts(registered.answers, place) : null,
  }
}

/**
 * The place's portal submission when there is one, else the old form's promoted proposal — the
 * order `registrationOf` in `partner-place-provisioning.ts` uses. A failed portal read falls back
 * to the proposal: this is a read-only panel, and the policy above must not fail because of it.
 */
async function registrationAnswersOf(
  attractionId: string,
  row: FactsRow
): Promise<{ answers: PartnerAnswers | null; source: PartnerRegistrationSource }> {
  const portal = await portalRegistrationOfPlace(attractionId).catch((e: unknown) => {
    console.error('[description-policy] portal registration read failed:', e instanceof Error ? e.message : e)
    return undefined
  })
  if (portal) return { answers: portal.answers, source: 'portal' }
  return { answers: row.proposal_answers, source: 'proposal' }
}

/**
 * The place's own values for the facts, with the operator's identity. `null` when the read failed —
 * the facts then come from the answers alone, and the generation is not blocked by it.
 */
async function placeFactsOf(attractionId: string, db: SupabaseClient): Promise<PlaceFactsRow | null> {
  const [attraction, details] = await Promise.all([
    core(db)
      .from('attractions')
      .select('opening_hours, payment_credit_cards, pet_friendly, air_conditioning, wheelchair_accessible')
      .eq('id', attractionId)
      .maybeSingle(),
    core(db)
      .from('place_details')
      .select('place_type, cuisine, tags, price_range, has_delivery, accepts_reservations, has_wifi, has_outdoor_seating')
      .eq('attraction_id', attractionId)
      .maybeSingle(),
  ])
  if (attraction.error || details.error) {
    console.error('[description-policy] place facts read failed:', attraction.error?.code ?? details.error?.code)
    return null
  }
  const a = (attraction.data ?? {}) as Record<string, unknown>
  const d = details.data as Record<string, any> | null
  return {
    hasDetailsRow: !!d,
    place_type: d?.place_type ?? null,
    cuisine: Array.isArray(d?.cuisine) ? d.cuisine : null,
    tags: Array.isArray(d?.tags) ? d.tags : null,
    price_range: typeof d?.price_range === 'number' ? d.price_range : null,
    has_delivery: d?.has_delivery ?? null,
    accepts_reservations: d?.accepts_reservations ?? null,
    has_wifi: d?.has_wifi ?? null,
    has_outdoor_seating: d?.has_outdoor_seating ?? null,
    opening_hours: a.opening_hours ?? null,
    payment_credit_cards: a.payment_credit_cards ?? null,
    pet_friendly: a.pet_friendly ?? null,
    air_conditioning: a.air_conditioning ?? null,
    wheelchair_accessible: a.wheelchair_accessible ?? null,
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
  return applyNameOnly(attractionId, db)
}

async function applyNameOnly(attractionId: string, db: SupabaseClient): Promise<NameOnlyOutcome> {
  const { data, error } = await core(db).rpc('cms_apply_name_only_description', {
    p_attraction_id: attractionId,
    p_language: BASE_LANGUAGE,
    p_gender: BASE_GENDER,
  })

  if (error) throw new Error(error.message)
  return (data as NameOnlyOutcome) ?? 'skipped'
}

/** `generation_meta.kind` of a description written from the partner's own text (`story_script`). */
export const PARTNER_STORY_SCRIPT_KIND = 'partner_story_script'

/** What the partner's registration brings to the description. */
export interface PartnerDescriptionInput {
  /** `answers.story_script` — the portal's paid-tier text (≤ 600 chars). `null` on the old form. */
  story: string | null
  /** Only the portal's approval passes it — see `DescriptionPolicyFacts.acceptedPlanChoice`. */
  acceptedPlanChoice: PlanChoice | null
}

/**
 * `NameOnlyOutcome`, plus `no_story`: the tier is the paid one and the registration brought no
 * text — the studio produces it (gate 2 of BR-B2B-011 is a person, not this function).
 */
export type PartnerDescriptionOutcome = NameOnlyOutcome | 'no_story'

/**
 * THE PLACE BORN FROM A PARTNER'S REGISTRATION CARRIES WHAT ITS TIER GIVES IT — #888, and the one
 * entry point for it: the place created on approval (`approvePortalSubmission`,
 * `createPlaceFromPrefill`) and the catalogue POI linked to the registration (#885) both call this.
 *
 *  · `name_only` (free tier) → the description IS the name, by `cms_apply_name_only_description`
 *    (BR-B2B-016, item 9) — without it the place is mute (`hasDescriptiveAudio`).
 *  · `partner_story` (paid tier, or the operator's exception) → `story_script` becomes the pt
 *    description (BR-B2B-016, item 1; BR-B2B-025 — Tuggi narrates what the establishment asserts).
 *  · `curation` → nothing.
 *
 * The tier is `describeDescriptionPolicy`'s, never read here a second time.
 *
 * NEVER WRITES OVER A DESCRIPTION (BR-B2B-016, 5th edge case), and the guard is in the statement,
 * not in an `if` between a read and a write: the insert is `ON CONFLICT DO NOTHING`, and the only
 * row it may replace is the name-only one (`generation_meta.kind = partner_name_only`), by a
 * conditional UPDATE. A catalogue description, an operator's edit and a `[PROCESSING]` row answer
 * `blocked`. Running it again answers `unchanged`.
 *
 * It writes TEXT ONLY: `audio_url` stays `NULL` and nothing is queued — the app voices the
 * description itself (operator, 2026-10-06).
 *
 * `db` is the OPERATOR's session client: the RPC and the table's write policies gate on the CMS
 * editor's JWT.
 */
export async function applyPartnerPlaceDescription(
  attractionId: string,
  input: PartnerDescriptionInput,
  db: SupabaseClient
): Promise<PartnerDescriptionOutcome> {
  const view = await loadPlaceDescriptionPolicy(attractionId, db, input.acceptedPlanChoice)
  if (!view) return 'not_applicable'
  if (view.decision.policy === 'name_only') return applyNameOnly(attractionId, db)
  if (view.decision.policy !== 'partner_story') return 'not_applicable'

  const story = (input.story ?? '').trim()
  if (!story) return 'no_story'
  if (view.baseDescription?.text === story) return 'unchanged'

  const row = {
    attraction_id: attractionId,
    language: BASE_LANGUAGE,
    gender: BASE_GENDER,
    description: story,
    audio_url: null,
    updated_at: new Date().toISOString(),
    // Same reasoning as the name-only row: the establishment answers for what it asserts
    // (BR-B2B-025, item 4 — Tuggi does not verify third-party facts), and the operator who just
    // approved the registration is the human review (BR-B2B-011, gate 2).
    verification_status: 'approved',
    generation_meta: { kind: PARTNER_STORY_SCRIPT_KIND },
  }

  const inserted = await core(db)
    .from('attraction_descriptions')
    .upsert(row, { onConflict: 'attraction_id,language,gender', ignoreDuplicates: true })
    .select('id')
  if (inserted.error) throw new Error(inserted.error.message)
  if ((inserted.data ?? []).length > 0) return 'written'

  // TWIN IN DENO: `supabase/functions/_shared/places-story-suspension.ts` (`reconcilePartnerStories`) does
  // this same conditional UPDATE for the payment sweep (BR-B2B-019 item 6), under `service_role`,
  // because this RPC path needs an operator's JWT. Change one, change the other.
  const replaced = await core(db)
    .from('attraction_descriptions')
    .update(row)
    .eq('attraction_id', attractionId)
    .eq('language', BASE_LANGUAGE)
    .eq('gender', BASE_GENDER)
    .eq('generation_meta->>kind', 'partner_name_only')
    .select('id')
  if (replaced.error) throw new Error(replaced.error.message)
  return (replaced.data ?? []).length > 0 ? 'written' : 'blocked'
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
