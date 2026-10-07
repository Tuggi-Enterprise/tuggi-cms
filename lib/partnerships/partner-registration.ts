/**
 * WHAT THE PARTNER INFORMED THAT HAS NO COLUMN ON THE PLACE — #886, read-only in the place editor.
 *
 * The prefill (`place-prefill.ts`) writes what has a column; this is the rest, kept as the partner
 * wrote it so the operator sees it beside the editable fields. ALLOWLIST, never the whole
 * `answers`: the registration also carries the representative (name, CPF, e-mail, phone —
 * BR-B2B-030), and a key not named here does not reach the browser.
 *
 * Pure, so the route, the screen and the test read the same thing.
 */

import type { PartnerAnswers } from '@/lib/partner-form/schema'
import { stringList } from '@/lib/partner-form/place-prefill'
import { PARTNER_STORY_FIELDS } from '@/lib/partnerships/place-description-policy'

/** Where the answers came from: the place's portal submission, or the old form's promoted proposal. */
export type PartnerRegistrationSource = 'portal' | 'proposal'

export interface PartnerRegistrationSummary {
  source: PartnerRegistrationSource
  signatureItem: string | null
  /** ISO 639-1 codes (contract `partner-proposal-answers.md` §8.1). */
  languages: string[]
  instagram: string | null
  /** Ids of §8.2, of the chosen category. */
  subtypes: string[]
  /** The story answers, by field id (`story_founder`…`story_event`, `story_script`). Empty ones omitted. */
  story: { id: string; answer: string }[]
}

/** The story keys shown: the old form's four blocks and the portal's single script. */
const STORY_IDS = [...PARTNER_STORY_FIELDS.map((field) => field.id), 'story_script'] as const

function text(value: unknown): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed || null
}

/** `null` when there are no answers, or when none of the allowlisted keys was answered. */
export function partnerRegistrationSummary(
  answers: PartnerAnswers | null,
  source: PartnerRegistrationSource
): PartnerRegistrationSummary | null {
  if (!answers) return null

  const story: PartnerRegistrationSummary['story'] = []
  for (const id of STORY_IDS) {
    const answer = text(answers[id])
    if (answer) story.push({ id, answer })
  }

  const summary: PartnerRegistrationSummary = {
    source,
    signatureItem: text(answers.signature_item),
    languages: stringList(answers.languages),
    instagram: text(answers.instagram),
    subtypes: stringList(answers.subtypes),
    story,
  }

  const empty =
    !summary.signatureItem &&
    !summary.instagram &&
    summary.languages.length === 0 &&
    summary.subtypes.length === 0 &&
    story.length === 0
  return empty ? null : summary
}
