/**
 * The social agenda of the CMS (#1058): shape of a post as `social.posts`, `social.post_media` and
 * `social.post_targets` store it, and every decision the screen and the write routes share.
 *
 * No `BR-*` governs these posts: it is an internal tool of the operator. The limits are the Meta's,
 * from `ig-user/media` of the Graph API v26.0 (spike #1057), and the caption ceiling is also the
 * `CHECK` of `social.posts.caption`. The form and the server read the SAME `validatePost`, so the
 * server never accepts what the screen would refuse.
 *
 * Pure module: no Supabase, no React. It runs in the browser, in the route and in `node:test`.
 */

export const NETWORKS = ['instagram', 'facebook'] as const
export type Network = (typeof NETWORKS)[number]

/** Values of the `social.posts.media_type` check. */
export const MEDIA_TYPES = ['IMAGE', 'CAROUSEL', 'REELS'] as const
export type MediaType = (typeof MEDIA_TYPES)[number]

export const TARGET_STATUSES = ['scheduled', 'publishing', 'published', 'failed', 'canceled'] as const
export type TargetStatus = (typeof TARGET_STATUSES)[number]

export const SOCIAL_BUCKET = 'social-media'

/** Instagram ceilings; the caption one is also the database check. */
export const CAPTION_MAX = 2200
export const HASHTAG_MAX = 30
export const MENTION_MAX = 20
export const CAROUSEL_MIN = 2
export const CAROUSEL_MAX = 20

export const IMAGE_MIME = 'image/jpeg'
export const VIDEO_MIMES = ['video/mp4', 'video/quicktime'] as const
export const IMAGE_MAX_BYTES = 8 * 1024 * 1024
export const VIDEO_MAX_BYTES = 300 * 1024 * 1024
/** Aspect ratio window of an Instagram image: 4:5 to 1.91:1. */
export const IMAGE_RATIO_MIN = 4 / 5
export const IMAGE_RATIO_MAX = 1.91
export const VIDEO_MIN_SECONDS = 3
export const VIDEO_MAX_SECONDS = 15 * 60

/** Title is an internal label the screen does not ask for: the first caption line, cut here. */
export const TITLE_MAX = 60

export const DOWNLOAD_URL = 'https://www.tuggi.app/download'

export interface PostMedia {
  id?: string
  position: number
  storage_path: string
  mime_type: string
  /** Public URL, derived by the route from `storage_path`; never stored. */
  url?: string
}

export interface PostTarget {
  id: string
  network: Network
  status: TargetStatus
  attempts: number
  permalink: string | null
  error: string | null
  published_at: string | null
  updated_at: string
}

export interface SocialPost {
  id: string
  title: string
  caption: string
  media_type: MediaType
  scheduled_at: string
  link_url: string | null
  utm_campaign: string | null
  created_at: string
  updated_at: string
  post_media: PostMedia[]
  post_targets: PostTarget[]
}

/** The columns every read selects, embeds included. One string, so the list and the post agree. */
export const POST_SELECT =
  'id, title, caption, media_type, scheduled_at, link_url, utm_campaign, created_at, updated_at, ' +
  'post_media(id, position, storage_path, mime_type), ' +
  'post_targets(id, network, status, attempts, permalink, error, published_at, updated_at)'

export const isNetwork = (v: unknown): v is Network => (NETWORKS as readonly unknown[]).indexOf(v) >= 0
export const isMediaType = (v: unknown): v is MediaType => (MEDIA_TYPES as readonly unknown[]).indexOf(v) >= 0

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v)

export type MediaKind = 'image' | 'video'

/** Image or video, read from the mime, which is all `post_media` keeps. */
export function mediaKindOf(mime: string): MediaKind | null {
  if (mime === IMAGE_MIME) return 'image'
  if ((VIDEO_MIMES as readonly string[]).indexOf(mime) >= 0) return 'video'
  return null
}

/** Caption length in Unicode code points, as `char_length` and the Meta count it. */
export function captionLength(caption: string): number {
  return Array.from(caption).length
}

// Built at runtime: the CMS compiles to es2015, which does not know property escapes.
const HASHTAG = () => new RegExp('(^|[^\\p{L}\\p{N}_&])#[\\p{L}\\p{N}_]', 'gu')
const MENTION = () => new RegExp('(^|[^\\p{L}\\p{N}_.])@[\\p{L}\\p{N}_.]', 'gu')

export function countHashtags(caption: string): number {
  return (caption.match(HASHTAG()) ?? []).length
}

export function countMentions(caption: string): number {
  return (caption.match(MENTION()) ?? []).length
}

/** `social.posts.title`: first non-empty caption line, at most `TITLE_MAX` code points. */
export function titleFromCaption(caption: string, postId: string): string {
  const line = caption
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0)
  if (!line) return `Post ${postCode(postId)}`
  const chars = Array.from(line)
  return chars.length <= TITLE_MAX ? line : `${chars.slice(0, TITLE_MAX - 1).join('').replace(/\s+$/, '')}…`
}

/** The short code of a post: its first eight id characters. */
export function postCode(postId: string): string {
  return postId.slice(0, 8).toLowerCase()
}

export function utmCampaign(postId: string): string {
  return `post_${postCode(postId)}`
}

/**
 * The download link of a post. One link for both networks, because the caption is one
 * (`utm_source=meta`); `utm_medium=social` is what GA4 groups as Organic Social.
 */
export function downloadLink(postId: string): string {
  return `${DOWNLOAD_URL}?utm_source=meta&utm_medium=social&utm_campaign=${utmCampaign(postId)}`
}

/** `<post_id>/<position>-<uuid>.<ext>`: the uuid keeps the name from being guessed. */
export function mediaStoragePath(postId: string, position: number, uuid: string, mime: string): string {
  const ext = mime === IMAGE_MIME ? 'jpg' : mime === 'video/quicktime' ? 'mov' : 'mp4'
  return `${postId}/${position}-${uuid}.${ext}`
}

export function isOwnStoragePath(postId: string, path: string): boolean {
  return new RegExp(`^${postId}/\\d+-[0-9a-f-]{36}\\.(jpg|mp4|mov)$`, 'i').test(path)
}

// ── Post-level status ─────────────────────────────────────────────────────────────────────

export type PostFilter = 'scheduled' | 'published' | 'failed' | 'canceled'

/**
 * One word for the whole post, for the list filter. A post is "failed" when ANY network failed,
 * "published" when every network that was not canceled published, "canceled" when all were.
 */
export function postFilterOf(targets: Pick<PostTarget, 'status'>[]): PostFilter {
  const s = targets.map((t) => t.status)
  if (s.indexOf('failed') >= 0) return 'failed'
  if (s.indexOf('scheduled') >= 0 || s.indexOf('publishing') >= 0) return 'scheduled'
  if (s.length === 0 || s.every((x) => x === 'canceled')) return 'canceled'
  return 'published'
}

export type LockReason = 'publishing' | 'published' | 'canceled'

/**
 * Why the content of a post can no longer change, or `null` when it can. A network publishing or
 * published freezes networks, type, media and caption (the Instagram API does not edit a published
 * media); a post canceled on every network is final, and a new post is how it comes back.
 */
export function lockReasonOf(targets: Pick<PostTarget, 'status'>[]): LockReason | null {
  const s = targets.map((t) => t.status)
  if (s.indexOf('publishing') >= 0) return 'publishing'
  if (s.indexOf('published') >= 0) return 'published'
  if (s.length > 0 && s.every((x) => x === 'canceled')) return 'canceled'
  return null
}

export const isCancelable = (t: Pick<PostTarget, 'status'>) => t.status === 'scheduled' || t.status === 'failed'

// ── Validation ────────────────────────────────────────────────────────────────────────────

export type PostErrorCode =
  | 'no_network'
  | 'no_media'
  | 'image_many'
  | 'image_is_video'
  | 'carousel_too_few'
  | 'carousel_too_many'
  | 'carousel_is_video'
  | 'reels_no_video'
  | 'reels_many'
  | 'caption_too_long'
  | 'too_many_hashtags'
  | 'too_many_mentions'
  | 'time_missing'
  | 'time_past'

export interface PostError {
  field: 'networks' | 'media' | 'caption' | 'scheduled_at'
  code: PostErrorCode
  /** Placeholders of the copy sentence (`{over}`, `{max}`). */
  values?: Record<string, number>
}

export interface PostDraft {
  networks: Network[]
  media_type: MediaType
  caption: string
  /** ISO instant, or null when the field is empty. */
  scheduled_at: string | null
  media: { mime_type: string }[]
}

/**
 * Every refusal of a draft, in field order, so the form can focus the first one. `minScheduledAt`
 * is the earliest instant the caller accepts: the form passes now + 10 minutes, the route passes
 * now (the request took time to arrive, and the form already held the line).
 */
export function validatePost(draft: PostDraft, minScheduledAt: Date): PostError[] {
  const errors: PostError[] = []

  if (draft.networks.length === 0) errors.push({ field: 'networks', code: 'no_network' })

  const kinds = draft.media.map((m) => mediaKindOf(m.mime_type))
  const videos = kinds.filter((k) => k === 'video').length
  const count = draft.media.length
  const media = (code: PostErrorCode, values?: Record<string, number>) =>
    errors.push({ field: 'media', code, ...(values ? { values } : {}) })

  if (count === 0) media(draft.media_type === 'REELS' ? 'reels_no_video' : 'no_media')
  else if (draft.media_type === 'IMAGE') {
    if (videos > 0) media('image_is_video')
    else if (count > 1) media('image_many')
  } else if (draft.media_type === 'CAROUSEL') {
    if (videos > 0) media('carousel_is_video')
    else if (count < CAROUSEL_MIN) media('carousel_too_few')
    else if (count > CAROUSEL_MAX) media('carousel_too_many', { max: CAROUSEL_MAX, over: count - CAROUSEL_MAX })
  } else if (draft.media_type === 'REELS') {
    if (videos === 0) media('reels_no_video')
    else if (count > 1) media('reels_many')
  }

  // The database refuses a caption over 2200 whatever the network, so this one is not
  // Instagram-only (the spec allowed Facebook past it; the column check does not).
  const length = captionLength(draft.caption)
  if (length > CAPTION_MAX) {
    errors.push({ field: 'caption', code: 'caption_too_long', values: { over: length - CAPTION_MAX, max: CAPTION_MAX } })
  } else if (draft.networks.indexOf('instagram') >= 0) {
    const tags = countHashtags(draft.caption)
    const mentions = countMentions(draft.caption)
    if (tags > HASHTAG_MAX) errors.push({ field: 'caption', code: 'too_many_hashtags', values: { over: tags - HASHTAG_MAX } })
    else if (mentions > MENTION_MAX) {
      errors.push({ field: 'caption', code: 'too_many_mentions', values: { over: mentions - MENTION_MAX } })
    }
  }

  if (!draft.scheduled_at) errors.push({ field: 'scheduled_at', code: 'time_missing' })
  else {
    const at = new Date(draft.scheduled_at)
    if (Number.isNaN(at.getTime())) errors.push({ field: 'scheduled_at', code: 'time_missing' })
    else if (at.getTime() < minScheduledAt.getTime()) errors.push({ field: 'scheduled_at', code: 'time_past' })
  }

  return errors
}

/** Per-file check before the upload. `null` when the file is fine for that type of post. */
export type FileErrorCode = 'file_type' | 'file_too_big' | 'image_ratio' | 'video_duration'

export function fileTypeError(file: { type: string; size: number }): { code: FileErrorCode; max?: string } | null {
  const kind = mediaKindOf(file.type)
  if (!kind) return { code: 'file_type' }
  if (kind === 'image' && file.size > IMAGE_MAX_BYTES) return { code: 'file_too_big', max: '8 MB' }
  if (kind === 'video' && file.size > VIDEO_MAX_BYTES) return { code: 'file_too_big', max: '300 MB' }
  return null
}

export function imageRatioOk(width: number, height: number): boolean {
  if (!width || !height) return false
  const ratio = width / height
  // A hair of tolerance: 1080x1350 is exactly 4:5 and must not fail on floating point.
  return ratio >= IMAGE_RATIO_MIN - 0.001 && ratio <= IMAGE_RATIO_MAX + 0.001
}

export function videoDurationOk(seconds: number): boolean {
  return Number.isFinite(seconds) && seconds >= VIDEO_MIN_SECONDS && seconds <= VIDEO_MAX_SECONDS
}
