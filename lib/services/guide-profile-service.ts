/**
 * The tour guide's public profile in the CMS (#936, BR-B2B-064). Contract
 * `docs/contracts/partner-proposal-answers.md` §8.6.
 *
 * READS with `service_role`: `partner.guide_profiles` and `partner.guide_service_cities` have RLS
 * on and no policy, so nobody else reads them. WRITES go through the three `core.cms_*` RPCs with
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

/** The closed reasons of the "Ocultar do app" dialog (spec #936 §5); `other` carries free text. */
export const GUIDE_HIDE_REASONS = ['tourist_report', 'inactive', 'guide_request', 'other'] as const
export type GuideHideReason = (typeof GUIDE_HIDE_REASONS)[number]

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const PHOTO_FILE = `${UUID}[.](?:jpg|jpeg|png|webp)`

function partner() {
  return getSupabaseService().schema('partner')
}

export interface GuideProfile {
  clientId: string
  displayName: string
  bio: string
  photoPath: string
  photoUrl: string
  languages: string[]
  specialties: string[]
  whatsapp: string
  consent: boolean
  hidden: boolean
  hiddenReason: string | null
  updatedAt: string
  cities: { city: string; state: string }[]
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
    .select('client_id, hidden, public_contact_consent')
    .in('client_id', clientIds)
  if (error || !data) {
    console.error('[guide-profile] facts read failed', error?.code ?? 'no_data')
    return facts
  }
  for (const row of data as { client_id: string; hidden: boolean; public_contact_consent: boolean }[]) {
    facts.set(row.client_id, { hidden: row.hidden, consent: row.public_contact_consent })
  }
  return facts
}

export type GuideProfileRead = { ok: true; profile: GuideProfile | null } | { ok: false }

export async function loadGuideProfile(clientId: string): Promise<GuideProfileRead> {
  const [profileRead, citiesRead] = await Promise.all([
    partner()
      .from('guide_profiles')
      .select('client_id, display_name, bio, photo_path, languages, specialties, whatsapp, public_contact_consent, hidden, hidden_reason, updated_at')
      .eq('client_id', clientId)
      .maybeSingle(),
    partner().from('guide_service_cities').select('city, state').eq('guide_client_id', clientId).order('city'),
  ])
  if (profileRead.error || citiesRead.error) {
    console.error('[guide-profile] read failed', profileRead.error?.code ?? citiesRead.error?.code)
    return { ok: false }
  }
  const row = profileRead.data as {
    client_id: string
    display_name: string
    bio: string
    photo_path: string
    languages: string[]
    specialties: string[]
    whatsapp: string
    public_contact_consent: boolean
    hidden: boolean
    hidden_reason: string | null
    updated_at: string
  } | null
  if (!row) return { ok: true, profile: null }
  return {
    ok: true,
    profile: {
      clientId: row.client_id,
      displayName: row.display_name,
      bio: row.bio,
      photoPath: row.photo_path,
      photoUrl: guidePhotoUrl(row.photo_path),
      languages: row.languages ?? [],
      specialties: row.specialties ?? [],
      whatsapp: row.whatsapp,
      consent: row.public_contact_consent,
      hidden: row.hidden,
      hiddenReason: row.hidden_reason,
      updatedAt: row.updated_at,
      cities: (citiesRead.data ?? []) as { city: string; state: string }[],
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
