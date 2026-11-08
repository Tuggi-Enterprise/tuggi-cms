/**
 * Automatic screening of the photos of a user route version (#1106, BR-ROTA-006 item 3), behind
 * the Edge Function `moderate-route-photos`.
 *
 * Apple 1.2 asks for a filter AND the human review: the filter here only SIGNALS. A flagged photo is
 * shown marked to the curator in the CMS queue and blocks nothing by itself; approving and refusing
 * stay with the person (`core.approve_route_revision`, `core.reject_route_revision`). Only a `clean`
 * cover may become the photo of the automatic POI (operator, 2026-11-08, #1114).
 *
 * Provider: Google Cloud Vision SafeSearch (operator, 2026-11-08, #1114: everything on Google).
 * Checked on 2026-11-08 in the official reference (docs.cloud.google.com/vision/docs):
 * `POST https://vision.googleapis.com/v1/images:annotate` with `requests[].image.content` (base64)
 * and `features: [{ type: 'SAFE_SEARCH_DETECTION' }]`; the answer is `responses[]` with
 * `safeSearchAnnotation` (`adult`, `spoof`, `medical`, `violence`, `racy`, each a Likelihood from
 * `VERY_UNLIKELY` to `VERY_LIKELY`, or `UNKNOWN`) or `error`. Files up to 20 MB and a 10 MB JSON
 * request. The key goes in the `x-goog-api-key` header, never in the URL (docs: authentication,
 * api-keys-use).
 *
 * The photo travels as its bytes read from the private bucket `travel-diary-photos` with the
 * service role. The reference says `image.source.imageUri` must be publicly accessible and that
 * Google cannot guarantee such a fetch, so a signed URL is not used. Nothing of the photo, its key
 * (which carries the author id) or the answer goes to the log.
 *
 * Deno module with no imports, so `tests/api` loads it through a path built at run time.
 */

export const PHOTO_MODERATION_PROVIDER = 'google-cloud-vision-safesearch'
export const SAFE_SEARCH_URL = 'https://vision.googleapis.com/v1/images:annotate'
export const DIARY_PHOTO_BUCKET = 'travel-diary-photos'
/** Photos screened in one call; the rest come back `unchecked`, and the curator still sees them. */
export const PHOTO_MODERATION_MAX = 100
/** Photos screened at the same time. */
export const PHOTO_MODERATION_CONCURRENCY = 4
/** Seconds one provider call may take before the photo is left `unchecked`. */
export const PHOTO_MODERATION_TIMEOUT_S = 20
/** Largest photo sent: base64 grows it by a third and the JSON request stops at 10 MB. */
export const PHOTO_MODERATION_MAX_BYTES = 7 * 1024 * 1024

/** Likelihood levels of the reference, weakest first. `UNKNOWN` is not a level: it never approves. */
export const LIKELIHOOD_LEVELS = ['VERY_UNLIKELY', 'UNLIKELY', 'POSSIBLE', 'LIKELY', 'VERY_LIKELY'] as const
export type Likelihood = (typeof LIKELIHOOD_LEVELS)[number]

/**
 * The rule, in one place: a photo is `flagged` when a category reaches its level. `medical` and
 * `spoof` are read by nobody (operator, 2026-11-08, #1114).
 */
export const SAFE_SEARCH_FLAG_AT: Readonly<Record<'adult' | 'violence' | 'racy', Likelihood>> = {
  adult: 'LIKELY',
  violence: 'LIKELY',
  racy: 'VERY_LIKELY',
}

/** Formats the provider reads that the app sends. A HEIC photo is left `unchecked`. */
const SUPPORTED_EXTENSION = /\.(jpe?g|png|webp|gif)$/i

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type PhotoStatus = 'clean' | 'flagged' | 'unchecked'

export interface PhotoVerdict {
  key: string
  status: PhotoStatus
  /** The SafeSearch categories that reached their level, e.g. `adult`, `violence`. */
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

function toBase64(bytes: Uint8Array): string {
  const native = (bytes as Uint8Array & { toBase64?: () => string }).toBase64
  if (typeof native === 'function') return native.call(bytes)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

export function buildSafeSearchBody(bytes: Uint8Array): {
  requests: Array<{ image: { content: string }; features: Array<{ type: 'SAFE_SEARCH_DETECTION' }> }>
} {
  return { requests: [{ image: { content: toBase64(bytes) }, features: [{ type: 'SAFE_SEARCH_DETECTION' }] }] }
}

/**
 * Reads the provider answer. An `error`, no `safeSearchAnnotation`, or a deciding category missing
 * or `UNKNOWN` throws: the photo is left `unchecked`, never `clean`.
 */
export function parseSafeSearchResponse(json: unknown): Classification {
  const responses = (json as { responses?: unknown })?.responses
  const first = Array.isArray(responses) ? (responses[0] as { error?: unknown; safeSearchAnnotation?: unknown }) : null
  if (!first || first.error) throw new Error('safesearch: error or no result in the answer')
  const annotation = first.safeSearchAnnotation as Record<string, unknown> | undefined
  if (!annotation || typeof annotation !== 'object') throw new Error('safesearch: no safeSearchAnnotation')
  const categories: string[] = []
  for (const [category, threshold] of Object.entries(SAFE_SEARCH_FLAG_AT)) {
    const level = LIKELIHOOD_LEVELS.indexOf(annotation[category] as Likelihood)
    if (level < 0) throw new Error(`safesearch: ${category} has no level`)
    if (level >= LIKELIHOOD_LEVELS.indexOf(threshold)) categories.push(category)
  }
  categories.sort()
  return { flagged: categories.length > 0, categories }
}

/** One SafeSearch call. Throws on any failure (HTTP status, timeout, answer out of shape). */
export async function classifyWithSafeSearch(
  bytes: Uint8Array,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Classification> {
  const res = await fetchImpl(SAFE_SEARCH_URL, {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(buildSafeSearchBody(bytes)),
    signal: AbortSignal.timeout(PHOTO_MODERATION_TIMEOUT_S * 1000),
  })
  if (!res.ok) {
    await res.body?.cancel()
    throw new Error(`safesearch http ${res.status}`)
  }
  return parseSafeSearchResponse(await res.json())
}

export interface PhotoModerationDeps {
  /** The photo bytes from the private bucket, or `null` when it could not be read. */
  readPhoto: (key: string) => Promise<Uint8Array | null>
  /** One provider call. Throws on any failure. */
  classify: (bytes: Uint8Array) => Promise<Classification>
}

/** Why a photo stayed `unchecked`; counts only, for the log. */
export type UncheckedReason = 'format' | 'over_max' | 'read' | 'size' | 'provider'

/**
 * Screens each photo. A failure of one leaves that one `unchecked` and the others go on; the
 * caller asks again later. `onUnchecked` gets the reason only, never the key.
 */
export async function moderatePhotos(
  keys: string[],
  deps: PhotoModerationDeps,
  onUnchecked: (reason: UncheckedReason, error?: unknown) => void = () => {},
): Promise<PhotoVerdict[]> {
  const out: PhotoVerdict[] = keys.map((key) => ({ key, status: 'unchecked', categories: [] }))
  const checkable: PhotoVerdict[] = []
  out.forEach((v, i) => {
    if (i >= PHOTO_MODERATION_MAX) onUnchecked('over_max')
    else if (!SUPPORTED_EXTENSION.test(v.key)) onUnchecked('format')
    else checkable.push(v)
  })
  const one = async (verdict: PhotoVerdict) => {
    let bytes: Uint8Array | null
    try {
      bytes = await deps.readPhoto(verdict.key)
    } catch {
      bytes = null
    }
    if (!bytes) return onUnchecked('read')
    if (bytes.length > PHOTO_MODERATION_MAX_BYTES) return onUnchecked('size')
    try {
      const c = await deps.classify(bytes)
      verdict.status = c.flagged ? 'flagged' : 'clean'
      verdict.categories = c.categories
    } catch (error) {
      onUnchecked('provider', error)
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
  onUnchecked?: (reason: UncheckedReason, error?: unknown) => void
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
  const photos = await moderatePhotos(revisionPhotoKeys(revision), deps, deps.onUnchecked)
  return { status: 200, body: { model: PHOTO_MODERATION_PROVIDER, photos } }
}
