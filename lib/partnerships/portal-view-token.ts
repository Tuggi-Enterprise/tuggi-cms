/**
 * #996 — "Ver como o lojista": the CMS admin opens the partner's `/status` in the portal, read-only.
 * Contract: `docs/contracts/places-cms.md` §11 (workspace).
 *
 * Two signed tokens, one secret (`PORTAL_VIEW_SECRET`, Vercel only: the portal never holds it, it
 * forwards what it got and the CMS checks it):
 *  - `access`: minted by the admin's click, lives 5 minutes, opens ONE session. Single use is the
 *    audit row of the redemption, written with `id = jti` (`portal-view-service.ts`).
 *  - `session`: what the portal keeps in an httpOnly cookie for 30 minutes; every read of the
 *    partner's submission carries it back here.
 * Both name the submission and the admin who asked. The `kind` is signed, so an access cannot be
 * replayed as a session nor a session as an access.
 *
 * Shape: `base64url(json).base64url(hmac-sha256)`. Pure and Node-only (`node:crypto`).
 */

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'

export const PORTAL_VIEW_ACCESS_SECONDS = 5 * 60
export const PORTAL_VIEW_SESSION_SECONDS = 30 * 60

/** A secret shorter than this is a mistake in the environment, and the feature stays off. */
const MIN_SECRET_LENGTH = 32
/** A token of ours is about 250 characters; anything far longer is not worth an HMAC. */
const MAX_TOKEN_LENGTH = 1024
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type PortalViewKind = 'access' | 'session'

export interface PortalViewClaims {
  kind: PortalViewKind
  /** The portal submission being viewed. */
  submissionId: string
  /** `auth.users.id` of the CMS admin who asked. */
  adminId: string
  /** One per token; the access's is the id of its redemption audit row. */
  jti: string
  /** Unix seconds. */
  expiresAt: number
}

export type VerifyFailure = 'malformed' | 'bad_signature' | 'wrong_kind' | 'expired'

/** The secret from the environment, or `null` when it is missing or too short (fails closed). */
export function portalViewSecret(env: Record<string, string | undefined> = process.env): string | null {
  const value = (env.PORTAL_VIEW_SECRET ?? '').trim()
  return value.length >= MIN_SECRET_LENGTH ? value : null
}

const mac = (secret: string, payload: string) => createHmac('sha256', secret).update(payload, 'utf8').digest('base64url')

export function signPortalView(
  secret: string,
  input: { kind: PortalViewKind; submissionId: string; adminId: string; nowSeconds: number }
): { token: string; claims: PortalViewClaims } {
  const lifetime = input.kind === 'access' ? PORTAL_VIEW_ACCESS_SECONDS : PORTAL_VIEW_SESSION_SECONDS
  const claims: PortalViewClaims = {
    kind: input.kind,
    submissionId: input.submissionId,
    adminId: input.adminId,
    jti: randomUUID(),
    expiresAt: input.nowSeconds + lifetime,
  }
  const payload = Buffer.from(
    JSON.stringify({ v: 1, k: claims.kind, s: claims.submissionId, a: claims.adminId, j: claims.jti, e: claims.expiresAt }),
    'utf8'
  ).toString('base64url')
  return { token: `${payload}.${mac(secret, payload)}`, claims }
}

export function verifyPortalView(
  secret: string,
  token: unknown,
  expected: PortalViewKind,
  nowSeconds: number
): { ok: true; claims: PortalViewClaims } | { ok: false; reason: VerifyFailure } {
  if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH) return { ok: false, reason: 'malformed' }
  const parts = token.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: 'malformed' }
  const [payload, signature] = parts
  const want = Buffer.from(mac(secret, payload))
  const got = Buffer.from(signature)
  if (want.length !== got.length || !timingSafeEqual(want, got)) return { ok: false, reason: 'bad_signature' }

  let raw: unknown
  try {
    raw = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  const r = (raw ?? {}) as Record<string, unknown>
  if (r.v !== 1 || typeof r.e !== 'number' || !Number.isInteger(r.e)) return { ok: false, reason: 'malformed' }
  if (typeof r.s !== 'string' || !UUID.test(r.s) || typeof r.a !== 'string' || !UUID.test(r.a)) return { ok: false, reason: 'malformed' }
  if (typeof r.j !== 'string' || !UUID.test(r.j)) return { ok: false, reason: 'malformed' }
  if (r.k !== expected) return { ok: false, reason: 'wrong_kind' }
  const lifetime = expected === 'access' ? PORTAL_VIEW_ACCESS_SECONDS : PORTAL_VIEW_SESSION_SECONDS
  // Past its end, or claiming to last longer than any token we mint: refused either way.
  if (r.e <= nowSeconds || r.e - nowSeconds > lifetime) return { ok: false, reason: 'expired' }
  return { ok: true, claims: { kind: expected, submissionId: r.s, adminId: r.a, jti: r.j, expiresAt: r.e } }
}

// ── What the view may read ──────────────────────────────────────────────────────────────

/**
 * The `core.portal_*` reads the partner's `/status` makes, and the arguments each one takes. The
 * ONLY list: the portal forwards any name and this decides. Every function here is STABLE in the
 * database (no write); `portal_get_guide_profile` is not (it locks the row) and stays out.
 * `p_submission_id`, when the function takes it, must be the viewed submission.
 */
const READS = {
  portal_list_submissions: [],
  portal_get_submission: ['p_submission_id'],
  portal_list_messages: ['p_submission_id'],
  portal_get_contract: ['p_submission_id'],
  portal_get_accepted_terms: ['p_submission_id'],
  portal_get_subscription: ['p_submission_id'],
  portal_get_payout_pix_key: ['p_submission_id'],
  portal_list_place_charges: ['p_submission_id'],
  portal_get_place_media: ['p_submission_id'],
  portal_get_place_profile: ['p_submission_id'],
  portal_get_terms: ['p_submission_id', 'p_version'],
  portal_quote: ['p_billing_period', 'p_voucher_code'],
} as const satisfies Record<string, readonly string[]>

export type PortalViewRead = keyof typeof READS
export const PORTAL_VIEW_READS = Object.keys(READS) as PortalViewRead[]

const SHORT_TEXT = /^[\p{L}\p{N} ._-]{1,40}$/u

/**
 * The read, when it is one of the list and its arguments are the expected ones for THIS
 * submission; `null` otherwise. `p_submission_id` is required where the function takes it, so the
 * caller cannot drop it to reach some other overload.
 */
export function portalViewRead(
  fn: unknown,
  args: unknown,
  submissionId: string
): { fn: PortalViewRead; args: Record<string, unknown> } | null {
  if (typeof fn !== 'string' || !Object.prototype.hasOwnProperty.call(READS, fn)) return null
  const name = fn as PortalViewRead
  const given = args === undefined || args === null ? {} : args
  if (typeof given !== 'object' || Array.isArray(given)) return null
  const entries = Object.entries(given as Record<string, unknown>)
  const allowed: readonly string[] = READS[name]
  if (entries.some(([key]) => !allowed.includes(key))) return null
  const out: Record<string, unknown> = {}
  for (const [key, value] of entries) {
    if (key === 'p_submission_id') {
      // Checked once, below, together with its absence.
    } else if (key === 'p_billing_period') {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 12) return null
    } else if (value !== null && (typeof value !== 'string' || !SHORT_TEXT.test(value))) {
      return null
    }
    out[key] = value
  }
  if (allowed.includes('p_submission_id') && out.p_submission_id !== submissionId) return null
  return { fn: name, args: out }
}
