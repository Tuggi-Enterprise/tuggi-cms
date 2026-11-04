/**
 * The arithmetic of the two funnels of the Engagement and conversion page (#1068, #1101 spec Parte C
 * §C5 and §C6), in plain TS so it is testable without mounting.
 *
 * Two instruments meet on this screen and they never form a fraction (DS-COMPONENTE-084 item 2):
 *
 *   installs  -> GA4 `first_open` per day, per DEVICE (`social.funnel_daily`)
 *   entered   -> people who got past the Terms in the month, account or guest
 *
 * So the drop from installs to entered is printed as a difference, never as a rate. The steps after
 * `entered` (account, guide or story, purchased) are each a share of `entered`, in any order: a guest
 * buys without an account (BR-USUARIO-037 3.j), so none of them is a share of the one before. The GA4
 * "interacted" count of the use funnel only sets the ruler: no rate touches it.
 *
 * And three states of `installs` print differently (DS-COMPONENTE-084 item 1):
 *
 *   unknown   -> no row in `social.funnel_daily` for the month: GA4 was not collecting
 *   floor     -> GA4 counted fewer installs than entries: it lost events, the count is a minimum
 *   measured  -> the plain number, and the only state where the difference is printed
 */

import { SUMMARY_MIN_BASE } from '@/lib/engagement/summary'

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
  purchased: number
  /**
   * The fields of #1100 (contract banco-para-cms Parte 23). `null` = the function deployed does not
   * send them yet, which prints "no data", never 0 (BR-COMUNICACAO-022 item 4).
   */
  testedFree: number | null
  purchasedAfterFree: number | null
  purchasedWithoutFree: number | null
  usedGuideOrStory: number | null
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
    purchased: count(r.purchased),
    testedFree: nullableCount(r.tested_free),
    purchasedAfterFree: nullableCount(r.purchased_after_free),
    purchasedWithoutFree: nullableCount(r.purchased_without_free),
    usedGuideOrStory: nullableCount(r.used_guide_or_story),
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

/** A share of a base; a zero or unknown base prints no rate (DS-COMPONENTE-084 item 2). */
function rateOf(value: number | null, base: number | null): number | null {
  return value === null || base === null || base <= 0 ? null : value / base
}

// ── Use funnel (spec §C5) ────────────────────────────────────────────────────────────────────

export interface UseFunnelView {
  installs: InstallsState
  /** One ruler for the four bands; an unknown count draws no band and does not set it. */
  max: number
  notEntered: number | null
  /** `entered − account`, the guest part of Entered; `null` when account came larger (spec §C15.6). */
  guest: number | null
  rates: { account: number | null; used: number | null }
}

/**
 * The use funnel: installs (GA4), entered, interacted (GA4, `newEngaged`) and guide or story. The
 * GA4 count only widens the ruler; the two rates are bank over bank of the same cohort.
 */
export function readUseFunnel(f: ConversionFunnel, newEngaged: number | null): UseFunnelView {
  return {
    installs: installsState(f.installs.total, f.entered),
    max: Math.max(f.installs.total ?? 0, f.entered, newEngaged ?? 0, f.usedGuideOrStory ?? 0),
    notEntered: notEntered(f.installs.total, f.entered),
    guest: f.account <= f.entered ? f.entered - f.account : null,
    rates: {
      account: rateOfEntered(f.account, f.entered),
      used: rateOf(f.usedGuideOrStory, f.entered),
    },
  }
}

// ── Purchase funnel (spec §C6, DS-COMPONENTE-101) ────────────────────────────────────────────

export type BranchKey = 'tested' | 'untested'

export interface PurchaseBranch {
  key: BranchKey
  /** People in the branch; `null` when the source does not split yet. `0` is measured. */
  size: number | null
  /** `size / entered`. */
  share: number | null
  bought: number | null
  /** The rest of the branch, named, never a measure of its own (DS-COMPONENTE-101 item 1). */
  notBought: number | null
  /** `bought / size`; `null` with a zero or unknown base. */
  rate: number | null
}

export interface PurchaseFunnelView {
  entered: number
  purchased: number
  purchasedRate: number | null
  /** The source sends `tested_free`: the trunk splits in two parts. */
  split: boolean
  branches: [PurchaseBranch, PurchaseBranch]
  /** The branch that converts more, by DS-COMPONENTE-101 item 3; `null` when it does not print. */
  convertsMore: BranchKey | null
  /** Both rates measured and a base under `SUMMARY_MIN_BASE`: the bases go in the title of the rate. */
  smallBase: boolean
}

function branch(key: BranchKey, size: number | null, bought: number | null, entered: number): PurchaseBranch {
  const b = size === null ? null : bought
  return {
    key,
    size,
    share: rateOf(size, entered),
    bought: b,
    notBought: size === null || b === null || b > size ? null : size - b,
    rate: rateOf(b, size),
  }
}

/**
 * The purchase funnel: Entered splits into "tested with free hours" and the rest, and each branch
 * prints its own purchase rate. The floor of the highlight is the surface's (`SUMMARY_MIN_BASE`,
 * DS-COMPONENTE-100 item 1, one owner).
 */
export function readPurchaseFunnel(f: ConversionFunnel): PurchaseFunnelView {
  const tested = f.testedFree !== null && f.testedFree <= f.entered ? f.testedFree : null
  const untested = tested === null ? null : f.entered - tested
  const branches: [PurchaseBranch, PurchaseBranch] = [
    branch('tested', tested, f.purchasedAfterFree, f.entered),
    branch('untested', untested, f.purchasedWithoutFree, f.entered),
  ]
  const [a, b] = branches
  const measured = a.rate !== null && b.rate !== null
  const bigEnough = measured && (a.size as number) >= SUMMARY_MIN_BASE && (b.size as number) >= SUMMARY_MIN_BASE
  const ra = a.rate === null ? null : Math.round(a.rate * 100)
  const rb = b.rate === null ? null : Math.round(b.rate * 100)
  return {
    entered: f.entered,
    purchased: f.purchased,
    purchasedRate: rateOfEntered(f.purchased, f.entered),
    split: tested !== null,
    branches,
    convertsMore: bigEnough && ra !== rb ? ((ra as number) > (rb as number) ? 'tested' : 'untested') : null,
    smallBase: measured && !bigEnough,
  }
}
