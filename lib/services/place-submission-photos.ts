/**
 * The photos of ONE Portal Locais submission (#809, BR-B2B-044) — the only reader of the bucket
 * in the CMS. Contract: `docs/contracts/partner-proposal-answers.md` §8.5.
 *
 * The path in Storage IS the reference (there is no key in `answers`):
 *   `<submission_id>/facade/<uuid>.<ext>` and `<submission_id>/gallery/<uuid>.<ext>`.
 *
 * THE CAP IS APPLIED HERE, ON READ. The Storage policy only tests the limit in a rolled-back
 * transaction and then writes the row as superuser, so parallel uploads (or one that finishes
 * after the submission) can leave more objects than the plan allows. Deterministic selection,
 * ordered by `created_at, id`:
 *   · facade  = the oldest `facade/`;
 *   · gallery = the oldest 5 `gallery/` (2 on "No mapa" — 3 photos, BR-B2B-044 items 2 and 3);
 *   · on approval, objects created after the last exit from `draft`/`changes_requested` are
 *     ignored (`photoCutoff`). Not `submitted_at`: it is written only on the first submit.
 * The excess stays in the bucket and is never shown or published.
 *
 * Private bucket: the screen gets short-lived signed URLs, generated here with `service_role`.
 */

import { getSupabaseService } from '@/lib/core/supabase-client'
import { isPaidPlan } from '@/lib/partnerships/portal-review'

export const PLACE_SUBMISSION_PHOTOS_BUCKET = 'place-submission-photos'

/** Lifetime of the signed URL the validation screen receives (seconds). */
export const PHOTO_SIGNED_URL_TTL_SECONDS = 300

/** Gallery photos besides the facade — BR-B2B-044 item 2 (3 photos) and item 3 (6 photos). */
export const GALLERY_LIMIT_FREE = 2
export const GALLERY_LIMIT_PAID = 5

/** The statuses the partner edits in; leaving them freezes the photo set (contract §8.5). */
const EDITABLE_STATUSES = new Set(['draft', 'changes_requested'])

export interface StoredPhoto {
  id: string
  name: string
  created_at: string
}

export interface SubmissionPhoto {
  role: 'facade' | 'gallery'
  path: string
  createdAt: string
  url: string
}

export function galleryLimit(planChoice: string | null | undefined): number {
  return isPaidPlan(planChoice) ? GALLERY_LIMIT_PAID : GALLERY_LIMIT_FREE
}

/**
 * The approval cutoff: `max(created_at)` of the transitions leaving `draft`/`changes_requested`.
 * `null` when the submission never left them.
 */
export function photoCutoff(transitions: { from_status: string; created_at: string }[]): string | null {
  let cutoff: string | null = null
  for (const t of transitions) {
    if (!EDITABLE_STATUSES.has(t.from_status)) continue
    if (cutoff === null || Date.parse(t.created_at) > Date.parse(cutoff)) cutoff = t.created_at
  }
  return cutoff
}

/** Whether the screen is judging a frozen set (the cutoff applies) or one still being edited. */
export function isPhotoSetFrozen(status: string): boolean {
  return !EDITABLE_STATUSES.has(status)
}

function byAge(a: StoredPhoto, b: StoredPhoto): number {
  return Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id)
}

/** Pure selection — BR-B2B-044 items 2 and 3, contract §8.5. */
export function selectSubmissionPhotos(input: {
  facade: StoredPhoto[]
  gallery: StoredPhoto[]
  planChoice: string | null | undefined
  cutoff: string | null
}): { facade: StoredPhoto | null; gallery: StoredPhoto[] } {
  const limit = input.cutoff === null ? null : Date.parse(input.cutoff)
  const eligible = (list: StoredPhoto[]) =>
    list.filter((o) => limit === null || Date.parse(o.created_at) <= limit).sort(byAge)
  return {
    facade: eligible(input.facade)[0] ?? null,
    gallery: eligible(input.gallery).slice(0, galleryLimit(input.planChoice)),
  }
}

/**
 * Reads, caps and signs. Facade first, then the gallery in order. Any Storage failure — the
 * bucket not existing yet (migration 20261004130000 not applied) included — degrades to "no
 * photos": the panel that fails does not take the screen down (spec §2, Local).
 */
export async function readSubmissionPhotos(
  submissionId: string,
  options: { planChoice: string | null | undefined; cutoff: string | null }
): Promise<SubmissionPhoto[]> {
  try {
    const bucket = getSupabaseService().storage.from(PLACE_SUBMISSION_PHOTOS_BUCKET)
    const list = async (folder: 'facade' | 'gallery'): Promise<StoredPhoto[]> => {
      const { data, error } = await bucket.list(`${submissionId}/${folder}`, {
        limit: 100,
        sortBy: { column: 'created_at', order: 'asc' },
      })
      if (error) throw error
      // Folder placeholders come back with `id: null`.
      return (data ?? []).flatMap((o) =>
        o.id && o.created_at ? [{ id: o.id, name: o.name, created_at: o.created_at }] : []
      )
    }
    const [facade, gallery] = await Promise.all([list('facade'), list('gallery')])
    const chosen = selectSubmissionPhotos({ facade, gallery, ...options })
    const ordered = [
      ...(chosen.facade ? [{ role: 'facade' as const, object: chosen.facade }] : []),
      ...chosen.gallery.map((object) => ({ role: 'gallery' as const, object })),
    ].map((p) => ({ ...p, path: `${submissionId}/${p.role}/${p.object.name}` }))
    if (ordered.length === 0) return []

    const { data: signed, error } = await bucket.createSignedUrls(
      ordered.map((p) => p.path),
      PHOTO_SIGNED_URL_TTL_SECONDS
    )
    if (error) throw error
    const urls = new Map((signed ?? []).filter((s) => !s.error && s.signedUrl).map((s) => [s.path, s.signedUrl]))
    return ordered.flatMap((p) => {
      const url = urls.get(p.path)
      return url ? [{ role: p.role, path: p.path, createdAt: p.object.created_at, url }] : []
    })
  } catch (error) {
    console.warn('[portal-photos] read failed', error instanceof Error ? error.message : 'unknown')
    return []
  }
}
