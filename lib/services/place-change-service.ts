/**
 * The CMS side of the portal's photo and text changes (#922, BR-B2B-061 item 2; contract
 * `docs/contracts/portal-fotos-e-texto.md` §5). Service role only, behind `withAuth` in the routes:
 * `partner.place_change_queue()` and `partner.decide_place_change(...)` are granted to nobody else.
 *
 * ORDER IS THE CONTRACT, AND EVERY STEP IS RETRY-SAFE:
 *  · photo: download the private file → upload to `travel-app-images/partners/<attraction>/<request>.<ext>`
 *    (upsert, the path is the proposal's own) → decide with the OBJECT PATH, never a URL: the database
 *    checks the object exists and builds the URL on the project host;
 *  · text: decide (the database rewrites the base row and deletes the translations in one
 *    transaction) → remove the voiced mp3s of this place. Deciding again answers `unchanged`, so a
 *    failed cleanup is retried by approving again.
 * Then the app's read model is rebuilt for the place, best effort (the cron is the fallback).
 * Nothing from a row goes to the log: ids and codes only.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseService } from '@/lib/core/supabase-client'
import {
  AUDIO_BUCKET,
  PROPOSAL_BUCKET,
  PUBLIC_IMAGE_BUCKET,
  decisionError,
  imageContentType,
  publishedObjectPath,
  toPlaceChanges,
  voicedAudioPaths,
  type DecisionBody,
  type DecisionError,
  type PlaceChange,
} from '@/lib/partnerships/place-changes'

const SIGNED_URL_TTL_S = 3600

type Result<T> = { ok: true; data: T } | { ok: false; status: number; error: DecisionError | 'audio_cleanup_failed' }

const fail = (status: number, error: DecisionError | 'audio_cleanup_failed'): { ok: false; status: number; error: DecisionError | 'audio_cleanup_failed' } => ({ ok: false, status, error })

/** The pending changes, oldest first, with the proposed photo signed for the preview. */
export async function listPlaceChanges(db: SupabaseClient = getSupabaseService()): Promise<Result<PlaceChange[]>> {
  const { data, error } = await db.schema('partner').rpc('place_change_queue')
  if (error) {
    console.error('[place-changes] queue refused:', error.code)
    const e = decisionError(error.code, error.details ?? undefined)
    return fail(e.status, e.error)
  }
  const changes = toPlaceChanges(data)
  const paths = changes.map((c) => c.photoPath).filter((p): p is string => !!p)
  if (paths.length) {
    const signed = await db.storage.from(PROPOSAL_BUCKET).createSignedUrls(paths, SIGNED_URL_TTL_S)
    if (signed.error) console.error('[place-changes] sign failed')
    const urls = new Map<string, string>()
    for (const s of signed.data ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl)
    for (const c of changes) c.photoUrl = c.photoPath ? (urls.get(c.photoPath) ?? null) : null
  }
  return { ok: true, data: changes }
}

type RequestRow = { id: string; attraction_id: string; kind: 'photo' | 'text'; photo_path: string | null }

/** Copies the proposal to the public bucket; the object path, or `null` when the copy failed. */
async function publishPhoto(db: SupabaseClient, r: RequestRow): Promise<string | null> {
  const target = r.photo_path ? publishedObjectPath(r.attraction_id, r.id, r.photo_path) : null
  if (!target || !r.photo_path) return null
  const file = await db.storage.from(PROPOSAL_BUCKET).download(r.photo_path)
  if (file.error || !file.data) {
    console.error('[place-changes] download failed:', r.id)
    return null
  }
  const up = await db.storage.from(PUBLIC_IMAGE_BUCKET).upload(target, file.data, { upsert: true, contentType: imageContentType(target) })
  if (up.error) {
    console.error('[place-changes] publish failed:', r.id)
    return null
  }
  return target
}

/** The voiced files of the place, by exact path (twin of the Deno `removeVoicedCopies`). */
export async function removeVoicedAudio(db: SupabaseClient, attractionId: string): Promise<boolean> {
  const folder = `master_audio/${attractionId}`
  const listed = await db.storage.from(AUDIO_BUCKET).list(folder, { limit: 100 })
  if (listed.error) return false
  const paths = voicedAudioPaths(attractionId, (listed.data ?? []).map((f: { name: string }) => f.name))
  if (paths.length === 0) return true
  const removed = await db.storage.from(AUDIO_BUCKET).remove(paths)
  return !removed.error
}

/** `core.app_poi_read_build` for the place — best effort, never throws (the cron is the fallback). */
async function rebuildReadModel(db: SupabaseClient, attractionId: string): Promise<void> {
  try {
    const { error } = await db.schema('core').rpc('app_poi_read_build', { p_ids: [attractionId] })
    if (error) console.warn('[place-changes] read model rebuild failed:', error.code)
  } catch {
    console.warn('[place-changes] read model rebuild threw')
  }
}

/** Approve or refuse one change. `cmsUserId` is `core.cms_users.id` of who decided. */
export async function decidePlaceChange(
  requestId: string,
  body: DecisionBody,
  cmsUserId: string,
  db: SupabaseClient = getSupabaseService()
): Promise<Result<{ outcome: string }>> {
  const read = await db
    .schema('partner')
    .from('place_change_requests')
    .select('id, attraction_id, kind, photo_path')
    .eq('id', requestId)
    .maybeSingle()
  if (read.error) {
    console.error('[place-changes] read refused:', read.error.code)
    const e = decisionError(read.error.code, undefined)
    return fail(e.status, e.error)
  }
  const r = read.data as RequestRow | null
  if (!r) return fail(404, 'not_found')

  let objectPath: string | null = null
  if (body.decision === 'approved' && r.kind === 'photo') {
    objectPath = await publishPhoto(db, r)
    if (!objectPath) return fail(502, 'publish_failed')
  }

  const { data, error } = await db.schema('partner').rpc('decide_place_change', {
    p_request_id: r.id,
    p_decision: body.decision,
    p_decided_by: cmsUserId,
    p_note: body.decision === 'rejected' ? body.note : null,
    p_object_path: objectPath,
  })
  if (error) {
    console.error('[place-changes] decision refused:', r.id, error.code, error.details)
    const e = decisionError(error.code, error.details ?? undefined)
    return fail(e.status, e.error)
  }
  const outcome = Array.isArray(data) && data[0] && typeof data[0].outcome === 'string' ? data[0].outcome : 'unknown'
  if (body.decision === 'rejected') return { ok: true, data: { outcome } }

  if (r.kind === 'text' && !(await removeVoicedAudio(db, r.attraction_id))) {
    console.error('[place-changes] audio cleanup failed:', r.id)
    return fail(502, 'audio_cleanup_failed')
  }
  await rebuildReadModel(db, r.attraction_id)
  return { ok: true, data: { outcome } }
}
