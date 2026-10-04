// _shared/places-secret.ts
//
// The gate of the Edge Functions the Portal Locais (`tuggi-places`) calls —
// `places-movement` and `places-story-preview`. Contract:
// `docs/contracts/places-cms.md` (workspace).
//
// A SECRET OF ITS OWN, NOT A SUPABASE KEY. The portal's Worker holds
// `PLACES_CMS_SECRET` and nothing else: a Supabase secret key equals
// `service_role`, ignores RLS, and a leak in the Worker would be the whole
// database. A leak of this one opens two read-mostly functions and nothing more.
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
