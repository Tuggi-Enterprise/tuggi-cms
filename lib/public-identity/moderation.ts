/**
 * The moderation of public names in the CMS (#1144, epic #1127): the queue of reports, the reset
 * and the lock of an account, and the lists the filter reads. BR-USUARIO-051 items 1, 2.d, 5 and 6,
 * BR-USUARIO-050 item 7. Contract `docs/contracts/identidade-publica.md`, "CMS" and "Tabelas que o
 * CMS lê e escreve direto".
 *
 * The database decides: what a reset writes (a generated name, an empty bio), that a removed @ is
 * blocked forever, what the filter normalizes and how it matches. This module only checks what
 * reaches the database and reads what comes back. Pure: the routes, the screens and the tests read
 * it alike.
 */

export const PUBLIC_IDENTITY_FIELDS = ['display_name', 'nickname', 'bio'] as const
export type PublicIdentityField = (typeof PUBLIC_IDENTITY_FIELDS)[number]

export const REPORT_SURFACES = ['scoreboard', 'discovered_by', 'profile_page'] as const
export type ReportSurface = (typeof REPORT_SURFACES)[number]

export const REPORT_DECISIONS = ['remove', 'dismiss'] as const
export type ReportDecision = (typeof REPORT_DECISIONS)[number]

export const RESERVED_MATCHES = ['exact', 'contains'] as const
export type ReservedMatch = (typeof RESERVED_MATCHES)[number]

export const OWN_TERM_KINDS = ['blocked', 'allowed'] as const
export type OwnTermKind = (typeof OWN_TERM_KINDS)[number]

function oneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value)
}

export const isPublicIdentityField = (value: unknown): value is PublicIdentityField =>
  oneOf(PUBLIC_IDENTITY_FIELDS, value)
export const isReportDecision = (value: unknown): value is ReportDecision => oneOf(REPORT_DECISIONS, value)

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A user id from a path or a body: a uuid, nothing else reaches the database. */
export function userIdOf(value: unknown): string | null {
  return typeof value === 'string' && UUID_RE.test(value) ? value : null
}

/** A positive bigint id from a path or a query (report, own term). */
export function positiveIdOf(value: unknown): number | null {
  const raw = typeof value === 'number' ? String(value) : value
  if (typeof raw !== 'string' || !/^\d{1,15}$/.test(raw)) return null
  const id = Number(raw)
  return id > 0 ? id : null
}

// ── The queue of reports (item 5) ──────────────────────────────────────────────────────────

/** One open row of `drive.public_identity_reports`, with the current @ of the account. */
export interface IdentityReportRow {
  reportId: number
  userId: string
  /** The @ the account has now, for the link to its record; the reported value may be gone. */
  nickname: string | null
  field: PublicIdentityField
  reportedValue: string
  surface: ReportSurface
  reportsCount: number
  firstReportedAt: string
  lastReportedAt: string
}

/**
 * The rows the queue reads, newest report last as the contract orders them. A row without id,
 * account, field or surface is dropped: it cannot be decided, and inventing the field would show a
 * report that does not exist.
 */
export function parseReportRows(data: unknown, nicknames: Record<string, string | null> = {}): IdentityReportRow[] | null {
  if (!Array.isArray(data)) return null
  const rows: IdentityReportRow[] = []
  for (const raw of data) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const reportId = positiveIdOf(r.id)
    const userId = userIdOf(r.target_user_id)
    const lastReportedAt = text(r.last_reported_at)
    if (reportId === null || !userId || !lastReportedAt) continue
    if (!isPublicIdentityField(r.field) || !oneOf(REPORT_SURFACES, r.surface)) continue
    if (typeof r.reported_value !== 'string') continue
    const count = Number(r.reports_count)
    rows.push({
      reportId,
      userId,
      nickname: nicknames[userId] ?? null,
      field: r.field,
      reportedValue: r.reported_value,
      surface: r.surface,
      reportsCount: Number.isSafeInteger(count) && count > 0 ? count : 1,
      firstReportedAt: text(r.created_at) ?? lastReportedAt,
      lastReportedAt,
    })
  }
  return rows
}

/** What `drive.decide_public_identity_report_as` answered. */
export type ReportOutcome =
  | { kind: 'removed'; value: string | null }
  | { kind: 'dismissed' }
  /** Someone decided it first; nothing changed now. */
  | { kind: 'already_decided'; status: string }

export function readReportOutcome(data: unknown): ReportOutcome | null {
  if (!data || typeof data !== 'object') return null
  const r = data as Record<string, unknown>
  if (r.changed === false && typeof r.status === 'string') return { kind: 'already_decided', status: r.status }
  if (r.changed !== true) return null
  if (r.status === 'removed') return { kind: 'removed', value: typeof r.value === 'string' ? r.value : null }
  if (r.status === 'dismissed') return { kind: 'dismissed' }
  return null
}

// ── The record of the account: reset (item 5) and lock (item 6) ────────────────────────────

/** The public identity of one account, as the CMS shows it on the record. */
export interface AccountIdentity {
  displayName: string | null
  nickname: string | null
  bio: string | null
  /** When the moderation last reset the field; `null` once the owner writes it again. */
  resetAt: Record<PublicIdentityField, string | null>
  locked: boolean
  lockedAt: string | null
}

export function readAccountIdentity(profile: unknown, lock: unknown): AccountIdentity | null {
  if (!profile || typeof profile !== 'object') return null
  const p = profile as Record<string, unknown>
  const l = lock && typeof lock === 'object' ? (lock as Record<string, unknown>) : null
  return {
    displayName: text(p.display_name),
    nickname: text(p.nickname),
    bio: text(p.bio),
    resetAt: {
      display_name: text(p.display_name_reset_at),
      nickname: text(p.nickname_reset_at),
      bio: text(p.bio_reset_at),
    },
    locked: l !== null,
    lockedAt: l ? text(l.locked_at) : null,
  }
}

/** What `drive.reset_public_identity_as` answered: the value now (`null` = empty bio). */
export interface ResetOutcome {
  field: PublicIdentityField
  value: string | null
  reportsClosed: number
}

export function readResetOutcome(data: unknown): ResetOutcome | null {
  if (!data || typeof data !== 'object') return null
  const r = data as Record<string, unknown>
  if (!isPublicIdentityField(r.field)) return null
  const closed = Number(r.reports_closed)
  return {
    field: r.field,
    value: typeof r.value === 'string' ? r.value : null,
    reportsClosed: Number.isSafeInteger(closed) && closed >= 0 ? closed : 0,
  }
}

/** What `drive.set_public_identity_lock_as` answered. */
export function readLockOutcome(data: unknown): { locked: boolean } | null {
  if (!data || typeof data !== 'object') return null
  const r = data as Record<string, unknown>
  return typeof r.locked === 'boolean' ? { locked: r.locked } : null
}

// ── The lists (BR-USUARIO-050 item 7, BR-USUARIO-051 items 1, 2 and 2.d) ───────────────────

export interface ReservedName {
  name: string
  /** The comparison key the database generates; the row's identity. */
  nameKey: string
  match: ReservedMatch
  appliesToDisplayName: boolean
}

export interface OwnTerm {
  id: number
  kind: OwnTermKind
  term: string
  normalized: string
}

export interface LdnoobwLanguage {
  language: string
  terms: string[]
}

export interface FilterLists {
  reserved: ReservedName[]
  own: OwnTerm[]
  ldnoobw: {
    languages: LdnoobwLanguage[]
    /** The commits the rows carry; one, unless a migration loaded a second version. */
    commits: string[]
    /** Rows in the table, which may be more than the rows read. */
    total: number
  }
}

export function parseReservedNames(data: unknown): ReservedName[] {
  if (!Array.isArray(data)) return []
  const rows: ReservedName[] = []
  for (const raw of data) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const name = text(r.name)
    const nameKey = text(r.name_key)
    if (!name || !nameKey || !oneOf(RESERVED_MATCHES, r.match)) continue
    rows.push({ name, nameKey, match: r.match, appliesToDisplayName: r.applies_to_display_name === true })
  }
  return rows
}

export function parseOwnTerms(data: unknown): OwnTerm[] {
  if (!Array.isArray(data)) return []
  const rows: OwnTerm[] = []
  for (const raw of data) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const id = positiveIdOf(r.id)
    const term = text(r.term)
    if (id === null || !term || !oneOf(OWN_TERM_KINDS, r.kind)) continue
    rows.push({ id, kind: r.kind, term, normalized: text(r.normalized) ?? '' })
  }
  return rows
}

export function groupLdnoobw(data: unknown): { languages: LdnoobwLanguage[]; commits: string[] } {
  const byLanguage = new Map<string, string[]>()
  const commits = new Set<string>()
  if (Array.isArray(data)) {
    for (const raw of data) {
      if (!raw || typeof raw !== 'object') continue
      const r = raw as Record<string, unknown>
      const language = text(r.language)
      const term = text(r.term)
      if (!language || !term) continue
      if (!byLanguage.has(language)) byLanguage.set(language, [])
      byLanguage.get(language)!.push(term)
      const commit = text(r.source_commit)
      if (commit) commits.add(commit)
    }
  }
  const languages = Array.from(byLanguage.keys())
    .sort()
    .map((language) => ({ language, terms: byLanguage.get(language)! }))
  return { languages, commits: Array.from(commits).sort() }
}

/** The bounds of `drive.reserved_public_names_name_ck`: the characters of an @, 1 to 30. */
const RESERVED_NAME_RE = /^[A-Za-z0-9._-]{1,30}$/

/** `core.public_name_key`: lower case, without `.`, `_` and `-`. The key a reserved row is deleted by. */
export function publicNameKey(name: string): string {
  return name.toLowerCase().replace(/[._-]/g, '')
}

/** A name key from a query: what `publicNameKey` can produce, nothing else reaches the delete. */
export function nameKeyOf(value: unknown): string | null {
  return typeof value === 'string' && /^[a-z0-9]{1,30}$/.test(value) ? value : null
}

export type ReservedNameInput = { name: string; match: ReservedMatch; appliesToDisplayName: boolean }

/** The body of a new reserved name, or `null` when the database would refuse it (`23514`). */
export function reservedNameInputOf(body: unknown): ReservedNameInput | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  const name = typeof b.name === 'string' ? b.name.trim() : ''
  if (!RESERVED_NAME_RE.test(name) || publicNameKey(name) === '') return null
  const match = b.match === undefined ? 'exact' : b.match
  if (!oneOf(RESERVED_MATCHES, match)) return null
  if (b.appliesToDisplayName !== undefined && typeof b.appliesToDisplayName !== 'boolean') return null
  return { name, match, appliesToDisplayName: b.appliesToDisplayName === true }
}

/** `drive.text_filter_own_terms_term_ck`: 1 to 150 after trimming the ends. */
export const OWN_TERM_MAX = 150

export type OwnTermInput = { kind: OwnTermKind; term: string }

/**
 * The body of a new own term, or `null` when the database would refuse it. A term made only of
 * spaces and punctuation normalizes to nothing and the database refuses it too (`23514`); that
 * answer comes back from the insert, because the normalization has one owner, the database.
 */
export function ownTermInputOf(body: unknown): OwnTermInput | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  if (!oneOf(OWN_TERM_KINDS, b.kind)) return null
  const term = typeof b.term === 'string' ? b.term.trim() : ''
  if (term.length < 1 || term.length > OWN_TERM_MAX) return null
  return { kind: b.kind, term }
}
