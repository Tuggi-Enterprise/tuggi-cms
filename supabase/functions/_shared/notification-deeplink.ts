/**
 * NOTIFICATION DEEPLINK — SINGLE SOURCE OF TRUTH
 *
 * Answers one question, in one place: "where does the link of this notification
 * live?". The answer used to be spelled by hand at every inbox-mirroring path of
 * `firebase-push-notification`, and the three spellings disagreed — the direct
 * push (`type === 'user'`) never read `url`, so every push composed in the CMS
 * landed in `drive.user_notifications` with `deeplink` NULL (222 rows in the
 * table, 1 with a deeplink, measured 2026-08-23).
 *
 * The two spellings that exist in the wild, and why both are read:
 *  - `data.url`      — what the CMS composer emits
 *                      (`components/marketing/notifications/NotificationManager.tsx`,
 *                      `handleSend`, field "deepLink");
 *  - `data.deeplink` — what platform callers emit
 *                      (e.g. `daily-gamification-orchestrator`, `tuggi://map`).
 *
 * The canonical consumer is the `deeplink` column of `drive.user_notifications`.
 *
 * Do NOT add a fourth spelling here. The app in the field has no OTA — even a
 * 100% JS fix needs a store build — so the installed base only understands
 * `deeplink` / `data.deeplink` / `data.url`, and a new key would be silently
 * dropped for weeks.
 */

/** Any `data` bag that may carry the link, in either spelling. */
export type NotificationDataBag = Record<string, unknown> | null | undefined;

/**
 * First link found, reading the sources in the order given and, inside each
 * source, `deeplink` before `url`.
 *
 * Blank or whitespace-only values count as absent: a `''` in the `deeplink`
 * column is worse than NULL, because the inbox would render the row as tappable
 * and the tap would go nowhere.
 *
 * @returns the trimmed link, or `null` when no source carries one.
 */
export function resolveDeeplink(...sources: NotificationDataBag[]): string | null {
  for (const source of sources) {
    for (const key of ['deeplink', 'url'] as const) {
      const value = source?.[key];
      if (typeof value === 'string' && value.trim() !== '') {
        return value.trim();
      }
    }
  }
  return null;
}
