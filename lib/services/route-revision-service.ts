/**
 * Server side of the approval queue of user route versions (#1106). Every decision is the
 * database's (contract `docs/contracts/diario-de-bordo.md`); this module shapes the calls.
 *
 * IDENTITY. The queue and decision RPCs check `core.is_caller_platform_admin()`, which reads the
 * caller's JWT: they run on the curator's cookie client (`auth.supabase`), never on the service
 * role, whose JWT carries no e-mail. The version rows and the diary photos are read on the same
 * client (admin SELECT policy, admin read of `travel-diary-photos`). The service role is used for
 * two things only, both without personal data: reading the POI catalog around an annotation, and
 * writing the copied photo into the public POI bucket (same as `place-change-service.ts`).
 *
 * Nothing from a row goes to the log: ids and codes only. The author's text never does.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseService } from '@/lib/core/supabase-client'
import { storedLineToLatLngs } from '@/lib/services/routing/route-geometry'
import { calculateDistance } from '@/lib/services/trigger-points-google/utils/calculations'
import {
  APPROVAL_TRANSLATION,
  DIARY_PHOTO_BUCKET,
  NEARBY_POI_RADIUS_M,
  POI_IMAGE_BUCKET,
  REVIEW_PHOTO_URL_TTL_S,
  REVISION_COLUMNS,
  annotationTextCount,
  boundingBox,
  canPromote,
  classifyRevisionError,
  diffRevisions,
  needsTranslationAfterApproval,
  photoContentType,
  promotedPhotoPath,
  revisionPhotoKeys,
  toRevisionContent,
  type LatLng,
  type NearbyPoi,
  type PromotionInput,
  type QueueItem,
  type RevisionActionError,
  type RevisionContent,
  type RevisionDiff,
} from '@/lib/routes/route-revisions'

type Db = SupabaseClient
type Fail = { ok: false; status: number; error: RevisionActionError | 'photo_not_of_stop' | 'cannot_promote' }
type Result<T> = { ok: true; data: T } | Fail

const fail = (code: string | undefined): Fail => {
  const e = classifyRevisionError(code)
  return { ok: false, status: e.status, error: e.error }
}

export async function listQueue(db: Db): Promise<Result<QueueItem[]>> {
  const { data, error } = await db.schema('core').rpc('list_pending_route_revisions')
  if (error) {
    console.error('[route-revisions] queue refused:', error.code)
    return fail(error.code)
  }
  return { ok: true, data: ((data ?? []) as QueueItem[]).map((r) => ({ ...r, report_count: Number(r.report_count ?? 0) })) }
}

async function readRevision(db: Db, revisionId: string): Promise<Result<(RevisionContent & { linestring: unknown }) | null>> {
  const { data, error } = await db.schema('core').from('custom_route_revisions').select(REVISION_COLUMNS).eq('id', revisionId).maybeSingle()
  if (error) {
    console.error('[route-revisions] revision read refused:', error.code)
    return fail(error.code)
  }
  if (!data) return { ok: true, data: null }
  const row = data as Record<string, unknown>
  return { ok: true, data: { ...toRevisionContent(row), linestring: row.linestring ?? null } }
}

export interface RevisionDetail {
  revision: RevisionContent
  live: RevisionContent | null
  route: { id: string; slug: string | null; status: string; live_revision_id: string | null }
  line: LatLng[]
  liveLine: LatLng[]
  diff: RevisionDiff
  /** Signed URLs of the photos of both versions, by storage key. A key that could not be signed is absent. */
  photoUrls: Record<string, string>
  /** POIs around each annotation of the version under review, by annotation id. */
  nearby: Record<string, NearbyPoi[]>
  /** Annotations of this version already promoted, annotation id -> POI id. */
  promoted: Record<string, string>
}

function lineOf(linestring: unknown): LatLng[] {
  try {
    return storedLineToLatLngs(linestring)
  } catch {
    return []
  }
}

/** POIs of the catalog within `NEARBY_POI_RADIUS_M` of a point, nearest first. */
export async function nearbyPois(point: LatLng, catalog: Db = getSupabaseService()): Promise<NearbyPoi[]> {
  const box = boundingBox(point, NEARBY_POI_RADIUS_M)
  const { data, error } = await catalog
    .schema('core')
    .from('attraction_coordinate')
    .select('attraction_id, latitude, longitude, attractions!inner(id, name, city, country)')
    .gte('latitude', box.minLat).lte('latitude', box.maxLat)
    .gte('longitude', box.minLng).lte('longitude', box.maxLng)
    .limit(50)
  if (error) {
    console.error('[route-revisions] nearby read refused:', error.code)
    return []
  }
  const seen = new Set<string>()
  const out: NearbyPoi[] = []
  type CatalogRow = {
    attraction_id: string
    latitude: number
    longitude: number
    attractions: CatalogPoi | CatalogPoi[] | null
  }
  type CatalogPoi = { id: string; name: string | null; city: string | null; country: string | null }
  for (const row of (data ?? []) as unknown as CatalogRow[]) {
    const a = Array.isArray(row.attractions) ? row.attractions[0] : row.attractions
    const id = a?.id ?? row.attraction_id
    if (!id || seen.has(id)) continue
    seen.add(id)
    const distance = calculateDistance(point, { lat: Number(row.latitude), lng: Number(row.longitude) })
    if (distance > NEARBY_POI_RADIUS_M) continue
    out.push({ id, name: a?.name ?? '', city: a?.city ?? null, country: a?.country ?? null, distance_m: Math.round(distance) })
  }
  return out.sort((x, y) => x.distance_m - y.distance_m).slice(0, 10)
}

export async function getRevisionDetail(db: Db, revisionId: string): Promise<Result<RevisionDetail | null>> {
  const rev = await readRevision(db, revisionId)
  if (!rev.ok) return rev
  if (!rev.data) return { ok: true, data: null }
  const revision = rev.data

  const { data: routeRow, error: routeError } = await db
    .schema('core').from('custom_routes').select('id, slug, status, live_revision_id').eq('id', revision.route_id).maybeSingle()
  if (routeError || !routeRow) {
    console.error('[route-revisions] route read refused:', routeError?.code ?? 'missing')
    return fail(routeError?.code ?? 'TGW08')
  }
  const route = routeRow as RevisionDetail['route']

  let live: (RevisionContent & { linestring: unknown }) | null = null
  if (route.live_revision_id && route.live_revision_id !== revision.id) {
    const read = await readRevision(db, route.live_revision_id)
    if (!read.ok) return read
    live = read.data
  }

  const keys = [...new Set([...revisionPhotoKeys(revision), ...(live ? revisionPhotoKeys(live) : [])])]
  const photoUrls: Record<string, string> = {}
  if (keys.length) {
    const signed = await db.storage.from(DIARY_PHOTO_BUCKET).createSignedUrls(keys, REVIEW_PHOTO_URL_TTL_S)
    if (signed.error) console.error('[route-revisions] sign failed')
    for (const s of signed.data ?? []) if (s.path && s.signedUrl) photoUrls[s.path] = s.signedUrl
  }

  const annotations = revision.stops.filter((s) => s.kind === 'annotation' && s.lat !== null && s.lng !== null)
  const nearbyEntries = await Promise.all(
    annotations.map(async (s) => [s.ref, await nearbyPois({ lat: s.lat as number, lng: s.lng as number })] as const),
  )

  const promoted: Record<string, string> = {}
  if (annotations.length) {
    const { data: done, error: doneError } = await db
      .schema('core').from('attractions').select('id, source_annotation_id').in('source_annotation_id', annotations.map((a) => a.ref))
    if (doneError) console.error('[route-revisions] promoted read refused:', doneError.code)
    for (const d of (done ?? []) as Array<{ id: string; source_annotation_id: string }>) promoted[d.source_annotation_id] = d.id
  }

  const { linestring: pendingLine, ...pending } = revision
  const liveContent = live ? (({ linestring: _l, ...rest }) => rest)(live) : null
  return {
    ok: true,
    data: {
      revision: pending,
      live: liveContent,
      route,
      line: lineOf(pendingLine),
      liveLine: live ? lineOf(live.linestring) : [],
      diff: diffRevisions(live, revision),
      photoUrls,
      nearby: Object.fromEntries(nearbyEntries),
      promoted,
    },
  }
}

// ─── Decisions ────────────────────────────────────────────────────────────────

export interface ApprovalOutcome {
  route_id: string
  revision_no: number
  status: string
  valid_until: string | null
  text_changed: boolean
  /** What happened to the translation of the approved text (BR-ROTA-006 item 3). */
  translation: 'requested' | 'not_needed' | 'failed'
  /** HTTP status of `generate-translated-audio` when it failed (429 is its hourly limit). */
  translation_status?: number
}

/** Calls `generate-translated-audio` in route mode with the curator's session. Returns the HTTP status. */
export async function requestRouteTranslation(routeId: string, accessToken: string): Promise<number> {
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/generate-translated-audio`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        routeId,
        targetLanguage: APPROVAL_TRANSLATION.language,
        voiceGender: APPROVAL_TRANSLATION.gender,
        generateAudio: true,
      }),
    })
    await res.body?.cancel()
    return res.status
  } catch {
    return 0
  }
}

/**
 * BR-ROTA-006 item 3: the only approval of a user route version. Then, when the approved text needs
 * it, asks for its translation and audio (route text and annotations). A failed translation does not
 * undo the approval: it is reported, and the route editor's language tab generates it again.
 */
export async function approveRevision(db: Db, revisionId: string, accessToken: string | null): Promise<Result<ApprovalOutcome>> {
  const rev = await readRevision(db, revisionId)
  if (!rev.ok) return rev
  if (!rev.data) return fail('TGW08')

  const { data, error } = await db.schema('core').rpc('approve_route_revision', { p_revision_id: revisionId })
  if (error) {
    console.error('[route-revisions] approve refused:', error.code)
    return fail(error.code)
  }
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null
  if (!row) return fail(undefined)

  const { data: ready } = await db
    .schema('core').from('custom_route_descriptions').select('id')
    .eq('route_id', String(row.route_id)).eq('language', APPROVAL_TRANSLATION.language)
    .eq('gender', APPROVAL_TRANSLATION.gender).eq('status', 'ready').limit(1)

  const outcome: ApprovalOutcome = {
    route_id: String(row.route_id),
    revision_no: Number(row.revision_no),
    status: String(row.status),
    valid_until: (row.valid_until as string | null) ?? null,
    text_changed: row.text_changed === true,
    translation: 'not_needed',
  }
  const needed = needsTranslationAfterApproval({
    textChanged: outcome.text_changed,
    routeTranslationReady: Array.isArray(ready) && ready.length > 0,
    annotationTexts: annotationTextCount(rev.data.stops),
  })
  if (needed) {
    const status = accessToken ? await requestRouteTranslation(outcome.route_id, accessToken) : 401
    if (status >= 200 && status < 300) outcome.translation = 'requested'
    else {
      outcome.translation = 'failed'
      outcome.translation_status = status
      console.error('[route-revisions] translation after approval failed:', status)
    }
  }
  return { ok: true, data: outcome }
}

/** BR-ROTA-006 item 3: refuses a version with the reason the author reads. The route state does not move. */
export async function rejectRevision(db: Db, revisionId: string, reason: string): Promise<Result<Record<string, unknown>>> {
  const { data, error } = await db.schema('core').rpc('reject_route_revision', { p_revision_id: revisionId, p_reason: reason })
  if (error) {
    console.error('[route-revisions] reject refused:', error.code)
    return fail(error.code)
  }
  return { ok: true, data: ((Array.isArray(data) ? data[0] : data) ?? {}) as Record<string, unknown> }
}

export interface PromotionOutcome {
  attraction_id: string
  created: boolean
  photo: 'copied' | 'none' | 'failed'
}

/**
 * BR-ROTA-009: an annotation of a pending or approved version becomes a POI, `approved = false`, with
 * the author's corrected text and the author credit (the database's). The chosen photo is copied from
 * the private diary bucket to the public POI bucket and set as the POI image when it has none.
 */
export async function promoteAnnotation(
  db: Db,
  revisionId: string,
  input: PromotionInput,
  publicStore: Db = getSupabaseService(),
): Promise<Result<PromotionOutcome>> {
  const rev = await readRevision(db, revisionId)
  if (!rev.ok) return rev
  if (!rev.data) return fail('TGW08')
  const stop = rev.data.stops.find((s) => s.kind === 'annotation' && s.ref === input.annotationId)
  if (!stop) return fail('TGW17')
  if (!canPromote(stop)) return { ok: false, status: 400, error: 'cannot_promote' }
  if (input.photoKey && !stop.photo_keys.includes(input.photoKey)) return { ok: false, status: 400, error: 'photo_not_of_stop' }

  const { data, error } = await db.schema('core').rpc('promote_annotation_to_poi', {
    p_revision_id: revisionId,
    p_annotation_id: input.annotationId,
    p_name: input.name,
    p_description: input.description,
    p_city: input.city,
    p_country: input.country,
    p_state: input.state,
    p_category: null,
  })
  if (error) {
    console.error('[route-revisions] promote refused:', error.code)
    return fail(error.code)
  }
  const row = (Array.isArray(data) ? data[0] : data) as { attraction_id?: string; created?: boolean } | null
  if (!row?.attraction_id) return fail(undefined)
  const outcome: PromotionOutcome = { attraction_id: row.attraction_id, created: row.created === true, photo: 'none' }
  if (!input.photoKey) return { ok: true, data: outcome }

  outcome.photo = 'failed'
  const target = promotedPhotoPath(row.attraction_id, input.photoKey)
  if (!target) return { ok: true, data: outcome }
  const file = await db.storage.from(DIARY_PHOTO_BUCKET).download(input.photoKey)
  if (file.error || !file.data) {
    console.error('[route-revisions] photo download failed:', row.attraction_id)
    return { ok: true, data: outcome }
  }
  const up = await publicStore.storage.from(POI_IMAGE_BUCKET).upload(target, file.data, { upsert: true, contentType: photoContentType(target) })
  if (up.error) {
    console.error('[route-revisions] photo publish failed:', row.attraction_id)
    return { ok: true, data: outcome }
  }
  const publicUrl = publicStore.storage.from(POI_IMAGE_BUCKET).getPublicUrl(target).data.publicUrl
  // Only when the POI has no image yet: a repeated promotion never overwrites a curator's later choice.
  const { error: setError } = await db
    .schema('core').from('attractions').update({ image_url: publicUrl }).eq('id', row.attraction_id).is('image_url', null)
  if (setError) {
    console.error('[route-revisions] image set refused:', setError.code)
    return { ok: true, data: outcome }
  }
  outcome.photo = 'copied'
  return { ok: true, data: outcome }
}

/** The photo verdicts of `moderate-route-photos` for one version, with the curator's session. */
export async function checkRevisionPhotos(revisionId: string, accessToken: string): Promise<{ status: number; body: unknown }> {
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/moderate-route-photos`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ revisionId }),
    })
    const body = await res.json().catch(() => ({}))
    return { status: res.status, body }
  } catch {
    return { status: 502, body: { error: 'photo_check_unavailable' } }
  }
}
