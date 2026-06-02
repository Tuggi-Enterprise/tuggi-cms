/**
 * Marketing module — feature gate (SSOT).
 *
 * Single chokepoint that decides whether the Marketing module (newsletter +
 * push notifications) is available. Today it is always enabled; in the future
 * this will read the user's profile / purchased CMS capabilities. Keeping the
 * decision in one place means routes and navigation never drift apart.
 *
 * Usage:
 *   if (!isMarketingEnabled(role)) redirect/hide.
 */

export type MarketingGateRole = string | null | undefined;

/**
 * Whether the Marketing module is enabled for the given CMS role.
 *
 * NOTE (stub): returns `true` for everyone for now. When the capability flag
 * lands, branch here on role / entitlements — every caller picks it up for free.
 */
export function isMarketingEnabled(_role?: MarketingGateRole): boolean {
  return true;
}
