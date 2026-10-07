// _shared/places-draft-secret.ts — the Worker's secret of the anonymous draft (#863).
//
// `PLACES_DRAFT_SECRET`, in `x-places-draft-secret`, compared in constant time. Its OWN secret, not
// `PLACES_CMS_SECRET` (security review of #863, option B). Two functions gate on it:
// `places-portal-draft` (every call) and `places-payment` (the cookie's checkout, §7.2 of
// `places-portal-rascunho.md`). Unset → every call is refused.

import { constantTimeEqual } from './constant-time.ts';
import { DRAFT_SECRET_ENV } from './places-portal-draft.ts';

export function isDraftSecret(provided: string | null, fn: string): boolean {
  const expected = (Deno.env.get(DRAFT_SECRET_ENV) ?? '').trim();
  if (!expected) {
    console.error(`[${fn}] ${DRAFT_SECRET_ENV} is not set; refusing every call`);
    return false;
  }
  const candidate = (provided ?? '').trim();
  return !!candidate && constantTimeEqual(candidate, expected);
}
