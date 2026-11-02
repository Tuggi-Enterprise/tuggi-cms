/**
 * The arithmetic of the Conversion report (#1068), in plain TS so it is testable without mounting.
 *
 * Two instruments meet on this screen and they never form a fraction (DS-COMPONENTE-084 item 2):
 *
 *   installs  -> GA4 `first_open` per day, per DEVICE (`social.funnel_daily`)
 *   entered   -> people who got past the Terms in the month, account or guest
 *
 * So the drop from installs to entered is printed as a difference, never as a rate. The steps after
 * `entered` (account, used hours, purchased) are each a share of `entered`, in any order: a guest buys
 * without an account (BR-USUARIO-037 3.j), so none of them is a share of the one before.
 *
 * And three states of `installs` print differently (DS-COMPONENTE-084 item 1):
 *
 *   unknown   -> no row in `social.funnel_daily` for the month: GA4 was not collecting
 *   floor     -> GA4 counted fewer installs than entries: it lost events, the count is a minimum
 *   measured  -> the plain number, and the only state where the difference is printed
 */

export interface ConversionInstalls {
  ios: number | null
  android: number | null
  /** `null` = no GA4 row for the month. `0` = GA4 measured and nobody installed. */
  total: number | null
}

export interface ConversionFunnel {
  /** YYYY-MM */
  month: string
  installs: ConversionInstalls
  entered: number
  account: number
  usedHours: number
  purchased: number
}

export type InstallsState = 'unknown' | 'floor' | 'measured'

/** `null` stays `null`; anything else becomes a finite number or `null`. Zero is a value. */
function nullableCount(v: unknown): number | null {
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function count(v: unknown): number {
  return nullableCount(v) ?? 0
}

/**
 * Reads the jsonb of `core.dashboard_conversion_funnel(p_month)`. The one thing this guards is
 * `installs.total: null`: coercing it to `0` would claim GA4 measured an empty month.
 */
export function parseConversionFunnel(raw: unknown): ConversionFunnel {
  const r = (raw ?? {}) as Record<string, unknown>
  const i = (r.installs ?? {}) as Record<string, unknown>
  return {
    month: typeof r.month === 'string' ? r.month : '',
    installs: {
      ios: nullableCount(i.ios),
      android: nullableCount(i.android),
      total: nullableCount(i.total),
    },
    entered: count(r.entered),
    account: count(r.account),
    usedHours: count(r.used_hours),
    purchased: count(r.purchased),
  }
}

export function installsState(installsTotal: number | null, entered: number): InstallsState {
  if (installsTotal === null) return 'unknown'
  return installsTotal < entered ? 'floor' : 'measured'
}

/** Share of `entered`. Zero denominator prints no rate (DS-COMPONENTE-084 item 2), so `null`. */
export function rateOfEntered(value: number, entered: number): number | null {
  return entered > 0 ? value / entered : null
}

/** "N installed and did not enter": only when installs is measured and not a floor. */
export function notEntered(installsTotal: number | null, entered: number): number | null {
  return installsState(installsTotal, entered) === 'measured' ? (installsTotal as number) - entered : null
}

/** One ruler for all five bars. An unknown installs count draws no bar and does not set the scale. */
export function funnelMax(installsTotal: number | null, entered: number): number {
  return Math.max(installsTotal ?? 0, entered)
}

export interface FunnelView {
  installs: InstallsState
  max: number
  notEntered: number | null
  rates: { account: number | null; usedHours: number | null; purchased: number | null }
}

export function readFunnel(f: ConversionFunnel): FunnelView {
  return {
    installs: installsState(f.installs.total, f.entered),
    max: funnelMax(f.installs.total, f.entered),
    notEntered: notEntered(f.installs.total, f.entered),
    rates: {
      account: rateOfEntered(f.account, f.entered),
      usedHours: rateOfEntered(f.usedHours, f.entered),
      purchased: rateOfEntered(f.purchased, f.entered),
    },
  }
}
