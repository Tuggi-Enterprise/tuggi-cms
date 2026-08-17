/**
 * How the signing link is built — #342, same shape and same reason as
 * `lib/partner-form/link.ts`.
 *
 * `i18n.ts` falls back to `en` for a missing or invalid locale, and this contract is a
 * Brazilian instrument signed by a Brazilian legal representative. The locale segment is
 * therefore pinned, the generator never assembles a URL without it, and the page redirects
 * anything else back to `/pt/`.
 *
 * The origin is OURS and never the caller's. A function that composes a URL from a value
 * in the request body hands an attacker a link with our brand on it — the correction the
 * #341 gate made to `send-transactional`, and the same rule applies to every href in this
 * feature.
 */

/** The locale of this surface, pinned (spec do `design`, §4.2). */
export const CONTRACT_LOCALE = 'pt'

export function buildContractUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}/${CONTRACT_LOCALE}/contrato/${token}`
}

/** The path alone, for the in-app redirect that has no origin to work with. */
export function contractPath(token: string): string {
  return `/${CONTRACT_LOCALE}/contrato/${token}`
}
