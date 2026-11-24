/**
 * The CMS side of the Tuggi do parceiro, wave 1 (#1257, epic #1248). Contract
 * `docs/contracts/tuggi-do-parceiro.md` §3 (bucket) and §5 (what the CMS writes).
 *
 * Pure: the routes, the service and the screens read it, without pulling the service client into
 * the browser bundle. The database owns every value and every CHECK (`partner_brands_pilot_ck`,
 * `gift_day_packages_price_ck`); the parsers here only turn what those CHECKs would refuse into a
 * code the screen translates (`PartnerBrand.errors`) before the round trip.
 *
 * Rules: BR-B2B-070 item 2 (the logo is approved in the CMS, the last approved one stays until the
 * new one passes), item 4 (the colour switch), item 7 (the term in days, read from the CMS
 * configuration, never a literal), item 9 (the pilot per partner, the price field empty for now).
 */

/** Private bucket of the partner logos (§3). Read by a signed URL only: `getPublicUrl` does not serve. */
export const PARTNER_LOGO_BUCKET = 'partner-logos'

/** Long enough to look at the queue and decide; short enough that a copied link dies the same day. */
export const LOGO_SIGNED_URL_TTL_S = 600

/** The `drive.reward_settings` key of the brand term (BR-B2B-070 item 7). Its value is the database's. */
export const BRAND_TERM_KEY = 'partner_brand.days'

/** The three `drive.feature_switches` of this product (§5). The set is the database's (TGJ22). */
export const PARTNER_SWITCH_KEYS = [
  'partner.brand_color_enabled',
  'partner.gift_ios_enabled',
  'partner.gift_android_enabled',
] as const
export type PartnerSwitchKey = (typeof PARTNER_SWITCH_KEYS)[number]

/** The i18n id of a switch under `PartnerBrand.switches.items` (dots are not keys in next-intl). */
export function switchId(key: PartnerSwitchKey): string {
  return key.replace('partner.', '')
}

/** What the portal shows the partner; long enough for two sentences, short enough for one card. */
export const LOGO_REASON_MAX = 300

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LOGO_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/
const CURRENCY = /^[A-Z]{3}$/
const INT4_MAX = 2147483647

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}

/** `<client_id>/<uuid>.png`, lowercase uuid: the shape of `partner_brands_logo_path_ck`. */
export function isPartnerLogoPath(clientId: string, path: unknown): path is string {
  if (typeof path !== 'string') return false
  const [folder, file, ...rest] = path.split('/')
  return rest.length === 0 && folder === clientId.toLowerCase() && LOGO_FILE.test(file ?? '')
}

// ─── Errors ──────────────────────────────────────────────────────────────────────────────────

export type PartnerBrandErrorCode =
  | 'invalid_body'
  | 'invalid_client'
  | 'reason_required'
  | 'reason_too_long'
  | 'logo_not_pending'
  | 'invalid_date'
  | 'pilot_incomplete'
  | 'pilot_window'
  | 'invalid_package'
  | 'price_incomplete'
  | 'invalid_price'
  | 'invalid_currency'
  | 'client_not_found'
  | 'package_not_found'
  | 'invalid_value'
  | 'forbidden'
  | 'read_failed'
  | 'write_failed'

export interface PartnerBrandError {
  code: PartnerBrandErrorCode
}

export const PARTNER_BRAND_ERROR_CODES: readonly PartnerBrandErrorCode[] = [
  'invalid_body',
  'invalid_client',
  'reason_required',
  'reason_too_long',
  'logo_not_pending',
  'invalid_date',
  'pilot_incomplete',
  'pilot_window',
  'invalid_package',
  'price_incomplete',
  'invalid_price',
  'invalid_currency',
  'client_not_found',
  'package_not_found',
  'invalid_value',
  'forbidden',
  'read_failed',
  'write_failed',
]

export function partnerBrandErrorStatus(error: PartnerBrandError): number {
  switch (error.code) {
    case 'forbidden':
      return 403
    case 'client_not_found':
    case 'package_not_found':
      return 404
    case 'logo_not_pending':
      return 409
    case 'read_failed':
    case 'write_failed':
      return 500
    default:
      return 400
  }
}

/**
 * A refusal of the database, by SQLSTATE. `TGB71` is `cms_decide_partner_logo` saying the file is
 * not the pending one any more (a newer one arrived, or someone decided it first). `details` is
 * never read nor logged: it carries the failing row.
 */
export function classifyPartnerBrandError(error: { code?: string | null } | null | undefined): PartnerBrandError {
  switch (error?.code) {
    case 'TGB71':
      return { code: 'logo_not_pending' }
    case '42501':
      return { code: 'forbidden' }
    case '23503':
      return { code: 'client_not_found' }
    case '23514':
    case '22023':
    case '22P02':
    case '22007':
    case '22008':
      return { code: 'invalid_value' }
    default:
      return { code: 'write_failed' }
  }
}

// ─── Logo decision ───────────────────────────────────────────────────────────────────────────

export interface LogoDecision {
  client_id: string
  logo_path: string
  approve: boolean
  /** Trimmed; `null` on approval. */
  reason: string | null
}

export type Parse<T> = { ok: true; value: T } | { ok: false; error: PartnerBrandError }

const refuse = <T>(code: PartnerBrandErrorCode): Parse<T> => ({ ok: false, error: { code } })

/**
 * `{ client_id, logo_path, approve, reason? }`. A refusal needs the reason the portal shows the
 * partner (BR-B2B-070 item 2; the function refuses it too, `22023`).
 */
export function parseLogoDecision(body: unknown): Parse<LogoDecision> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return refuse('invalid_body')
  const b = body as Record<string, unknown>
  if (!isUuid(b.client_id)) return refuse('invalid_client')
  const clientId = b.client_id.toLowerCase()
  if (!isPartnerLogoPath(clientId, b.logo_path)) return refuse('invalid_body')
  if (typeof b.approve !== 'boolean') return refuse('invalid_body')
  if (b.approve) return { ok: true, value: { client_id: clientId, logo_path: b.logo_path, approve: true, reason: null } }
  if (b.reason !== undefined && b.reason !== null && typeof b.reason !== 'string') return refuse('invalid_body')
  const reason = typeof b.reason === 'string' ? b.reason.trim() : ''
  if (!reason) return refuse('reason_required')
  if (reason.length > LOGO_REASON_MAX) return refuse('reason_too_long')
  return { ok: true, value: { client_id: clientId, logo_path: b.logo_path, approve: false, reason } }
}

// ─── Pilot ───────────────────────────────────────────────────────────────────────────────────

export interface PilotWindow {
  pilot_starts_at: string | null
  pilot_ends_at: string | null
}

function readInstant(value: unknown): { ok: true; iso: string | null } | { ok: false } {
  if (value === null || value === undefined || value === '') return { ok: true, iso: null }
  if (typeof value !== 'string') return { ok: false }
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? { ok: false } : { ok: true, iso: new Date(ms).toISOString() }
}

/**
 * `{ pilot_starts_at, pilot_ends_at }`: both, the end after the start, or both empty (the partner
 * leaves the product, BR-B2B-070 item 9). Mirror of `partner_brands_pilot_ck`.
 */
export function parsePilot(body: unknown): Parse<PilotWindow> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return refuse('invalid_body')
  const b = body as Record<string, unknown>
  const starts = readInstant(b.pilot_starts_at)
  const ends = readInstant(b.pilot_ends_at)
  if (!starts.ok || !ends.ok) return refuse('invalid_date')
  if ((starts.iso === null) !== (ends.iso === null)) return refuse('pilot_incomplete')
  if (starts.iso && ends.iso && Date.parse(ends.iso) <= Date.parse(starts.iso)) return refuse('pilot_window')
  return { ok: true, value: { pilot_starts_at: starts.iso, pilot_ends_at: ends.iso } }
}

// ─── Package price ───────────────────────────────────────────────────────────────────────────

export interface PackagePrice {
  days: number
  price_cents: number | null
  price_currency: string | null
}

/**
 * `{ days, price_cents, price_currency }`: the two price fields together or neither (BR-B2B-070
 * item 9: the price is a field of the record, empty for now). Mirror of `gift_day_packages_price_ck`.
 */
export function parsePackagePrice(body: unknown): Parse<PackagePrice> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return refuse('invalid_body')
  const b = body as Record<string, unknown>
  const days = b.days
  if (typeof days !== 'number' || !Number.isInteger(days) || days <= 0 || days > 32767) return refuse('invalid_package')
  const cents = b.price_cents ?? null
  const rawCurrency = b.price_currency ?? null
  if (rawCurrency !== null && typeof rawCurrency !== 'string') return refuse('invalid_currency')
  const currency = typeof rawCurrency === 'string' && rawCurrency.trim() ? rawCurrency.trim().toUpperCase() : null
  if ((cents === null) !== (currency === null)) return refuse('price_incomplete')
  if (cents !== null && (typeof cents !== 'number' || !Number.isInteger(cents) || cents < 0 || cents > INT4_MAX)) {
    return refuse('invalid_price')
  }
  if (currency !== null && !CURRENCY.test(currency)) return refuse('invalid_currency')
  return { ok: true, value: { days, price_cents: cents as number | null, price_currency: currency } }
}

/**
 * What the curator typed in the price field, in major units, into cents: `49,90` and `49.90` are
 * 4990, `49` is 4900. Empty is `null` (no price). Anything else, or more than two decimals, is NaN.
 */
export function parseMoneyInput(input: string): number | null {
  const normalized = input.trim().replace(/\s/g, '')
  if (normalized === '') return null
  const match = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(normalized)
  if (!match) return Number.NaN
  const fraction = (match[2] ?? '').padEnd(2, '0')
  return Number(match[1]) * 100 + Number(fraction)
}

/** Cents back into the field, with the comma of pt-BR: 4990 → `49,90`. */
export function formatMoneyInput(cents: number | null): string {
  if (cents === null) return ''
  return `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, '0')}`
}

// ─── Reads as the screens receive them ───────────────────────────────────────────────────────

export interface PendingLogo {
  client_id: string
  client_name: string | null
  logo_path: string
  logo_submitted_at: string | null
  /** Signed for `LOGO_SIGNED_URL_TTL_S`; `null` when signing failed. */
  logo_url: string | null
  approved_logo_path: string | null
  approved_logo_url: string | null
}

export interface ClientBrand {
  client_id: string
  logo_path: string | null
  logo_status: 'pending' | 'approved' | 'rejected' | null
  logo_submitted_at: string | null
  logo_decided_at: string | null
  logo_rejection_reason: string | null
  logo_url: string | null
  approved_logo_path: string | null
  approved_logo_url: string | null
  pilot_starts_at: string | null
  pilot_ends_at: string | null
  gift_days: number | null
}

export interface PartnerSwitch {
  key: PartnerSwitchKey
  is_on: boolean
  updated_at: string | null
}

export interface GiftPackage {
  days: number
  price_cents: number | null
  price_currency: string | null
}

export interface PartnerBrandSettings {
  /** `null` when the key is not in the database (the migration did not run). */
  term_days: number | null
  switches: PartnerSwitch[]
  packages: GiftPackage[]
}

/** The three switches out of `cms_get_trip_settings().switches`, in the order of `PARTNER_SWITCH_KEYS`. */
export function pickPartnerSwitches(rows: unknown): PartnerSwitch[] {
  const list = Array.isArray(rows) ? (rows as Record<string, unknown>[]) : []
  return PARTNER_SWITCH_KEYS.flatMap((key) => {
    const row = list.find((r) => r?.key === key)
    if (!row || typeof row.is_on !== 'boolean') return []
    return [{ key, is_on: row.is_on, updated_at: typeof row.updated_at === 'string' ? row.updated_at : null }]
  })
}
