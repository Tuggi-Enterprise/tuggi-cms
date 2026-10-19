/**
 * The tourists' votes on each story, as the curator reads them (#950, BR-CONTEUDO-009 item 5).
 * Source: `drive.cms_story_feedback_summary(p_language, p_limit)`, service_role only, one row per
 * POI and language, counted only over the votes on the CURRENT text (item 4). Shown in
 * `/admin/story-feedback` (spec `docs/design/spec-voto-na-historia-2026-10.md` §7).
 *
 * Pure: types, the URL filter and order, and the mapping that decides what leaves the server.
 * The mapping is a whitelist on purpose: nothing that identifies the tourist reaches the screen
 * (item 7 and spec §7), and the RPC already returns no author; a column added to it later does not
 * leak by `...row`.
 */

/** The narration languages of the app (`src/locales/*.json` of tuggi-drive-v2). */
export const STORY_LANGUAGES = ['pt', 'en', 'es', 'fr', 'it'] as const
export type StoryLanguage = (typeof STORY_LANGUAGES)[number]
export const isStoryLanguage = (v: unknown): v is StoryLanguage => (STORY_LANGUAGES as readonly unknown[]).includes(v)

/** `?reason=`: wrong = "informação errada"; dislike = "não gostei", which is also a down without reason (item 2). */
export const STORY_REASON_FILTERS = ['wrong', 'dislike'] as const
export type StoryReasonFilter = (typeof STORY_REASON_FILTERS)[number]
export const isStoryReasonFilter = (v: unknown): v is StoryReasonFilter =>
  (STORY_REASON_FILTERS as readonly unknown[]).includes(v)

/** The sortable numeric columns. Default `wrong` = the RPC's own order (wrong desc, then down desc). */
export const STORY_SORTS = ['wrong', 'dislike', 'downNoReason', 'up', 'lastVote'] as const
export type StorySort = (typeof STORY_SORTS)[number]
export const isStorySort = (v: unknown): v is StorySort => (STORY_SORTS as readonly unknown[]).includes(v)

/** A row of `drive.cms_story_feedback_summary`. */
export interface StoryFeedbackSummaryRow {
  poi_id: string
  poi_name: string | null
  language: string
  up_count: number
  down_count: number
  wrong_info_count: number
  disliked_count: number
  stale_count: number
  last_vote_at: string | null
  recent_comments: unknown
}

export interface StoryComment {
  comment: string
  reason: 'disliked' | 'wrong_info' | null
  /** The voice of the story the comment is about (`core.attraction_descriptions.gender`). */
  gender: string | null
  at: string
}

/** What the route answers per row. */
export interface StoryFeedbackItem {
  poiId: string
  poiName: string | null
  language: string
  up: number
  down: number
  wrong: number
  disliked: number
  /** Down with no reason chosen: counts as "não gostei" (item 2), shown apart so the curator sees the step was skipped. */
  downNoReason: number
  lastVoteAt: string | null
  /** The five newest comments on the current text, newest first; no author. */
  comments: StoryComment[]
}

const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.trunc(v) : 0)

function toComments(raw: unknown): StoryComment[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((c): StoryComment[] => {
    if (!c || typeof c !== 'object') return []
    const o = c as Record<string, unknown>
    if (typeof o.comment !== 'string' || typeof o.at !== 'string') return []
    return [
      {
        comment: o.comment,
        reason: o.reason === 'disliked' || o.reason === 'wrong_info' ? o.reason : null,
        gender: typeof o.gender === 'string' ? o.gender : null,
        at: o.at,
      },
    ]
  })
}

export function toStoryFeedbackItem(r: StoryFeedbackSummaryRow): StoryFeedbackItem {
  const down = count(r.down_count)
  const wrong = count(r.wrong_info_count)
  const disliked = count(r.disliked_count)
  return {
    poiId: r.poi_id,
    poiName: r.poi_name,
    language: r.language,
    up: count(r.up_count),
    down,
    wrong,
    disliked,
    downNoReason: Math.max(0, down - wrong - disliked),
    lastVoteAt: r.last_vote_at,
    comments: toComments(r.recent_comments),
  }
}

const SORT_KEY: Record<StorySort, (i: StoryFeedbackItem) => number> = {
  wrong: (i) => i.wrong,
  dislike: (i) => i.disliked + i.downNoReason,
  downNoReason: (i) => i.downNoReason,
  up: (i) => i.up,
  lastVote: (i) => (i.lastVoteAt ? Date.parse(i.lastVoteAt) : 0),
}

/**
 * Only stories with at least one down on the current text (spec §7), the reason filter, then the
 * order: the chosen column desc, ties by total down desc, then by last vote.
 */
export function toStoryFeedbackList(
  rows: StoryFeedbackSummaryRow[],
  filter: { reason: StoryReasonFilter | null; sort: StorySort }
): StoryFeedbackItem[] {
  const key = SORT_KEY[filter.sort]
  return rows
    .map(toStoryFeedbackItem)
    .filter((i) => i.down > 0)
    .filter((i) => {
      if (filter.reason === 'wrong') return i.wrong > 0
      if (filter.reason === 'dislike') return i.disliked + i.downNoReason > 0
      return true
    })
    .sort(
      (a, b) =>
        key(b) - key(a) ||
        b.down - a.down ||
        (b.lastVoteAt ? Date.parse(b.lastVoteAt) : 0) - (a.lastVoteAt ? Date.parse(a.lastVoteAt) : 0)
    )
}

/** The database's refusals, as HTTP. Until the migration is applied the function does not exist: 503 `not_available`. */
export function storyFeedbackErrorStatus(code: string | null | undefined): { status: number; error: string } {
  if (code === 'PGRST202' || code === '42883') return { status: 503, error: 'not_available' }
  if (code === '42501') return { status: 403, error: 'forbidden' }
  return { status: 500, error: 'internal' }
}
