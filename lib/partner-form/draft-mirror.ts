/**
 * The local copy of what the person typed into the partner form (#341).
 *
 * It exists so a dropped connection costs nothing that was typed: the form autosaves to
 * the server on every step change, and this mirror only ever fills what an offline stretch
 * kept from arriving. The server copy is still the one the team reads.
 *
 * It holds personal data — CNPJ, and the name, e-mail and phone of the legal
 * representative — on a device that is very often shared: this form is filled at the
 * counter of a restaurant, on whatever phone or tablet is there. So it has a deadline, and
 * that is the reason this is a module of its own instead of three closures inside the
 * component: the expiry is a guarantee, and a guarantee is something a test can break.
 *
 * A day covers "I'll finish this tonight" and costs nothing beyond it — whatever the
 * server received comes back from the server. It used to have no deadline at all, and the
 * only thing that cleared it was a successful submission, which an abandoned form never
 * has.
 */

import type { PartnerAnswers } from './schema'

export const MIRROR_TTL_MS = 24 * 60 * 60 * 1000

export function mirrorKey(token: string): string {
  return `partner-form:${token}`
}

interface MirroredDraft {
  savedAt: number
  answers: PartnerAnswers
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

export function readMirror(key: string): PartnerAnswers {
  const store = storage()
  if (!store) return {}

  try {
    const raw = store.getItem(key)
    if (!raw) return {}

    const stored = JSON.parse(raw) as Partial<MirroredDraft>
    const savedAt = typeof stored?.savedAt === 'number' ? stored.savedAt : 0
    const answers = stored?.answers

    // No stamp means a mirror written before this had a deadline: it goes too.
    if (!savedAt || !answers || Date.now() - savedAt > MIRROR_TTL_MS) {
      clearMirror(key)
      return {}
    }
    return answers
  } catch {
    clearMirror(key)
    return {}
  }
}

export function writeMirror(key: string, answers: PartnerAnswers): void {
  try {
    const stored: MirroredDraft = { savedAt: Date.now(), answers }
    storage()?.setItem(key, JSON.stringify(stored))
  } catch {
    // Private browsing and a full quota both land here; the form keeps working.
  }
}

export function clearMirror(key: string): void {
  try {
    storage()?.removeItem(key)
  } catch {
    // Same as above.
  }
}
