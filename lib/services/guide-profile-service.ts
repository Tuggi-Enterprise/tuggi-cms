/**
 * The tour guide's public profile in the CMS (#936, BR-B2B-064). Contract
 * `docs/contracts/partner-proposal-answers.md` §8.6.
 *
 * READS with `service_role`: `partner.guide_profiles` has RLS
 * on and no policy, so nobody else reads it. WRITES go through the `core.cms_*` RPCs with
 * the OPERATOR's session, so the gate (`core.is_caller_platform_admin()`) answers for the person on
 * the screen. The one write that needs `service_role` is the photo copy: the draft bucket is
 * private and `guide-photos` only admits the guide's own uploads.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseService } from '@/lib/core/supabase-client'
import type { GuideProfileFacts } from '@/lib/partnerships/pipeline'
import { PLACE_SUBMISSION_PHOTOS_BUCKET } from '@/lib/services/place-submission-photos'

export const GUIDE_PHOTOS_BUCKET = 'guide-photos'

/** BR-B2B-064 item 4: the bio is up to 400 characters (`partner.guide_bio_of`). */
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

/** The closed reasons of the "Ocultar do app" dialog (spec #936 §5); `other` carries free text. */
export const GUIDE_HIDE_REASONS = ['tourist_report', 'inactive', 'guide_request', 'other'] as const
export type GuideHideReason = (typeof GUIDE_HIDE_REASONS)[number]

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const PHOTO_FILE = `${UUID}[.](?:jpg|jpeg|png|webp)`

function partner() {
  return getSupabaseService().schema('partner')
}

/** The one meeting point of a guide (BR-B2B-064 items 4 and 6), as `partner.guide_profiles` keeps it. */
export interface GuideMeetingPoint {
  address: string
  city: string
  lat: number
  lng: number
}

/**
 * Name, bio, photo and WhatsApp are `null` in the EMPTY profile the approval of an app request
 * creates (BR-B2B-066 item 10.b, #1184): the guide fills them later, through the portal page opened
 * in the app. A portal guide's profile is born with all of them.
 */
export interface GuideProfile {
  clientId: string
  displayName: string | null
  bio: string | null
  photoPath: string | null
  photoUrl: string | null
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

/** The public URL of a `guide-photos` object — the bucket is public (contract §8.6). */
export function guidePhotoUrl(photoPath: string): string {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '')
  return `${base}/storage/v1/object/public/${GUIDE_PHOTOS_BUCKET}/${photoPath.split('/').map(encodeURIComponent).join('/')}`
}

/**
 * Where the draft facade goes on publication: `<submission_id>/facade/<file>` →
 * `<client_id>/<file>`, the same file name (contract §8.6). `null` when `profile_photo` is not the
 * submission's own facade — the path comes from `answers`, so it is checked before any Storage call.
 */
export function guidePhotoCopyPaths(
  submissionId: string,
  clientId: string,
  profilePhoto: string | null | undefined
): { from: string; to: string } | null {
  const match = new RegExp(`^${submissionId}/facade/(${PHOTO_FILE})$`).exec(profilePhoto ?? '')
  if (!match || !new RegExp(`^${UUID}$`).test(clientId)) return null
  return { from: `${submissionId}/facade/${match[1]}`, to: `${clientId}/${match[1]}` }
}

/**
 * Copies the draft facade to `guide-photos`. An object already there is a retry, not a failure.
 */
export async function copyGuidePhoto(
  submissionId: string,
  clientId: string,
  profilePhoto: string | null | undefined
): Promise<{ ok: true } | { ok: false; error: 'invalid_photo' | 'photo_copy_failed' }> {
  const paths = guidePhotoCopyPaths(submissionId, clientId, profilePhoto)
  if (!paths) return { ok: false, error: 'invalid_photo' }
  const { error } = await getSupabaseService()
    .storage.from(PLACE_SUBMISSION_PHOTOS_BUCKET)
    .copy(paths.from, paths.to, { destinationBucket: GUIDE_PHOTOS_BUCKET })
  if (error && !/exist|duplicate/i.test(error.message ?? '')) {
    console.error('[guide-profile] photo copy failed', (error as { statusCode?: string }).statusCode ?? 'unknown')
    return { ok: false, error: 'photo_copy_failed' }
  }
  return { ok: true }
}

/** The profile facts the queue derives its state from, by client. A failed read degrades to none. */
export async function loadGuideProfileFacts(clientIds: string[]): Promise<Map<string, GuideProfileFacts>> {
  const facts = new Map<string, GuideProfileFacts>()
  if (clientIds.length === 0) return facts
  const { data, error } = await partner()
    .from('guide_profiles')
    .select('client_id, hidden, public_contact_consent, listed_in_app, meeting_point_lat')
    .in('client_id', clientIds)
  if (error || !data) {
    console.error('[guide-profile] facts read failed', error?.code ?? 'no_data')
    return facts
  }
  for (const row of data as {
    client_id: string
    hidden: boolean
    public_contact_consent: boolean
    listed_in_app: boolean
    meeting_point_lat: number | null
  }[]) {
    facts.set(row.client_id, {
      hidden: row.hidden,
      consent: row.public_contact_consent,
      listedInApp: row.listed_in_app === true,
      hasMeetingPoint: row.meeting_point_lat !== null,
    })
  }
  return facts
}

/** A text column of the profile, or `null` when the guide has not sent it yet (empty profile, #1184). */
function filled(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

export type GuideProfileRead = { ok: true; profile: GuideProfile | null } | { ok: false }

export async function loadGuideProfile(clientId: string): Promise<GuideProfileRead> {
  // The service cities are no longer read: since #1177 the meeting point replaces them, and the
  // record does not show them (spec #936 §9.2).
  const profileRead = await partner()
    .from('guide_profiles')
    .select(
      'client_id, display_name, bio, photo_path, languages, specialties, whatsapp, public_contact_consent, hidden, hidden_reason, updated_at, listed_in_app, meeting_point_address, meeting_point_city, meeting_point_lat, meeting_point_lng'
    )
    .eq('client_id', clientId)
    .maybeSingle()
  if (profileRead.error) {
    console.error('[guide-profile] read failed', profileRead.error.code)
    return { ok: false }
  }
  const row = profileRead.data as {
    client_id: string
    display_name: string | null
    bio: string | null
    photo_path: string | null
    languages: string[] | null
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
  return {
    ok: true,
    profile: {
      clientId: row.client_id,
      displayName: filled(row.display_name),
      bio: filled(row.bio),
      photoPath: filled(row.photo_path),
      photoUrl: filled(row.photo_path) ? guidePhotoUrl(row.photo_path as string) : null,
      languages: row.languages ?? [],
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
      return { httpStatus: 409, error: 'status_conflict' }
    case 'TGP22':
      return { httpStatus: 422, error: detail ? `invalid_${detail}` : 'invalid' }
    // `cms_set_guide_listed`: listing needs a meeting point, a photo and a bio (BR-B2B-064 items
    // 9.a and 11.a). The DETAIL names what is missing, one answer each, so the screen tells which
    // apart from a bad argument. No DETAIL is the meeting point, the database's answer before #1184.
    case 'TGP23':
      if (detail === 'photo') return { httpStatus: 409, error: GUIDE_PHOTO_REQUIRED }
      if (detail === 'bio') return { httpStatus: 409, error: GUIDE_BIO_REQUIRED }
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

/** BR-B2B-064 item 11: the curator rewrites the bio (1 to 400); `answers.bio` follows in the database. */
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
 * Listing without a meeting point, a photo or a bio is refused by the database (TGP23 with that
 * DETAIL) and answered as `meeting_point_required`, `photo_required` or `bio_required`. Unlisting
 * deletes nothing and records no reason.
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
