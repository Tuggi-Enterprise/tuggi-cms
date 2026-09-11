/**
 * What a pin on the Overview hero map says, and which channel says it.
 *
 * The map asks three questions and the marker
 * (`components/ui/GoogleMapComponent.tsx`) has three channels, so the mapping lives here, in
 * one place:
 *
 * | question | channel |
 * | :-- | :-- |
 * | is the guide on RIGHT NOW? | `active` — bigger pin, halo, top of the stack |
 * | what is this person worth? | `color` — the entitlement state |
 * | is this position now, or is it archive? | `dimmed` — filled pin vs. hollow pin |
 *
 * The three channels are orthogonal on purpose, and two of them are not free choices:
 * emphasis is **static** (DS-MAPA-027 — no animation loop on an operation map) and the
 * temporal state is drawn by **shape**, never by opacity, because opacity would destroy the
 * colour that carries the first fact (DS-MAPA-028).
 *
 * Before #732 the panel answered the second one with `is_premium` and answered neither of the
 * other two. `dashboard_user_location_pins` returned position with no temporal predicate at
 * all: 112 of the 378 pins (29.6 %, measured by `data` on 2026-09-11) were a position older
 * than 30 days, wearing exactly the same look as the single live pin.
 *
 * Nothing here recomputes a business rule. The entitlement state arrives resolved from
 * `drive.entitlement_state_of` and "guide on" arrives resolved as `guide_active`
 * (BR-MONETIZACAO-046 and `docs/contracts/banco-para-cms.md`, Part 6). This module picks
 * pixels from facts, and that is all it does.
 */

import { CHART_COLORS, CHART_NEUTRAL, ENTITLEMENT_COLOR } from '@/lib/constants/chart-colors'
import { ENTITLEMENT_STATES } from '@/lib/credit/entitlement'
import type { EntitlementState } from '@/lib/credit/entitlement'
import { LIVE_SIGNAL_MAX_AGE_SECONDS } from '@/lib/dashboard/time-windows'

/** `never` means the user has never emitted a signal (`last_signal_at IS NULL`) — 30 of the 378 measured pins. */
export type SignalFreshness = 'live' | 'archived' | 'never'

/** What the pin colour asserts. `unknown` is not a product state: it is a column that did not arrive. */
export type PinTone = EntitlementState | 'unknown' | 'live-only'

export interface MapPinFacts {
  entitlement_state?: string | null
  last_signal_age_seconds?: number | null
  guide_active?: boolean | null
}

export interface MapPinAppearance {
  /** Marker colour. */
  color: string
  /** Bigger pin, halo and top of the stack — all static (DS-MAPA-027). Reserved for the guide being on. */
  active: boolean
  /** Hollow pin: this position is archive, not presence. The colour survives in the stroke (DS-MAPA-028). */
  dimmed: boolean
  tone: PinTone
  freshness: SignalFreshness
}

/**
 * How old the last signal is, in three buckets.
 *
 * **A negative age is a signal from now, not a signal from the future.**
 * `drive.insert_location_batch` clamps the device clock to `[now()-1h, now()+5min]`
 * (migration `20260903150000`) and accepts up to 5 minutes ahead, so a device with a fast
 * clock produces a legitimately negative age. Comparing `age <= cut` already handles it; what
 * must never happen is that value reaching a sentence as "-3 minutes ago" — that is what
 * `signalAgeMinutes` is for.
 */
export function signalFreshness(ageSeconds: number | null | undefined): SignalFreshness {
  if (ageSeconds == null || !Number.isFinite(ageSeconds)) return 'never'
  return ageSeconds <= LIVE_SIGNAL_MAX_AGE_SECONDS ? 'live' : 'archived'
}

/**
 * The age in whole minutes, for display, floored at zero.
 *
 * The floor is how the negative is handled: a fast device clock reads "0 min ago", never
 * "-3 min ago". Returns `null` when there was no signal at all — the caller owns the sentence
 * for absence, because `0` there would be an assertion nobody made (the same pact as
 * `formatDurationOrDash`).
 */
export function signalAgeMinutes(ageSeconds: number | null | undefined): number | null {
  if (ageSeconds == null || !Number.isFinite(ageSeconds)) return null
  return Math.max(0, Math.floor(ageSeconds / 60))
}

/**
 * How many whole minutes ago an ISO instant happened — the guide's "on since".
 *
 * Floored at zero for the same reason as `signalAgeMinutes`, and for a second one:
 * `guide_session_started_at` is a server clock, but the `Date.now()` it is compared against
 * is the **operator's browser**, so a lagging operator clock would print "on for -2 min". An
 * unparseable date returns `null`.
 */
export function minutesSinceIso(iso: string | null | undefined, now: number = Date.now()): number | null {
  if (!iso) return null
  const started = Date.parse(iso)
  if (!Number.isFinite(started)) return null
  return Math.max(0, Math.floor((now - started) / 60_000))
}

/**
 * The colour of the entitlement state — three states, three colours (BR-MONETIZACAO-046).
 *
 * The palette is **not** chosen here: it is `ENTITLEMENT_COLOR`, the same one
 * `PaidAccessCard` paints two widgets above on this very screen. The map used to say
 * `is_premium ? orange : blue`, and that is the change that matters: **68 of the 73** pins
 * holding a canonical entitlement rendered as non-paying, because `is_premium` came from
 * `subscription_tier_id` and whoever buys a minute pack has no tier.
 *
 * A missing state does **not** fall back to `free`: BR-MONETIZACAO-046 says an unknown
 * entitlement never becomes `free` by omission, and painting it blue would be exactly that
 * assertion. Grey is the colour of "not a category, a hole in the data" (`CHART_NEUTRAL`).
 */
export function entitlementPinColor(state: string | null | undefined): string {
  return isEntitlementState(state) ? ENTITLEMENT_COLOR[state] : CHART_NEUTRAL
}

/**
 * The named pin, from `core.dashboard_user_location_pins`.
 *
 * **`guide_active` is the only input to "the guide is on".** `guide_state` is not read here,
 * and the omission is deliberate: it is only ever filled inside an open session, and #731
 * measures `TriggerDetectionService` emitting `guide_state = 'active'` hours after the
 * session closed (750 orphan heartbeats in 30 days). Rebuilding the boolean from it would
 * carry that defect onto the screen (Part 6, item 4).
 */
export function userPinAppearance(pin: MapPinFacts, hasLivePing = false): MapPinAppearance {
  const freshness = signalFreshness(pin.last_signal_age_seconds)
  const guideOn = pin.guide_active === true

  return {
    color: entitlementPinColor(pin.entitlement_state),
    active: guideOn,
    // Three ways of being present, and any one of them is enough. `hasLivePing` is the user
    // showing up in the presence RPC, which is fresher than any column of this pin — the
    // position being drawn is that one. The guide being on is presence the database itself
    // declared (an open session): dimming that pin would say "not here" about someone the
    // database just said is on the road. That last clause is also an invariant the icon
    // builder leans on: `active && dimmed` never leaves this function, so "hollow" is only
    // ever asked of the base pin (DS-MAPA-028).
    dimmed: !guideOn && !hasLivePing && freshness !== 'live',
    tone: isEntitlementState(pin.entitlement_state) ? pin.entitlement_state : 'unknown',
    freshness,
  }
}

/**
 * The pin of someone with a live ping and **no row** in `dashboard_user_location_pins`
 * (a trail with no `profiles.lat/lng`).
 *
 * Green, and with no entitlement state: the presence RPC returns `{user_id, nickname, lat,
 * lng, timestamp}` and nothing else. Painting it blue would pass it off as `free` without
 * anyone having measured that. Never `dimmed` — it exists because a ping just arrived.
 */
export function livePinAppearance(): MapPinAppearance {
  return {
    color: CHART_COLORS.green,
    active: false,
    dimmed: false,
    tone: 'live-only',
    freshness: 'live',
  }
}

function isEntitlementState(value: unknown): value is EntitlementState {
  return typeof value === 'string' && (ENTITLEMENT_STATES as readonly string[]).indexOf(value) >= 0
}
