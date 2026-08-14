/**
 * How the partner form link is built — one place, because the locale segment is a
 * correctness requirement and not a formatting detail.
 *
 * `i18n.ts` falls back to `en` for a missing or invalid locale. A link without the
 * segment therefore hands an English form to a Brazilian restaurant owner, and the two
 * documents this form asks for (CNPJ, alvará) are Brazilian by definition. The generator
 * does not assemble the URL without the segment, and the page redirects anything else
 * back to `/pt/`.
 */

/** The locale of this surface, pinned (spec do `design`, §3.1 and §8.3). */
export const PARTNER_FORM_LOCALE = 'pt'

export function buildPartnerFormUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}/${PARTNER_FORM_LOCALE}/parceria/${token}`
}

/** The path alone, for the in-app redirect that has no origin to work with. */
export function partnerFormPath(token: string): string {
  return `/${PARTNER_FORM_LOCALE}/parceria/${token}`
}

/**
 * Where "Como tratamos os seus dados" points — and it points nowhere yet.
 *
 * BR-USUARIO-028, item 1: the categories collected have to be declared in the published
 * policy, and the field and the policy line are the same delivery. This form introduces
 * name, role, e-mail and phone of the legal representative AND documents that carry a
 * third party's personal data (a contrato social carries CPF, RG and the addresses of the
 * partners). The `tuggi-cms` has no privacy policy at all, and the Tech Lead decided in
 * #341 that no new one is written for it: the destination is the policy that already
 * exists in `tuggi-enterprise`, extended with these categories. That is #344, and it
 * blocks the go-live of this form — not its implementation.
 *
 * Until it exists the label renders as plain text, so nobody clicks a promise that has no
 * page behind it.
 */
export const PARTNER_PRIVACY_POLICY_URL: string | null = null
