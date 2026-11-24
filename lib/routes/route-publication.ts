/**
 * Publication of a route in the CMS (#945, epic #942): visibility, validity, slug, state and the
 * review queue of routes that app users publish from a trip.
 *
 * The database is the owner of every decision here (migration 20261019110000 of db-tuggiApp):
 * `core.upsert_custom_route` writes, `core.custom_route_availability` answers "can this route be
 * followed now", `core.custom_route_slug_history` keeps the old links alive. This module only reads
 * the row the CMS already has and shapes the call; it does not decide anything the database decides.
 *
 * Kept free of server imports on purpose: the editor and the list import it, and `route-service.ts`
 * pulls the OSRM client into the browser bundle.
 *
 * While the migration is not applied the columns do not exist. `hasPublicationColumns` is the one
 * question every caller asks before showing or sending any of this: absent means hidden, never error.
 */

/** BR-ROTA-003. `link_only` is "only with the link", never "private": anyone with the link opens it. */
export const ROUTE_VISIBILITIES = ['public', 'link_only'] as const
export type RouteVisibility = typeof ROUTE_VISIBILITIES[number]

/** `core.custom_routes.status`, CHECK in the database. Expired is not a status (BR-ROTA-004). */
export const ROUTE_STATUSES = ['active', 'pending_review', 'removed_by_author', 'removed_by_moderation'] as const
export type RouteStatus = typeof ROUTE_STATUSES[number]

/** What `core.custom_route_availability` answers. */
export type RouteAvailability =
  | 'ok' | 'expired' | 'not_yet_valid' | 'pending_review' | 'removed_by_author' | 'removed_by_moderation'

/** BR-ROTA-005: the public link of a route. The site resolves it, old slugs included. */
export const ROUTE_LINK_BASE = 'https://tuggi.app/r/'

export function routeLink(slug: string): string {
  return `${ROUTE_LINK_BASE}${slug}`
}

/** Same pattern and length as `custom_routes_slug_format_check` and the trigger `custom_routes_slug`. */
export const ROUTE_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/
export const ROUTE_SLUG_MAX_LENGTH = 80

export function isValidRouteSlug(value: string): boolean {
  return value.length <= ROUTE_SLUG_MAX_LENGTH && ROUTE_SLUG_PATTERN.test(value)
}

export interface PublicationFields {
  slug?: string | null
  visibility?: string | null
  status?: string | null
  valid_from?: string | null
  valid_until?: string | null
  owner_user_id?: string | null
  moderation_reason?: string | null
  moderation_reviewed_at?: string | null
  is_active?: boolean | null
  metadata?: { source?: unknown; [key: string]: unknown } | null
}

/** The migration landed when the row carries `status`. Before it, every new control stays hidden. */
export function hasPublicationColumns(route: object | null | undefined): boolean {
  return Boolean(route) && 'status' in (route as object)
}

/**
 * A route published by an app user. `owner_user_id` is what the database uses; `metadata.source`
 * survives the account being deleted (`owner_user_id` goes NULL then).
 */
export function isUserRoute(route: PublicationFields): boolean {
  return Boolean(route.owner_user_id) || route.metadata?.source === 'user_trip'
}

/**
 * Display mirror of `core.custom_route_availability` (20261019110000), for the badge of the list
 * and the editor. The CMS has the row, not a call per row; the database stays the owner and every
 * reader outside the CMS calls the function. Change both or neither.
 */
export function routeAvailability(route: PublicationFields, now: Date = new Date()): RouteAvailability {
  if (route.status === 'removed_by_moderation') return 'removed_by_moderation'
  if (route.status === 'removed_by_author' || route.is_active !== true) return 'removed_by_author'
  if (route.status === 'pending_review') return 'pending_review'
  if (route.valid_until && new Date(route.valid_until).getTime() < now.getTime()) return 'expired'
  if (route.valid_from && new Date(route.valid_from).getTime() > now.getTime()) return 'not_yet_valid'
  return 'ok'
}

/** Named parameters that `core.upsert_custom_route` gained in #943. Absent key = keep the value. */
export interface PublicationParams {
  p_visibility?: RouteVisibility
  p_slug?: string
  p_set_validity?: true
  p_valid_from?: string | null
  p_valid_until?: string | null
}

export type PublicationErrorCode =
  | 'visibility_invalid' | 'slug_invalid' | 'slug_taken' | 'validity_invalid' | 'route_removed_by_author'

function parseInstant(value: unknown): string | null | 'invalid' {
  if (value === null || value === '') return null
  if (typeof value !== 'string') return 'invalid'
  const time = Date.parse(value)
  return Number.isNaN(time) ? 'invalid' : new Date(time).toISOString()
}

/**
 * Reads `visibility`, `slug`, `valid_from` and `valid_until` from a PUT body. A key that is absent
 * stays out (the column keeps its value); a key that is present and malformed is an error, never a
 * silent default. Validity travels as a pair: sending either one writes both (NULL clears).
 */
export function parseRoutePublication(
  body: Record<string, unknown>,
): { params: PublicationParams } | { error: PublicationErrorCode } {
  const params: PublicationParams = {}

  if (body.visibility !== undefined) {
    if (!(ROUTE_VISIBILITIES as readonly unknown[]).includes(body.visibility)) return { error: 'visibility_invalid' }
    params.p_visibility = body.visibility as RouteVisibility
  }

  if (body.slug !== undefined) {
    const slug = typeof body.slug === 'string' ? body.slug.trim() : ''
    if (!isValidRouteSlug(slug)) return { error: 'slug_invalid' }
    params.p_slug = slug
  }

  if (body.valid_from !== undefined || body.valid_until !== undefined) {
    const from = parseInstant(body.valid_from ?? null)
    const until = parseInstant(body.valid_until ?? null)
    if (from === 'invalid' || until === 'invalid') return { error: 'validity_invalid' }
    if (from && until && Date.parse(until) <= Date.parse(from)) return { error: 'validity_invalid' }
    params.p_set_validity = true
    params.p_valid_from = from
    params.p_valid_until = until
  }

  return { params }
}

/**
 * Turns a refusal of `upsert_custom_route` into the field error the editor shows. `TGW09` is the
 * slug trigger (format, or a slug another route had); `23505` is the unique index on the current
 * slug; `TGW10` is a route its author removed (BR-ROTA-007).
 */
export function classifyPublicationError(error: { code?: string; message?: string } | null | undefined): PublicationErrorCode | null {
  if (!error) return null
  if (error.code === '23505' && /slug/i.test(error.message ?? '')) return 'slug_taken'
  if (error.code === 'TGW09') return /already belongs/i.test(error.message ?? '') ? 'slug_taken' : 'slug_invalid'
  if (error.code === 'TGW05') return 'visibility_invalid'
  if (error.code === 'TGW10') return 'route_removed_by_author'
  if (error.code === '23514' && /validity/i.test(error.message ?? '')) return 'validity_invalid'
  return null
}

/**
 * BR-ROTA-006: what the CMS admin does from the queue or the editor. Remove never DELETEs; it marks
 * `removed_by_moderation`. Approve and restore both write `active`; on a reported route that is
 * already active, approving stamps `moderation_reviewed_at`, which is what closes its reports.
 */
export const MODERATION_ACTIONS = ['approve', 'remove', 'restore'] as const
export type ModerationAction = typeof MODERATION_ACTIONS[number]

export function isModerationAction(value: unknown): value is ModerationAction {
  return typeof value === 'string' && (MODERATION_ACTIONS as readonly string[]).includes(value)
}

export function moderationStatus(action: ModerationAction): 'active' | 'removed_by_moderation' {
  return action === 'remove' ? 'removed_by_moderation' : 'active'
}

export interface RouteReport {
  route_id: string
  reason: string | null
  created_at: string
}

export interface ReportSummary {
  count: number
  reasons: string[]
}

/**
 * Open reports of a route: the ones filed after an admin last decided it by hand
 * (`moderation_reviewed_at`). `core.custom_route_reports` has no "closed" column; the decision
 * stamp is the close. Reasons are the most frequent first, three at most.
 */
export function openReports(reports: RouteReport[], reviewedAt: string | null | undefined): ReportSummary {
  const since = reviewedAt ? Date.parse(reviewedAt) : Number.NEGATIVE_INFINITY
  const open = reports.filter((r) => Date.parse(r.created_at) > since)
  const tally = new Map<string, number>()
  for (const r of open) {
    const reason = r.reason?.trim()
    if (reason) tally.set(reason, (tally.get(reason) ?? 0) + 1)
  }
  const reasons = [...tally.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([reason]) => (reason.length > 60 ? `${reason.slice(0, 59)}…` : reason))
  return { count: open.length, reasons }
}

export interface QueueCandidate {
  id: string
  status: string | null
  moderation_reviewed_at: string | null
}

/**
 * The review queue (spec 8.1): routes in `pending_review`, plus routes still live with open reports.
 * A removed route is decided and leaves the queue whatever its reports say.
 */
export function reviewQueueIds(
  pending: QueueCandidate[],
  reported: QueueCandidate[],
  reports: RouteReport[],
): string[] {
  const ids = new Set(pending.filter((r) => r.status === 'pending_review').map((r) => r.id))
  for (const route of reported) {
    if (route.status !== 'active' && route.status !== 'pending_review') continue
    const own = reports.filter((r) => r.route_id === route.id)
    if (openReports(own, route.moderation_reviewed_at).count > 0) ids.add(route.id)
  }
  return [...ids]
}

/** `<input type="date">` value of an instant, in the browser's zone. */
export function instantToDateInput(value: string | null | undefined): string {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** "From" starts at the first instant of the day, "Until" ends at the last one, in the browser's zone. */
export function dateInputToInstant(value: string, edge: 'start' | 'end'): string | null {
  if (!value) return null
  const d = new Date(`${value}T${edge === 'start' ? '00:00:00.000' : '23:59:59.999'}`)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** PostgREST answer for a column the database does not have yet. */
export function isMissingColumn(error: { code?: string } | null | undefined): boolean {
  return error?.code === '42703' || error?.code === 'PGRST204'
}

/** PostgREST answer for a function the database does not have yet. */
export function isMissingFunction(error: { code?: string } | null | undefined): boolean {
  return error?.code === 'PGRST202' || error?.code === '42883'
}

/** PostgREST answer for a table the database does not have yet. */
export function isMissingRelation(error: { code?: string } | null | undefined): boolean {
  return error?.code === '42P01' || error?.code === 'PGRST205'
}
