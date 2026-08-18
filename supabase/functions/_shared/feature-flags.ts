/**
 * Remote kill switches for the Edge Functions — read at request time, from the
 * environment, so that flipping one is a secret change plus a redeploy and never
 * a code change.
 *
 * Why the environment and not the client: the app has no OTA. A switch that
 * lives in the bundle only reaches whoever installs a new store build, which is
 * weeks away and never reaches 100% of the field. The Edge Function is the only
 * place that reaches every installed version at once.
 *
 * Every flag here FAILS CLOSED: anything other than the exact string `true`
 * (trimmed, case-insensitive) leaves the feature OFF. An unset variable, a typo
 * and an empty value must all mean "do not spend money".
 */

/**
 * Name of the environment variable that re-enables just-in-time contextual
 * narration in `generate-contextual-narration`. Declared once; no other module
 * spells it out, so renaming it is one edit.
 */
export const CONTEXTUAL_NARRATION_ENABLED_ENV = "CONTEXTUAL_NARRATION_ENABLED";

/**
 * Whether `generate-contextual-narration` may generate. OFF since #487
 * (2026-08-18): every generated narration is a paid AI call, and the native
 * pre-fetch was making them without anyone having turned the feature on.
 *
 * Read inside the function, never at module load, so a test can swap `Deno.env`
 * between cases and so a restarted isolate always sees the current secret.
 */
export function isContextualNarrationEnabled(): boolean {
    const raw = Deno.env.get(CONTEXTUAL_NARRATION_ENABLED_ENV);
    return (raw ?? "").trim().toLowerCase() === "true";
}
