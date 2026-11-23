/**
 * The CMS side of the planned trip and the trip reminder (#1233, épico #1226). Contract:
 * `docs/contracts/viagem-marcada-e-lembrete.md` (Parte 1, "CMS", "#1233 CMS").
 *
 * The database owns every value, range and list: `drive.cms_get_trip_settings`,
 * `drive.cms_set_feature_switch`, `drive.cms_set_message_template`, `drive.cms_set_provider_secret`,
 * `drive.cms_get_message_sends` and `drive.cms_get_planned_trips_panel`. This module holds only the
 * shapes the routes check before calling them (mirrors of the CHECKs, so a malformed body never
 * reaches the database) and the classification of a refusal. Rules: BR-COMUNICACAO-023 item 5,
 * BR-COMUNICACAO-024 items 8 to 10, BR-USUARIO-055 item 6.c.
 */

import type { RewardSetting, RewardUnit } from '@/lib/rewards/settings'
import { isRewardUnit } from '@/lib/rewards/settings'
import { WEEKLY_PUSH_LANGUAGES } from '@/lib/notifications/weekly-push'

// ── Lists ───────────────────────────────────────────────────────────────────────────────

/** `message_templates_piece_ck`: the pieces a template (and a test send) is for. */
export const TEMPLATE_PIECES = ['phone_confirmation', 'trip_reminder_before', 'trip_reminder_day'] as const
export type TemplatePiece = (typeof TEMPLATE_PIECES)[number]

export function isTemplatePiece(value: unknown): value is TemplatePiece {
  return typeof value === 'string' && (TEMPLATE_PIECES as readonly string[]).includes(value)
}

/** The channels the `trip-message-test` Edge Function accepts (interface fixed with #1231). */
export const TEST_CHANNELS = ['push', 'email', 'whatsapp', 'sms'] as const
export type TestChannel = (typeof TEST_CHANNELS)[number]

export function isTestChannel(value: unknown): value is TestChannel {
  return typeof value === 'string' && (TEST_CHANNELS as readonly string[]).includes(value)
}

/** Templates are the WhatsApp's (BR-COMUNICACAO-024 item 8; contract "Modelos"). */
export const TEMPLATE_CHANNELS = ['whatsapp'] as const

/**
 * Template languages: the base of the profile language, in the server message languages of
 * BR-IDIOMA-001 item 3. The list has one owner (`WEEKLY_PUSH_LANGUAGES`); the database only checks
 * the shape (`message_templates_language_ck`).
 */
export const TEMPLATE_LANGUAGES = WEEKLY_PUSH_LANGUAGES
export type TemplateLanguage = (typeof TEMPLATE_LANGUAGES)[number]

/** What the form suggests as the Meta language code. The operator may type another one. */
export const PROVIDER_LANGUAGE_SUGGESTION: Record<TemplateLanguage, string> = {
  pt: 'pt_BR',
  en: 'en_US',
  es: 'es',
  fr: 'fr',
  it: 'it',
  de: 'de',
}

// ── Shapes (mirrors of the CHECKs) ──────────────────────────────────────────────────────

/** `feature_switches` keys: dotted lowercase words. The set is the database's (TGJ22). */
export const SWITCH_KEY_RE = /^[a-z0-9_]+(\.[a-z0-9_]+)+$/
/** `provider_secret_slots_name_ck`. The slot list is the database's (TGJ20). */
export const SECRET_SLOT_RE = /^[a-z0-9_]+\.[a-z0-9_]+$/
/** TGJ21: the trimmed value is empty or longer than this. */
export const SECRET_MAX_LENGTH = 4096
/** `message_templates_channel_ck`, also `message_sends_channel_ck`. */
export const CHANNEL_RE = /^[a-z0-9_]+$/
/** `message_templates_language_ck`. */
export const TEMPLATE_LANGUAGE_RE = /^[a-z]{2,3}$/
/** `message_templates_name_ck`. */
export const TEMPLATE_NAME_RE = /^[a-z0-9_]+$/
export const TEMPLATE_NAME_MAX_LENGTH = 512
/** `message_templates_provider_language_ck`. */
export const PROVIDER_LANGUAGE_RE = /^[a-z]{2,3}(_[A-Z]{2})?$/
/** `drive.cms_get_message_sends` caps `p_limit` here. */
export const SENDS_LIMIT_MAX = 200

export interface TemplateInput {
  channel: string
  piece: TemplatePiece
  language: string
  /** `null` removes the template. */
  template_name: string | null
  provider_language: string | null
}

/** The body of `PUT /api/admin/trip-reminder/templates`, or `null` when malformed. */
export function parseTemplateInput(body: unknown): TemplateInput | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  const { channel, piece, language } = b
  const name = b.template_name
  const providerLanguage = b.provider_language
  if (typeof channel !== 'string' || !(TEMPLATE_CHANNELS as readonly string[]).includes(channel)) return null
  if (!isTemplatePiece(piece)) return null
  if (typeof language !== 'string' || !TEMPLATE_LANGUAGE_RE.test(language)) return null
  if (name === null) {
    return { channel, piece, language, template_name: null, provider_language: null }
  }
  if (typeof name !== 'string' || name.length > TEMPLATE_NAME_MAX_LENGTH || !TEMPLATE_NAME_RE.test(name)) return null
  if (typeof providerLanguage !== 'string' || !PROVIDER_LANGUAGE_RE.test(providerLanguage)) return null
  return { channel, piece, language, template_name: name, provider_language: providerLanguage }
}

/** The body of `PUT /api/admin/trip-reminder/secrets`, or `null` when malformed. */
export function parseSecretInput(body: unknown): { name: string; value: string } | null {
  if (!body || typeof body !== 'object') return null
  const { name, value } = body as Record<string, unknown>
  if (typeof name !== 'string' || name.length > 80 || !SECRET_SLOT_RE.test(name)) return null
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed === '' || trimmed.length > SECRET_MAX_LENGTH) return null
  return { name, value }
}

// ── Reads ───────────────────────────────────────────────────────────────────────────────

export interface TripSwitch {
  key: string
  is_on: boolean
  /** `device` (push), `email` or `phone` for a `channel.<name>` row; `null` for the others. */
  channel_kind: 'device' | 'email' | 'phone' | null
  channel_order: number | null
  rule_id: string | null
  updated_at: string | null
}

export interface TripNumber {
  value: number
  unit: string
  rule_id: string | null
  updated_at: string | null
}

export interface TripTemplate {
  channel: string
  piece: TemplatePiece
  language: string
  template_name: string
  provider_language: string
  updated_at: string | null
}

export interface ProviderSecret {
  name: string
  channel: string
  description: string
  configured_at: string | null
  last4: string | null
}

export interface SecretChange {
  name: string
  changed_at: string
  changed_by: string | null
  changed_by_email: string | null
}

export interface TripSettings {
  switches: TripSwitch[]
  numbers: Record<string, TripNumber>
  ask_phone_effective: boolean
  templates: TripTemplate[]
  secrets: ProviderSecret[]
  secret_changes: SecretChange[]
}

/** The secret slot as the screen may see it: never anything but these five fields. */
export function pickSecret(row: unknown): ProviderSecret | null {
  if (!row || typeof row !== 'object') return null
  const r = row as Record<string, unknown>
  if (typeof r.name !== 'string') return null
  return {
    name: r.name,
    channel: typeof r.channel === 'string' ? r.channel : r.name.split('.')[0],
    description: typeof r.description === 'string' ? r.description : '',
    configured_at: typeof r.configured_at === 'string' ? r.configured_at : null,
    last4: typeof r.last4 === 'string' ? r.last4 : null,
  }
}

/**
 * `drive.cms_get_trip_settings()` as the route hands it to the browser. The secrets go through
 * `pickSecret`, so a column added later to that read never reaches the page by accident.
 */
export function normalizeTripSettings(data: unknown): TripSettings {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
  return {
    switches: list(d.switches) as TripSwitch[],
    numbers: (d.numbers && typeof d.numbers === 'object' ? d.numbers : {}) as Record<string, TripNumber>,
    ask_phone_effective: d.ask_phone_effective === true,
    templates: list(d.templates) as TripTemplate[],
    secrets: list(d.secrets).map(pickSecret).filter((s): s is ProviderSecret => s !== null),
    secret_changes: list(d.secret_changes) as SecretChange[],
  }
}

/** The numbers of the read, in the shape the shared reward editor takes. */
export function numbersAsRewardSettings(numbers: Record<string, TripNumber>): RewardSetting[] {
  return Object.entries(numbers)
    .map(([key, n]) => ({
      key,
      value: Number(n?.value),
      unit: (isRewardUnit(n?.unit) ? n.unit : null) as RewardUnit | null,
      rule_id: typeof n?.rule_id === 'string' ? n.rule_id : null,
    }))
    .filter((s) => Number.isFinite(s.value))
    .sort((a, b) => a.key.localeCompare(b.key))
}

/** The reminder channels (`channel.<name>` rows), in the order the sender tries them. */
export function reminderChannels(switches: TripSwitch[]): { name: string; kind: TripSwitch['channel_kind']; is_on: boolean }[] {
  return switches
    .filter((s) => s.channel_kind !== null && s.key.startsWith('channel.'))
    .sort((a, b) => (a.channel_order ?? 0) - (b.channel_order ?? 0))
    .map((s) => ({ name: s.key.slice('channel.'.length), kind: s.channel_kind, is_on: s.is_on }))
}

/** The confirmation of the number only exists on a phone channel (BR-COMUNICACAO-024 item 5). */
export function canTest(piece: TemplatePiece, channelKind: TripSwitch['channel_kind']): boolean {
  return piece !== 'phone_confirmation' || channelKind === 'phone'
}

/** next-intl reads a dot as nesting: the message id of a switch key. */
export function messageId(key: string): string {
  return key.replace(/\./g, '_')
}

export interface MessageSend {
  id: string
  created_at: string
  updated_at: string
  piece: TemplatePiece | 'test'
  channel: string
  outcome: 'sent' | 'delivered' | 'failed'
  /** The provider code; the database already replaced any number by `[number]`. */
  reason: string | null
  phone_last4: string | null
}

export interface PlannedTripsPanel {
  by_destination_month: { country_code: string | null; city: string | null; month: string | null; trips: number }[]
  totals: { trips: number; with_date: number; with_destination: number; accounts: number; trip_hours_credited: number }
  answers: Partial<Record<'now' | 'planned' | 'unsure', number>>
  contacts_by_channel: { channel: string | null; delivery_state: string; stopped: boolean; contacts: number }[]
  email_reminders_stopped: number
}

// ── Test send ───────────────────────────────────────────────────────────────────────────

export interface TestSendResult {
  ok: boolean
  channel: string
  error_code?: string
}

/**
 * What the screen may show of an error code: a provider or function code, never free text. A run
 * of 7 or more digits is refused because a provider message can carry the phone number (the same
 * rule `drive.record_message_send` applies to `reason`).
 */
export function safeErrorCode(value: unknown): string | null {
  if (typeof value !== 'string') return null
  if (!/^[A-Za-z0-9_.:-]{1,64}$/.test(value)) return null
  if (/\d{7,}/.test(value)) return null
  return value
}

/** The Edge Function reply reduced to the fixed interface `{ ok, channel, error_code? }`. */
export function toTestSendResult(httpStatus: number, json: unknown, channel: string): TestSendResult {
  const j = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>
  if (typeof j.ok === 'boolean') {
    const code = safeErrorCode(j.error_code)
    return {
      ok: j.ok,
      channel: typeof j.channel === 'string' && CHANNEL_RE.test(j.channel) ? j.channel : channel,
      ...(j.ok ? {} : { error_code: code ?? 'unknown' }),
    }
  }
  return { ok: false, channel, error_code: safeErrorCode(j.error) ?? `http_${httpStatus}` }
}

// ── Refusals ────────────────────────────────────────────────────────────────────────────

export type TripAdminErrorCode =
  | 'forbidden'
  | 'unknown_key'
  | 'unknown_slot'
  | 'invalid_secret'
  | 'not_a_message_channel'
  | 'invalid_value'
  | 'invalid_body'
  | 'relogin'
  | 'unknown'

export interface TripAdminError {
  code: TripAdminErrorCode
  sqlstate?: string
}

/** SQLSTATE of the contract ("Erros") to a code the screen names. The message is never read. */
export function classifyTripAdminError(error: { code?: string | null } | null | undefined): TripAdminError {
  const sqlstate = error?.code ?? undefined
  switch (sqlstate) {
    case '42501':
      return { code: 'forbidden', sqlstate }
    case 'TGJ22':
      return { code: 'unknown_key', sqlstate }
    case 'TGJ20':
      return { code: 'unknown_slot', sqlstate }
    case 'TGJ21':
      return { code: 'invalid_secret', sqlstate }
    case 'TGJ23':
      return { code: 'not_a_message_channel', sqlstate }
    case '23514':
    case '22023':
      return { code: 'invalid_value', sqlstate }
    default:
      return { code: 'unknown', sqlstate }
  }
}

export function tripAdminErrorStatus(error: TripAdminError): number {
  switch (error.code) {
    case 'forbidden':
      return 403
    case 'relogin':
      return 401
    case 'unknown_key':
    case 'unknown_slot':
      return 404
    case 'invalid_secret':
    case 'not_a_message_channel':
    case 'invalid_value':
    case 'invalid_body':
      return 400
    default:
      return 500
  }
}
