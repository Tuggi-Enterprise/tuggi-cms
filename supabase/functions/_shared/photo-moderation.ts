/**
 * Automatic screening of the photos of a user route version (#1106, BR-ROTA-006 item 3), behind
 * the Edge Function `moderate-route-photos`.
 *
 * Apple 1.2 asks for a filter AND the human review: the filter here only SIGNALS. A flagged photo is
 * shown marked to the curator in the CMS queue and blocks nothing by itself; approving and refusing
 * stay with the person (`core.approve_route_revision`, `core.reject_route_revision`).
 *
 * Provider: OpenAI Moderation, model `omni-moderation-latest`, free. Checked on 2026-11-06 in the
 * official guide (developers.openai.com/api/docs/guides/moderation): `input` is an array of
 * `{ type: 'image_url', image_url: { url } }`, the URL may be a web address or a data URL, images up
 * to 20 MB, and the answer is `results[]` with `flagged`, `categories` (booleans per category),
 * `category_scores` and `category_applied_input_types`. The guide shows one image per request and
 * says nothing of more, so this module sends ONE photo per request.
 *
 * The photo travels as a signed URL of the private bucket `travel-diary-photos`, valid for
 * `PHOTO_SIGNED_URL_TTL_S` seconds: long enough for the provider to fetch it, never a public link.
 * Nothing of the photo, its key (which carries the author id) or the answer goes to the log.
 *
 * Deno module with no imports, so `tests/api` loads it through a path built at run time.
 */

export const PHOTO_MODERATION_MODEL = 'omni-moderation-latest'
export const OPENAI_MODERATIONS_URL = 'https://api.openai.com/v1/moderations'
export const DIARY_PHOTO_BUCKET = 'travel-diary-photos'
/** Seconds the provider has to fetch the photo. */
export const PHOTO_SIGNED_URL_TTL_S = 120
/** Photos screened in one call; the rest come back `unchecked`, and the curator still sees them. */
export const PHOTO_MODERATION_MAX = 100
/** Photos screened at the same time. */
export const PHOTO_MODERATION_CONCURRENCY = 4
/** Seconds one provider call may take before the photo is left `unchecked`. */
export const PHOTO_MODERATION_TIMEOUT_S = 20

/** Formats the provider reads (the guide's image inputs). A HEIC photo is left `unchecked`. */
const SUPPORTED_EXTENSION = /\.(jpe?g|png|webp|gif)$/i

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type PhotoStatus = 'clean' | 'flagged' | 'unchecked'

export interface PhotoVerdict {
  key: string
  status: PhotoStatus
  /** The provider categories that came back true, e.g. `sexual`, `violence/graphic`. */
  categories: string[]
}

export interface Classification {
  flagged: boolean
  categories: string[]
}

/** Every photo key a version uses: the stops' photos and the cover, once each, in order. */
export function revisionPhotoKeys(revision: { stops?: unknown; cover_photo_key?: unknown }): string[] {
  const keys: string[] = []
  const add = (k: unknown) => {
    if (typeof k === 'string' && k && !keys.includes(k)) keys.push(k)
  }
  if (Array.isArray(revision.stops)) {
    for (const stop of revision.stops as Array<{ photo_keys?: unknown }>) {
      if (stop && Array.isArray(stop.photo_keys)) for (const k of stop.photo_keys) add(k)
    }
  }
  add(revision.cover_photo_key)
  return keys
}

export function buildModerationBody(url: string): { model: string; input: Array<{ type: 'image_url'; image_url: { url: string } }> } {
  return { model: PHOTO_MODERATION_MODEL, input: [{ type: 'image_url', image_url: { url } }] }
}

/** Reads the provider answer. Out of shape throws: the photo is left `unchecked`, never `clean`. */
export function parseModerationResponse(json: unknown): Classification {
  const result = (json as { results?: unknown })?.results
  const first = Array.isArray(result) ? (result[0] as { flagged?: unknown; categories?: unknown }) : null
  if (!first || typeof first.flagged !== 'boolean') throw new Error('moderation: no result in the answer')
  const categories = first.categories && typeof first.categories === 'object'
    ? Object.entries(first.categories as Record<string, unknown>).filter(([, on]) => on === true).map(([name]) => name).sort()
    : []
  return { flagged: first.flagged, categories: first.flagged ? categories : [] }
}

export interface PhotoModerationDeps {
  /** A signed URL of the private bucket, or `null` when it could not be signed. */
  sign: (key: string) => Promise<string | null>
  /** One provider call. Throws on any failure. */
  classify: (url: string) => Promise<Classification>
}

/** Screens each photo. A failure of one leaves that one `unchecked` and the others go on. */
export async function moderatePhotos(keys: string[], deps: PhotoModerationDeps): Promise<PhotoVerdict[]> {
  const out: PhotoVerdict[] = keys.map((key) => ({ key, status: 'unchecked', categories: [] }))
  const checkable = out.slice(0, PHOTO_MODERATION_MAX).filter((v) => SUPPORTED_EXTENSION.test(v.key))
  const one = async (verdict: PhotoVerdict) => {
    try {
      const url = await deps.sign(verdict.key)
      if (!url) return
      const c = await deps.classify(url)
      verdict.status = c.flagged ? 'flagged' : 'clean'
      verdict.categories = c.categories
    } catch {
      // stays unchecked: the curator sees the photo without a verdict
    }
  }
  for (let i = 0; i < checkable.length; i += PHOTO_MODERATION_CONCURRENCY) {
    await Promise.all(checkable.slice(i, i + PHOTO_MODERATION_CONCURRENCY).map(one))
  }
  return out
}

export interface PhotoModerationRequestDeps extends PhotoModerationDeps {
  /** `core.custom_route_revisions` by id (service role), or `null` when there is none. Throws on a read error. */
  readRevision: (revisionId: string) => Promise<{ stops?: unknown; cover_photo_key?: unknown } | null>
  hasApiKey: boolean
}

/** The whole request after the admin gate, as status + body, so the test runs it without Deno. */
export async function handlePhotoModeration(
  body: unknown,
  deps: PhotoModerationRequestDeps,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const revisionId = (body as { revisionId?: unknown } | null)?.revisionId
  if (typeof revisionId !== 'string' || !UUID_RE.test(revisionId)) {
    return { status: 400, body: { error: 'invalid_revision_id' } }
  }
  if (!deps.hasApiKey) return { status: 503, body: { error: 'moderation_not_configured' } }
  let revision: { stops?: unknown; cover_photo_key?: unknown } | null
  try {
    revision = await deps.readRevision(revisionId)
  } catch {
    return { status: 503, body: { error: 'revision_unavailable' } }
  }
  if (!revision) return { status: 404, body: { error: 'revision_not_found' } }
  const photos = await moderatePhotos(revisionPhotoKeys(revision), deps)
  return { status: 200, body: { model: PHOTO_MODERATION_MODEL, photos } }
}
