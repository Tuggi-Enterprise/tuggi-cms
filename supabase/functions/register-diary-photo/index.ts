// Edge Function: register-diary-photo (#1116, epic #1102)
//
// The one way a diary photo gets its row. The app uploads the object to the private bucket
// `travel-diary-photos`, then calls here; this function screens the object with Google Cloud
// Vision SafeSearch (the rule of `_shared/photo-moderation.ts`) and only a clean photo reaches
// `drive.add_annotation_photo_as`, which only the service role may execute. An improper photo is
// deleted from the bucket and never registered (BR-ROTA-008 item 4). The time read right before the
// object is read goes to the RPC as `p_screened_at`, and the database refuses (TGW16) an object
// written after it, so bytes swapped during the provider call are never registered. The provider down, the bucket
// or the RPC failing: nothing is written or deleted, and the app tries again (fail closed). The
// answers are in `_shared/diary-photo-registration.ts` and in `docs/contracts/diario-de-bordo.md`.
//
// Who calls: the app, with the user's session JWT. The user id comes from the token
// (`auth.getUser`), never from the body. Our own machine keys are not a user and get 401.
//
// The key `GOOGLE_CLOUD_API_KEY` lives only in the Edge Function secrets. Nothing of the photo, its
// key (which carries the user id), the user id or the provider answer goes to the log: the status
// and the outcome only.
//
// Deploy: supabase functions deploy register-diary-photo (verify_jwt stays on), after the migration
// that creates `drive.add_annotation_photo_as`.

import { createAdminClient } from '../_shared/supabase-client.ts';
import { isOwnMachineKey } from '../_shared/auth-middleware.ts';
import { checkRateLimit, RATE_LIMIT_CONFIG } from '../_shared/rate-limiter.ts';
import { classifyWithSafeSearch, DIARY_PHOTO_BUCKET } from '../_shared/photo-moderation.ts';
import { handleDiaryPhotoRegistration, type PhotoRead } from '../_shared/diary-photo-registration.ts';

const FUNCTION_NAME = 'register-diary-photo';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const GOOGLE_CLOUD_API_KEY = Deno.env.get('GOOGLE_CLOUD_API_KEY') ?? '';

/** storage-js answers a missing object with 404, or with 400 and `statusCode: '404'` in older servers. */
function isNotFound(error: unknown): boolean {
  const e = error as { status?: unknown; statusCode?: unknown; message?: unknown };
  return (
    String(e?.status ?? '') === '404' ||
    String(e?.statusCode ?? '') === '404' ||
    (typeof e?.message === 'string' && /not.?found/i.test(e.message))
  );
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const db = createAdminClient();
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  let userId: string | null = null;
  if (token && !isOwnMachineKey(token)) {
    const { data, error } = await db.auth.getUser(token);
    userId = error ? null : data.user?.id ?? null;
  }

  if (userId) {
    const limit = RATE_LIMIT_CONFIG[FUNCTION_NAME];
    const rate = checkRateLimit(req, FUNCTION_NAME, limit.maxRequests, limit.windowSeconds);
    if (!rate.allowed) {
      console.warn(`[${FUNCTION_NAME}] status=429`);
      return json(429, { error: 'rate_limited' });
    }
  }

  const body = await req.json().catch(() => null);
  const result = await handleDiaryPhotoRegistration(body, userId, {
    hasApiKey: Boolean(GOOGLE_CLOUD_API_KEY),
    now: () => new Date(),
    readPhoto: async (key): Promise<PhotoRead> => {
      const { data, error } = await db.storage.from(DIARY_PHOTO_BUCKET).download(key);
      if (error) {
        if (isNotFound(error)) return { kind: 'missing' };
        throw new Error('storage read failed');
      }
      if (!data) throw new Error('storage read empty');
      return { kind: 'found', bytes: new Uint8Array(await data.arrayBuffer()) };
    },
    classify: async (bytes) => {
      try {
        return await classifyWithSafeSearch(bytes, GOOGLE_CLOUD_API_KEY);
      } catch (e) {
        console.warn(`[${FUNCTION_NAME}] provider_error ${e instanceof Error ? e.message : 'unknown'}`);
        throw e;
      }
    },
    removePhoto: async (key) => {
      const { error } = await db.storage.from(DIARY_PHOTO_BUCKET).remove([key]);
      return !error;
    },
    register: async (uid, photo, screenedAt) => {
      const { data, error } = await db.schema('drive').rpc('add_annotation_photo_as', {
        p_user_id: uid,
        p_photo_id: photo.photoId,
        p_annotation_id: photo.annotationId,
        p_storage_key: photo.storageKey,
        p_taken_at: photo.takenAt,
        p_screened_at: screenedAt,
      });
      if (error) return { ok: false, code: typeof error.code === 'string' ? error.code : null };
      const row = (Array.isArray(data) ? data[0] : data) as { photo_id?: unknown; created?: unknown } | null;
      if (!row || typeof row.photo_id !== 'string') return { ok: false, code: null };
      return { ok: true, photoId: row.photo_id, created: row.created === true };
    },
  });

  const code = typeof result.body.code === 'string' ? ` code=${result.body.code}` : '';
  console.log(`[${FUNCTION_NAME}] status=${result.status} outcome=${result.outcome}${code}`);
  return json(result.status, result.body);
});
