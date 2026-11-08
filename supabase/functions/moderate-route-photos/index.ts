// Edge Function: moderate-route-photos (#1106, #1114, epic #1102)
//
// Screens the photos of one version of a user route with Google Cloud Vision SafeSearch and
// answers a verdict per photo: `clean`, `flagged` (with the categories) or `unchecked`. Rule:
// BR-ROTA-006 item 3, the filter only SIGNALS; it writes nothing and blocks nothing (Apple 1.2 asks
// for a filter AND the human review, and the human review is the CMS queue). The thresholds live in
// `SAFE_SEARCH_FLAG_AT` (`_shared/photo-moderation.ts`).
//
// Who calls: the CMS server, `POST /api/route-revisions/<id>/photo-check`, with the curator's
// session. `requireAdmin` lets in an active CMS admin (or our own machine key) and nobody else: an
// app user's token or the publishable key gets 401/403 before any photo is read.
//
// The key `GOOGLE_CLOUD_API_KEY` lives only in the Edge Function secrets and goes in a header, never
// in a URL. Each photo goes to the provider as its bytes, read from the private bucket with the
// service role; no link to it leaves the project. Nothing of the photo, its key or the provider
// answer goes to the log: counts and the HTTP status only. A provider failure leaves the photo
// `unchecked` and the curator asks again.
//
// Deploy: supabase functions deploy moderate-route-photos (verify_jwt stays on: the caller always
// carries a session JWT).

import { createAdminClient } from '../_shared/supabase-client.ts';
import { requireAdmin } from '../_shared/auth-middleware.ts';
import {
  classifyWithSafeSearch,
  DIARY_PHOTO_BUCKET,
  handlePhotoModeration,
  type UncheckedReason,
} from '../_shared/photo-moderation.ts';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const GOOGLE_CLOUD_API_KEY = Deno.env.get('GOOGLE_CLOUD_API_KEY') ?? '';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const admin = await requireAdmin(req);
  if (admin instanceof Response) return admin;

  const body = await req.json().catch(() => null);
  const db = createAdminClient();
  const unchecked: Partial<Record<UncheckedReason, number>> = {};
  let providerError = '';

  const result = await handlePhotoModeration(body, {
    hasApiKey: Boolean(GOOGLE_CLOUD_API_KEY),
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
    readPhoto: async (key) => {
      const { data, error } = await db.storage.from(DIARY_PHOTO_BUCKET).download(key);
      return error || !data ? null : new Uint8Array(await data.arrayBuffer());
    },
    classify: (bytes) => classifyWithSafeSearch(bytes, GOOGLE_CLOUD_API_KEY),
    onUnchecked: (reason, error) => {
      unchecked[reason] = (unchecked[reason] ?? 0) + 1;
      // Our own messages (`safesearch http 403`) or the timeout's name; no URL, header or body.
      if (reason === 'provider' && !providerError) {
        providerError = error instanceof Error ? (error.name === 'Error' ? error.message : error.name) : 'unknown';
      }
    },
  });

  const photos = (result.body.photos ?? []) as Array<{ status: string }>;
  const count = (s: string) => photos.filter((p) => p.status === s).length;
  const reasons = Object.entries(unchecked).map(([r, n]) => `${r}:${n}`).join(',') || '-';
  console.log(`[moderate-route-photos] status=${result.status} clean=${count('clean')} flagged=${count('flagged')} unchecked=${count('unchecked')} reasons=${reasons}`);
  if (providerError) console.error(`[moderate-route-photos] provider failure, left unchecked: ${providerError}`);
  return json(result.status, result.body);
});
