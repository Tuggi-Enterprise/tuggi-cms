/**
 * The acceptance link of a client who did not come through the portal — BR-B2B-056, items 2 and 7.
 * Contract: `docs/contracts/aceite-por-link.md`.
 *
 * Pure and browser-safe: where the link points and what each refusal of the issuing route means.
 * The token is minted on the server (`lib/security/single-use-token.ts`); the database keeps only
 * its sha256, so a link cannot be recovered later — copying again issues a new one and the old one
 * dies (§2 of the contract).
 *
 * THE ADDRESS HAS A TWIN in `supabase/functions/send-transactional/index.ts` (`acceptanceHref`),
 * because the e-mail composes it inside the Edge Function from a secret of ours and never takes an
 * href from its caller. `tests/api/acceptance-link.test.ts` holds the two to the same path.
 */

/** The portal's own default, the same as `tuggi-places` `PORTAL_ORIGIN` (#874). */
export const DEFAULT_PLACES_PORTAL_ORIGIN = 'https://partner.tuggi.app'

/** The page of `tuggi-places` that shows the terms and records the acceptance. */
export const ACCEPTANCE_PATH = '/aceite/'

/** An https origin of ours, or the default — the same rule as the Edge Function's `ownOrigin`. */
export function placesPortalOrigin(configured: string | undefined): string {
  const value = (configured ?? '').trim().replace(/\/+$/, '')
  return /^https:\/\/[^\s/?#]+$/.test(value) ? value : DEFAULT_PLACES_PORTAL_ORIGIN
}

export function acceptanceUrl(origin: string, token: string): string {
  return `${origin}${ACCEPTANCE_PATH}${token}`
}

/** The plan of the terms the link carries (BR-B2B-056, item 3). */
export type AcceptancePlan = 'map_only' | 'map_and_description'

/**
 * The record fields `client_acceptance_link_issue` names in `TGP22` (contract §5). The screen
 * names the one that is missing, so the operator fixes the record and issues again.
 */
export const RECORD_FIELDS = ['legal_name', 'trade_name', 'address', 'city', 'state', 'tax_id', 'email'] as const
export type RecordField = (typeof RECORD_FIELDS)[number]

export function isRecordField(value: unknown): value is RecordField {
  return (RECORD_FIELDS as readonly unknown[]).includes(value)
}

/** What the issuing route answers with, and the client reads. */
export type AcceptanceLinkError =
  | 'record_incomplete'
  | 'already_accepted'
  | 'paid_plan_unavailable'
  | 'no_terms'
  | 'client_not_found'
  | 'issue_failed'

export interface IssuedLink {
  url: string
  expiresAt: string
  sentTo: string
  /** `null` when nobody asked to send; `false` when the e-mail did not go out. */
  emailSent: boolean | null
}

/** The last link of a client, as the tab shows it (no token: the database never had it). */
export interface LinkStatus {
  createdAt: string
  expiresAt: string
  sentTo: string
  state: 'live' | 'expired' | 'revoked' | 'used'
}
