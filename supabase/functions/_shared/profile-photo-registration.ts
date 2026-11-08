/**
 * Registration of the profile photo behind the Edge Function `register-profile-photo` (#1130,
 * BR-USUARIO-052 item 2.e, BR-USUARIO-050 item 3): the photo the account shows is set only here,
 * after the screening of `photo-screening.ts` (the rule of BR-ROTA-008 item 4, `SAFE_SEARCH_FLAG_AT`).
 *
 * The app uploads `<user_id>/<uuid>.jpg` to the private bucket `profile-photos`, then calls here with
 * `{ storageKey }`. The user id comes from the token, never from the body. Only a clean photo reaches
 * `drive.set_profile_photo_as`, which only the service role may execute. Answers (contract
 * `docs/contracts/foto-de-perfil.md`):
 *
 * - 200 `{ photoKey }`: clean, and the profile shows it. The same key again answers the same.
 * - 400 `{ error: 'invalid_body' }`: a key out of shape or outside the caller's folder.
 * - 401 `{ error: 'unauthorized' }`: no user behind the token.
 * - 409 `{ error: 'rpc_refused', code }`: TGW16 (object not uploaded, or written after the
 *   screening: the app uploads again under a new uuid), TGW19 (no profile), TGU37 (guest).
 * - 422 `{ error: 'photo_refused', categories }`: improper. The object is deleted, nothing is
 *   written, and the previous photo stays.
 * - 422 `{ error: 'photo_unsupported' }`: not a JPEG, or past `PHOTO_MODERATION_MAX_BYTES`.
 * - 503: the provider, the bucket or the RPC failed. FAIL CLOSED: nothing is written or deleted.
 *
 * Deno module whose only import is a sibling `.ts`, so `tests/api` loads it through a path built
 * at run time.
 */

import {
  answer,
  type PhotoScreeningDeps,
  type RegistrationAnswer,
  screenUploadedPhoto,
} from './photo-screening.ts'

export const PROFILE_PHOTO_BUCKET = 'profile-photos'

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const UUID_RE = new RegExp(`^${UUID}$`, 'i')
/** The shape `drive.set_profile_photo_as` and the bucket policy accept: `<uuid>.jpg` in the folder. */
const PHOTO_FILE_RE = new RegExp(`^${UUID}\\.jpg$`, 'i')

/** SQLSTATEs of `drive.set_profile_photo_as` the app acts on. Any other is a 503. */
export const REFUSED_PROFILE_RPC_CODES: ReadonlySet<string> = new Set(['TGW16', 'TGW19', 'TGU37'])

export type ProfileRegisterResult = { ok: true; photoKey: string } | { ok: false; code: string | null }

export interface ProfilePhotoRegistrationDeps extends PhotoScreeningDeps {
  /** `drive.set_profile_photo_as(p_user_id, p_key, p_screened_at)` with the user id of the token. */
  register: (userId: string, key: string, screenedAt: string) => Promise<ProfileRegisterResult>
}

/** The key as the contract fixes it, in the caller's own folder, or `null`. */
export function parseProfilePhotoBody(body: unknown, userId: string): string | null {
  const b = body as Record<string, unknown> | null
  if (!b || typeof b !== 'object') return null
  const key = b.storageKey
  if (typeof key !== 'string') return null
  const slash = key.indexOf('/')
  if (slash < 0 || key.slice(0, slash) !== userId) return null
  return PHOTO_FILE_RE.test(key.slice(slash + 1)) ? key : null
}

/** The whole request after the token was read, so the test runs it without Deno. */
export async function handleProfilePhotoRegistration(
  body: unknown,
  userId: string | null,
  deps: ProfilePhotoRegistrationDeps,
): Promise<RegistrationAnswer> {
  if (!userId || !UUID_RE.test(userId)) return answer(401, { error: 'unauthorized' }, 'unauthorized')
  const key = parseProfilePhotoBody(body, userId)
  if (!key) return answer(400, { error: 'invalid_body' }, 'invalid_body')

  const screening = await screenUploadedPhoto(key, deps)
  if (!screening.clean) return screening.answer

  let result: ProfileRegisterResult
  try {
    result = await deps.register(userId, key, screening.screenedAt)
  } catch {
    return answer(503, { error: 'register_unavailable' }, 'rpc')
  }
  if (!result.ok) {
    if (result.code && REFUSED_PROFILE_RPC_CODES.has(result.code)) {
      return answer(409, { error: 'rpc_refused', code: result.code }, 'rpc_refused')
    }
    return answer(503, { error: 'register_unavailable' }, 'rpc')
  }
  return answer(200, { photoKey: result.photoKey }, 'registered')
}
