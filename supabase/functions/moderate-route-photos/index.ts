// Edge Function: moderate-route-photos (#1106, epic #1102)
//
// Screens the photos of one version of a user route with OpenAI `omni-moderation-latest` and
// answers a verdict per photo: `clean`, `flagged` (with the categories) or `unchecked`. Rule:
// BR-ROTA-006 item 3, the filter only SIGNALS; it writes nothing and blocks nothing (Apple 1.2 asks
// for a filter AND the human review, and the human review is the CMS queue).
//
// Who calls: the CMS server, `POST /api/route-revisions/<id>/photo-check`, with the curator's
// session. `requireAdmin` lets in an active CMS admin (or our own machine key) and nobody else: an
// app user's token or the publishable key gets 401/403 before any photo is signed.
//
// The key `OPENAI_API_KEY` lives only in this function's secrets. Each photo goes to the provider as
// a signed URL of the private bucket, valid for `PHOTO_SIGNED_URL_TTL_S` seconds. Nothing of the
// photo, its key or the provider answer goes to the log: counts only.
//
// Deploy: supabase functions deploy moderate-route-photos (verify_jwt stays on: the caller always
// carries a session JWT).

import { createAdminClient } from '../_shared/supabase-client.ts';
import { requireAdmin } from '../_shared/auth-middleware.ts';
import {
  buildModerationBody,
  DIARY_PHOTO_BUCKET,
  handlePhotoModeration,
  OPENAI_MODERATIONS_URL,
  parseModerationResponse,
  PHOTO_MODERATION_TIMEOUT_S,
  PHOTO_SIGNED_URL_TTL_S,
} from '../_shared/photo-moderation.ts';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') ?? '';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const admin = await requireAdmin(req);
  if (admin instanceof Response) return admin;

  const body = await req.json().catch(() => null);
  const db = createAdminClient();

  const result = await handlePhotoModeration(body, {
    hasApiKey: Boolean(OPENAI_API_KEY),
    readRevision: async (revisionId) => {
      const { data, error } = await db
        .schema('core')
        .from('custom_route_revisions')
        .select('stops, cover_photo_key')
        .eq('id', revisionId)
        .maybeSingle();
      if (error) throw new Error(`custom_route_revisions read failed: ${error.code}`);
      return data;
    },
    sign: async (key) => {
      const { data, error } = await db.storage.from(DIARY_PHOTO_BUCKET).createSignedUrl(key, PHOTO_SIGNED_URL_TTL_S);
      return error ? null : data?.signedUrl ?? null;
    },
    classify: async (url) => {
      const res = await fetch(OPENAI_MODERATIONS_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(buildModerationBody(url)),
        signal: AbortSignal.timeout(PHOTO_MODERATION_TIMEOUT_S * 1000),
      });
      if (!res.ok) {
        await res.body?.cancel();
        throw new Error(`moderation http ${res.status}`);
      }
      return parseModerationResponse(await res.json());
    },
  });

  const photos = (result.body.photos ?? []) as Array<{ status: string }>;
  const count = (s: string) => photos.filter((p) => p.status === s).length;
  console.log(`[moderate-route-photos] status=${result.status} clean=${count('clean')} flagged=${count('flagged')} unchecked=${count('unchecked')}`);
  return json(result.status, result.body);
});
