/**
 * The screening an uploaded photo goes through before any Edge Function registers it (BR-ROTA-008
 * item 4, BR-USUARIO-052 item 2.e.ii). One path for every photo the app uploads and a server
 * registers: the diary photo (`register-diary-photo`, #1116) and the profile photo
 * (`register-profile-photo`, #1130). Each handler parses its own body and calls its own RPC; the
 * screening between the two is this module, and the rule it applies is `SAFE_SEARCH_FLAG_AT` in
 * `photo-moderation.ts`.
 *
 * In order: a key the provider reads, the provider key present, the clock read BEFORE the object is
 * read (it goes to the RPC as `p_screened_at`, and the database refuses an object written after it),
 * the object read with the service role, its size and JPEG signature, one SafeSearch call, and, for
 * an improper photo, the delete of the object. FAIL CLOSED: the provider or the bucket failing ends
 * in 503 with nothing written or deleted. A refusal is answered only once the object is gone.
 *
 * Deno module whose only import is a sibling `.ts`, so `tests/api` loads it through a path built at
 * run time.
 */

import {
  type Classification,
  hasJpegSignature,
  isSupportedPhotoKey,
  PHOTO_MODERATION_MAX_BYTES,
} from './photo-moderation.ts'

/** The code of an object that is not in the bucket, the same the RPCs give for it. */
export const PHOTO_NOT_UPLOADED_CODE = 'TGW16'

/** What reading the object gave. Any other failure throws. */
export type PhotoRead = { kind: 'found'; bytes: Uint8Array } | { kind: 'missing' }

export interface PhotoScreeningDeps {
  hasApiKey: boolean
  /** The clock of the function, read once right before the object is read. */
  now: () => Date
  readPhoto: (key: string) => Promise<PhotoRead>
  /** One provider call. Throws on any failure (HTTP status, timeout, answer out of shape). */
  classify: (bytes: Uint8Array) => Promise<Classification>
  /** Storage API delete of one object. `true` only when it is gone. */
  removePhoto: (key: string) => Promise<boolean>
}

/** Why the answer is what it is; the only thing a handler logs besides the status. */
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

export const answer = (
  status: number,
  body: Record<string, unknown>,
  outcome: RegistrationOutcome,
): RegistrationAnswer => ({ status, body, outcome })

const UNAVAILABLE = { error: 'moderation_unavailable' }

/** A clean photo and the time it was screened at, or the answer that ends the request. */
export type ScreeningResult = { clean: true; screenedAt: string } | { clean: false; answer: RegistrationAnswer }

export async function screenUploadedPhoto(key: string, deps: PhotoScreeningDeps): Promise<ScreeningResult> {
  const stop = (status: number, body: Record<string, unknown>, outcome: RegistrationOutcome): ScreeningResult => ({
    clean: false,
    answer: answer(status, body, outcome),
  })
  if (!isSupportedPhotoKey(key)) return stop(422, { error: 'photo_unsupported' }, 'unsupported')
  if (!deps.hasApiKey) return stop(503, UNAVAILABLE, 'no_key')

  // Taken before the read, so any write after it is newer than what was screened. No margin for
  // clock skew between the function and the database: subtract 0; a margin would only go backwards.
  const screenedAt = deps.now().toISOString()
  let read: PhotoRead
  try {
    read = await deps.readPhoto(key)
  } catch {
    return stop(503, { error: 'storage_unavailable' }, 'read')
  }
  if (read.kind === 'missing') {
    return stop(409, { error: 'rpc_refused', code: PHOTO_NOT_UPLOADED_CODE }, 'not_uploaded')
  }
  const bytes = read.bytes
  if (bytes.length > PHOTO_MODERATION_MAX_BYTES || !hasJpegSignature(bytes)) {
    return stop(422, { error: 'photo_unsupported' }, 'unsupported')
  }

  let verdict: Classification
  try {
    verdict = await deps.classify(bytes)
  } catch {
    return stop(503, UNAVAILABLE, 'provider')
  }

  if (verdict.flagged) {
    // The refusal is final only once the object is gone; a failed delete is tried again.
    let removed = false
    try {
      removed = await deps.removePhoto(key)
    } catch {
      removed = false
    }
    if (!removed) return stop(503, { error: 'storage_unavailable' }, 'remove')
    return stop(422, { error: 'photo_refused', categories: verdict.categories }, 'refused')
  }
  return { clean: true, screenedAt }
}

/** storage-js answers a missing object with 404, or with 400 and `statusCode: '404'` in older servers. */
export function isNotFound(error: unknown): boolean {
  const e = error as { status?: unknown; statusCode?: unknown; message?: unknown }
  return (
    String(e?.status ?? '') === '404' ||
    String(e?.statusCode ?? '') === '404' ||
    (typeof e?.message === 'string' && /not.?found/i.test(e.message))
  )
}
