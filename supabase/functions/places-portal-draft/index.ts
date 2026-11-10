// Edge Function: places-portal-draft (#863, epic #802)
//
// The anonymous draft of the Portal Locais, its clickwrap acceptance (`submit`), and the e-mail
// link — issued only once the acceptance is settled — that signs in and claims it.
// Contract: `docs/contracts/places-portal-rascunho.md` (workspace); logic and the fixed list of
// database functions in `_shared/places-portal-draft.ts`.
//
// Called server-to-server by the portal's Worker with `x-places-draft-secret` (its OWN secret,
// `PLACES_DRAFT_SECRET` — not `PLACES_CMS_SECRET`, compared in constant time in
// `_shared/places-draft-secret.ts`). `claim` also carries the user's access token in
// `Authorization: Bearer`. Deploy with `--no-verify-jwt`: the secret gates every call, and the
// user's token is verified here (`getClaims`).
//
// THIS IS THE ONLY CALLER OF `partner.portal_draft_*` (EXECUTE to service_role only), but for
// `portal_draft_payment_checkout`, which `places-payment` also calls for the cookie's checkout: the
// Worker holds no Supabase secret key (D2 of `20261004120000`).
//
// Secrets: PLACES_DRAFT_SECRET, PLACES_PORTAL_ORIGIN (default https://partner.tuggi.app),
// RESEND_API_KEY, RESEND_FROM.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createAdminClient, getPublishableKey, getSupabaseUrl } from '../_shared/supabase-client.ts';
import { isDraftSecret } from '../_shared/places-draft-secret.ts';
import { authAdmin, randomToken, sendEmail, sha256Hex, submissionReads } from '../_shared/places-access-link-runtime.ts';
import {
  DRAFT_SECRET_HEADER,
  PHOTO_BUCKET,
  PORTAL_ORIGIN_ENV,
  SIGNED_URL_TTL_S,
  handle,
  portalOrigin,
  type Deps,
} from '../_shared/places-portal-draft.ts';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function deps(): Deps {
  const admin = createAdminClient();
  const bucket = () => admin.storage.from(PHOTO_BUCKET);
  return {
    rpc: async (fn, args) => {
      try {
        const { data, error } = await admin.schema('partner').rpc(fn, args);
        return { data, error: error ? { code: error.code, details: error.details, message: error.message } : null };
      } catch {
        return { data: null, error: { code: 'network' } };
      }
    },
    storage: {
      async list(prefix) {
        const { data, error } = await bucket().list(prefix, { limit: 100, sortBy: { column: 'created_at', order: 'asc' } });
        if (error) throw new Error(`storage list ${error.message?.slice(0, 80)}`);
        return (data ?? []).map((o: { name: string; created_at?: string | null }) => ({ name: o.name, created_at: o.created_at ?? null }));
      },
      async sign(paths) {
        const { data, error } = await bucket().createSignedUrls(paths, SIGNED_URL_TTL_S);
        if (error) throw new Error('storage sign');
        return Object.fromEntries((data ?? []).flatMap((d: { path: string | null; signedUrl: string | null }) => (d.path && d.signedUrl ? [[d.path, d.signedUrl]] : [])));
      },
      async upload(path, bytes) {
        const { error } = await bucket().upload(path, bytes, { contentType: 'image/jpeg', upsert: false });
        return !error;
      },
      async remove(path) {
        const { error } = await bucket().remove([path]);
        return !error;
      },
    },
    auth: {
      ...authAdmin(admin),
      async claims(jwt) {
        // `getClaims` verifies the signature (JWKS, or the Auth server for a symmetric key).
        const client = createClient(getSupabaseUrl(), getPublishableKey(), {
          auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
        });
        const { data, error } = await client.auth.getClaims(jwt);
        const c = data?.claims as { sub?: unknown; session_id?: unknown; is_anonymous?: unknown } | undefined;
        if (error || typeof c?.sub !== 'string' || typeof c.session_id !== 'string' || c.is_anonymous === true) return null;
        return { sub: c.sub, sessionId: c.session_id };
      },
    },
    sendEmail,
    sha256Hex,
    uuid: () => crypto.randomUUID(),
    randomToken,
    submissions: submissionReads(admin),
    origin: portalOrigin(Deno.env.get(PORTAL_ORIGIN_ENV)),
  };
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  if (!isDraftSecret(req.headers.get(DRAFT_SECRET_HEADER), 'places-portal-draft')) return json(401, { error: 'unauthorized' });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'invalid', field: 'body' });
  }
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  const action = String((body as { action?: unknown } | null)?.action ?? '').slice(0, 24);
  try {
    const r = await handle(deps(), body, jwt);
    // Action and status only: no e-mail, token, answers or path in the log.
    console.log('[places-portal-draft]', action, r.status);
    return json(r.status, r.body);
  } catch (e) {
    console.error('[places-portal-draft] failed', action, e instanceof Error ? e.message.slice(0, 120) : 'unknown');
    return json(502, { error: 'unavailable' });
  }
});
