/**
 * What a coupon grants — BR-MONETIZACAO-047: one of two natures, never a third.
 *
 *   - `until`   extends the access period by `duration_days` (the legacy coupon)
 *   - `minutes` adds `grant_minutes` to the hour balance (partner coupon in hours)
 *
 * The combination mirrors `drive.coupons.coupons_natureza_ck`: exactly one of the two amounts is
 * filled, and the other is NULL. Validating it here only turns a 23514 into a readable 400.
 *
 * The cap of 2.700 minutes per act (BR-MONETIZACAO-063 item 7) is NOT restated here: its single
 * owner is `drive.manual_grant_cap_minutes()`, enforced on insert/update by the trigger
 * `coupons_manual_grant_cap_bi_bu`, which raises `TGM63` with the cap in the text. The routes
 * read it back through `classifyLedgerError` (`lib/credit/errors.ts`), exactly like the credit
 * door does. A second `2700` in this repo would be the second declaration CLAUDE.md §6 forbids.
 */

import { formatDuration } from '@/lib/format/duration'
import { UNKNOWN_VALUE } from '@/lib/format/unknown'
import { classifyLedgerError } from '@/lib/credit/errors'

export type CouponGrantKind = 'until' | 'minutes'

export interface CouponGrantFields {
  grant_kind: CouponGrantKind
  duration_days: number | null
  grant_minutes: number | null
}

export type CouponGrantParse =
  | { ok: true; fields: CouponGrantFields }
  | { ok: false; error: string }

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1
}

function isAbsent(value: unknown): boolean {
  return value === undefined || value === null
}

/**
 * Reads the three grant fields of a request body into the only shapes the table accepts.
 * `grant_kind` absent means `until`, the column default — what every caller sent before #787.
 */
export function parseCouponGrant(body: Record<string, unknown>): CouponGrantParse {
  const kind = body.grant_kind ?? 'until'
  if (kind !== 'until' && kind !== 'minutes') {
    return { ok: false, error: 'grant_kind must be "until" or "minutes"' }
  }

  if (kind === 'until') {
    if (!isAbsent(body.grant_minutes)) {
      return { ok: false, error: 'grant_minutes must be null when grant_kind is "until"' }
    }
    if (!isPositiveInteger(body.duration_days)) {
      return { ok: false, error: 'duration_days must be a positive integer' }
    }
    return {
      ok: true,
      fields: { grant_kind: 'until', duration_days: body.duration_days, grant_minutes: null },
    }
  }

  if (!isAbsent(body.duration_days)) {
    return { ok: false, error: 'duration_days must be null when grant_kind is "minutes"' }
  }
  if (!isPositiveInteger(body.grant_minutes)) {
    return { ok: false, error: 'grant_minutes must be a positive integer' }
  }
  return {
    ok: true,
    fields: { grant_kind: 'minutes', duration_days: null, grant_minutes: body.grant_minutes },
  }
}

/**
 * The grant as the coupon list prints it: `12 h` for an hours coupon (via `formatDuration`, the
 * owner of `h`/`min`), `7 days` for a period coupon. `daysWord` is the translated unit.
 */
export function formatCouponGrant(
  coupon: { grant_kind?: CouponGrantKind | null; grant_minutes?: number | null; duration_days: number | null },
  daysWord: string
): string {
  if (coupon.grant_kind === 'minutes') return formatDuration(coupon.grant_minutes)
  return `${coupon.duration_days ?? UNKNOWN_VALUE} ${daysWord}`
}

/**
 * Maps a write error of `drive.coupons` to the route's answer. `TGM63` is the cap trigger
 * (BR-MONETIZACAO-063 item 7) and carries the cap, read back — never declared — by
 * `classifyLedgerError`. `23514` is `coupons_natureza_ck` or another CHECK: the operator's input.
 */
export function couponWriteRefusal(
  error: { code?: string | null; message?: string | null }
): { status: number; body: { error: string; code: string; cap_minutes?: number } } | null {
  if (error.code === 'TGM63') {
    const { capMinutes } = classifyLedgerError(error, 'grant')
    return {
      status: 400,
      body: {
        error: capMinutes
          ? `grant_minutes exceeds the cap of ${capMinutes} minutes per coupon`
          : 'grant_minutes exceeds the cap per coupon',
        code: 'above_cap',
        ...(capMinutes ? { cap_minutes: capMinutes } : {}),
      },
    }
  }
  if (error.code === '23514') {
    return { status: 400, body: { error: 'Invalid grant combination', code: 'invalid_grant' } }
  }
  return null
}
