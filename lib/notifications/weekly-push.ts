/**
 * The CMS view of the weekly push (BR-COMUNICACAO-019 3.m, #1047): its two pieces, their texts and
 * what each send produced. Read and written only through the `drive.cms_*_weekly_push_*` functions
 * (db-tuggiApp 20261028150000, docs/contracts/banco-para-cms.md part 20).
 *
 * The database owns every number: the hours a piece may take (`policy.allowed_hours`, derived from
 * the quiet hours), the week cap, and the text limits (`weekly_push_texts_*_ck`). `validateWeeklyPushText`
 * mirrors those checks so Save is disabled before the write, the same way `validateRewardValue`
 * mirrors `reward_settings_value_ck`; the database stays the judge and its refusal (SQLSTATE TGN01
 * to TGN10) is mapped to the same i18n key the client check uses.
 *
 * `new_place` never reaches this module: the read skips it and the write refuses it (TGN01).
 */

export const WEEKLY_PUSH_PIECES = ['thursday_local', 'saturday_local'] as const
export type WeeklyPushPiece = (typeof WEEKLY_PUSH_PIECES)[number]

export type WeeklyPushVariant = 'event' | 'route' | 'reminder_city' | 'reminder_no_city'

/** The variants each piece sends, in the order of the rule (3.m.2 and 3.m.3). */
export const PIECE_VARIANTS: Record<WeeklyPushPiece, readonly WeeklyPushVariant[]> = {
  thursday_local: ['event', 'reminder_city', 'reminder_no_city'],
  saturday_local: ['route', 'reminder_city', 'reminder_no_city'],
}

/** Display order of the language chips (spec 2.3). The set itself is `weekly_push_texts_language_ck`. */
export const WEEKLY_PUSH_LANGUAGES = ['pt', 'en', 'es', 'fr', 'it'] as const
export type WeeklyPushLanguage = (typeof WEEKLY_PUSH_LANGUAGES)[number]

/** `weekly_push_texts_title_len_ck` and `_body_len_ck`, measured without the two placeholders. */
export const WEEKLY_PUSH_TITLE_MAX = 40
export const WEEKLY_PUSH_BODY_MAX = 110

/** The results window the screen asks for (spec 2.2). */
export const WEEKLY_PUSH_RESULT_WEEKS = 12

export interface WeeklyPushPieceRow {
  piece: WeeklyPushPiece
  push_kind: string
  local_dow: number
  local_hour: number
  is_active: boolean
  updated_at: string | null
  last_sent_local_date: string | null
}

export interface WeeklyPushTextRow {
  piece: WeeklyPushPiece
  variant: WeeklyPushVariant
  language: string
  title: string
  body: string
  updated_at: string | null
}

export interface WeeklyPushPolicy {
  week_cap: number
  quiet_from_hour: number
  quiet_until_hour: number
  allowed_hours: number[]
}

export interface WeeklyPushSettings {
  pieces: WeeklyPushPieceRow[]
  texts: WeeklyPushTextRow[]
  policy: WeeklyPushPolicy
  last_changed_at: string | null
}

export interface WeeklyPushSend {
  piece: WeeklyPushPiece
  local_date: string
  picked: number
  claimed: number
  sent: number
  denied: number
  not_delivered: number
  failed: number
}

export interface WeeklyPushWeek {
  week_start: string
  sent_people: number
  push_off_today: number
  sends: WeeklyPushSend[]
}

export interface WeeklyPushResults {
  weeks: WeeklyPushWeek[]
}

export function isWeeklyPushPiece(value: unknown): value is WeeklyPushPiece {
  return typeof value === 'string' && (WEEKLY_PUSH_PIECES as readonly string[]).includes(value)
}

export function isWeeklyPushVariant(value: unknown): value is WeeklyPushVariant {
  return typeof value === 'string' && ['event', 'route', 'reminder_city', 'reminder_no_city'].includes(value)
}

export function isWeeklyPushLanguage(value: unknown): value is WeeklyPushLanguage {
  return typeof value === 'string' && (WEEKLY_PUSH_LANGUAGES as readonly string[]).includes(value)
}

/** Length as the database measures it: trimmed, without `{name}` and `{city}`. */
export function measureWeeklyPushText(text: string): number {
  return stripPlaceholders(text.trim()).length
}

function replaceEvery(text: string, token: string, value: string): string {
  return text.split(token).join(value)
}

/** The text without `{name}` and `{city}`, what the length checks count. */
export function stripPlaceholders(text: string): string {
  return replaceEvery(replaceEvery(text, '{name}', ''), '{city}', '')
}

/** Fills the placeholders for the preview. */
export function fillWeeklyPushText(text: string, values: { name: string; city: string }): string {
  return replaceEvery(replaceEvery(text, '{name}', values.name), '{city}', values.city)
}

// ── Errors ───────────────────────────────────────────────────────────────────────────────

export type WeeklyPushErrorCode =
  | 'refused'
  | 'hour_not_allowed'
  | 'title_required'
  | 'body_required'
  | 'title_too_long'
  | 'body_too_long'
  | 'city_required'
  | 'city_forbidden'
  | 'name_required'
  | 'unknown_placeholder'
  | 'invalid_body'
  | 'forbidden'
  | 'unknown'

export interface WeeklyPushError {
  code: WeeklyPushErrorCode
  sqlstate?: string
}

const SQLSTATE_CODE: Record<string, WeeklyPushErrorCode> = {
  TGN01: 'refused',
  TGN02: 'hour_not_allowed',
  TGN03: 'title_required',
  TGN04: 'body_required',
  TGN05: 'title_too_long',
  TGN06: 'body_too_long',
  TGN07: 'city_required',
  TGN08: 'city_forbidden',
  TGN09: 'name_required',
  TGN10: 'unknown_placeholder',
  '22023': 'invalid_body',
  '42501': 'forbidden',
}

export function classifyWeeklyPushError(error: { code?: string | null } | null | undefined): WeeklyPushError {
  const sqlstate = error?.code ?? undefined
  return { code: (sqlstate && SQLSTATE_CODE[sqlstate]) || 'unknown', sqlstate }
}

export function weeklyPushErrorStatus(error: WeeklyPushError): number {
  switch (error.code) {
    case 'forbidden':
      return 403
    case 'refused':
      return 404
    case 'unknown':
      return 500
    default:
      return 400
  }
}

/**
 * The `Pages.WeeklyPush` key that explains a refusal. `context` picks the fallback: a piece write
 * and a text write fail with different sentences.
 */
export function weeklyPushErrorKey(code: WeeklyPushErrorCode | undefined, context: 'piece' | 'text'): string {
  switch (code) {
    case 'refused':
      return 'messages.refused'
    case 'hour_not_allowed':
      return 'pieces.hour_in_quiet'
    case 'title_required':
    case 'body_required':
    case 'title_too_long':
    case 'body_too_long':
    case 'city_required':
    case 'city_forbidden':
    case 'name_required':
    case 'unknown_placeholder':
      return `texts.errors.${code}`
    default:
      return context === 'piece' ? 'messages.piece_save_failed' : 'messages.text_save_failed'
  }
}

// ── Client check of a text ───────────────────────────────────────────────────────────────

export interface WeeklyPushTextProblem {
  field: 'title' | 'body'
  code: Exclude<WeeklyPushErrorCode, 'refused' | 'hour_not_allowed' | 'invalid_body' | 'forbidden' | 'unknown'> | 'name_in_title'
  values?: Record<string, string | number>
}

const UNKNOWN_PLACEHOLDER = /\{[^{}]*\}/

/**
 * Every problem of a draft, per field, in the order the operator fixes them. Empty list means
 * Save may write. Mirrors `drive.cms_set_weekly_push_text` plus one rule of the screen only:
 * `{name}` stays out of the title (copy doc 3).
 */
export function validateWeeklyPushText(
  variant: WeeklyPushVariant,
  title: string,
  body: string
): WeeklyPushTextProblem[] {
  const problems: WeeklyPushTextProblem[] = []
  const fields = { title, body } as const
  for (const field of ['title', 'body'] as const) {
    const text = fields[field]
    const max = field === 'title' ? WEEKLY_PUSH_TITLE_MAX : WEEKLY_PUSH_BODY_MAX
    const length = measureWeeklyPushText(text)
    const unknown = UNKNOWN_PLACEHOLDER.exec(stripPlaceholders(text))
    if (length === 0) problems.push({ field, code: field === 'title' ? 'title_required' : 'body_required' })
    else if (length > max) {
      problems.push({ field, code: field === 'title' ? 'title_too_long' : 'body_too_long', values: { max } })
    }
    if (unknown) problems.push({ field, code: 'unknown_placeholder', values: { placeholder: unknown[0] } })
  }
  if (title.includes('{name}')) problems.push({ field: 'title', code: 'name_in_title' })
  if ((variant === 'event' || variant === 'route') && !body.includes('{name}')) {
    problems.push({ field: 'body', code: 'name_required' })
  }
  const hasCity = (title + body).includes('{city}')
  if (variant === 'reminder_no_city' && hasCity) {
    problems.push({ field: title.includes('{city}') ? 'title' : 'body', code: 'city_forbidden' })
  } else if (variant !== 'reminder_no_city' && !hasCity) {
    problems.push({ field: 'body', code: 'city_required' })
  }
  return problems
}

// ── Results ──────────────────────────────────────────────────────────────────────────────

/** What did not reach a phone; shown dim so the row adds up to `picked`. */
export function notDelivered(send: WeeklyPushSend): number {
  return send.not_delivered + send.failed
}

/** `YYYY-MM-DD` as a calendar date at local noon, so no time zone moves the day. */
export function calendarDate(isoDate: string): Date {
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Date(y, m - 1, d, 12)
}

/** The Sunday that closes a week starting on Monday (item 4.1). */
export function weekEnd(weekStart: string): Date {
  const date = calendarDate(weekStart)
  date.setDate(date.getDate() + 6)
  return date
}
