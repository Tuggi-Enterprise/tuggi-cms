import { UNKNOWN_VALUE } from '@/lib/format/unknown'

/**
 * The single owner of the `5 h 20 min` shape (spec §1, `docs/design/spec-cms-credito-por-hora-2026-08.md`).
 *
 * `h` and `min` DO NOT translate: they are the same three characters in pt, en and es,
 * so they live here and never in `messages/*.json`. There is always a space between the
 * number and the unit. Zero is `0 min`, never an empty string — an empty cell reads as
 * "unknown", and unknown has its own copy (`panel.balance_unknown`, `DS-COMPONENTE-007`).
 *
 * Nothing here computes a balance. The balance is whatever `drive.get_entitlement`
 * returned (BR-MONETIZACAO-046); this module only renders an integer of minutes.
 */

/**
 * Minutes per consumption block — BR-MONETIZACAO-049. Usage is only ever metered in
 * whole 5-minute blocks, so a granted amount outside the block is born with 1 to 4
 * minutes no block can consume.
 *
 * This is the granularity the minutes `<select>` is built from, not a validation: the
 * refusal itself belongs to the database (`drive.record_time_credit_grant`, SQLSTATE
 * `TGM49`), which is the last door. The screen is one of the doors, not the only one.
 */
export const MINUTES_PER_BLOCK = 5

/**
 * The 12 options of the minutes `<select>`: `00, 05, 10 … 55`. Derived from the block, not
 * typed out, so the control cannot drift away from what the debit actually measures. It
 * lives here rather than in the component because it is what proves criterion 2 of the
 * spec — no reachable combination of hours and minutes forms a non-multiple.
 */
export const MINUTE_OPTIONS: readonly number[] = Array.from(
  { length: 60 / MINUTES_PER_BLOCK },
  (_, index) => index * MINUTES_PER_BLOCK
)

/** Formats whole minutes as `5 h 20 min`, `45 min`, `12 h`, `0 min`. */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) return '0 min'

  const whole = Math.trunc(minutes)
  const hours = Math.floor(whole / 60)
  const rest = whole % 60

  if (hours > 0 && rest > 0) return `${hours} h ${rest} min`
  if (hours > 0) return `${hours} h`
  return `${rest} min`
}

/**
 * `5 h 20 min` for a known amount, `UNKNOWN_VALUE` for a column that did not come back.
 *
 * `formatDuration` answers "how do I write this many minutes" and reads `null` as `0 min`,
 * because its callers are looking at a balance the database returned: a measured zero. This
 * one answers a different question — "did the column come back at all" — and there `0 min`
 * would be an assertion nobody made (`DS-COMPONENTE-007`).
 *
 * The two live side by side on purpose. The RPCs of the dashboard belong to `data` and gain
 * columns before the migration reaches this repo; `optionalMinutes` in
 * `lib/services/dashboard-service.ts` is the other half of the same pact — a missing column
 * becomes `null`, never `0`.
 */
export function formatDurationOrDash(minutes: number | null | undefined): string {
  return minutes == null ? UNKNOWN_VALUE : formatDuration(minutes)
}

/** Splits whole minutes into the two fields of the quantity control (spec §2). */
export function splitDuration(minutes: number): { hours: number; minutes: number } {
  const whole = Math.max(0, Math.trunc(minutes))
  return { hours: Math.floor(whole / 60), minutes: whole % 60 }
}

/**
 * The two valid neighbours of an amount that is not a multiple of the block, for
 * `errors.not_multiple`. Reachable only when a caller other than the form produced the
 * amount — the form's controls cannot form an invalid total (`DS-COMPONENTE-012`).
 */
export function nearestBlockValues(minutes: number): { lower: number; upper: number } {
  const whole = Math.max(0, Math.trunc(minutes))
  const lower = Math.floor(whole / MINUTES_PER_BLOCK) * MINUTES_PER_BLOCK
  return { lower, upper: lower + MINUTES_PER_BLOCK }
}
