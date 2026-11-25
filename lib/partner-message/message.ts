/**
 * The partner message in the CMS (#1264, BR-COMUNICACAO-026 items 4, 6 and 7). Contract
 * `docs/contracts/tuggi-do-parceiro.md` §11.2. Pure: the routes parse with it on the server and the
 * panel reads the same limits and codes in the browser.
 *
 * The database is the authority on every rule (lengths, push marks, no written link, the window,
 * the caps): these parsers check only the shape, so a rule never lives in two places. The limits
 * below exist for the counters on screen; the database answers TGB95 when one is passed.
 */

/** The languages a version can exist in: the ones the e-mail footer exists in (copy §3.2). */
export const PARTNER_MESSAGE_LANGS = ['pt', 'en', 'es', 'it'] as const
export type PartnerMessageLang = (typeof PARTNER_MESSAGE_LANGS)[number]

/**
 * The six fields of a version, in the order of the copy (§2), with the counter of each. Same numbers
 * as the CHECKs of `partner.partner_message_texts` (contract §11.2); `preheader` and `image_alt` are
 * optional.
 */
export const PARTNER_MESSAGE_FIELDS = [
  { key: 'title', max: 40, required: true, multiline: false },
  { key: 'summary', max: 110, required: true, multiline: false },
  { key: 'subject', max: 50, required: true, multiline: false },
  { key: 'preheader', max: 110, required: false, multiline: false },
  { key: 'body', max: 500, required: true, multiline: true },
  { key: 'button_label', max: 24, required: true, multiline: false },
  { key: 'image_alt', max: 200, required: false, multiline: false },
] as const
export type PartnerMessageField = (typeof PARTNER_MESSAGE_FIELDS)[number]['key']
export type PartnerMessageText = Partial<Record<PartnerMessageField, string | null>>
export type PartnerMessageTexts = Partial<Record<PartnerMessageLang, PartnerMessageText>>

/** Where the button goes (contract §11.1). A POI or a route takes its id in `button_ref`. */
export const PARTNER_MESSAGE_BUTTON_KINDS = ['partner_place', 'website', 'poi', 'route'] as const
export type PartnerMessageButtonKind = (typeof PARTNER_MESSAGE_BUTTON_KINDS)[number]
export const buttonNeedsRef = (kind: PartnerMessageButtonKind) => kind === 'poi' || kind === 'route'

export const PARTNER_MESSAGE_STATUSES = ['draft', 'approved', 'scheduled', 'sent', 'refused', 'cancelled'] as const
export type PartnerMessageStatus = (typeof PARTNER_MESSAGE_STATUSES)[number]

export const PARTNER_MESSAGE_ACTIONS = ['approve', 'refuse', 'schedule', 'unschedule', 'cancel'] as const
export type PartnerMessageAction = (typeof PARTNER_MESSAGE_ACTIONS)[number]

/** Which acts each state offers (contract §11.1). The database refuses the rest with TGB90. */
export const ACTIONS_BY_STATUS: Record<PartnerMessageStatus, readonly PartnerMessageAction[]> = {
  draft: ['approve', 'refuse', 'cancel'],
  approved: ['schedule', 'cancel'],
  scheduled: ['unschedule', 'cancel'],
  sent: [],
  refused: [],
  cancelled: [],
}

/** A reason of a refusal or a cancellation: 1 to 1,000 characters, as the database checks. */
export const REASON_MAX = 1000
export const REQUESTED_BY_MAX = 120

/** The numbers of a message, exact (CMS only; the portal shows "menos de 5", §11.5). */
export interface PartnerMessageNumbers {
  reach: number
  queued: number
  capped: number
  no_language: number
  push_sent: number
  push_failed: number
  email_sent: number
  email_failed: number
  opened: number
  app_opened: number
  email_clicked: number
  opted_out_7d: number
}

/** `partner.cms_get_partner_message`, the fields the panel reads. */
export interface PartnerMessage {
  id: string
  client_id: string
  partner_handle: string | null
  partner_name: string | null
  status: PartnerMessageStatus
  requested_by: string
  requested_at: string
  button_kind: PartnerMessageButtonKind
  button_ref: string | null
  button_url: string | null
  /** In contract §11.2, but `partner.partner_message_json` does not answer it yet (2026-11-25). */
  approved_button_url?: string | null
  image_path: string | null
  local_send_at: string | null
  refusal_reason: string | null
  cancel_reason: string | null
  created_at: string
  decided_at: string | null
  scheduled_at: string | null
  finished_at: string | null
  texts: PartnerMessageTexts
  numbers: PartnerMessageNumbers
  audience_yes_now: number
}

/** One row of `partner.cms_list_partner_messages`. */
export interface PartnerMessageRow {
  id: string
  client_id: string
  partner_handle: string | null
  partner_name: string | null
  status: PartnerMessageStatus
  title: string | null
  languages: string[]
  local_send_at: string | null
  requested_by: string
  requested_at: string
  created_at: string
  decided_at: string | null
  refusal_reason: string | null
  cancel_reason: string | null
  reach: number
  push_sent: number
  email_sent: number
  opened: number
}

/** One row of `partner.cms_partner_message_senders`. */
export interface PartnerMessageSender {
  client_id: string
  partner_handle: string | null
  partner_name: string | null
  client_type: string | null
  can_send: boolean
  audience_yes: number
  monthly_cap: number
  used_this_month: number
  last_local_send_at: string | null
}

// ------------------------------------------------------------------ errors

export type PartnerMessageErrorCode =
  | 'invalid_body'
  | 'invalid_id'
  | 'not_found'
  | 'wrong_state'
  | 'already_started'
  | 'partner_cannot_send'
  | 'monthly_cap'
  | 'too_close'
  | 'outside_window'
  | 'in_the_past'
  | 'invalid_field'
  | 'sending_off'
  | 'reason_required'
  | 'read_failed'
  | 'write_failed'

/**
 * `field` names what to fix when the database refuses a field (TGB95): `lang` is the version,
 * `rule` one of `length` (size or a control character), `push_marks`, `no_link`, `missing`, or the
 * field of the message (`button`, `image_path`, `image_alt`, `texts`, `client_id`, `requested_by`).
 */
export interface PartnerMessageError {
  code: PartnerMessageErrorCode
  state?: string
  cap?: number
  field?: { lang?: string; key?: string; rule: string }
}

export function partnerMessageErrorStatus(error: PartnerMessageError): number {
  switch (error.code) {
    case 'invalid_body':
    case 'invalid_id':
    case 'reason_required':
      return 400
    case 'not_found':
      return 404
    case 'wrong_state':
    case 'already_started':
    case 'partner_cannot_send':
    case 'monthly_cap':
    case 'too_close':
    case 'sending_off':
      return 409
    case 'outside_window':
    case 'in_the_past':
    case 'invalid_field':
      return 422
    default:
      return 500
  }
}

const TEXT_CONSTRAINT = /^partner_message_texts_([a-z_]+)_ck$/

/** The DETAIL of a TGB95 (contract §11.2) as the field to fix. */
export function fieldOfDetail(detail: string | null | undefined): PartnerMessageError['field'] {
  const raw = String(detail ?? '').trim()
  // `<lang>:<constraint>`: an automatic refusal of a text.
  const colon = raw.match(/^([a-z]{2}):(.+)$/)
  if (colon) {
    const rule = colon[2].match(TEXT_CONSTRAINT)?.[1] ?? 'length'
    if (rule === 'push_marks') return { lang: colon[1], rule: 'push_marks' }
    if (rule === 'no_link') return { lang: colon[1], rule: 'no_link' }
    return { lang: colon[1], key: rule, rule: 'length' }
  }
  // `<lang>.<field>`: unknown, not a text, required and missing, or the image without its alt.
  const dot = raw.match(/^([a-z]{2})\.([a-z_]+)$/)
  if (dot) return { lang: dot[1], key: dot[2], rule: dot[2] === 'image_alt' ? 'image_alt' : 'missing' }
  if (/^[a-z]{2}$/.test(raw)) return { lang: raw, rule: 'language' }
  if (raw === 'partner_messages_button_ck' || raw === 'button' || raw === 'button_kind' || raw === 'button_ref') return { rule: 'button' }
  if (raw === 'partner_messages_image_path_ck' || raw === 'image_path') return { rule: 'image_path' }
  if (raw === 'partner_messages_requested_by_ck' || raw === 'requested_by' || raw === 'requested_at') return { rule: 'requested_by' }
  if (raw === 'texts') return { rule: 'texts' }
  if (raw === 'client_id') return { rule: 'client_id' }
  return { rule: 'unknown' }
}

/** A database error as the precise answer of the route. `fallback` is the read or the write. */
export function classifyPartnerMessageError(
  error: { code?: string | null; details?: string | null; message?: string | null } | null | undefined,
  fallback: 'read_failed' | 'write_failed' = 'write_failed'
): PartnerMessageError {
  const detail = error?.details ?? null
  switch (error?.code) {
    case 'TGB90':
      if (detail === 'started') return { code: 'already_started' }
      if (detail === 'missing') return { code: 'not_found' }
      return { code: 'wrong_state', ...(detail ? { state: detail } : {}) }
    case 'TGB91':
      return { code: 'partner_cannot_send' }
    case 'TGB92': {
      const cap = Number(detail)
      return { code: 'monthly_cap', ...(Number.isFinite(cap) && detail ? { cap } : {}) }
    }
    case 'TGB93':
      return { code: 'too_close' }
    case 'TGB94':
      return { code: detail === 'past' ? 'in_the_past' : 'outside_window' }
    case 'TGB95':
      return { code: 'invalid_field', field: fieldOfDetail(detail) }
    case 'TGB96':
      return { code: 'sending_off' }
    case '22023':
      return { code: 'invalid_body' }
    default:
      return { code: fallback }
  }
}

// ------------------------------------------------------------------ parsers

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: PartnerMessageError }
const bad = (error: PartnerMessageError): { ok: false; error: PartnerMessageError } => ({ ok: false, error })

export interface SaveInput {
  client_id: string | null
  requested_by: string
  requested_at: string
  button_kind: PartnerMessageButtonKind
  button_ref: string | null
  image_path: string | null
  texts: Record<string, Record<string, string | null>>
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * The body of a create (`client_id` required) or an edit (`client_id` absent). Shape only: the
 * texts go to the database as typed, and the database answers the field that breaks a rule.
 */
export function parseSaveBody(body: unknown, mode: 'create' | 'edit'): Parsed<SaveInput> {
  if (!isRecord(body)) return bad({ code: 'invalid_body' })
  const clientId = body.client_id
  if (mode === 'create' && !isUuid(clientId)) return bad({ code: 'invalid_field', field: { rule: 'client_id' } })
  if (mode === 'edit' && clientId !== undefined && clientId !== null && !isUuid(clientId)) {
    return bad({ code: 'invalid_field', field: { rule: 'client_id' } })
  }
  const requestedBy = typeof body.requested_by === 'string' ? body.requested_by.trim() : ''
  const requestedAt = typeof body.requested_at === 'string' ? body.requested_at : ''
  if (!requestedBy || requestedBy.length > REQUESTED_BY_MAX || Number.isNaN(Date.parse(requestedAt))) {
    return bad({ code: 'invalid_field', field: { rule: 'requested_by' } })
  }
  const kind = body.button_kind
  if (!(PARTNER_MESSAGE_BUTTON_KINDS as readonly unknown[]).includes(kind)) {
    return bad({ code: 'invalid_field', field: { rule: 'button' } })
  }
  const buttonKind = kind as PartnerMessageButtonKind
  const ref = body.button_ref
  if (buttonNeedsRef(buttonKind) ? !isUuid(ref) : ref !== undefined && ref !== null && ref !== '') {
    return bad({ code: 'invalid_field', field: { rule: 'button' } })
  }
  const imagePath = body.image_path
  if (imagePath !== undefined && imagePath !== null && typeof imagePath !== 'string') {
    return bad({ code: 'invalid_field', field: { rule: 'image_path' } })
  }
  if (!isRecord(body.texts) || Object.keys(body.texts).length === 0) {
    return bad({ code: 'invalid_field', field: { rule: 'texts' } })
  }
  const texts: SaveInput['texts'] = {}
  for (const [lang, version] of Object.entries(body.texts)) {
    if (!(PARTNER_MESSAGE_LANGS as readonly string[]).includes(lang) || !isRecord(version)) {
      return bad({ code: 'invalid_field', field: { lang, rule: 'language' } })
    }
    const clean: Record<string, string | null> = {}
    for (const field of PARTNER_MESSAGE_FIELDS) {
      const value = version[field.key]
      if (value === undefined || value === null || value === '') {
        if (field.required) return bad({ code: 'invalid_field', field: { lang, key: field.key, rule: 'missing' } })
        continue
      }
      if (typeof value !== 'string') return bad({ code: 'invalid_field', field: { lang, key: field.key, rule: 'missing' } })
      clean[field.key] = value
    }
    texts[lang] = clean
  }
  return {
    ok: true,
    value: {
      client_id: mode === 'create' ? (clientId as string).toLowerCase() : null,
      requested_by: requestedBy,
      requested_at: new Date(requestedAt).toISOString(),
      button_kind: buttonKind,
      button_ref: buttonNeedsRef(buttonKind) ? (ref as string).toLowerCase() : null,
      image_path: typeof imagePath === 'string' && imagePath.trim() ? imagePath.trim() : null,
      texts,
    },
  }
}

export type DecisionInput =
  | { action: 'approve' | 'unschedule' }
  | { action: 'refuse' | 'cancel'; reason: string }
  | { action: 'schedule'; local_send_at: string }

/** A wall clock without zone, minutes or seconds: `2026-12-01T10:00` (the hour it leaves for each person). */
const WALL_CLOCK = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/

export function parseDecisionBody(body: unknown): Parsed<DecisionInput> {
  if (!isRecord(body) || !(PARTNER_MESSAGE_ACTIONS as readonly unknown[]).includes(body.action)) {
    return bad({ code: 'invalid_body' })
  }
  const action = body.action as PartnerMessageAction
  if (action === 'refuse' || action === 'cancel') {
    const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
    if (!reason || reason.length > REASON_MAX) return bad({ code: 'reason_required' })
    return { ok: true, value: { action, reason } }
  }
  if (action === 'schedule') {
    const at = typeof body.local_send_at === 'string' ? body.local_send_at.trim() : ''
    if (!WALL_CLOCK.test(at) || Number.isNaN(Date.parse(`${at}Z`))) return bad({ code: 'outside_window' })
    return { ok: true, value: { action, local_send_at: at.length === 16 ? `${at}:00` : at } }
  }
  return { ok: true, value: { action } }
}
