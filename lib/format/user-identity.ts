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
 */

/**
 * How much of the `user_id` reaches the screen when there is no `nickname`.
 *
 * Eight, from BR-USUARIO-042 item 2. The credit dialog truncates the same uuid to its last
 * 6 — the same fact declared twice (CLAUDE.md §6). Whoever touches both reconciles to this
 * one; that screen is sub judice today and is not this card's to change.
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

  return '—'
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
