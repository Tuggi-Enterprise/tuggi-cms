/**
 * The CMS approval queue of user route versions (#1106, epic #1102). Contract:
 * `docs/contracts/diario-de-bordo.md` (workspace), migrations 20261106130000 and 20261106140000 of
 * db-tuggiApp.
 *
 * BR-ROTA-006 item 3: every version of a user route is approved by a person, and nothing automatic
 * approves. The CMS decides a VERSION, never the route: `core.approve_route_revision` and
 * `core.reject_route_revision` are the only doors. `core.upsert_custom_route` with `p_status` is
 * never an approval (it would put a version on the air without deciding it); it stays for removing
 * by moderation and restoring.
 *
 * Kept free of server imports: the review screen imports the diff and the line split.
 */

/** BR-ROTA-006 item 3: the reason the author reads, 1 to 1,000 characters, delivered as written. */
export const REJECT_REASON_MAX = 1000

/**
 * How far around an annotation the promotion dialog looks for existing POIs, so the curator sees
 * a likely duplicate before creating one (BR-ROTA-009 item 1). A display choice of #1106, not a
 * business number: the database decides nothing with it.
 */
export const NEARBY_POI_RADIUS_M = 300

/** The translation the CMS asks for after an approval: the default every reader falls back to. */
export const APPROVAL_TRANSLATION = { language: 'en-us', gender: 'male' } as const

/** Private bucket of the diary photos (contract, "Storage"). */
export const DIARY_PHOTO_BUCKET = 'travel-diary-photos'
/** Public bucket the app reads POI images from. */
export const POI_IMAGE_BUCKET = 'travel-app-images'
/** Seconds a signed photo URL lives on the review screen. */
export const REVIEW_PHOTO_URL_TTL_S = 600

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

export interface LatLng {
  lat: number
  lng: number
}

/** One row of `core.list_pending_route_revisions()`. */
export interface QueueItem {
  revision_id: string
  route_id: string
  revision_no: number
  submitted_at: string
  route_status: string
  slug: string | null
  author_user_id: string | null
  author_nickname: string | null
  name: string
  live_revision_id: string | null
  live_revision_no: number | null
  filter_flag_reason: string | null
  report_count: number
}

/** One stop of a version, as `core.resolve_user_route_stops` writes it. */
export interface RevisionStop {
  kind: 'annotation' | 'poi'
  ref: string
  title: string | null
  description: string | null
  lat: number | null
  lng: number | null
  at: string | null
  photo_keys: string[]
}

/** The columns of `core.custom_route_revisions` the review reads. */
export interface RevisionContent {
  id: string
  route_id: string
  revision_no: number
  state: 'pending' | 'approved' | 'rejected' | 'cancelled'
  name: string
  description: string | null
  visibility: string
  cover_photo_key: string | null
  stops: RevisionStop[]
  uncovered_segments: UncoveredSegment[]
  filter_flag_reason: string | null
  submitted_at: string
}

export const REVISION_COLUMNS =
  'id, route_id, revision_no, state, name, description, visibility, cover_photo_key, stops, uncovered_segments, linestring, filter_flag_reason, submitted_at'

/** BR-ROTA-008 item 7: a join between two trips of 2,000 m or more, as the server stored it. */
export interface UncoveredSegment {
  from_index: number
  to_index: number
  meters: number
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export function normalizeStops(raw: unknown): RevisionStop[] {
  if (!Array.isArray(raw)) return []
  const out: RevisionStop[] = []
  for (const s of raw as Record<string, unknown>[]) {
    if (!s || (s.kind !== 'annotation' && s.kind !== 'poi') || typeof s.ref !== 'string') continue
    out.push({
      kind: s.kind,
      ref: s.ref,
      title: str(s.title),
      description: str(s.description),
      lat: num(s.lat),
      lng: num(s.lng),
      at: str(s.at),
      photo_keys: Array.isArray(s.photo_keys) ? (s.photo_keys as unknown[]).filter((k): k is string => typeof k === 'string') : [],
    })
  }
  return out
}

export function normalizeSegments(raw: unknown): UncoveredSegment[] {
  if (!Array.isArray(raw)) return []
  return (raw as Record<string, unknown>[])
    .map((s) => ({ from_index: num(s?.from_index), to_index: num(s?.to_index), meters: num(s?.meters) }))
    .filter((s): s is UncoveredSegment => s.from_index !== null && s.to_index !== null && s.meters !== null)
}

/** A database row of `core.custom_route_revisions` as the review uses it. */
export function toRevisionContent(row: Record<string, unknown>): RevisionContent {
  return {
    id: String(row.id),
    route_id: String(row.route_id),
    revision_no: Number(row.revision_no),
    state: row.state as RevisionContent['state'],
    name: String(row.name ?? ''),
    description: str(row.description),
    visibility: String(row.visibility ?? ''),
    cover_photo_key: str(row.cover_photo_key),
    stops: normalizeStops(row.stops),
    uncovered_segments: normalizeSegments(row.uncovered_segments),
    filter_flag_reason: str(row.filter_flag_reason),
    submitted_at: String(row.submitted_at ?? ''),
  }
}

/** Every photo key of a version: stops first, then the cover, once each. */
export function revisionPhotoKeys(rev: Pick<RevisionContent, 'stops' | 'cover_photo_key'>): string[] {
  const keys: string[] = []
  for (const s of rev.stops) for (const k of s.photo_keys) if (!keys.includes(k)) keys.push(k)
  if (rev.cover_photo_key && !keys.includes(rev.cover_photo_key)) keys.push(rev.cover_photo_key)
  return keys
}

/** Annotation stops that carry text: the ones translated and narrated after the approval. */
export function annotationTextCount(stops: RevisionStop[]): number {
  return stops.filter((s) => s.kind === 'annotation' && (s.title || s.description)).length
}

// ─── Refusal ──────────────────────────────────────────────────────────────────

export type RejectReasonError = 'reason_required' | 'reason_too_long'

/**
 * BR-ROTA-006 item 3: the reason is required and goes to the author as the curator wrote it. Blank
 * is refused (the database refuses it too, TGW04); more than 1,000 characters is refused here
 * rather than cut by the database.
 */
export function parseRejectReason(value: unknown): { ok: true; reason: string } | { ok: false; error: RejectReasonError } {
  if (typeof value !== 'string' || value.trim().length === 0) return { ok: false, error: 'reason_required' }
  if (value.length > REJECT_REASON_MAX) return { ok: false, error: 'reason_too_long' }
  return { ok: true, reason: value }
}

// ─── Errors of the RPCs ───────────────────────────────────────────────────────

export type RevisionActionError =
  | 'not_admin' | 'revision_not_found' | 'already_decided' | 'route_removed' | 'invalid_text'
  | 'not_a_stop' | 'not_available' | 'revision_action_failed'

/** The codes of the contract (42501, TGW04, TGW08, TGW09, TGW17, TGW18) to an HTTP answer. */
export function classifyRevisionError(code: string | undefined): { status: number; error: RevisionActionError } {
  switch (code) {
    case '42501': return { status: 403, error: 'not_admin' }
    case 'TGW08': return { status: 404, error: 'revision_not_found' }
    case 'TGW18': return { status: 409, error: 'already_decided' }
    case 'TGW09': return { status: 409, error: 'route_removed' }
    case 'TGW04': return { status: 400, error: 'invalid_text' }
    case 'TGW17': return { status: 400, error: 'not_a_stop' }
    // the migration is not applied yet: the function or the table does not exist
    case 'PGRST202': case '42883': case 'PGRST205': case '42P01': return { status: 503, error: 'not_available' }
    default: return { status: 500, error: 'revision_action_failed' }
  }
}

// ─── After the approval ───────────────────────────────────────────────────────

/**
 * Whether the CMS asks `generate-translated-audio` for the approved version (contract, "O que fica
 * com o dev", item 4): the name or description changed (`text_changed`, the database deleted the old
 * translations), the route has no ready translation yet, or the version has annotation text (each
 * version starts with no stop translation, BR-ROTA-008 item 5).
 */
export function needsTranslationAfterApproval(input: {
  textChanged: boolean
  routeTranslationReady: boolean
  annotationTexts: number
}): boolean {
  return input.textChanged || !input.routeTranslationReady || input.annotationTexts > 0
}

// ─── Diff between the version on the air and the pending one ─────────────────

export type FieldName = 'name' | 'description' | 'visibility' | 'cover'
export type StopChange = 'added' | 'removed' | 'edited' | 'moved' | 'same'

export interface RevisionDiff {
  /** No version on the air: a first submission, nothing to compare. */
  first: boolean
  fields: Array<{ field: FieldName; before: string | null; after: string | null }>
  stops: Array<{ kind: RevisionStop['kind']; ref: string; title: string | null; change: StopChange }>
  /** The joined line changed (a trip came in or left the diary). */
  lineChanged: boolean
}

const stopKey = (s: Pick<RevisionStop, 'kind' | 'ref'>) => `${s.kind}:${s.ref}`

/**
 * What changed from the version on the air to the pending one, in the pending order, removed stops
 * at the end. `moved` is a stop kept in both whose place among the kept stops changed.
 */
export function diffRevisions(
  live: (Pick<RevisionContent, 'name' | 'description' | 'visibility' | 'cover_photo_key' | 'stops'> & { linestring?: unknown }) | null,
  pending: Pick<RevisionContent, 'name' | 'description' | 'visibility' | 'cover_photo_key' | 'stops'> & { linestring?: unknown },
): RevisionDiff {
  if (!live) {
    return {
      first: true,
      fields: [],
      stops: pending.stops.map((s) => ({ kind: s.kind, ref: s.ref, title: s.title, change: 'added' as const })),
      lineChanged: false,
    }
  }
  const fields: RevisionDiff['fields'] = []
  const field = (name: FieldName, before: string | null, after: string | null) => {
    if ((before ?? null) !== (after ?? null)) fields.push({ field: name, before: before ?? null, after: after ?? null })
  }
  field('name', live.name, pending.name)
  field('description', live.description, pending.description)
  field('visibility', live.visibility, pending.visibility)
  field('cover', live.cover_photo_key, pending.cover_photo_key)

  const liveByKey = new Map(live.stops.map((s) => [stopKey(s), s]))
  const pendingKeys = new Set(pending.stops.map(stopKey))
  const keptLive = live.stops.map(stopKey).filter((k) => pendingKeys.has(k))
  const keptPending = pending.stops.map(stopKey).filter((k) => liveByKey.has(k))

  const stops: RevisionDiff['stops'] = pending.stops.map((s) => {
    const before = liveByKey.get(stopKey(s))
    if (!before) return { kind: s.kind, ref: s.ref, title: s.title, change: 'added' as const }
    const edited = before.title !== s.title || before.description !== s.description
      || before.photo_keys.join('|') !== s.photo_keys.join('|')
    if (edited) return { kind: s.kind, ref: s.ref, title: s.title, change: 'edited' as const }
    const moved = keptLive.indexOf(stopKey(s)) !== keptPending.indexOf(stopKey(s))
    return { kind: s.kind, ref: s.ref, title: s.title, change: moved ? 'moved' as const : 'same' as const }
  })
  for (const s of live.stops) {
    if (!pendingKeys.has(stopKey(s))) stops.push({ kind: s.kind, ref: s.ref, title: s.title, change: 'removed' })
  }
  const lineChanged = JSON.stringify(live.linestring ?? null) !== JSON.stringify(pending.linestring ?? null)
  return { first: false, fields, stops, lineChanged }
}

// ─── The line on the map ──────────────────────────────────────────────────────

/**
 * Splits the joined line into the recorded stretches and the uncovered ones (BR-ROTA-008 item 7:
 * the server already kept only the joins of 2,000 m or more; the CMS keeps no threshold). An
 * uncovered stretch is the straight join between `from_index` and `to_index`.
 */
export function splitLineAtGaps(line: LatLng[], segments: UncoveredSegment[]): { recorded: LatLng[][]; uncovered: LatLng[][] } {
  const recorded: LatLng[][] = []
  const uncovered: LatLng[][] = []
  let cursor = 0
  const sorted = [...segments].sort((a, b) => a.from_index - b.from_index)
  for (const s of sorted) {
    if (s.from_index < cursor || s.to_index <= s.from_index || s.to_index >= line.length) continue
    const piece = line.slice(cursor, s.from_index + 1)
    if (piece.length >= 2) recorded.push(piece)
    uncovered.push([line[s.from_index], line[s.to_index]])
    cursor = s.to_index
  }
  const tail = line.slice(cursor)
  if (tail.length >= 2) recorded.push(tail)
  return { recorded, uncovered }
}

// ─── Promotion of an annotation to a POI (BR-ROTA-009) ───────────────────────

export interface PromotionInput {
  annotationId: string
  name: string
  description: string
  city: string
  country: string
  state: string | null
  photoKey: string | null
}

export type PromotionError =
  | 'invalid_annotation' | 'name_required' | 'description_required' | 'city_required'
  | 'country_required' | 'invalid_photo'

/** The body of the promotion. The text is the author's, corrected only (BR-ROTA-009 item 2). */
export function parsePromotion(body: unknown): { ok: true; input: PromotionInput } | { ok: false; error: PromotionError } {
  const b = (body ?? {}) as Record<string, unknown>
  if (!isUuid(b.annotationId)) return { ok: false, error: 'invalid_annotation' }
  const t = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  if (!t(b.name)) return { ok: false, error: 'name_required' }
  if (!t(b.description)) return { ok: false, error: 'description_required' }
  if (!t(b.city)) return { ok: false, error: 'city_required' }
  if (!t(b.country)) return { ok: false, error: 'country_required' }
  if (b.photoKey !== undefined && b.photoKey !== null && (typeof b.photoKey !== 'string' || !b.photoKey)) {
    return { ok: false, error: 'invalid_photo' }
  }
  return {
    ok: true,
    input: {
      annotationId: b.annotationId,
      name: t(b.name),
      description: t(b.description),
      city: t(b.city),
      country: t(b.country),
      state: t(b.state) || null,
      photoKey: (b.photoKey as string | null | undefined) ?? null,
    },
  }
}

/** Whether an annotation can become a POI: it needs the author's text (BR-ROTA-009, edge case). */
export function canPromote(stop: Pick<RevisionStop, 'kind' | 'title' | 'description'>): boolean {
  return stop.kind === 'annotation' && Boolean(stop.title || stop.description)
}

/**
 * Where the chosen photo is copied in the public POI bucket (BR-ROTA-009 item 3). The file name is
 * the photo id, so a repeated promotion writes the same object. `null` for a format the app does
 * not show (HEIC).
 */
export function promotedPhotoPath(attractionId: string, photoKey: string): string | null {
  const file = photoKey.split('/').pop() ?? ''
  const m = /^([0-9a-f-]{36})\.(jpe?g|webp|png)$/i.exec(file)
  if (!m || !isUuid(m[1])) return null
  return `user-annotations/${attractionId}/${m[1].toLowerCase()}.${m[2].toLowerCase()}`
}

export function photoContentType(path: string): string {
  if (/\.png$/i.test(path)) return 'image/png'
  if (/\.webp$/i.test(path)) return 'image/webp'
  return 'image/jpeg'
}

/** A POI next to an annotation, nearest first. */
export interface NearbyPoi {
  id: string
  name: string
  city: string | null
  country: string | null
  distance_m: number
}

/** Degrees of latitude and longitude that cover `radiusM` around `lat`, for the bounding box. */
export function boundingBox(point: LatLng, radiusM: number): { minLat: number; maxLat: number; minLng: number; maxLng: number } {
  const dLat = radiusM / 111_320
  const dLng = radiusM / (111_320 * Math.max(Math.cos((point.lat * Math.PI) / 180), 0.01))
  return { minLat: point.lat - dLat, maxLat: point.lat + dLat, minLng: point.lng - dLng, maxLng: point.lng + dLng }
}
