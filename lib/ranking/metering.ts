/**
 * WHEN THE METER STARTED EXISTING — the single owner of that date in the CMS.
 *
 * `drive.time_credit_consumption` is empty before **2026-08-18 20:41 UTC**: there was no
 * `metered` state in the past and no minute is reconstructible backwards
 * (`docs/contracts/banco-para-cms.md`, Parte 7, fact 5, measured 2026-09-13).
 *
 * The consequence for the screen is the whole reason this module exists: in a period entirely
 * before that instant, the minute axis of the scoreboard is **zero for want of an instrument**,
 * not for want of use. Printing `0` there would assert a measurement nobody made, so the
 * columns print `UNKNOWN_VALUE` instead — `DS-COMPONENTE-084` item 1, which also requires the
 * temporal boundary to have ONE owner in code rather than a literal inside a component.
 *
 * The 90-day window CROSSES the boundary, which is why coverage has three answers and not two.
 */

/** `2026-08-18T20:41:00Z` — the first row of `drive.time_credit_consumption`. */
export const METERING_LEDGER_START = Date.UTC(2026, 7, 18, 20, 41, 0)

/**
 * How much of a period the meter covers.
 *
 * - `full` — the period starts at or after the ledger's first row: every minute is measured;
 * - `partial` — the period straddles the boundary (`rolling_90d` does today): part of the
 *   window has no instrument, and the number that comes back is a floor, not a total;
 * - `none` — the period ends before the meter existed: the minute axis is unknown, not zero.
 */
export type MeteringCoverage = 'full' | 'partial' | 'none'

export function meteringCoverage(
  periodStart: string | Date,
  periodEnd: string | Date
): MeteringCoverage {
  const start = new Date(periodStart).getTime()
  // `period_end` is EXCLUSIVE (contract, Parte 7): a period ending exactly at the first charge
  // contains no charged minute, so it is `none` and not `partial`.
  const end = new Date(periodEnd).getTime()

  if (!Number.isFinite(start) || !Number.isFinite(end)) return 'full'
  if (end <= METERING_LEDGER_START) return 'none'
  if (start >= METERING_LEDGER_START) return 'full'
  return 'partial'
}

/** Does this period have a measured minute axis at all? The three time columns hang on it. */
export function hasMeter(coverage: MeteringCoverage): boolean {
  return coverage !== 'none'
}
