/**
 * The local copy of what the person typed into the partner form (#341).
 *
 * IT IS NOW THE ONLY DRAFT THERE IS. The form used to autosave to the server, addressed by an
 * invite token; the link carries no token any more (operator, 2026-08-16), so there is no
 * credential to attach a server-side draft to, and a public route that created a row on every
 * keystroke would be an open write with nothing behind it. What the person types stays on
 * their device until they send it, and the copy says so.
 *
 * It holds personal data — CNPJ, and the name, e-mail and phone of the legal representative —
 * on a device that is very often shared: this form is filled at the counter of a restaurant,
 * on whatever phone or tablet is there. So it has a deadline, and that is the reason this is a
 * module of its own instead of three closures inside the component: the expiry is a guarantee,
 * and a guarantee is something a test can break.
 *
 * A day covers "I'll finish this tonight" and costs nothing beyond it.
 */

import type { PartnerAnswers } from './schema'

export const MIRROR_TTL_MS = 24 * 60 * 60 * 1000

/**
 * One key, because there is one form. It used to carry the invite token; keying it by CNPJ
 * instead was considered and refused — a CNPJ is public, so "resume the draft of this CNPJ"
 * would hand anyone who types a number the answers somebody else filled in.
 */
export const MIRROR_KEY = 'partner-form:draft'

interface MirroredDraft {
  savedAt: number
  answers: PartnerAnswers
}

export interface RestoredDraft {
  answers: PartnerAnswers
  /** When it was last written, ISO. Null when there is nothing to resume. */
  savedAt: string | null
}

/**
 * `globalThis` and not `window`: in the browser they are the same object, and this way the
 * deadline above is exercised by `npm run test:api` with a fake store.
 */
function storage(): Storage | null {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage ?? null
  } catch {
    // Reading `localStorage` itself throws when cookies are blocked.
    return null
  }
}

const NOTHING: RestoredDraft = { answers: {}, savedAt: null }

export function readMirror(key: string = MIRROR_KEY): RestoredDraft {
  const store = storage()
  if (!store) return NOTHING

  try {
    const raw = store.getItem(key)
    if (!raw) return NOTHING

    const stored = JSON.parse(raw) as Partial<MirroredDraft>
    const savedAt = typeof stored?.savedAt === 'number' ? stored.savedAt : 0
    const answers = stored?.answers

    // No stamp means a mirror written before this had a deadline: it goes too.
    if (!savedAt || !answers || Date.now() - savedAt > MIRROR_TTL_MS) {
      clearMirror(key)
      return NOTHING
    }
    // An empty draft is not something to resume — the banner would greet a first-time
    // visitor by telling them they are continuing something they never started.
    if (Object.keys(answers).length === 0) return NOTHING

    return { answers, savedAt: new Date(savedAt).toISOString() }
  } catch {
    clearMirror(key)
    return NOTHING
  }
}

export function writeMirror(answers: PartnerAnswers, key: string = MIRROR_KEY): void {
  try {
    const stored: MirroredDraft = { savedAt: Date.now(), answers }
    storage()?.setItem(key, JSON.stringify(stored))
  } catch {
    // Private browsing and a full quota both land here; the form keeps working.
  }
}

export function clearMirror(key: string = MIRROR_KEY): void {
  try {
    storage()?.removeItem(key)
  } catch {
    // Same as above.
  }
}
