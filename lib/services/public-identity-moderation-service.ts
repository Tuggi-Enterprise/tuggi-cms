/**
 * The moderation of public names (#1144, BR-USUARIO-051 items 1, 2.d, 5 and 6, BR-USUARIO-050
 * item 7). Contract `docs/contracts/identidade-publica.md`, "CMS" and "Tabelas que o CMS lê e
 * escreve direto". Every table and RPC here is `service_role` only, so this runs on the service
 * client, behind the admin gate of the routes.
 *
 * `supabase-js` does not reject: every error comes back in `{ error }` and is read here. Only the
 * code is logged: the message of a failed write can carry the name or the term.
 */

import { getSupabaseService } from '@/lib/core/supabase-client'
import {
  groupLdnoobw,
  parseOwnTerms,
  parseReportRows,
  parseReservedNames,
  readAccountIdentity,
  readLockOutcome,
  readReportOutcome,
  readResetOutcome,
  type AccountIdentity,
  type FilterLists,
  type IdentityReportRow,
  type OwnTerm,
  type OwnTermInput,
  type PublicIdentityField,
  type ReportDecision,
  type ReportOutcome,
  type ReservedName,
  type ReservedNameInput,
  type ResetOutcome,
} from '@/lib/public-identity/moderation'

export type ModerationFailure = 'not_found' | 'invalid' | 'duplicate' | 'failed'

export type ModerationResult<T> = { ok: true; value: T } | { ok: false; error: ModerationFailure }

/** The queue reads at most this many open reports; the count on the screen says when there are more. */
export const REPORT_QUEUE_LIMIT = 200

/** More than the five LDNOOBW files hold today (805 rows); `total` says when a read was cut. */
const LDNOOBW_READ_LIMIT = 2000

function failureOf(error: { code?: string }): ModerationFailure {
  if (error.code === 'P0002' || error.code === 'TGW19') return 'not_found'
  if (error.code === '22023' || error.code === '23514') return 'invalid'
  if (error.code === '23505') return 'duplicate'
  return 'failed'
}

function drive() {
  return getSupabaseService().schema('drive')
}

/** BR-USUARIO-051 item 5: the open reports, oldest last report first, or `null` when the read failed. */
export async function listOpenReports(): Promise<{ reports: IdentityReportRow[]; total: number } | null> {
  const { data, error, count } = await drive()
    .from('public_identity_reports')
    .select('id, target_user_id, field, reported_value, surface, reports_count, created_at, last_reported_at', {
      count: 'exact',
    })
    .eq('status', 'open')
    .order('last_reported_at', { ascending: true })
    .limit(REPORT_QUEUE_LIMIT)
  if (error) {
    console.error('[public-identity] reports read failed:', error.code)
    return null
  }
  const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : []
  const ids = Array.from(new Set(rows.map((row) => row.target_user_id).filter((id): id is string => typeof id === 'string')))
  const nicknames: Record<string, string | null> = {}
  if (ids.length > 0) {
    const profiles = await drive().from('profiles').select('id, nickname').in('id', ids)
    // The @ only labels the link to the record; without it the record still opens by the id.
    if (profiles.error) console.error('[public-identity] nickname read failed:', profiles.error.code)
    for (const p of (profiles.data ?? []) as { id: string; nickname: string | null }[]) nicknames[p.id] = p.nickname
  }
  const reports = parseReportRows(rows, nicknames)
  return reports === null ? null : { reports, total: count ?? reports.length }
}

/** BR-USUARIO-051 item 5: remove (the field goes back to generated) or keep. */
export async function decideReport(
  reportId: number,
  decision: ReportDecision,
  actor: string
): Promise<ModerationResult<ReportOutcome>> {
  const { data, error } = await drive().rpc('decide_public_identity_report_as', {
    p_report_id: reportId,
    p_decision: decision,
    p_actor: actor,
  })
  if (error) {
    console.error('[public-identity] decide failed:', error.code)
    return { ok: false, error: failureOf(error) }
  }
  const outcome = readReportOutcome(data)
  return outcome ? { ok: true, value: outcome } : { ok: false, error: 'failed' }
}

/** The identity of one account and whether its edit is locked; `not_found` without a profile. */
export async function readIdentity(userId: string): Promise<ModerationResult<AccountIdentity>> {
  const [profile, lock] = await Promise.all([
    drive()
      .from('profiles')
      .select('nickname, bio, nickname_reset_at, bio_reset_at')
      .eq('id', userId)
      .maybeSingle(),
    drive().from('public_identity_locks').select('locked_at').eq('user_id', userId).maybeSingle(),
  ])
  const error = profile.error ?? lock.error
  if (error) {
    console.error('[public-identity] identity read failed:', error.code)
    return { ok: false, error: 'failed' }
  }
  const identity = readAccountIdentity(profile.data, lock.data)
  return identity ? { ok: true, value: identity } : { ok: false, error: 'not_found' }
}

/** BR-USUARIO-051 item 5: the moderation resets one field; works on a locked account too. */
export async function resetField(
  userId: string,
  field: PublicIdentityField,
  actor: string
): Promise<ModerationResult<ResetOutcome>> {
  const { data, error } = await drive().rpc('reset_public_identity_as', {
    p_user_id: userId,
    p_field: field,
    p_actor: actor,
  })
  if (error) {
    console.error('[public-identity] reset failed:', error.code)
    return { ok: false, error: failureOf(error) }
  }
  const outcome = readResetOutcome(data)
  return outcome ? { ok: true, value: outcome } : { ok: false, error: 'failed' }
}

/** BR-USUARIO-051 item 6: lock or unlock the edit of name, @ and bio. Repeating is safe. */
export async function setLock(userId: string, locked: boolean, actor: string): Promise<ModerationResult<{ locked: boolean }>> {
  const { data, error } = await drive().rpc('set_public_identity_lock_as', {
    p_user_id: userId,
    p_locked: locked,
    p_actor: actor,
  })
  if (error) {
    console.error('[public-identity] lock failed:', error.code)
    return { ok: false, error: failureOf(error) }
  }
  const outcome = readLockOutcome(data)
  return outcome ? { ok: true, value: outcome } : { ok: false, error: 'failed' }
}

/** The reserved names, the own lists and the LDNOOBW (read only), or `null` when a read failed. */
export async function readFilterLists(): Promise<FilterLists | null> {
  const [reserved, own, ldnoobw] = await Promise.all([
    drive().from('reserved_public_names').select('name, name_key, match, applies_to_display_name').order('name_key'),
    drive().from('text_filter_own_terms').select('id, kind, term, normalized').order('normalized'),
    drive()
      .from('text_filter_ldnoobw_terms')
      .select('language, term, source_commit', { count: 'exact' })
      .order('language')
      .order('term')
      .limit(LDNOOBW_READ_LIMIT),
  ])
  const error = reserved.error ?? own.error ?? ldnoobw.error
  if (error) {
    console.error('[public-identity] lists read failed:', error.code)
    return null
  }
  const grouped = groupLdnoobw(ldnoobw.data)
  const read = grouped.languages.reduce((sum, l) => sum + l.terms.length, 0)
  return {
    reserved: parseReservedNames(reserved.data),
    own: parseOwnTerms(own.data),
    ldnoobw: { ...grouped, total: ldnoobw.count ?? read },
  }
}

/** BR-USUARIO-050 item 7: a new reserved name. `duplicate` when its key is already reserved. */
export async function addReservedName(input: ReservedNameInput, actor: string): Promise<ModerationResult<ReservedName>> {
  const { data, error } = await drive()
    .from('reserved_public_names')
    .insert({ name: input.name, match: input.match, applies_to_display_name: input.appliesToDisplayName, created_by: actor })
    .select('name, name_key, match, applies_to_display_name')
    .single()
  if (error) {
    console.error('[public-identity] reserved insert failed:', error.code)
    return { ok: false, error: failureOf(error) }
  }
  const [row] = parseReservedNames([data])
  return row ? { ok: true, value: row } : { ok: false, error: 'failed' }
}

/** Removes a reserved name by its key. Proven by the deleted row: no row is `not_found`. */
export async function removeReservedName(nameKey: string): Promise<ModerationResult<ReservedName>> {
  const { data, error } = await drive()
    .from('reserved_public_names')
    .delete()
    .eq('name_key', nameKey)
    .select('name, name_key, match, applies_to_display_name')
  if (error) {
    console.error('[public-identity] reserved delete failed:', error.code)
    return { ok: false, error: failureOf(error) }
  }
  const [row] = parseReservedNames(data)
  return row ? { ok: true, value: row } : { ok: false, error: 'not_found' }
}

/** BR-USUARIO-051 items 2 and 2.d: a blocked or allowed term. `duplicate` when it normalizes to one already there. */
export async function addOwnTerm(input: OwnTermInput, actor: string): Promise<ModerationResult<OwnTerm>> {
  const { data, error } = await drive()
    .from('text_filter_own_terms')
    .insert({ kind: input.kind, term: input.term, created_by: actor })
    .select('id, kind, term, normalized')
    .single()
  if (error) {
    console.error('[public-identity] own term insert failed:', error.code)
    return { ok: false, error: failureOf(error) }
  }
  const [row] = parseOwnTerms([data])
  return row ? { ok: true, value: row } : { ok: false, error: 'failed' }
}

/** Removes an own term by id. Proven by the deleted row: no row is `not_found`. */
export async function removeOwnTerm(id: number): Promise<ModerationResult<OwnTerm>> {
  const { data, error } = await drive()
    .from('text_filter_own_terms')
    .delete()
    .eq('id', id)
    .select('id, kind, term, normalized')
  if (error) {
    console.error('[public-identity] own term delete failed:', error.code)
    return { ok: false, error: failureOf(error) }
  }
  const [row] = parseOwnTerms(data)
  return row ? { ok: true, value: row } : { ok: false, error: 'not_found' }
}

/** The HTTP status of a failure, the same in every route of this module. */
export function statusOf(error: ModerationFailure): number {
  if (error === 'not_found') return 404
  if (error === 'invalid') return 400
  if (error === 'duplicate') return 409
  return 503
}
