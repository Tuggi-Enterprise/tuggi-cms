/**
 * The queue of photo and text changes proposed in the partner portal (#922, BR-B2B-061 item 2;
 * contract `docs/contracts/portal-fotos-e-texto.md` §5). Pure: the screen reads the shapes and the
 * route reads the rules, without pulling the service client into the browser bundle.
 *
 * What is on the air stays on the air until a CMS operator approves. Approving a photo publishes a
 * copy in the public bucket and the database builds the URL from the object path; approving a text
 * rewrites the base description and deletes the translations, and the CMS removes the voiced mp3s.
 */

/** Private bucket of the portal (the proposal's file). */
export const PROPOSAL_BUCKET = 'place-submission-photos'
/** Public bucket the app reads images from (contract §2). */
export const PUBLIC_IMAGE_BUCKET = 'travel-app-images'
/** Bucket of the voiced descriptions (`master_audio/<id>/<id>-*.mp3`). */
export const AUDIO_BUCKET = 'travel-app-audios'
/** What the partner reads after a refusal (`partner.decide_place_change`, 1..1000). */
export const PLACE_CHANGE_NOTE_MAX = 1000

export type PlaceChangeKind = 'photo' | 'text'

/** One row of `partner.place_change_queue()` (contract §5.1), as the screen shows it. */
export interface PlaceChange {
  requestId: string
  submissionId: string
  attractionId: string
  placeName: string | null
  city: string | null
  kind: PlaceChangeKind
  /** 0 = facade; null for the text. */
  slot: number | null
  /** Private path of the proposed photo; signed by the route. */
  photoPath: string | null
  /** Signed URL of the proposed photo, filled by the route. */
  photoUrl: string | null
  proposedText: string | null
  /** What is on the air now (URL or text); `liveValue` was what the partner saw when proposing. */
  currentValue: string | null
  liveValue: string | null
  storyEntitled: boolean
  requestedAt: string
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

/** `partner.place_change_queue()` rows → the screen's rows. A row out of shape is dropped. */
export function toPlaceChanges(raw: unknown): PlaceChange[] {
  if (!Array.isArray(raw)) return []
  const out: PlaceChange[] = []
  for (const r of raw as Record<string, unknown>[]) {
    const requestId = str(r?.request_id)
    const attractionId = str(r?.attraction_id)
    const kind = r?.kind === 'photo' || r?.kind === 'text' ? r.kind : null
    if (!requestId || !attractionId || !kind) continue
    out.push({
      requestId,
      submissionId: str(r.submission_id) ?? '',
      attractionId,
      placeName: str(r.place_name),
      city: str(r.city),
      kind,
      slot: typeof r.slot === 'number' ? r.slot : null,
      photoPath: str(r.photo_path),
      photoUrl: null,
      proposedText: str(r.proposed_text),
      currentValue: str(r.current_value),
      liveValue: str(r.live_value),
      storyEntitled: r.story_entitled === true,
      requestedAt: str(r.requested_at) ?? '',
    })
  }
  return out
}

const PROPOSAL_PATH = /^[0-9a-f-]{36}\/changes\/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$/

/**
 * Where the approved photo is published (contract §2, §5.2): `partners/<attraction_id>/<request_id>.<ext>`
 * of the public bucket, same extension as the proposal. The path is the proposal's own, so a retry
 * overwrites the same object. Out of shape: `null` (nothing is copied).
 */
export function publishedObjectPath(attractionId: string, requestId: string, photoPath: string): string | null {
  const m = PROPOSAL_PATH.exec(photoPath)
  if (!m) return null
  return `partners/${attractionId}/${requestId}.${m[1]}`
}

export function imageContentType(path: string): string {
  if (/\.png$/.test(path)) return 'image/png'
  if (/\.webp$/.test(path)) return 'image/webp'
  return 'image/jpeg'
}

/**
 * The voiced files of THIS place only, by exact path: `master_audio/<id>/<id>-*.mp3`.
 *
 * TWIN IN DENO: `supabase/functions/_shared/places-story-suspension-runtime.ts` (`removeVoicedCopies`)
 * applies this same filter for the payment sweep (BR-B2B-019 item 7). The Edge runtime cannot be
 * imported from Node, so the filter lives twice; change one, change the other.
 */
export function voicedAudioPaths(attractionId: string, names: readonly string[]): string[] {
  const folder = `master_audio/${attractionId}`
  return names
    .filter((n) => n.indexOf(`${attractionId}-`) === 0 && /\.mp3$/.test(n) && n.indexOf('/') < 0)
    .map((n) => `${folder}/${n}`)
}

export type DecisionError =
  | 'not_found'
  /** Already decided another way, withdrawn or superseded (`details` = the status). */
  | 'not_pending'
  /** The submission left `live`: nothing to publish to. */
  | 'not_live'
  | 'note_required'
  /** The copy to the public bucket did not land (or the database did not see it). */
  | 'publish_failed'
  | 'not_available'
  | 'failed'

/** `partner.decide_place_change` refusal → the route's answer (contract §5.2). */
export function decisionError(code: string | undefined, details: string | undefined): { status: number; error: DecisionError } {
  if (code === 'TGP01') return { status: 404, error: 'not_found' }
  if (code === 'TGP10') return details === 'submission_status' ? { status: 409, error: 'not_live' } : { status: 409, error: 'not_pending' }
  if (code === 'TGP22' && details === 'note') return { status: 422, error: 'note_required' }
  if (code === 'TGP22' && details === 'object_path') return { status: 502, error: 'publish_failed' }
  // The migration is not applied yet: the function or the table does not exist.
  if (code === 'PGRST202' || code === '42883' || code === '42P01') return { status: 503, error: 'not_available' }
  return { status: 500, error: 'failed' }
}

export type DecisionBody = { decision: 'approved' } | { decision: 'rejected'; note: string }

/** The route's body: approve, or refuse with a short reason (BR-B2B-061 item 2). */
export function parseDecisionBody(raw: unknown): DecisionBody | { invalid: 'decision' | 'note' } {
  const b = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  if (b.decision === 'approved') return { decision: 'approved' }
  if (b.decision !== 'rejected') return { invalid: 'decision' }
  const note = typeof b.note === 'string' ? b.note.trim() : ''
  if (!note || note.length > PLACE_CHANGE_NOTE_MAX) return { invalid: 'note' }
  return { decision: 'rejected', note }
}
