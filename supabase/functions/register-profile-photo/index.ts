// Edge Function: register-profile-photo (#1130, epic #1127)
//
// The one way a profile photo is set (BR-USUARIO-052 item 2.e, BR-USUARIO-050 item 3). The app
// uploads the object to the private bucket `profile-photos`, then calls here; this function screens
// it with the rule of `_shared/photo-moderation.ts` (the same path as `register-diary-photo`,
// `_shared/photo-screening.ts`) and only a clean photo reaches `drive.set_profile_photo_as`, which
// only the service role may execute. An improper photo is deleted from the bucket and never set;
// the previous one stays. The provider, the bucket or the RPC failing: nothing is written or
// deleted (fail closed). The answers are in `_shared/profile-photo-registration.ts` and in
// `docs/contracts/foto-de-perfil.md`.
//
// Who calls: the app, with the user's session JWT. The user id comes from the token
// (`auth.getUser`), never from the body. Our own machine keys are not a user and get 401.
//
// Secret: `GOOGLE_VISION_API_KEY`, the one `register-diary-photo` reads. Nothing of the photo, its
// key (which carries the user id), the user id or the provider answer goes to the log: the status
// and the outcome only.
//
// Deploy: supabase functions deploy register-profile-photo (verify_jwt stays on), after the
// migration that creates `drive.set_profile_photo_as` and the bucket.

import { createAdminClient } from '../_shared/supabase-client.ts';
import { isOwnMachineKey } from '../_shared/auth-middleware.ts';
import { checkRateLimit, RATE_LIMIT_CONFIG } from '../_shared/rate-limiter.ts';
import { classifyWithSafeSearch } from '../_shared/photo-moderation.ts';
import { isNotFound, type PhotoRead } from '../_shared/photo-screening.ts';
import { handleProfilePhotoRegistration, PROFILE_PHOTO_BUCKET } from '../_shared/profile-photo-registration.ts';

const FUNCTION_NAME = 'register-profile-photo';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const VISION_API_KEY = Deno.env.get('GOOGLE_VISION_API_KEY') ?? '';

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
  const result = await handleProfilePhotoRegistration(body, userId, {
    hasApiKey: Boolean(VISION_API_KEY),
    now: () => new Date(),
    readPhoto: async (key): Promise<PhotoRead> => {
      const { data, error } = await db.storage.from(PROFILE_PHOTO_BUCKET).download(key);
      if (error) {
        if (isNotFound(error)) return { kind: 'missing' };
        throw new Error('storage read failed');
      }
      if (!data) throw new Error('storage read empty');
      return { kind: 'found', bytes: new Uint8Array(await data.arrayBuffer()) };
    },
    classify: async (bytes) => {
      try {
        return await classifyWithSafeSearch(bytes, VISION_API_KEY);
      } catch (e) {
        console.warn(`[${FUNCTION_NAME}] provider_error ${e instanceof Error ? e.message : 'unknown'}`);
        throw e;
      }
    },
    removePhoto: async (key) => {
      const { error } = await db.storage.from(PROFILE_PHOTO_BUCKET).remove([key]);
      return !error;
    },
    register: async (uid, key, screenedAt) => {
      const { data, error } = await db.schema('drive').rpc('set_profile_photo_as', {
        p_user_id: uid,
        p_key: key,
        p_screened_at: screenedAt,
      });
      if (error) return { ok: false, code: typeof error.code === 'string' ? error.code : null };
      const photoKey = (data as { photo_key?: unknown } | null)?.photo_key;
      if (typeof photoKey !== 'string') return { ok: false, code: null };
      return { ok: true, photoKey };
    },
  });

  const code = typeof result.body.code === 'string' ? ` code=${result.body.code}` : '';
  console.log(`[${FUNCTION_NAME}] status=${result.status} outcome=${result.outcome}${code}`);
  return json(result.status, result.body);
});
