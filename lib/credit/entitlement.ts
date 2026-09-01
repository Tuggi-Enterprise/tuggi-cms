/**
 * The vocabulary of the access right, and the balance bands the CMS reads it with.
 *
 * **Nothing here resolves a state.** `unlimited` → `metered` → `free` is resolved once,
 * in `drive.get_entitlement(user_id)`, and arrives already decided on every RPC —
 * **BR-MONETIZACAO-046** allows exactly one implementation of that order. This module
 * owns the NAMES of those facts and groups a balance into a band; no function here reads
 * `ends_at` or compares a balance against a date to infer a right.
 *
 * The bands are the Tech Lead's decision on #656, and the reason is the catalogue: the
 * smallest pass on sale is 600 minutes (**BR-MONETIZACAO-048**), so less than one hour
 * left is less than 10% of the smallest package.
 *
 * **Formatting minutes is not from here.** The owner of the `5 h 20 min` shape is
 * `lib/format/duration.ts`, by spec (`docs/design/spec-cms-credito-por-hora-2026-08.md`),
 * including the decision that `h` and `min` are not translated.
 */

/**
 * The three states, in the order `drive.get_entitlement` resolves them. There is no
 * fourth value. `docs/contracts/entitlement.md` declares them; here they get a type name.
 */
export const ENTITLEMENT_STATES = ['unlimited', 'metered', 'free'] as const

export type EntitlementState = (typeof ENTITLEMENT_STATES)[number]

/**
 * The six doors through which balance or term enters an account (BR-MONETIZACAO-047) —
 * what the ledger writes in `source`, and what `last_grant_source` answers. A source
 * outside this list is new data from the database, and the screen prints the raw value
 * instead of inventing a label for it.
 */
export const GRANT_SOURCES = ['purchase', 'welcome', 'coupon', 'cms', 'partner', 'transfer'] as const

export type GrantSource = (typeof GRANT_SOURCES)[number]

/**
 * Purchase or grant, for the badge on the list.
 *
 * The question is "where did the balance come from", and `last_grant_source` is what
 * answers it — the most recent grant. `has_purchase` answers something else ("this person
 * has bought at some point") and earns its own column; using both for the same badge is
 * how one fact ends up with two owners.
 */
export function grantOrigin(source: string | null | undefined): 'purchase' | 'grant' {
  return source === 'purchase' ? 'purchase' : 'grant'
}

/** Ascending order of comfort. It is the order the report's filter is drawn in. */
export const BALANCE_BANDS = ['critical', 'attention', 'comfortable'] as const

export type BalanceBand = (typeof BALANCE_BANDS)[number]

/** Floor of each band, in MINUTES. One band's ceiling is the next one's floor minus 1. */
export const BALANCE_BAND_FLOOR: Record<BalanceBand, number> = {
  critical: 1,
  attention: 60,
  comfortable: 300,
}

/**
 * The band of a balance, or `null` when there is no balance.
 *
 * Zero is no band at all: it is the `free` state (BR-MONETIZACAO-046, order 3), and `free`
 * does not belong on a running-out list. Negative does not exist — the zero floor lives in
 * the body of `drive.get_entitlement` — but if one ever arrives it lands here as absence of
 * balance instead of becoming "critical" by an accident of sign.
 */
export function balanceBand(minutes: number | null | undefined): BalanceBand | null {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes < BALANCE_BAND_FLOOR.critical) {
    return null
  }
  if (minutes >= BALANCE_BAND_FLOOR.comfortable) return 'comfortable'
  if (minutes >= BALANCE_BAND_FLOOR.attention) return 'attention'
  return 'critical'
}

/**
 * The largest balance still inside the band, to become `max_balance_minutes` on the RPC.
 * `comfortable` has no ceiling — it answers `null`, which the RPC reads as "no filter".
 */
export function balanceBandCeiling(band: BalanceBand): number | null {
  if (band === 'critical') return BALANCE_BAND_FLOOR.attention - 1
  if (band === 'attention') return BALANCE_BAND_FLOOR.comfortable - 1
  return null
}

/**
 * What the Overview's "running out" widget asks the RPC for: everything that is not yet
 * comfortable. Derived from the map above, so the widget and the band cannot disagree.
 */
export const LOW_BALANCE_CEILING_MINUTES = BALANCE_BAND_FLOOR.comfortable - 1
