// _shared/places-secret.ts
//
// The gate of the Edge Functions the Portal Locais (`tuggi-places`) calls:
// `places-measures`, `places-movement`, `places-payment`, `places-report`,
// `places-story-preview` and `places-portal-qr-login`. Contracts:
// `docs/contracts/places-cms.md` and `docs/contracts/login-por-qr.md` (workspace).
//
// A SECRET OF ITS OWN, NOT A SUPABASE KEY. The portal's Worker holds
// `PLACES_CMS_SECRET` and nothing else: a Supabase secret key equals
// `service_role`, ignores RLS, and a leak in the Worker would be the whole
// database. A leak of this one opens the functions above, and nothing more. It
// does not open a session: `places-portal-qr-login` hands a login link only to
// the browser holding the `poll_token` of a request the app approved.
// Same pattern as `NEWSLETTER_SECRET` in `send-newsletter`.

import { constantTimeEqual } from './constant-time.ts';

export const PLACES_SECRET_HEADER = 'x-places-secret';
export const PLACES_SECRET_ENV = 'PLACES_CMS_SECRET';

/**
 * True only when the header carries the configured secret. A project without
 * `PLACES_CMS_SECRET` answers false to everyone — an unset secret must never
 * read as "no secret needed".
 */
export function isPlacesSecret(provided: string | null | undefined): boolean {
  const expected = (Deno.env.get(PLACES_SECRET_ENV) ?? '').trim();
  if (!expected) {
    console.error(`[places-secret] ${PLACES_SECRET_ENV} is not set; refusing every call`);
    return false;
  }
  const candidate = (provided ?? '').trim();
  if (!candidate) return false;
  return constantTimeEqual(candidate, expected);
}
