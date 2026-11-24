// Edge Function: places-portal-qr-login (#1271, BR-B2B-069 item 4)
//
// The computer signs in to the Portal Locais by a QR the app approves. Contract:
// `docs/contracts/login-por-qr.md` §3 (workspace). Called server-to-server by the portal's Worker
// with `x-places-secret`; deploy with `--no-verify-jwt` (with the JWT check on, the Worker, which
// sends no user token, gets a 401). Logic: `_shared/places-portal-qr-login.ts`.

import { createAdminClient } from '../_shared/supabase-client.ts';
import { isPlacesSecret, PLACES_SECRET_HEADER } from '../_shared/places-secret.ts';
import { handlePortalQrLogin, type QrLoginDb } from '../_shared/places-portal-qr-login.ts';

Deno.serve((req: Request) =>
  handlePortalQrLogin(req, {
    isAuthorized: (r) => isPlacesSecret(r.headers.get(PLACES_SECRET_HEADER)),
    // The supabase-js builders narrow their types at every step; the handler reads only this slice.
    db: createAdminClient() as unknown as QrLoginDb,
  })
);
