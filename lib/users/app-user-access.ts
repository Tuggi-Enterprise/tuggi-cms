/**
 * THE ACCESS LEVEL OF A TOURIST, AS THE APP USERS LIST SHOWS AND FILTERS IT (#979).
 *
 * The level itself is decided in the database, in one place (`drive.access_level_of`, contract
 * `banco-para-cms.md` Part 13): `until` beats `purchased` beats `free`, a SANDBOX purchase is not a
 * purchase and a redeemed coupon is not one either. This module never recomputes it. It only turns
 * the value the RPC returns into a badge, a store detail and a filter, so the list and the big
 * numbers read the same level.
 *
 * Nothing here is React and nothing fetches: `tests/api/app-user-access.test.ts` proves it without a
 * browser.
 */

export const ACCESS_LEVELS = ['free', 'purchased', 'until'] as const

export type AccessLevel = (typeof ACCESS_LEVELS)[number]

export const PURCHASE_STORES = ['app_store', 'play_store'] as const

export type PurchaseStore = (typeof PURCHASE_STORES)[number]

/**
 * A value outside the three is `null`, never `free`: an unknown level painted as "free" would claim
 * that the tourist never paid, on top of data that did not arrive (a renamed column, an old RPC).
 */
export function accessLevelOf(raw: unknown): AccessLevel | null {
  return (ACCESS_LEVELS as readonly unknown[]).includes(raw) ? (raw as AccessLevel) : null
}

export function purchaseStoreOf(raw: unknown): PurchaseStore | null {
  return (PURCHASE_STORES as readonly unknown[]).includes(raw) ? (raw as PurchaseStore) : null
}

export interface AccessBadge {
  /** Key under `Pages.AppUsers.access`. */
  labelKey: `level.${AccessLevel}`
  className: string
}

const BADGE_CLASS: Record<AccessLevel, string> = {
  free: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  purchased: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
  until: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
}

export function accessBadge(level: AccessLevel): AccessBadge {
  return { labelKey: `level.${level}`, className: BADGE_CLASS[level] }
}

/**
 * The store is a detail of a purchase only. `purchase_store` can come filled on an `until` account
 * that also bought hours; the badge there says "access by period", and the store would read as the
 * reason for it.
 */
export function storeDetailKey(level: AccessLevel | null, store: unknown): `store.${PurchaseStore}` | null {
  if (level !== 'purchased') return null
  const known = purchaseStoreOf(store)
  return known ? `store.${known}` : null
}

/** `''` is "all levels". Any other filter keeps only the rows at exactly that level. */
export function matchesAccessFilter(level: unknown, filter: string): boolean {
  if (!filter) return true
  return accessLevelOf(level) === filter
}

/** `core.dashboard_app_user_stats()`, one row. PostgREST sends `bigint` as a number here. */
export interface AppUserStats {
  total_users: number
  ios_users: number
  android_users: number
  unknown_platform_users: number
  new_users_7d: number
  active_users_7d: number
  free_users: number
  purchased_users: number
  purchased_app_store_users: number
  purchased_play_store_users: number
  purchased_unknown_store_users: number
  until_users: number
  consumed_users: number
}

/** Share of the counted base that bought hours, as a whole percent. An empty base is 0, not NaN. */
export function purchasedShare(stats: Pick<AppUserStats, 'purchased_users' | 'total_users'>): number {
  const total = Number(stats.total_users)
  if (!total) return 0
  return Math.round((Number(stats.purchased_users) / total) * 100)
}
