/**
 * How a tourist is identified on a CMS screen — the single owner of **BR-USUARIO-042**.
 *
 * The chain has two links and ends at the second: the `nickname`, and in its absence the
 * first 8 characters of the `user_id`. There is no third link **on purpose**: every
 * candidate for one — full name, first name, avatar initial taken from the name, the local
 * part of the e-mail, its domain — is the same personal datum, cut smaller (item 2). A
 * fallback that reads well is exactly how the name comes back.
 *
 * Truncating the uuid is presentation, not storage: the `user_id` travels whole and is what
 * the screen keys, selects and opens a detail by. Eight characters are for a human to tell
 * two rows apart, never to identify anybody.
 *
 * This is not anonymisation, and calling it that would be a false claim by the ruler of
 * BR-USUARIO-017: the account stays identifiable, the data stays in the database, and the
 * `nickname` is a stable pseudonym tied to the person. What changes is what the screen shows.
 *
 * Filtering is not showing (item 3): a search that matches on an e-mail keeps working. It
 * just never renders the value that matched, so it never passes through here.
 *
 * There is **one** surface that also shows the e-mail — the manual grant confirmation — and
 * it lives here, in `grantTargetLabel`, on purpose: an exception kept next to the rule it
 * excepts is an exception somebody has to walk past to copy.
 */

import { UNKNOWN_VALUE } from '@/lib/format/unknown'

/**
 * How much of the `user_id` reaches the screen when there is no `nickname`.
 *
 * Eight, from BR-USUARIO-042 item 2. It is the ONLY truncation of a tourist uuid in the CMS:
 * the credit dialog used to cut the same uuid to its last 6, the same fact declared twice
 * (CLAUDE.md §6), and the rule's 6th edge case says whoever touches both reconciles to this
 * one. `grantTargetLabel` did, on 2026-09-01.
 */
export const USER_ID_LABEL_CHARS = 8

/** The shape any tourist row must have to be identified. `nickname` may be missing; the id may not. */
export interface AppUserIdentity {
  user_id?: string | null
  nickname?: string | null
}

/**
 * The label the operator reads: `nickname`, else the first 8 characters of the `user_id`.
 *
 * A blank `nickname` is an absent one — the database fills every new profile through
 * `tr_assign_default_nickname`, so a whitespace-only value is dirt, not an identifier.
 * With neither link available the answer is an em dash: the chain is closed, and an empty
 * string would render as a row with no one in it.
 */
export function appUserLabel(user: AppUserIdentity | null | undefined): string {
  const nickname = user?.nickname?.trim()
  if (nickname) return nickname

  const userId = user?.user_id?.trim()
  if (userId) return userId.slice(0, USER_ID_LABEL_CHARS)

  return UNKNOWN_VALUE
}

/**
 * The avatar initial — the first character of the label, and of nothing else.
 *
 * It exists so the initial cannot drift back to the name: an avatar reading `L` next to a
 * row labelled `hoppy-otter` is the full name still on screen, one character at a time.
 */
export function appUserInitial(user: AppUserIdentity | null | undefined): string {
  return appUserLabel(user).charAt(0).toUpperCase()
}

/**
 * The one surface that names a tourist by **`nickname` and e-mail** — nothing else does.
 *
 * The founder opened this exception on 2026-09-01, and BR-USUARIO-042's 4th edge case is what
 * it costs: granting on the wrong account is the expensive irreversible error of that screen
 * (`GrantCreditDialog`, `DS-COMPONENTE-013`), so the confirmation carries a second signal.
 * The full name is NOT that signal and is gone — the exception is nominal, and it is the
 * e-mail.
 *
 * The identity half is not re-derived here: it is `appUserLabel`, so the day the chain changes
 * this screen changes with it instead of keeping the old one.
 *
 * **With no e-mail there is no tail.** The old line appended the last 6 characters of the uuid
 * as a tie-breaker for homonyms, which the name needed and the `nickname` does not:
 * `profiles_nickname_unique` makes it unique in the database (BR-USUARIO-042, 3rd edge case).
 * Keeping it would print the same uuid twice in two different cuts — `a1b2c3d4 · …567890` —
 * and offer the operator a second signal that carries no second fact.
 */
export function grantTargetLabel(
  user: AppUserIdentity | null | undefined,
  email: string | null | undefined
): string {
  const label = appUserLabel(user)
  const address = email?.trim()

  return address ? `${label} · ${address}` : label
}
