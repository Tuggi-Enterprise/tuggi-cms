/**
 * Values the Meta and Gemini write into `social.*` (#1059), mapped to the keys of
 * `Pages.Social.format` and `Pages.Social.theme`. A value outside the map is returned as null, and
 * the screen prints it raw in mono with a title: that is the failure to see (DS-COPY-021).
 */

export type FormatKey = 'carousel' | 'reels' | 'image' | 'other'

/**
 * Copy section 2.2: `CAROUSEL_ALBUM` is Carrossel, `IMAGE` is Imagem; `VIDEO` with `REELS`, or with
 * no product type (Business Discovery may not bring it), is Reels; anything else is Outro.
 */
export function formatKey(mediaType: string | null, productType: string | null): FormatKey {
  if (productType === 'REELS') return 'reels'
  if (mediaType === 'CAROUSEL_ALBUM') return 'carousel'
  if (mediaType === 'IMAGE') return 'image'
  if (mediaType === 'VIDEO' && productType === null) return 'reels'
  return 'other'
}

/**
 * The `bucket` of `social.own_media_ranking` for the format dimension: `REELS`, or the media type of
 * a post that is not a reel. A `VIDEO` bucket is therefore a feed video, which the copy calls Outro,
 * and so is a null bucket (a post Meta sent without `media_type`).
 */
export function formatBucketKey(bucket: string | null): FormatKey {
  if (bucket === null) return 'other'
  return bucket === 'REELS' ? 'reels' : formatKey(bucket, bucket === 'VIDEO' ? 'FEED' : null)
}

export const THEME_KEYS = ['cidade', 'curiosidade', 'produto', 'bastidor', 'outro'] as const
export type ThemeKey = (typeof THEME_KEYS)[number]

/** `null` (and the ranking's `'pending'`) is a post the model has not classified yet. */
export function themeKey(theme: string | null): ThemeKey | 'pending' | null {
  if (theme === null || theme === 'pending') return 'pending'
  return (THEME_KEYS as readonly string[]).includes(theme) ? (theme as ThemeKey) : null
}

/** Instagram's username rule, and the CHECK of `social.watched_accounts.username`. */
export const USERNAME_PATTERN = /^[a-z0-9._]{1,30}$/

/** Trims, drops one leading `@` and lowercases: what the operator typed, as the table stores it. */
export function normalizeUsername(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().replace(/^@/, '').toLowerCase() : ''
}

/** The markets an account can be marked with (#1064, CHECK of `social.watched_accounts.market`). */
export const MARKETS = ['BR', 'US', 'EU'] as const
export type Market = (typeof MARKETS)[number]

export function isMarket(v: unknown): v is Market {
  return typeof v === 'string' && (MARKETS as readonly string[]).includes(v)
}

/**
 * The Meta Ad Library searched by the account's name (#1064, spec M4): Business Discovery gives no id
 * of the Facebook page, so the link is a keyword search, not the advertiser's page.
 */
export function adLibrarySearchUrl(username: string): string {
  const q = encodeURIComponent(username)
  return `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=ALL&q=${q}&search_type=keyword_unordered&media_type=all`
}
