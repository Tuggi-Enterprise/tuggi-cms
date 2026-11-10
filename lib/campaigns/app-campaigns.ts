/**
 * Campaigns of the app (#1192): what the CMS writes into `drive.in_app_campaigns`, and the reading
 * of the answers. Pure: the screen and the routes both read it, without pulling the service client
 * into the browser bundle.
 *
 * Contract: `docs/contracts/banco-para-cms.md`, Parte 29 (table, CHECKs, constraint names). The
 * database is the judge of the shape; `parseCampaignInput` only turns what the CHECKs would refuse
 * into a code the screen can translate before the round trip, and `classifyCampaignWriteError`
 * reads the refusal back when it happens anyway.
 *
 * Text limits and image sizes are the design spec's (`docs/design/spec-campanhas-no-app-2026-11.md`,
 * measured at 390 dp) and the copy guide's (`docs/design/copy/campanhas-no-app.md`, parte 2). The
 * app breaks a long text instead of shrinking it, so above the limit the card loses its layout:
 * here the limit refuses, unlike the inbox advice of `CharCount`.
 */

export const CAMPAIGN_FORMATS = ['map_carousel', 'launch_modal', 'explore_card'] as const
export type CampaignFormat = (typeof CAMPAIGN_FORMATS)[number]

/** BR-IDIOMA-001: the five languages of the app. */
export const CAMPAIGN_LANGUAGES = ['pt', 'en', 'es', 'fr', 'it'] as const
export type CampaignLanguage = (typeof CAMPAIGN_LANGUAGES)[number]

export const CAMPAIGN_TEXT_FIELDS = ['title', 'body', 'cta_label'] as const
export type CampaignTextField = (typeof CAMPAIGN_TEXT_FIELDS)[number]

export const CAMPAIGN_TEXT_MAX: Record<CampaignTextField, number> = { title: 40, body: 90, cta_label: 20 }

/** One image for the five languages, so it never carries text. */
export const CAMPAIGN_IMAGE_SPEC: Record<CampaignFormat, { ratio: '1:1' | '16:9'; width: number; height: number }> = {
  map_carousel: { ratio: '1:1', width: 512, height: 512 },
  explore_card: { ratio: '1:1', width: 512, height: 512 },
  launch_modal: { ratio: '16:9', width: 1200, height: 675 },
}

export type CampaignActionType = 'open_path' | 'redeem_coupon'

/**
 * #1193: the closed list of `in_app_campaigns_theme_ck`. The palette lives in the app build, so a
 * new theme is a build plus one more value in the CHECK; changing a campaign's theme is a save.
 * `default` is the look the operator approved for #1191.
 */
export const CAMPAIGN_THEMES = ['default', 'black_friday', 'tuggi_blue'] as const
export type CampaignTheme = (typeof CAMPAIGN_THEMES)[number]

export type CampaignText = Record<CampaignTextField, string>
export type CampaignContent = Partial<Record<CampaignLanguage, CampaignText>>

/** A row of `drive.in_app_campaigns`, with the coupon summary the list joins. */
export interface AppCampaign {
  id: string
  internal_name: string
  format: CampaignFormat
  theme: CampaignTheme
  is_active: boolean
  starts_at: string | null
  ends_at: string | null
  priority: number
  countries: string[]
  content: CampaignContent
  image_url: string | null
  action_type: CampaignActionType
  action_path: string | null
  coupon_id: string | null
  created_at: string
  updated_at: string
  coupon?: CampaignCouponSummary | null
}

export interface CampaignCouponSummary {
  id: string
  code: string
  grant_kind: 'until' | 'minutes' | null
  grant_minutes: number | null
  duration_days: number | null
  is_active: boolean
  valid_until: string | null
}

/** The columns the list reads, coupon included (FK `in_app_campaigns_coupon_id_fkey`). */
export const CAMPAIGN_SELECT =
  'id, internal_name, format, theme, is_active, starts_at, ends_at, priority, countries, content, image_url, action_type, action_path, coupon_id, created_at, updated_at, coupon:coupons(id, code, grant_kind, grant_minutes, duration_days, is_active, valid_until)'

// ─── Destinations ────────────────────────────────────────────────────────────────────────────

/**
 * Where an `open_path` campaign may send the tourist. Mirror of `IN_APP_NAVIGATION_PATHS` and of
 * the `/route/` prefix in `tuggi-drive-v2/src/services/deepLinkInAppPaths.ts`: the app hides a
 * campaign whose path it cannot open, so a path outside this list is a campaign nobody sees.
 * `/r/<slug>` is left out on purpose (#1192): it would count in the route-link funnel.
 *
 * `/map` opens the same Explorar as `/explore`, and `/ranking` the same page as `/scoreboard`:
 * the select offers one of each, and the route still accepts the alias a row may carry.
 * `id: 'path'` builds `/route/<uuid>`; `id: 'query'` builds `?id=<uuid>`, which the app requires
 * for these four (`DeepLinkService`, a missing id opens nothing).
 */
export const CAMPAIGN_DESTINATIONS = [
  { path: '/plans', id: null },
  { path: '/explore', id: null },
  { path: '/scoreboard', id: null },
  { path: '/stamps', id: null },
  { path: '/earn', id: null },
  { path: '/trips', id: null },
  { path: '/notifications', id: null },
  { path: '/my-routes', id: null },
  { path: '/route', id: 'path' },
  { path: '/event', id: 'query' },
  { path: '/place', id: 'query' },
  { path: '/poi', id: 'query' },
] as const satisfies readonly { path: string; id: 'path' | 'query' | null }[]

export type CampaignDestination = (typeof CAMPAIGN_DESTINATIONS)[number]['path']

/** The i18n key of a destination under `AppCampaigns.destinations` (`/my-routes` → `my_routes`). */
export function destinationKey(destination: CampaignDestination): string {
  return destination.slice(1).replace('-', '_')
}

const PLAIN_PATHS = new Set(['/plans', '/notifications', '/map', '/explore', '/ranking', '/scoreboard', '/stamps', '/earn', '/trips', '/my-routes'])
const QUERY_ID_PATHS = new Set(['/route', '/event', '/place', '/poi'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}

export function buildActionPath(destination: CampaignDestination, id: string): string {
  const entry = CAMPAIGN_DESTINATIONS.find((d) => d.path === destination)
  if (entry?.id === 'path') return `${destination}/${id.trim().toLowerCase()}`
  if (entry?.id === 'query') return `${destination}?id=${id.trim().toLowerCase()}`
  return destination
}

/** Back from a stored path to the select: `null` when the path is none of the offered ones. */
export function parseActionPath(path: string | null): { destination: CampaignDestination; id: string } | null {
  if (!path) return null
  if (path.startsWith('/route/')) return { destination: '/route', id: path.slice('/route/'.length) }
  const [base, query = ''] = path.split('?')
  const entry = CAMPAIGN_DESTINATIONS.find((d) => d.path === base)
  if (!entry) return null
  const id = new URLSearchParams(query).get('id') ?? ''
  return { destination: entry.path, id }
}

/** A path the app opens from a tap inside it. Plain paths take no query; the four detail paths take `id`. */
export function isAllowedActionPath(path: unknown): path is string {
  if (typeof path !== 'string') return false
  if (path.startsWith('/route/')) return isUuid(path.slice('/route/'.length))
  const queryAt = path.indexOf('?')
  if (queryAt < 0) return PLAIN_PATHS.has(path)
  const base = path.slice(0, queryAt)
  if (!QUERY_ID_PATHS.has(base)) return false
  const params = new URLSearchParams(path.slice(queryAt + 1))
  return [...params.keys()].join(',') === 'id' && isUuid(params.get('id'))
}

// ─── Status ──────────────────────────────────────────────────────────────────────────────────

export type CampaignStatus = 'running' | 'scheduled' | 'ended' | 'off'

/**
 * `running` is `drive.in_app_campaign_is_running`, word for word: `is_active`, `starts_at` null or
 * past, `ends_at` null or future. The other three say why a campaign is not running.
 */
export function campaignStatus(
  c: Pick<AppCampaign, 'is_active' | 'starts_at' | 'ends_at'>,
  now: Date = new Date()
): CampaignStatus {
  if (!c.is_active) return 'off'
  // The campaign's own window, not an entitlement (BR-MONETIZACAO-046 is about `drive.get_entitlement`).
  const nowMs = now.getTime()
  const endMs = c.ends_at ? Date.parse(c.ends_at) : null
  const startMs = c.starts_at ? Date.parse(c.starts_at) : null
  if (endMs !== null && endMs <= nowMs) return 'ended'
  if (startMs !== null && startMs > nowMs) return 'scheduled'
  return 'running'
}

// ─── Input ───────────────────────────────────────────────────────────────────────────────────

export type CampaignErrorCode =
  | 'invalid_body'
  | 'invalid_internal_name'
  | 'invalid_format'
  | 'invalid_theme'
  | 'invalid_priority'
  | 'invalid_countries'
  | 'invalid_content'
  | 'incomplete_language'
  | 'text_too_long'
  | 'invalid_image_url'
  | 'invalid_action'
  | 'invalid_action_path'
  | 'missing_coupon'
  | 'coupon_not_found'
  | 'invalid_date'
  | 'invalid_window'
  | 'not_found'
  | 'coupon_sync_failed'
  | 'coupon_release_failed'
  | 'write_failed'
  | 'invalid_image'
  | 'image_too_large'
  | 'upload_failed'

export interface CampaignError {
  code: CampaignErrorCode
  lang?: CampaignLanguage
  field?: CampaignTextField
}

export interface CampaignWriteFields {
  internal_name: string
  format: CampaignFormat
  /** Absent when the body carries none: the column keeps its value (`default` on insert). */
  theme?: CampaignTheme
  priority: number
  countries: string[]
  content: CampaignContent
  image_url: string | null
  action_type: CampaignActionType
  action_path: string | null
  coupon_id: string | null
  starts_at: string | null
  ends_at: string | null
  is_active: boolean
}

export type CampaignParse = { ok: true; fields: CampaignWriteFields } | { ok: false; error: CampaignError }

const INT4_MAX = 2147483647
const COUNTRY = /^[A-Z]{2}$/
const HTTPS_URL = /^https:\/\/\S+$/

function fail(code: CampaignErrorCode, extra: Omit<CampaignError, 'code'> = {}): CampaignParse {
  return { ok: false, error: { code, ...extra } }
}

function readDate(value: unknown): { ok: true; iso: string | null } | { ok: false } {
  if (value === null || value === undefined || value === '') return { ok: true, iso: null }
  if (typeof value !== 'string') return { ok: false }
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? { ok: false } : { ok: true, iso: new Date(ms).toISOString() }
}

/**
 * The whole campaign as the form sends it, into the only shapes the table accepts. A language with
 * every field blank is left out; a language half filled is refused (`title` and `cta_label` cannot
 * be blank, `body` can). Trims every text, so the count the operator saw is the count stored.
 */
export function parseCampaignInput(body: unknown): CampaignParse {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('invalid_body')
  const b = body as Record<string, unknown>

  const internalName = typeof b.internal_name === 'string' ? b.internal_name.trim() : ''
  if (!internalName) return fail('invalid_internal_name')

  if (!CAMPAIGN_FORMATS.includes(b.format as CampaignFormat)) return fail('invalid_format')
  const format = b.format as CampaignFormat

  // A body without `theme` (a tab opened before #1193) leaves the column alone; a present value
  // outside the list is refused, empty included, as the CHECK would.
  if (b.theme !== undefined && !CAMPAIGN_THEMES.includes(b.theme as CampaignTheme)) return fail('invalid_theme')
  const theme = b.theme as CampaignTheme | undefined

  const priority = b.priority ?? 0
  if (typeof priority !== 'number' || !Number.isInteger(priority) || Math.abs(priority) > INT4_MAX) {
    return fail('invalid_priority')
  }

  const rawCountries = b.countries ?? []
  if (!Array.isArray(rawCountries)) return fail('invalid_countries')
  const countries = [...new Set(rawCountries.map((c) => (typeof c === 'string' ? c.trim().toUpperCase() : '')))]
  if (countries.some((c) => !COUNTRY.test(c))) return fail('invalid_countries')

  const rawContent = b.content
  if (!rawContent || typeof rawContent !== 'object' || Array.isArray(rawContent)) return fail('invalid_content')
  const content: CampaignContent = {}
  for (const [lang, raw] of Object.entries(rawContent as Record<string, unknown>)) {
    if (!CAMPAIGN_LANGUAGES.includes(lang as CampaignLanguage)) return fail('invalid_content')
    const language = lang as CampaignLanguage
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('invalid_content')
    const r = raw as Record<string, unknown>
    if (Object.keys(r).some((k) => !CAMPAIGN_TEXT_FIELDS.includes(k as CampaignTextField))) return fail('invalid_content')
    const text = {} as CampaignText
    for (const field of CAMPAIGN_TEXT_FIELDS) {
      const value = r[field] ?? ''
      if (typeof value !== 'string') return fail('invalid_content')
      text[field] = value.trim()
    }
    if (!text.title && !text.body && !text.cta_label) continue
    if (!text.title || !text.cta_label) return fail('incomplete_language', { lang: language })
    for (const field of CAMPAIGN_TEXT_FIELDS) {
      if (text[field].length > CAMPAIGN_TEXT_MAX[field]) return fail('text_too_long', { lang: language, field })
    }
    content[language] = text
  }
  if (Object.keys(content).length === 0) return fail('invalid_content')

  const imageUrl = typeof b.image_url === 'string' && b.image_url.trim() ? b.image_url.trim() : null
  if (b.image_url !== undefined && b.image_url !== null && typeof b.image_url !== 'string') return fail('invalid_image_url')
  if (imageUrl && !HTTPS_URL.test(imageUrl)) return fail('invalid_image_url')

  let actionPath: string | null = null
  let couponId: string | null = null
  if (b.action_type === 'open_path') {
    if (!isAllowedActionPath(b.action_path)) return fail('invalid_action_path')
    actionPath = b.action_path
  } else if (b.action_type === 'redeem_coupon') {
    if (!isUuid(b.coupon_id)) return fail('missing_coupon')
    couponId = b.coupon_id.toLowerCase()
  } else {
    return fail('invalid_action')
  }

  const starts = readDate(b.starts_at)
  const ends = readDate(b.ends_at)
  if (!starts.ok || !ends.ok) return fail('invalid_date')
  if (starts.iso && ends.iso && Date.parse(ends.iso) <= Date.parse(starts.iso)) return fail('invalid_window')

  const isActive = b.is_active ?? false
  if (typeof isActive !== 'boolean') return fail('invalid_body')

  return {
    ok: true,
    fields: {
      internal_name: internalName,
      format,
      ...(theme ? { theme } : {}),
      priority,
      countries,
      content,
      image_url: imageUrl,
      action_type: b.action_type as CampaignActionType,
      action_path: actionPath,
      coupon_id: couponId,
      starts_at: starts.iso,
      ends_at: ends.iso,
      is_active: isActive,
    },
  }
}

// ─── Refusals ────────────────────────────────────────────────────────────────────────────────

/** `in_app_campaigns_<suffix>` → what the screen says. Names from the migrations `20261110200000` and `20261110210000`. */
const CONSTRAINT_ERRORS: Record<string, CampaignErrorCode> = {
  internal_name_ck: 'invalid_internal_name',
  format_ck: 'invalid_format',
  theme_ck: 'invalid_theme',
  window_ck: 'invalid_window',
  countries_ck: 'invalid_countries',
  content_ck: 'invalid_content',
  image_url_ck: 'invalid_image_url',
  action_type_ck: 'invalid_action',
  action_path_ck: 'invalid_action_path',
  action_ck: 'invalid_action',
  coupon_id_fkey: 'coupon_not_found',
}

/**
 * A write refusal of `drive.in_app_campaigns`, by SQLSTATE and constraint name. PostgREST puts the
 * name in `message`; `details` carries the failing row and is never read nor logged.
 */
export function classifyCampaignWriteError(error: { code?: string | null; message?: string | null }): CampaignError {
  const name = /"in_app_campaigns_([a-z_]+)"/.exec(error.message ?? '')?.[1]
  if ((error.code === '23514' || error.code === '23503') && name && CONSTRAINT_ERRORS[name]) {
    return { code: CONSTRAINT_ERRORS[name] }
  }
  if (error.code === '23503') return { code: 'coupon_not_found' }
  if (error.code === '22P02' || error.code === '22007' || error.code === '22008') return { code: 'invalid_body' }
  return { code: 'write_failed' }
}

export function campaignErrorStatus(error: CampaignError): number {
  if (error.code === 'not_found') return 404
  if (error.code === 'coupon_sync_failed' || error.code === 'coupon_release_failed' || error.code === 'write_failed' || error.code === 'upload_failed') return 500
  return 400
}

// ─── Image upload ────────────────────────────────────────────────────────────────────────────

/** Public bucket the app reads images from; campaigns live under their own folder. */
export const CAMPAIGN_IMAGE_FOLDER = 'in-app-campaigns'
export const CAMPAIGN_IMAGE_MAX_BYTES = 2 * 1024 * 1024

/** The file's real type, by its first bytes: the browser's `type` is whatever the client says. */
export function sniffImageType(bytes: Uint8Array): { contentType: string; ext: string } | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { contentType: 'image/jpeg', ext: 'jpg' }
  }
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => bytes[i] === v)) {
    return { contentType: 'image/png', ext: 'png' }
  }
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to))
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') {
    return { contentType: 'image/webp', ext: 'webp' }
  }
  return null
}
