/**
 * Where the description of an attraction stands between the editor and the bank.
 *
 * WHY THIS IS A STATE AND NOT A BOOLEAN: `generate-translated-audio` translates the most recent
 * SAVED row of `core.attraction_descriptions`. The editor buffer is invisible to it. So a screen
 * that asks "is there a description?" by looking at the textarea answers yes for the exact case
 * that fails — text generated or typed and never saved — and the operator gets a 500 for a field
 * they can see filled in. Three states, because the two failures need different sentences: one
 * says "save it", the other says "write it".
 *
 * `unsaved` wins over `missing`: what the operator has to do next is the same click, and telling
 * them the description is missing while it sits on their screen reads as a bug in the CMS.
 */

export type DescriptionState = 'missing' | 'unsaved' | 'saved'

interface DescriptionStateInput {
  /** Rows of `core.attraction_descriptions` already fetched for this attraction. */
  descriptions: Array<{ description?: string | null } | null | undefined> | null | undefined
  /** What the editor holds right now. */
  currentDescription: string | null | undefined
  /** What was last loaded from the bank for the language on screen. */
  originalDescription: string | null | undefined
}

/** `[PROCESSING]` is the lock placeholder the generator writes; it is not a description. */
const PROCESSING = '[PROCESSING]'

/** True when the bank holds a real description in ANY language — what the edge function reads. */
export function hasSavedDescription(
  descriptions: DescriptionStateInput['descriptions'],
): boolean {
  return (descriptions ?? []).some((row) => {
    const text = row?.description
    return typeof text === 'string' && text.trim().length > 0 && text !== PROCESSING
  })
}

export function describeDescriptionState(input: DescriptionStateInput): DescriptionState {
  const buffer = (input.currentDescription ?? '').trim()
  const saved = (input.originalDescription ?? '').trim()

  if (buffer.length > 0 && buffer !== saved) return 'unsaved'
  if (!hasSavedDescription(input.descriptions)) return 'missing'
  return 'saved'
}
