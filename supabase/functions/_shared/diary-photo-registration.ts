/**
 * Registration of one diary photo behind the Edge Function `register-diary-photo` (#1116,
 * BR-ROTA-008 item 4): an improper photo is refused at upload, before its row exists.
 *
 * The app uploads the object to the private bucket first, then calls here instead of the RPC. This
 * module reads the object with the service role, screens it with the rule of
 * `_shared/photo-moderation.ts` (`SAFE_SEARCH_FLAG_AT`, one owner) and only then calls
 * `drive.add_annotation_photo_as`, which only the service role may execute. Answers:
 *
 * - 200 `{ photoId, created }`: clean, and the row exists.
 * - 400 `{ error: 'invalid_body' }`: ids, time or key out of shape, or a key outside the caller's
 *   folder.
 * - 401 `{ error: 'unauthorized' }`: no user behind the token.
 * - 409 `{ error: 'rpc_refused', code }`: the SQLSTATE of the RPC (TGW16, TGW19), and TGW16 for an
 *   object that is not in the bucket, the code the app already reads as "upload again". The RPC
 *   also gives TGW16 when the object was written after `screenedAt`: bytes nobody screened.
 * - 422 `{ error: 'photo_refused', categories }`: improper. The object is deleted and no row is
 *   written. Answered only after the delete worked.
 * - 422 `{ error: 'photo_unsupported' }`: not a format the provider reads, or past
 *   `PHOTO_MODERATION_MAX_BYTES`. For good; nothing is written or deleted.
 * - 503: the provider, the bucket or the RPC failed. FAIL CLOSED: nothing is registered, nothing
 *   is deleted, and the app tries again on its next sync.
 *
 * Deno module whose only import is a sibling `.ts`, so `tests/api` loads it through a path built
 * at run time.
 */

import {
  type Classification,
  hasJpegSignature,
  isSupportedPhotoKey,
  PHOTO_MODERATION_MAX_BYTES,
} from './photo-moderation.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** ISO 8601 with date, time and zone, the shape `Date.toISOString` and Postgres both write. */
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})$/
const STORAGE_KEY_MAX = 512

/** SQLSTATEs of `drive.add_annotation_photo_as` the app acts on (contract `diario-de-bordo.md`). */
export const REFUSED_RPC_CODES: ReadonlySet<string> = new Set(['TGW16', 'TGW19'])
/** The code of an object that is not in the bucket, the same the RPC gives for it. */
export const PHOTO_NOT_UPLOADED_CODE = 'TGW16'

export interface DiaryPhotoRegistration {
  photoId: string
  annotationId: string
  storageKey: string
  takenAt: string
}

/** What reading the object gave. Any other failure throws. */
export type PhotoRead = { kind: 'found'; bytes: Uint8Array } | { kind: 'missing' }

export type RegisterResult =
  | { ok: true; photoId: string; created: boolean }
  | { ok: false; code: string | null }

export interface DiaryPhotoRegistrationDeps {
  hasApiKey: boolean
  /** The clock of the function, read once right before the object is read. */
  now: () => Date
  readPhoto: (key: string) => Promise<PhotoRead>
  /** One provider call. Throws on any failure (HTTP status, timeout, answer out of shape). */
  classify: (bytes: Uint8Array) => Promise<Classification>
  /** Storage API delete of one object. `true` only when it is gone. */
  removePhoto: (key: string) => Promise<boolean>
  /**
   * `drive.add_annotation_photo_as` with the user id of the token. `screenedAt` goes as
   * `p_screened_at`: the database refuses with TGW16 an object created or updated after it.
   */
  register: (userId: string, photo: DiaryPhotoRegistration, screenedAt: string) => Promise<RegisterResult>
}

/** Why the answer is what it is; the only thing the handler logs besides the status. */
export type RegistrationOutcome =
  | 'registered'
  | 'invalid_body'
  | 'unauthorized'
  | 'not_uploaded'
  | 'unsupported'
  | 'refused'
  | 'provider'
  | 'no_key'
  | 'read'
  | 'remove'
  | 'rpc_refused'
  | 'rpc'

export interface RegistrationAnswer {
  status: number
  body: Record<string, unknown>
  outcome: RegistrationOutcome
}

function isIsoTime(value: unknown): value is string {
  return typeof value === 'string' && ISO_RE.test(value) && !Number.isNaN(Date.parse(value))
}

/** The body as the contract fixes it, or `null`. The key must live in the caller's folder. */
export function parseRegistrationBody(body: unknown, userId: string): DiaryPhotoRegistration | null {
  const b = body as Record<string, unknown> | null
  if (!b || typeof b !== 'object') return null
  const { photoId, annotationId, storageKey, takenAt } = b
  if (typeof photoId !== 'string' || !UUID_RE.test(photoId)) return null
  if (typeof annotationId !== 'string' || !UUID_RE.test(annotationId)) return null
  if (!isIsoTime(takenAt)) return null
  if (typeof storageKey !== 'string' || storageKey.length > STORAGE_KEY_MAX) return null
  const rest = storageKey.slice(userId.length + 1)
  if (!storageKey.startsWith(`${userId}/`) || !rest) return null
  if (rest.includes('..') || rest.includes('\\') || rest.startsWith('/') || rest.includes('//')) return null
  return { photoId, annotationId, storageKey, takenAt }
}

const answer = (status: number, body: Record<string, unknown>, outcome: RegistrationOutcome): RegistrationAnswer => ({
  status,
  body,
  outcome,
})

const UNAVAILABLE = { error: 'moderation_unavailable' }

/** The whole request after the token was read, so the test runs it without Deno. */
export async function handleDiaryPhotoRegistration(
  body: unknown,
  userId: string | null,
  deps: DiaryPhotoRegistrationDeps,
): Promise<RegistrationAnswer> {
  if (!userId || !UUID_RE.test(userId)) return answer(401, { error: 'unauthorized' }, 'unauthorized')
  const photo = parseRegistrationBody(body, userId)
  if (!photo) return answer(400, { error: 'invalid_body' }, 'invalid_body')
  if (!isSupportedPhotoKey(photo.storageKey)) return answer(422, { error: 'photo_unsupported' }, 'unsupported')
  if (!deps.hasApiKey) return answer(503, UNAVAILABLE, 'no_key')

  // Taken before the read, so any write after it is newer than what was screened. No margin for
  // clock skew between the function and the database: subtract 0; a margin would only go backwards.
  const screenedAt = deps.now().toISOString()
  let read: PhotoRead
  try {
    read = await deps.readPhoto(photo.storageKey)
  } catch {
    return answer(503, { error: 'storage_unavailable' }, 'read')
  }
  if (read.kind === 'missing') {
    return answer(409, { error: 'rpc_refused', code: PHOTO_NOT_UPLOADED_CODE }, 'not_uploaded')
  }
  const bytes = read.bytes
  if (bytes.length > PHOTO_MODERATION_MAX_BYTES || !hasJpegSignature(bytes)) {
    return answer(422, { error: 'photo_unsupported' }, 'unsupported')
  }

  let verdict: Classification
  try {
    verdict = await deps.classify(bytes)
  } catch {
    return answer(503, UNAVAILABLE, 'provider')
  }

  if (verdict.flagged) {
    // The refusal is final only once the object is gone; a failed delete is tried again.
    let removed = false
    try {
      removed = await deps.removePhoto(photo.storageKey)
    } catch {
      removed = false
    }
    if (!removed) return answer(503, { error: 'storage_unavailable' }, 'remove')
    return answer(422, { error: 'photo_refused', categories: verdict.categories }, 'refused')
  }

  let result: RegisterResult
  try {
    result = await deps.register(userId, photo, screenedAt)
  } catch {
    return answer(503, { error: 'register_unavailable' }, 'rpc')
  }
  if (!result.ok) {
    if (result.code && REFUSED_RPC_CODES.has(result.code)) {
      return answer(409, { error: 'rpc_refused', code: result.code }, 'rpc_refused')
    }
    return answer(503, { error: 'register_unavailable' }, 'rpc')
  }
  return answer(200, { photoId: result.photoId, created: result.created }, 'registered')
}
