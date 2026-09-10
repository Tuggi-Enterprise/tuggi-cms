/**
 * Secret key resolution for the Edge Functions — single source of truth.
 *
 * The Supabase runtime injects BOTH generations of API keys side by side:
 * the legacy `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`, and the new
 * `SUPABASE_PUBLISHABLE_KEYS` / `SUPABASE_SECRET_KEYS`. The new ones are not a
 * bare value: each is a JSON object indexed BY KEY NAME, not by position.
 * https://supabase.com/docs/guides/functions/secrets
 *
 * No Edge Function reads a key from the environment on its own. They all call
 * `getSecretKey()`, so that disabling the legacy keys is one edit, here.
 *
 * The legacy fallback below is TEMPORARY and deliberately noisy — removing it
 * is step 3 of card #155. Now that the key name is known, its `console.error`
 * is how production tells us the configured name stopped resolving: it prints
 * the available NAMES and never a value, not even a prefix.
 */

/**
 * Name of this project's secret key inside `SUPABASE_SECRET_KEYS`.
 * Declared once; no other module may spell it out — the only literal copy lives
 * in the #155 test, on purpose, so that changing this line fails a test.
 *
 * This is the key created FOR the Edge Functions. The project holds four secret
 * keys — `default`, `cms_secret_key`, `app_secret_key` and `ef_secret_key` — and
 * only the last one belongs here. Changing this name to any of the other three
 * points every privileged function at another consumer's key, and the failure is
 * silent: the name resolves, so the `console.error` below never fires and the
 * functions keep answering 200 with the wrong identity. Confirm against the
 * project's key inventory (Management API) before touching this line.
 */
export const SECRET_KEY_NAME = 'ef_secret_key';

type SecretKeyMap = Record<string, string>;

/** Parses `SUPABASE_SECRET_KEYS`, or null when it is absent or malformed. */
function readSecretKeyMap(): SecretKeyMap | null {
  const raw = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as SecretKeyMap;
    }
  } catch {
    // Malformed value: treated as absent, and reported by the caller.
  }

  return null;
}

/**
 * Returns the secret key (formerly the service_role key) used by every
 * privileged Edge Function client.
 *
 * Falls back to the legacy `SUPABASE_SERVICE_ROLE_KEY` — see #155 — and shouts
 * when it does, because that fallback is the key that leaked.
 */
export function getSecretKey(): string {
  const secrets = readSecretKeyMap();
  const key = secrets?.[SECRET_KEY_NAME];

  if (typeof key === 'string' && key.length > 0) return key;

  console.error(
    `[secret-key] #155: no "${SECRET_KEY_NAME}" entry in SUPABASE_SECRET_KEYS; ` +
      'falling back to the legacy SUPABASE_SERVICE_ROLE_KEY. ' +
      `Available secret key names: [${secrets ? Object.keys(secrets).join(', ') : ''}]`,
  );

  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
}

/**
 * Name of the secret key the CMS's NEXT SERVER carries, inside the same map.
 *
 * It is NOT `SECRET_KEY_NAME`: `lib/core/supabase-client.ts` builds `getSupabaseService()`
 * with the `SUPABASE_SECRET_KEY` of the Next environment, and that value is a DIFFERENT one
 * of the project's four secret keys — measured 2026-09-01 by `qa` against the Management API
 * listing, and again in the CMS `.env` on 2026-09-10, prefix `sb_secret_SSfsg…`. A gate that
 * only knows `ef_secret_key` answers 401 to it, which is `send-transactional` refusing the
 * partner contract e-mail without anyone noticing: `sendTransactionalEmail` never throws.
 *
 * `default` and `app_secret_key` are the other two and are deliberately NOT here — no caller
 * presents them, and the one named for the app is the one that would sit closest to a binary.
 */
export const CMS_SERVER_KEY_NAME = 'cms_secret_key';

/**
 * Is this bearer token one of OUR OWN secret keys?
 *
 * The set is closed and NAMED — `ef_secret_key` (the machines: EF→EF and the database's
 * `net.http_post`) plus `cms_secret_key` (the Next server). Both are resolved from the
 * `SUPABASE_SECRET_KEYS` the runtime already injects, so recognising the second one costs no
 * new secret and no new configuration.
 *
 * WHY ADDING THE SECOND NAME GRANTS NOTHING. Every one of these keys already reaches PostgREST
 * as `service_role` and ignores RLS on every table: whoever holds one owns the base, gate or no
 * gate. What the gate exists to stop is the PUBLISHABLE key — the one shipped inside the app
 * binary and served in the site's JS — and that one is not in this map.
 *
 * The legacy `SUPABASE_SERVICE_ROLE_KEY` is reachable here ONLY through `getSecretKey()`'s
 * noisy #155 fallback, which fires when the configured name is missing. It is not a member of
 * this set on its own: it is the key that leaked.
 */
export function isOwnSecretKey(token: string): boolean {
  const candidate = token.trim();
  if (!candidate) return false;

  const map = readSecretKeyMap();
  const named = map?.[CMS_SERVER_KEY_NAME];

  const accepted = [getSecretKey(), typeof named === 'string' ? named : '']
    .map((k) => k.trim())
    .filter((k) => k.length > 0);

  return accepted.includes(candidate);
}
