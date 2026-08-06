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
