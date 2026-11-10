/**
 * The tour guide's profile in the CMS (#936, #1185, BR-B2B-064 items 4.a, 9 and 11). Contract
 * `docs/contracts/parceiro-sem-local.md` §8.6.
 *
 * Since #1185 the guide's profile IS the account's profile (BR-B2B-064 item 4.a): the name, the
 * photo, the bio and the languages are read from `drive.profiles` of `partner.clients.owner_user_id`,
 * never from `partner.guide_profiles`, whose copies of them are out of use. The name is the one of
 * `drive.published_name` (BR-USUARIO-050 item 2.d): the account's name only while the guide
 * authorized it, else nothing, and the screen shows the @. The display row keeps the WhatsApp, the
 * authorization, `hidden`, the meeting point, the specialties and the curator's tick.
 *
 * READS with `service_role`: `partner.guide_profiles` has RLS on and no policy, and the photo lives
 * in the private bucket `profile-photos` (a signed URL). WRITES go through the `core.cms_*` RPCs
 * with the OPERATOR's session, so the gate (`core.is_caller_platform_admin()`) answers for the
 * person on the screen. The one write that needs `service_role` is the facade copy at publication:
 * the draft bucket is private and `profile-photos/<user_id>/` only admits the account's own uploads.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseService } from '@/lib/core/supabase-client'
import type { GuideProfileFacts } from '@/lib/partnerships/pipeline'
import { PLACE_SUBMISSION_PHOTOS_BUCKET } from '@/lib/services/place-submission-photos'

/** The account's photo bucket (contract `foto-de-perfil.md`): private, `<user_id>/<uuid>.jpg`. */
export const PROFILE_PHOTOS_BUCKET = 'profile-photos'
/** How long the record's signed photo URL lives. The tab refetches on every act. */
const PHOTO_URL_TTL_SECONDS = 600

/** BR-USUARIO-052 item 2.a: the bio of a partner's account is up to 400 (`drive.bio_max_length(true)`). */
export const GUIDE_BIO_MAX = 400
/** `core.cms_set_guide_hidden`: the reason is 1 to 500 characters. */
export const GUIDE_HIDE_REASON_MAX = 500
/** `core.cms_set_guide_meeting_point` (`partner.guide_meeting_point_of`): address 1 to 300, city 1 to 80. */
export const GUIDE_MEETING_POINT_ADDRESS_MAX = 300
export const GUIDE_MEETING_POINT_CITY_MAX = 80
/** The route's answer when listing is refused for want of a meeting point (TGP23, BR-B2B-064 item 11.a). */
export const GUIDE_MEETING_POINT_REQUIRED = 'meeting_point_required'
/** The route's answers when listing is refused for want of a photo or a bio (TGP23, BR-B2B-064 item 9.a, #1184). */
export const GUIDE_PHOTO_REQUIRED = 'photo_required'
export const GUIDE_BIO_REQUIRED = 'bio_required'
/** #1185: listing refused because the record has no account, or the display row no WhatsApp (TGP23). */
export const GUIDE_OWNER_REQUIRED = 'owner_required'
export const GUIDE_WHATSAPP_REQUIRED = 'whatsapp_required'
/** #1185 (BR-B2B-069, 3rd edge case): the login already owns another record, or the record has another owner (TGP10 owner). */
export const GUIDE_OWNER_CONFLICT = 'owner_conflict'

/** The closed reasons of the "Ocultar do app" dialog (spec #936 §5); `other` carries free text. */
export const GUIDE_HIDE_REASONS = ['tourist_report', 'inactive', 'guide_request', 'other'] as const
export type GuideHideReason = (typeof GUIDE_HIDE_REASONS)[number]

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

function partner() {
  return getSupabaseService().schema('partner')
}

function drive() {
  return getSupabaseService().schema('drive')
}

/** The one meeting point of a guide (BR-B2B-064 items 4 and 6), as `partner.guide_profiles` keeps it. */
export interface GuideMeetingPoint {
  address: string
  city: string
  lat: number
  lng: number
}

/**
 * The guide's profile as the record shows it. The account fields are `null` while the account has
 * none (the app guide fills them after the approval, BR-B2B-066 item 10.b) or while the record has
 * no owner at all (`hasAccount` false).
 */
export interface GuideProfile {
  clientId: string
  /** The record has an owner (`owner_user_id`) with a profile in the app. */
  hasAccount: boolean
  /** The account's @ (`drive.profiles.nickname`), how the CMS names a person of the app (BR-USUARIO-042). */
  handle: string | null
  /** `drive.published_name`: the account's name, only while the guide authorized showing it (BR-USUARIO-050 item 2.d). */
  shownName: string | null
  /** The account's bio (BR-USUARIO-052 item 2.a). */
  bio: string | null
  /** The account has a photo (`photo_key`), whether or not the signed URL came back. */
  hasPhoto: boolean
  /** A short-lived signed URL of the account's photo in `profile-photos`, or `null`. */
  photoUrl: string | null
  /** The account's languages (`drive.profiles.spoken_languages`, BR-USUARIO-043). */
  languages: string[]
  specialties: string[]
  whatsapp: string | null
  consent: boolean
  hidden: boolean
  hiddenReason: string | null
  /** `listed_in_app`, the curator's "Aparece no app" (BR-B2B-064 item 11.a). */
  listedInApp: boolean
  /** `null` until the guide or the curator sets it (guides published before 2026-11-10). */
  meetingPoint: GuideMeetingPoint | null
  updatedAt: string
}

/**
 * The meeting point as the CMS sends it, checked with the bounds of `partner.guide_meeting_point_of`
 * before the RPC. `null` = invalid. The coordinate is a number the map produced (click or drag);
 * a string is refused, so nothing typed becomes a coordinate.
 */
export function guideMeetingPointOf(value: unknown): GuideMeetingPoint | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  const address = typeof v.address === 'string' ? v.address.trim() : ''
  const city = typeof v.city === 'string' ? v.city.trim() : ''
  const { lat, lng } = v
  if (address.length < 1 || address.length > GUIDE_MEETING_POINT_ADDRESS_MAX) return null
  if (city.length < 1 || city.length > GUIDE_MEETING_POINT_CITY_MAX) return null
  if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) return null
  if (typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180) return null
  return { address, city, lat, lng }
}

/**
 * Where the draft facade goes on publication (contract §8.6, item 3): `<submission_id>/facade/<uuid>.<ext>`
 * → `<account_id>/<the same uuid>.jpg` in `profile-photos`, the key `core.cms_publish_guide_profile`
 * looks for. `null` when `profile_photo` is not the submission's own facade or the account id is
 * not a uuid — the path comes from `answers`, so it is checked before any Storage call.
 */
export function facadeProfilePhotoPaths(
  submissionId: string,
  accountId: string | null | undefined,
  profilePhoto: string | null | undefined
): { from: string; to: string } | null {
  const match = new RegExp(`^${submissionId}/facade/(${UUID})[.](?:jpg|jpeg|png|webp)$`).exec(profilePhoto ?? '')
  if (!match || !new RegExp(`^${UUID}$`).test(accountId ?? '')) return null
  return { from: match[0], to: `${accountId}/${match[1]}.jpg` }
}

/** The JPEG signature. The portal only stores JPEG (`places-portal-draft`, `photo_upload`), whatever the extension says. */
function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
}

export type FacadeCopyError = 'invalid_photo' | 'photo_not_jpeg' | 'photo_copy_failed'

/**
 * The facade of the proposal becomes the account's photo (BR-B2B-069 item 2.b, contract §8.6 item 3)
 * only where `core.cms_publish_guide_profile` wants it: an account without a photo and a guide not
 * yet published. Otherwise nothing is copied (`copied: false`), so no unused object lands in the
 * account's folder. The bytes must already be JPEG: the CMS does not convert, it refuses
 * (`photo_not_jpeg`). An object already there is a retry, not a failure.
 */
export async function copyFacadeToProfilePhoto(
  submissionId: string,
  clientId: string,
  accountId: string | null | undefined,
  profilePhoto: string | null | undefined
): Promise<{ ok: true; copied: boolean } | { ok: false; error: FacadeCopyError }> {
  if (accountId && new RegExp(`^${UUID}$`).test(accountId)) {
    const [account, row] = await Promise.all([
      drive().from('profiles').select('photo_key').eq('id', accountId).maybeSingle(),
      partner().from('guide_profiles').select('client_id').eq('client_id', clientId).maybeSingle(),
    ])
    if (account.error || row.error) {
      console.error('[guide-profile] photo need read failed', account.error?.code ?? row.error?.code)
      return { ok: false, error: 'photo_copy_failed' }
    }
    if ((account.data as { photo_key: string | null } | null)?.photo_key || row.data) return { ok: true, copied: false }
  }
  const paths = facadeProfilePhotoPaths(submissionId, accountId, profilePhoto)
  if (!paths) return { ok: false, error: 'invalid_photo' }
  const storage = getSupabaseService().storage
  const download = await storage.from(PLACE_SUBMISSION_PHOTOS_BUCKET).download(paths.from)
  if (download.error || !download.data) {
    console.error('[guide-profile] facade read failed', (download.error as { statusCode?: string } | null)?.statusCode ?? 'no_data')
    return { ok: false, error: 'photo_copy_failed' }
  }
  const bytes = new Uint8Array(await download.data.arrayBuffer())
  if (!isJpeg(bytes)) return { ok: false, error: 'photo_not_jpeg' }
  const { error } = await storage
    .from(PROFILE_PHOTOS_BUCKET)
    .upload(paths.to, bytes, { contentType: 'image/jpeg', upsert: false })
  if (error && !/exist|duplicate/i.test(error.message ?? '')) {
    console.error('[guide-profile] photo copy failed', (error as { statusCode?: string }).statusCode ?? 'unknown')
    return { ok: false, error: 'photo_copy_failed' }
  }
  return { ok: true, copied: true }
}

interface AccountRow {
  id: string
  nickname: string | null
  published_name: string | null
  bio: string | null
  photo_key: string | null
  spoken_languages: string[] | null
}

/** The owner of each client, and the owner's profile, by client. `null` = a read failed. */
async function loadOwnerAccounts(clientIds: string[]): Promise<Map<string, AccountRow | null> | null> {
  const owners = await partner().from('clients').select('id, owner_user_id').in('id', clientIds)
  if (owners.error || !owners.data) {
    console.error('[guide-profile] owner read failed', owners.error?.code ?? 'no_data')
    return null
  }
  const ownerOf = new Map<string, string>()
  for (const row of owners.data as { id: string; owner_user_id: string | null }[]) {
    if (row.owner_user_id) ownerOf.set(row.id, row.owner_user_id)
  }
  const accounts = new Map<string, AccountRow>()
  const userIds = [...new Set(ownerOf.values())]
  if (userIds.length > 0) {
    // `published_name` is the PostgREST computed field of `drive.published_name(drive.profiles)`.
    const profiles = await drive()
      .from('profiles')
      .select('id, nickname, published_name, bio, photo_key, spoken_languages')
      .in('id', userIds)
    if (profiles.error || !profiles.data) {
      console.error('[guide-profile] account read failed', profiles.error?.code ?? 'no_data')
      return null
    }
    for (const row of profiles.data as AccountRow[]) accounts.set(row.id, row)
  }
  const byClient = new Map<string, AccountRow | null>()
  for (const clientId of clientIds) {
    const owner = ownerOf.get(clientId)
    byClient.set(clientId, owner ? accounts.get(owner) ?? null : null)
  }
  return byClient
}

/** A text value, or `null` when absent or blank. */
function filled(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/** The account's half of `partner.guide_shown_in_app`: a photo and a bio. */
function accountComplete(account: AccountRow | null): boolean {
  return Boolean(account && account.photo_key && filled(account.bio))
}

/** The profile facts the queue derives its state from, by client. A failed read degrades to none. */
export async function loadGuideProfileFacts(clientIds: string[]): Promise<Map<string, GuideProfileFacts>> {
  const facts = new Map<string, GuideProfileFacts>()
  if (clientIds.length === 0) return facts
  const { data, error } = await partner()
    .from('guide_profiles')
    .select('client_id, hidden, public_contact_consent, listed_in_app, meeting_point_lat, whatsapp')
    .in('client_id', clientIds)
  if (error || !data) {
    console.error('[guide-profile] facts read failed', error?.code ?? 'no_data')
    return facts
  }
  const rows = data as {
    client_id: string
    hidden: boolean
    public_contact_consent: boolean
    listed_in_app: boolean
    meeting_point_lat: number | null
    whatsapp: string | null
  }[]
  const accounts = await loadOwnerAccounts(rows.map((row) => row.client_id))
  if (!accounts) return facts
  for (const row of rows) {
    facts.set(row.client_id, {
      hidden: row.hidden,
      consent: row.public_contact_consent,
      listedInApp: row.listed_in_app === true,
      hasMeetingPoint: row.meeting_point_lat !== null,
      complete: accountComplete(accounts.get(row.client_id) ?? null) && filled(row.whatsapp) !== null,
    })
  }
  return facts
}

export type GuideProfileRead = { ok: true; profile: GuideProfile | null } | { ok: false }

export async function loadGuideProfile(clientId: string): Promise<GuideProfileRead> {
  // The service cities are no longer read: since #1177 the meeting point replaces them, and the
  // record does not show them (spec #936 §9.2). The name, bio, photo and languages of the row are
  // out of use since #1185: the account's are read below.
  const profileRead = await partner()
    .from('guide_profiles')
    .select(
      'client_id, specialties, whatsapp, public_contact_consent, hidden, hidden_reason, updated_at, listed_in_app, meeting_point_address, meeting_point_city, meeting_point_lat, meeting_point_lng'
    )
    .eq('client_id', clientId)
    .maybeSingle()
  if (profileRead.error) {
    console.error('[guide-profile] read failed', profileRead.error.code)
    return { ok: false }
  }
  const row = profileRead.data as {
    client_id: string
    specialties: string[] | null
    whatsapp: string | null
    public_contact_consent: boolean
    hidden: boolean
    hidden_reason: string | null
    updated_at: string
    listed_in_app: boolean
    meeting_point_address: string | null
    meeting_point_city: string | null
    meeting_point_lat: number | null
    meeting_point_lng: number | null
  } | null
  if (!row) return { ok: true, profile: null }
  const accounts = await loadOwnerAccounts([clientId])
  if (!accounts) return { ok: false }
  const account = accounts.get(clientId) ?? null
  let photoUrl: string | null = null
  if (account?.photo_key) {
    const signed = await getSupabaseService().storage.from(PROFILE_PHOTOS_BUCKET).createSignedUrl(account.photo_key, PHOTO_URL_TTL_SECONDS)
    // A failed signature hides the picture, not the fact that the account has one (the tick reads `hasPhoto`).
    if (signed.error) console.error('[guide-profile] photo sign failed', (signed.error as { statusCode?: string }).statusCode ?? 'unknown')
    photoUrl = signed.data?.signedUrl ?? null
  }
  return {
    ok: true,
    profile: {
      clientId: row.client_id,
      hasAccount: account !== null,
      handle: filled(account?.nickname),
      shownName: filled(account?.published_name),
      bio: filled(account?.bio),
      hasPhoto: Boolean(account?.photo_key),
      photoUrl,
      languages: account?.spoken_languages ?? [],
      specialties: row.specialties ?? [],
      whatsapp: filled(row.whatsapp),
      consent: row.public_contact_consent,
      hidden: row.hidden,
      hiddenReason: row.hidden_reason,
      listedInApp: row.listed_in_app === true,
      // CHECK guide_profiles_meeting_point_ck: the four are all null or all filled.
      meetingPoint:
        row.meeting_point_address !== null && row.meeting_point_city !== null && row.meeting_point_lat !== null && row.meeting_point_lng !== null
          ? { address: row.meeting_point_address, city: row.meeting_point_city, lat: row.meeting_point_lat, lng: row.meeting_point_lng }
          : null,
      updatedAt: row.updated_at,
    },
  }
}

export type GuideWriteOutcome<T> = { ok: true; value: T } | { ok: false; httpStatus: number; error: string }

/** `core.cms_*` SQLSTATEs (contract §8.6) → the route's answer. */
export function guideRpcErrorOf(code: string | undefined, detail?: string | null): { httpStatus: number; error: string } {
  switch (code) {
    case '42501':
      return { httpStatus: 403, error: 'forbidden' }
    case 'TGP01':
      return { httpStatus: 404, error: 'not_found' }
    case 'TGP10':
      // #1185: the owner of the record is another account, or the login owns another record.
      return { httpStatus: 409, error: detail === 'owner' ? GUIDE_OWNER_CONFLICT : 'status_conflict' }
    case 'TGP22':
      return { httpStatus: 422, error: detail ? `invalid_${detail}` : 'invalid' }
    // `cms_set_guide_listed`: listing needs a meeting point, an account with a photo and a bio, and
    // a WhatsApp (BR-B2B-064 items 4.a, 9.a and 11.a). The DETAIL names what is missing, one answer
    // each, so the screen tells which apart from a bad argument. No DETAIL is the meeting point, the
    // database's answer before #1184.
    case 'TGP23':
      if (detail === 'photo') return { httpStatus: 409, error: GUIDE_PHOTO_REQUIRED }
      if (detail === 'bio') return { httpStatus: 409, error: GUIDE_BIO_REQUIRED }
      if (detail === 'owner') return { httpStatus: 409, error: GUIDE_OWNER_REQUIRED }
      if (detail === 'whatsapp') return { httpStatus: 409, error: GUIDE_WHATSAPP_REQUIRED }
      return { httpStatus: 409, error: GUIDE_MEETING_POINT_REQUIRED }
    default:
      return { httpStatus: 503, error: 'guide_write_failed' }
  }
}

/** The reason as stored: the closed id, or the text of `other`. `null` = invalid. */
export function guideHideReasonText(reason: unknown, other: unknown): string | null {
  if (!(GUIDE_HIDE_REASONS as readonly unknown[]).includes(reason)) return null
  if (reason !== 'other') return reason as string
  const text = typeof other === 'string' ? other.trim() : ''
  return text.length >= 1 && text.length <= GUIDE_HIDE_REASON_MAX ? text : null
}

/** BR-B2B-064 item 11: hide (reason required) or show again. Nothing is deleted. */
export async function setGuideHidden(
  operator: SupabaseClient,
  clientId: string,
  hidden: boolean,
  reason: string | null
): Promise<GuideWriteOutcome<boolean>> {
  const { data, error } = await operator
    .schema('core')
    .rpc('cms_set_guide_hidden', { p_client_id: clientId, p_hidden: hidden, p_reason: hidden ? reason : null })
  if (error) {
    console.error('[guide-profile] set hidden failed', error.code)
    return { ok: false, ...guideRpcErrorOf(error.code, (error as { details?: string }).details) }
  }
  return { ok: true, value: Boolean(data) }
}

/** BR-B2B-064 item 11.c: the curator rewrites the bio OF THE ACCOUNT (1 to 400, #1185); the curator is the moderation. */
export async function updateGuideBio(
  operator: SupabaseClient,
  clientId: string,
  bio: string
): Promise<GuideWriteOutcome<string>> {
  const { data, error } = await operator
    .schema('core')
    .rpc('cms_update_guide_profile', { p_client_id: clientId, p_bio: bio })
  if (error) {
    console.error('[guide-profile] bio update failed', error.code)
    return { ok: false, ...guideRpcErrorOf(error.code, (error as { details?: string }).details) }
  }
  return { ok: true, value: String(data) }
}

/**
 * BR-B2B-064 item 11.a: the curator lists the guide in the app ("Aparece no app") or takes it out.
 * Listing without a meeting point, an account, the account's photo or bio, or a WhatsApp is refused
 * by the database (TGP23 with that DETAIL) and answered as `meeting_point_required`,
 * `owner_required`, `photo_required`, `bio_required` or `whatsapp_required`. Unlisting deletes
 * nothing and records no reason.
 */
export async function setGuideListed(
  operator: SupabaseClient,
  clientId: string,
  listed: boolean
): Promise<GuideWriteOutcome<boolean>> {
  const { data, error } = await operator.schema('core').rpc('cms_set_guide_listed', { p_client_id: clientId, p_listed: listed })
  if (error) {
    console.error('[guide-profile] set listed failed', error.code)
    return { ok: false, ...guideRpcErrorOf(error.code, (error as { details?: string }).details) }
  }
  return { ok: true, value: Boolean(data) }
}

/** BR-B2B-064 item 11.c: the curator sets the meeting point; `answers.meeting_point` follows in the database. */
export async function setGuideMeetingPoint(
  operator: SupabaseClient,
  clientId: string,
  point: GuideMeetingPoint
): Promise<GuideWriteOutcome<string>> {
  const { data, error } = await operator.schema('core').rpc('cms_set_guide_meeting_point', {
    p_client_id: clientId,
    p_address: point.address,
    p_city: point.city,
    p_lat: point.lat,
    p_lng: point.lng,
  })
  if (error) {
    console.error('[guide-profile] meeting point update failed', error.code)
    return { ok: false, ...guideRpcErrorOf(error.code, (error as { details?: string }).details) }
  }
  return { ok: true, value: String(data) }
}
