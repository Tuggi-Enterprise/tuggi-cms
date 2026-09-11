/**
 * The time windows of the panel — three of them, and each one answers a **different question**
 * (DS-MAPA-026).
 *
 * They were three unrelated numbers in three files: a constant in `lib/dashboard/map-pin.ts`,
 * a constant in the Overview page, and a `600` typed into a call. Different values reading as
 * carelessness, because none of them said what it decided. They live together here so the next
 * reader can see, in one screen, that the divergence is the point:
 *
 * | seconds | the question | what would break if it moved |
 * | --: | :-- | :-- |
 * | 300 | is this pin **presence or archive**? | the word "live" on 378 pins |
 * | 90 | **which coordinate do I draw**? | the position, not the state |
 * | 600 | what happened in the **last stretch**? | the Radar's list of POIs empties |
 *
 * The rule that governs all three (DS-MAPA-026): a window is a **question with a name**, never
 * a literal at the call site and never a parameter default — a default nobody passes is a
 * fourth number that no `grep` denounces (CLAUDE.md §6, and the `kRetryDelayMs` precedent).
 * Only one of them may be called "live", and it is the one that decides "live".
 */

/**
 * **Is this pin presence, or is it archive?**
 *
 * How many seconds old the last signal may be and still count as "live" on the map. This is
 * the **only** cut in the panel that decides the word "live", and it grades all 378 pins —
 * including the ones no presence RPC ever returns.
 *
 * Four ties hold the value. The first three each forbid a smaller cut; the third also forbids
 * a larger one.
 *
 * 1. **The noise admitted inside the value is itself 300 s.** `last_signal_at` is
 *    `greatest(session_heartbeats.created_at, user_location_history.created_at)` and the two
 *    are **not the same clock**: the first is `DEFAULT now()` (server), the second is the
 *    device clock **clamped** to `[now()-1h, now()+5min]` by `drive.insert_location_batch`
 *    (migration `20260903150000`). A cut below 300 s would be finer than the tolerance the
 *    database deliberately injects into the number being judged. 300 is the **smallest** cut
 *    that is not narrower than the error of its own input.
 * 2. **Both emitters run at 30 s, and the heartbeat arrives on a server clock.**
 *    `UserLocationTracker.RECORD_INTERVAL_MS` and `FLUSH_INTERVAL_MS` are both `30_000`, so a
 *    genuinely present device reaches ~60 s of age from queueing alone, before any network
 *    retry. With 60 s polling on the Overview, any cut below ~180 s makes the pin **blink**
 *    between live and archived from read to read. On a 378-pin map, a breathing pin is worse
 *    than either misclassification.
 * 3. **The panel has no resolution finer than 5 min anyway, and that is the ceiling.**
 *    `guide_active` depends on `drive.close_orphaned_sessions()`, run by the `close-orphans`
 *    cron every 5 minutes. The two presence channels of the same pin — signal and guide — share
 *    a resolution, and the coarser one sets it. Above 300 s the founder would see a pin still
 *    "live" after the janitor had already declared its session dead.
 * 4. **The choice costs nothing against the defect #732 exists to kill.** Of the 378 pins, 112
 *    hold a position older than 30 days and **none** falls between 90 s and 300 s (measured by
 *    `data` on 2026-09-11: <= 5 min = 1 pin; <= 1 h = 2). 90 and 300 classify those 112
 *    identically. The decision is entirely about flicker, and flicker argues for 300.
 *
 * The clamp is **not** the origin of the number: it is a skew limit, not a staleness limit.
 * Its slack is tie 1 above, not a coincidence.
 *
 * A **negative** age is legitimate — the clamp accepts `now()+5min` — and `ageSeconds <= cut`
 * handles it by construction. `signalAgeMinutes` owns the floor that keeps "-3 min ago" off
 * the screen.
 */
export const LIVE_SIGNAL_MAX_AGE_SECONDS = 300

/**
 * **Which coordinate do I draw?**
 *
 * Not a liveness window (DS-MAPA-026): it is the choice between the position the presence RPC
 * just returned and the snapshot in `profiles.lat/lng`. That is why it is the shortest of the
 * three — it protects the **position**, never the state. A pin outside this window is not
 * archived by it; it is drawn from its stored coordinate and graded by
 * `LIVE_SIGNAL_MAX_AGE_SECONDS` like every other pin.
 *
 * Background ping is ~30 s, so 90 s tolerates two lost pings without a false "online" and
 * drops a closed app in ~90 s. There is no "offline" event — presence is inferred from ping
 * recency. The Overview polls every 60 s, which must stay `<=` this window for the UI to
 * reflect the drop in time.
 */
export const POSITION_SOURCE_WINDOW_SEC = 90

/**
 * **What happened in the last stretch?**
 *
 * The Radar's feed window, and it is sized by the **content it feeds**, not by presence: the
 * same call fills `active_pois`, the list of POIs listened to, which is the main content of
 * that screen. Shortening it would empty the list (DS-MAPA-026, feed case).
 */
export const RADAR_FEED_WINDOW_SEC = 600
