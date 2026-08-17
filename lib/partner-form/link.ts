/**
 * How the partner form link is built — one place, because the locale segment is a
 * correctness requirement and not a formatting detail.
 *
 * ONE ADDRESS FOR EVERY PARTNER, with no token in it (operator, 2026-08-16): the same link is
 * sent to everybody, and what keeps one establishment from being registered twice is the CNPJ,
 * checked on submission. Nothing here is a credential, so nothing here needs to be secret.
 *
 * `i18n.ts` falls back to `en` for a missing or invalid locale. A link without the segment
 * therefore hands an English form to a Brazilian restaurant owner, and the document this form
 * asks for (CNPJ) is Brazilian by definition. So the path is never assembled without the
 * segment, and the page redirects anything else back to `/pt/`.
 *
 * THERE IS NO ABSOLUTE-URL BUILDER HERE. There was one, `buildPartnerFormUrl(origin)`, and it
 * had no caller: with no token there is nothing to generate per partner, and the one address
 * is typed into an e-mail by a person, not composed by this code. It came out rather than
 * waiting for a second reader to assume the CMS mails this link somewhere.
 */

/** The locale of this surface, pinned (spec do `design`, §3.1 and §8.3). */
export const PARTNER_FORM_LOCALE = 'pt'

/** The path of the form — used by the redirect, and the only place it is spelled out. */
export function partnerFormPath(): string {
  return `/${PARTNER_FORM_LOCALE}/parceria`
}

/**
 * Where "Como tratamos os seus dados" points — the policy published by `tuggi-enterprise`.
 *
 * THE SLUG IS NOT TRANSLATED, and that is a fact of the other repo rather than a preference:
 * `/trust-center/*` is in `SHARED_SLUG_ROUTES` of `src/i18n/pathnames.ts`, so `/pt/` carries the
 * English segment and `/pt/central-de-confianca/politica-de-privacidade` is a 404. The URL was
 * verified live by the operator on 2026-08-17 (200) and the route exists in the site repo.
 *
 * ABSOLUTE AND CROSS-ORIGIN, on purpose: the form lives in the CMS and the policy in the site, so
 * there is no relative path that reaches it and next-intl's `Link` cannot route to another
 * deployment. The anchor opens in a new tab — a partner halfway through a form must not lose it to
 * read the policy.
 *
 * The Tech Lead decided in #341 that the CMS writes no policy of its own (#344): the destination is
 * the one that already exists, EXTENDED with the categories this form introduces — name, role,
 * e-mail and phone of the legal representative, plus CNPJ, razão social and the establishment's
 * address. BR-USUARIO-028, item 1, is about that text and is the half of #344 that lives in
 * `tuggi-enterprise` (`Legal.Privacy`), not here.
 */
export const PARTNER_PRIVACY_POLICY_URL: string | null =
  'https://www.tuggi.app/pt/trust-center/privacy-policy'
