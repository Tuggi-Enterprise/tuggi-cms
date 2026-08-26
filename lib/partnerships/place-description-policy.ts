/**
 * WHAT TUGGI SAYS ABOUT A PARTNER'S PLACE — one decision, in one place.
 *
 * BR-B2B-016, item 1, is the whole ruler and it is short: on the FREE TIER the app points the
 * direction and says the NAME, and nothing beyond it; the PAID TIER adds a description, produced
 * out of what the establishment sends in. Item 9 closes the other side by consequence — a
 * free-tier partner place does NOT trigger on-demand narration production, and that is the first
 * named exception to BR-CONTEUDO-001 mode 2. Were it to receive produced narration it would be
 * getting the paid tier for free, and item 1 would be false with nobody having decided anything.
 *
 * Item 9 also says where the line is NOT: *"rendering the establishment's proper name is not
 * narration production"*. So `name_only` is not "no description": it is the description BEING the
 * name, which is what gives a free-tier place audio instead of silence — the app has a native
 * guard against playing the directional line alone (`if (!hasDescriptiveAudio) return NO`, the
 * `Divergência` of BR-B2B-021).
 *
 * THE EXCEPTION IS THE OPERATOR'S, AND IT IS RECORDED. Declared on 2026-08-26: the ruler may be
 * broken case by case, and in the same sentence they said what breaking it has to leave behind —
 * *"essa decisão precisa ser salva"*. A lone boolean will not do; who broke it, when and why is
 * what turns an exception into an auditable decision instead of state nobody can explain. So the
 * exception is the whole record or nothing: see `core.attractions.partner_description_*`,
 * migration `20260826_02`, where a CHECK keeps the three columns travelling together.
 *
 * Pure on purpose, in the mould of `place-readiness`: the screen, the route that writes and the
 * test all read THIS, so the three cannot disagree about the same partner.
 */

import type { PartnerPlan } from '@/lib/clients/partner-plan'
import { paymentStance } from '@/lib/clients/partner-plan'
import type { PartnerAnswers } from '@/lib/partner-form/schema'

/**
 * What the place may carry in the description's place.
 *
 * `curation` is the ordinary POI, and it is what EVERY record with no partner answers — nothing
 * in this rule reaches the curated catalogue, and that is the half it matters most not to break.
 */
export type DescriptionPolicy = 'name_only' | 'partner_story' | 'curation'

/** Why the policy is what it is. The screen shows the reason; without it the operator sees a lock with no owner. */
export type DescriptionPolicyReason =
  | 'not_a_partner'
  | 'free_tier'
  | 'paid_tier'
  | 'operator_exception'

/**
 * The exception, as the database holds it. All three or none — a blank reason is a decision
 * nobody can review six months later, and that is exactly what was asked for.
 */
export interface DescriptionException {
  /** `partner_description_exception_at` — ISO. Its presence IS the flag. */
  at: string
  /** Who broke the rule, already resolved into words by the route (`operatorLabel`). */
  by: string | null
  /** Why. Mandatory: the route refuses an exception with no reason written. */
  reason: string
}

/** The facts of one place this decision needs. Nothing is derived here; the derivation is below. */
export interface DescriptionPolicyFacts {
  /** `core.attractions.partner_client_id`. `null` = curated POI, and nothing changes for it. */
  partnerClientId: string | null
  /**
   * The client's plan, by `derivePartnerPlan` — the contract outranks the registration, the
   * registration outranks the proposal. `null` when the place points at a client that did not
   * resolve.
   */
  plan: PartnerPlan | null
  exception: DescriptionException | null
}

export interface DescriptionPolicyDecision {
  policy: DescriptionPolicy
  reason: DescriptionPolicyReason
  /** The exception in force, when it is the exception that explains the policy. */
  exception: DescriptionException | null
  /**
   * Whether the description studio may produce text for this place. `false` under `name_only`,
   * and that is item 9 translated into code.
   */
  mayGenerate: boolean
  /**
   * Whether the exception may be offered at all. It only means anything where there is a rule to
   * break: a curated POI has nothing to except, and a paying partner already owns the description
   * by contract.
   */
  mayException: boolean
}

/**
 * THE TIER IS NEVER A READ-TIME GATE, and nothing here makes it one. BR-B2B-016, item 4, is
 * invariant alongside BR-MONETIZACAO-056: two tourists on different tiers, at the same place, at
 * the same instant, receive the same text and the same audio. This function decides WHAT IS
 * PUBLISHED, once, in the CMS — never what is served to whoever is reading.
 */
export function describeDescriptionPolicy(
  facts: DescriptionPolicyFacts
): DescriptionPolicyDecision {
  if (!facts.partnerClientId) {
    return {
      policy: 'curation',
      reason: 'not_a_partner',
      exception: null,
      mayGenerate: true,
      mayException: false,
    }
  }

  // `paymentStance` is the one place that decides "paying or not paying" — the five `PlanKind`
  // values answer a finer question than this one, and re-writing `kind === 'paid'` here is how the
  // two readings would start to disagree. `undeclared` and `requested` land in `not_paying`, which
  // is TRUE about the money: neither is billing anything today.
  const paying = facts.plan ? paymentStance(facts.plan.kind) === 'paying' : false

  if (paying) {
    return {
      policy: 'partner_story',
      reason: 'paid_tier',
      exception: null,
      mayGenerate: true,
      mayException: false,
    }
  }

  if (facts.exception) {
    return {
      policy: 'partner_story',
      reason: 'operator_exception',
      exception: facts.exception,
      mayGenerate: true,
      mayException: true,
    }
  }

  return {
    policy: 'name_only',
    reason: 'free_tier',
    exception: null,
    mayGenerate: false,
    mayException: true,
  }
}

/**
 * THE PAID AUDIO'S BAND, in seconds, and the target handed to the generator.
 *
 * Asked for by the operator on 2026-08-26: *"precisamos criar uma descrição para um áudio de 10 a
 * 15s"*. The target is the middle of the band and not its ceiling — the generator aims at the
 * target and derives its character limit from it, so aiming at 15 produces text that overruns 15
 * more often than not.
 *
 * The default of `generate-description` is 25s and stays 25s for the rest of the catalogue: this
 * number is for the partner description and for nothing else.
 */
export const PARTNER_AUDIO_SECONDS = { min: 10, target: 13, max: 15 } as const

/**
 * The four story questions of the form, with the id the prompt uses.
 *
 * The id is SEMANTIC and English, not the Portuguese question: the prompt is written in English
 * (like the whole of `masterPackGenerator`), and coupling the generator to the form's copy would
 * let a `design` change silently rewrite the model's input.
 */
export const PARTNER_STORY_FIELDS = [
  { id: 'story_founder', label: 'who founded it and when' },
  { id: 'story_before', label: 'what stood at this address before' },
  { id: 'story_unique', label: 'what exists here that exists nowhere else' },
  { id: 'story_event', label: 'something that happened here the neighbourhood still tells' },
] as const

export interface PartnerStoryBlock {
  id: string
  label: string
  answer: string
}

export interface PartnerStoryInput {
  blocks: PartnerStoryBlock[]
  /** The handle off the registration (`answers.instagram`), with no `@` and no URL. `null` when unanswered. */
  socialHandle: string | null
}

/**
 * WHAT THE PARTNER WROTE, READY FOR THE GENERATOR — and what they did NOT write stays out.
 *
 * An unanswered question is omitted, never sent as "no answer": the model reads the question's
 * label as if it were input and starts narrating the gap (*"nobody knows what stood here
 * before"*), which is a claim about the place that no one made. BR-B2B-025 — Tuggi narrates what
 * the establishment asserts, and only that.
 *
 * Returns `null` when no block survived. That is not a software failure: it is GATE 2 of
 * BR-B2B-011 (clause (a) — the input is the minimum registration and nothing more), and a person
 * is who applies it. This function only reports that there is nothing to narrate.
 */
export function partnerStoryInput(answers: PartnerAnswers | null): PartnerStoryInput | null {
  if (!answers) return null

  const blocks: PartnerStoryBlock[] = []
  for (const field of PARTNER_STORY_FIELDS) {
    const answer = (answers[field.id] ?? '').trim()
    if (answer) blocks.push({ id: field.id, label: field.label, answer })
  }

  if (blocks.length === 0) return null
  return { blocks, socialHandle: normalizedHandle(answers.instagram ?? null) }
}

/**
 * The handle as the audio pronounces it, not as the partner typed it.
 *
 * The field is free text and arrives in all three shapes — `@cozimais.cf`, `cozimais.cf`,
 * `instagram.com/cozimais.cf`. TTS reads whatever is written, so a whole URL becomes "h t t p s
 * colon slash slash" inside the narration.
 */
export function normalizedHandle(raw: string | null): string | null {
  const text = (raw ?? '').trim()
  if (!text) return null

  const withoutUrl = text
    .replace(/^https?:\/\//i, '')
    .replace(/^(www\.)?instagram\.com\//i, '')
    .replace(/[/?#].*$/, '')
  const handle = withoutUrl.replace(/^@+/, '').trim()

  return handle || null
}
