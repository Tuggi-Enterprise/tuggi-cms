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
 * Where "Como tratamos os seus dados" points — and it points nowhere yet.
 *
 * BR-USUARIO-028, item 1: the categories collected have to be declared in the published
 * policy, and the field and the policy line are the same delivery. This form introduces name,
 * role, e-mail and phone of the legal representative. The `tuggi-cms` has no privacy policy at
 * all, and the Tech Lead decided in #341 that no new one is written for it: the destination is
 * the policy that already exists in `tuggi-enterprise`, extended with these categories. That
 * is #344, and it blocks the go-live of this form — not its implementation.
 *
 * Until it exists the label renders as plain text, so nobody clicks a promise that has no
 * page behind it.
 */
export const PARTNER_PRIVACY_POLICY_URL: string | null = null
