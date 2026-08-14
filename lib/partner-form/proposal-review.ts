/**
 * The reviewer's tools — the substitute test, the three reading marks, and the closed list
 * of discard reasons.
 *
 * NONE OF THIS DECIDES ANYTHING, and that is the design. Gate 2 of BR-B2B-011 is somebody
 * else's decision at another moment, and a place turned down at triage IS STILL A PARTNER
 * (BR-B2B-011, first edge case). So what lives here produces a reading, an annotation and a
 * reason — never a verdict, and never a `status` on the establishment.
 */

import { storyNudge } from '@/lib/partner-form/schema'

/**
 * Substitutes the establishment's names out of its own story — gate 2, clause (c), executed
 * instead of described: if the text is still true about "another restaurant in Búzios", the
 * text is not about this place.
 *
 * Mechanical on purpose. The judgement stays with whoever reads the result, which is why the
 * screen shows it as a view that can be undone and stores nothing.
 *
 * Longest name first, so that a trade name contained in the legal name ("Cantina do Zé" in
 * "Cantina do Zé Ltda") does not leave a stray "Ltda" behind.
 */
export function applySubstituteTest(
  text: string,
  options: { names: readonly (string | null | undefined)[]; replacement: string }
): string {
  const names = options.names
    .map((name) => (name ?? '').trim())
    .filter((name) => name.length >= 3)
    .sort((a, b) => b.length - a.length)

  let result = text
  for (const name of names) {
    result = result.replace(new RegExp(escapeRegExp(name), 'gi'), options.replacement)
  }
  return result
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * The three marks of gate 2, in its literal definition: the input carries at least one fact
 * that is dated, attributable to a named person, or observable on the premises.
 *
 * They are stored as an annotation of the review, alongside a free-text note. Input for
 * whoever decides — not the decision.
 */
export const REVIEW_MARKS = ['dated', 'named_person', 'observable'] as const
export type ReviewMark = (typeof REVIEW_MARKS)[number]

export interface ReviewNote {
  marks: ReviewMark[]
  observation: string
}

/** Keeps a body from becoming an annotation with arbitrary keys or a novel in it. */
export const REVIEW_OBSERVATION_MAX = 2000

export function normalizeReviewNote(input: unknown): ReviewNote | null {
  if (!input || typeof input !== 'object') return null
  const body = input as Record<string, unknown>

  const rawMarks = Array.isArray(body.marks) ? body.marks : []
  const marks: ReviewMark[] = []
  for (const mark of rawMarks) {
    if (typeof mark !== 'string') return null
    const known = REVIEW_MARKS.find((candidate) => candidate === mark)
    if (!known) return null
    if (marks.indexOf(known) < 0) marks.push(known)
  }

  const observation = typeof body.observation === 'string' ? body.observation.trim() : ''
  if (observation.length > REVIEW_OBSERVATION_MAX) return null

  return { marks, observation }
}

/**
 * Why a proposal was discarded. Closed list, and short on purpose.
 *
 * NO GATE OF BR-B2B-011 IS IN IT. Discarding a proposal is not turning a place down at
 * triage: triage is another decision, it does not take anybody's partnership away, and it is
 * not made on this screen. `notifies` marks the one reason that has a message to the partner
 * behind it (§5.C of the spec) — the other three are internal bookkeeping.
 */
export const DISCARD_REASONS = [
  { id: 'duplicate', notifies: false },
  { id: 'gave_up', notifies: false },
  { id: 'data_mismatch', notifies: false },
  { id: 'will_not_regularize', notifies: true },
] as const

export type DiscardReasonId = (typeof DISCARD_REASONS)[number]['id']

export function isDiscardReason(value: unknown): value is DiscardReasonId {
  return typeof value === 'string' && DISCARD_REASONS.some((reason) => reason.id === value)
}

/**
 * Whether the story carries a commercial-offer marker (menu, price, booking). Reuses the
 * detector the external form already nudges with — one decision about what an offer looks
 * like, so the reviewer and the partner never see the two disagree.
 *
 * A warning in plain text, with no `role="alert"` and blocking nothing: the same rule as the
 * nudge on the form.
 */
export function hasOfferMarker(text: string): boolean {
  return storyNudge(text) === 'offer'
}
