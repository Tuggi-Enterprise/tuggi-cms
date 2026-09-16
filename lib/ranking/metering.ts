/**
 * TWO INSTRUMENTS, TWO BOUNDARIES — and the older one is not the louder one.
 *
 * The scoreboard measures on two axes, and each one hangs on a different record:
 *
 * - the MINUTE comes from `drive.time_credit_consumption`, empty before **2026-08-18 20:41 UTC**;
 * - the KILOMETRE comes from the entitlement of the account at the instant of each step, and what
 *   makes entitlement reconstructible in the past is the balance-grant ledger, whose first row is
 *   **2026-08-13 16:11 UTC** (`docs/contracts/banco-para-cms.md`, Parte 7; **BR-RANKING-004**).
 *
 * The consequence for the screen is the whole reason this module exists, and since 2026-09-16 it
 * has two halves (`DS-COMPONENTE-084` item 1, cláusula de 2026-09-16; spec §7.7):
 *
 * 1. **ABSENCE AND INCOMPLETENESS DO NOT PRINT THE SAME.** Before 18/08 there is NO measured
 *    minute at all: zero there is absence of instrument and prints `UNKNOWN_VALUE` (*I do not
 *    know*). Before 13/08 the kilometre instrument EXISTS and is incomplete — with no grant
 *    ledger the only entitlement recognisable in the past is `subscription_end_date`, which
 *    reaches 68 of 530 profiles (12,8%, measured 2026-09-16) — so the number that comes out is
 *    positive and smaller than the real one, and it prints MARKED AS A FLOOR (*at least this*).
 *    Blanking a real number out of caution is as false as printing an absent one out of habit.
 * 2. **ONE BOUNDARY PER INSTRUMENT, AND NEITHER GOVERNS THE OTHER BY PROXIMITY.** A period
 *    between 13/08 and 18/08 has the kilometre `full` and the minute `none` AT THE SAME TIME.
 *    Reusing `meteringCoverage` to decide a kilometre column is the defect of 2026-09-13 under
 *    another name, and it passes every test that does not look at the date (spec §9, critério 37).
 *
 * The 90-day window CROSSES both boundaries, which is why coverage has three answers and not two,
 * and **eight of the 13 weeks of the horizon are below the kilometre one** — the floor state is
 * half the series the operator reads in the calibration panel, not an edge case.
 */

/** `2026-08-18T20:41:00Z` — the first row of `drive.time_credit_consumption`. */
export const METERING_LEDGER_START = Date.UTC(2026, 7, 18, 20, 41, 0)

/**
 * `2026-08-13T16:11:00Z` — the first row of the balance-grant ledger, measured 2026-09-16
 * (contract, Parte 7; spec §7.7). It is FIVE DAYS OLDER than the minute one, and that is the
 * whole trap: the two dates are close enough to look like the same fact and far enough apart to
 * make a week disagree with itself.
 */
export const ENTITLEMENT_LEDGER_START = Date.UTC(2026, 7, 13, 16, 11, 0)

/**
 * How much of a period an instrument covers.
 *
 * - `full` — the period starts at or after the ledger's first row: everything is measured;
 * - `partial` — the period straddles the boundary (`rolling_90d` does today, for both): part of
 *   the window has no instrument, and the number that comes back is a floor, not a total;
 * - `none` — the period ends before the record existed. For the MINUTE that means unknown; for
 *   the KILOMETRE it means floor, because the kilometre still has a second, partial source of
 *   entitlement (see the header). The distinction is the SCREEN's to print, not this type's to
 *   encode — the coverage answers *how much of the window the record covers*, and one answer
 *   serving two printings is what keeps a single owner for the boundary.
 */
export type MeteringCoverage = 'full' | 'partial' | 'none'

/**
 * Coverage of ONE boundary — the shared body, so `meteringCoverage` and `kmCoverage` are two
 * callers of one ruler and never two copies of it (CLAUDE.md §6).
 */
function coverageOf(
  boundary: number,
  periodStart: string | Date,
  periodEnd: string | Date
): MeteringCoverage {
  const start = new Date(periodStart).getTime()
  // `period_end` is EXCLUSIVE (contract, Parte 7): a period ending exactly at the first row
  // contains none of it, so it is `none` and not `partial`.
  const end = new Date(periodEnd).getTime()

  if (!Number.isFinite(start) || !Number.isFinite(end)) return 'full'
  if (end <= boundary) return 'none'
  if (start >= boundary) return 'full'
  return 'partial'
}

/**
 * The MINUTE axis — columns `Cobrado`, `Diferença`, `Pts por minuto` (`0` constant) and the card
 * `Cobrado sem disparo`. **Never a kilometre column** (spec §7.7).
 */
export function meteringCoverage(
  periodStart: string | Date,
  periodEnd: string | Date
): MeteringCoverage {
  return coverageOf(METERING_LEDGER_START, periodStart, periodEnd)
}

/**
 * The KILOMETRE axis — column 29 `Km com o guia ligado e com acesso`, column 30 `Pts de km`, the
 * `Disparo ÷ km` card and the calibration panel. **And the SCORE itself**, because the kilometre
 * is a parcel of `points_official` (**BR-RANKING-004**): where this says anything but `full`, the
 * points of the period are a floor and the screen declares it once, for the whole reading.
 */
export function kmCoverage(
  periodStart: string | Date,
  periodEnd: string | Date
): MeteringCoverage {
  return coverageOf(ENTITLEMENT_LEDGER_START, periodStart, periodEnd)
}

/** Does this period have a measured minute axis at all? The three time columns hang on it. */
export function hasMeter(coverage: MeteringCoverage): boolean {
  return coverage !== 'none'
}
