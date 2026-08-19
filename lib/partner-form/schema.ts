/**
 * What a stored proposal looks like to this repository, and the one judgement the conference
 * still makes about a free-text answer.
 *
 * THE VALIDATION LEFT WITH THE FORM (#396). `validateAnswers`, `normalizeAnswers`,
 * `problemsOfStep` and the draft schema decided what the SERVER ACCEPTS, and the server that
 * accepts it is now `tuggi-enterprise/src/app/api/partner-proposal/route.ts`. Keeping a copy
 * here would be a second declaration of a rule this repository never applies — and a rule
 * declared twice is a rule that disagrees with itself the first time one side moves.
 *
 * What stayed is what the CONFERENCE uses:
 *
 *  - `PartnerAnswers`, the shape of `partner.partner_form_submissions.answers`, which the review
 *    screen, the regularity band and the promotion all index;
 *  - `storyNudge`, which reads a story the merchant already sent and says whether it looks like
 *    an offer instead of a story. It runs on both sides on purpose and it is the same list of
 *    words: on the site while the person types, here when a curator reads it back. That
 *    duplication is named in `docs/contracts/partner-proposal-answers.md` — if the two lists
 *    drift, a story nudged on the way in stops being flagged on the way out, and nobody sees it.
 */

import type { PartnerFieldId } from './fields'

export type PartnerAnswers = Partial<Record<PartnerFieldId, string>>

/**
 * The quality nudge of step 3. It never blocks anything and never says "rejected" — the gate-2
 * decision of BR-B2B-011 has another owner and another moment (DS-COPY-015). This function only
 * says which nudge applies.
 */
const OFFER_WORDS =
  /\b(card[áa]pio|menu|pre[çc]o|promo[çc][ãa]o|delivery|reserva|desconto|quartos?|di[áa]ria)\b|R\$/i

export const STORY_SHORT_THRESHOLD = 60

export type StoryNudge = 'short' | 'offer' | null

export function storyNudge(value: string, options: { required?: boolean } = {}): StoryNudge {
  const text = (value ?? '').trim()
  if (!text) return null
  if (OFFER_WORDS.test(text)) return 'offer'
  if (options.required && text.length < STORY_SHORT_THRESHOLD) return 'short'
  return null
}
