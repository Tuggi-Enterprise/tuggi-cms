/**
 * The tourists' votes on POI, event, place and route, as the curator reads them (#950, #1016,
 * BR-CONTEUDO-009 items 5 and 7). Source: `drive.cms_item_feedback_summary(p_item_kind, p_language,
 * p_limit)`, service_role only, one row per item and language, counted only over the votes on the
 * CURRENT text (item 4). Contract: `docs/contracts/banco-para-cms.md`, Parte 18. Shown in
 * `/admin/story-feedback`.
 *
 * Pure: types, the URL filters and order, the editor link, and the mapping that decides what leaves
 * the server. The mapping is a whitelist on purpose: nothing that identifies the tourist reaches the
 * screen (item 7), and the RPC already returns no author; a column added to it later does not leak
 * by `...row`.
 */

import { placeToolHref } from '@/lib/partnerships/place-tool'

/** The four kinds a tourist votes on (item 1), as the RPC names them in `item_kind`. */
export const FEEDBACK_KINDS = ['poi', 'event', 'place', 'route'] as const
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number]
export const isFeedbackKind = (v: unknown): v is FeedbackKind => (FEEDBACK_KINDS as readonly unknown[]).includes(v)

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

/** A row of `drive.cms_item_feedback_summary`. */
export interface ItemFeedbackSummaryRow {
  item_kind: string
  item_id: string
  item_name: string | null
  /** NULL = the base text of an event, place or route, with no text in a language. */
  language: string | null
  up_count: number
  down_count: number
  wrong_info_count: number
  /** Includes the down without reason (item 2); `no_reason_count` is that part. */
  disliked_count: number
  no_reason_count: number
  stale_count: number
  last_vote_at: string | null
  recent_comments: unknown
}

export interface FeedbackComment {
  comment: string
  reason: 'disliked' | 'wrong_info' | null
  /** The voice of the story the comment is about; only a POI has one. */
  gender: string | null
  at: string
}

/** What the route answers per row. */
export interface FeedbackItem {
  kind: FeedbackKind
  itemId: string
  itemName: string | null
  language: string | null
  up: number
  down: number
  wrong: number
  /** "Não gostei" chosen as the reason. */
  disliked: number
  /** Down with no reason chosen: counts as "não gostei" (item 2), shown apart so the curator sees the step was skipped. */
  downNoReason: number
  lastVoteAt: string | null
  /** The five newest comments on the current text, newest first; no author. */
  comments: FeedbackComment[]
}

const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.trunc(v) : 0)

function toComments(raw: unknown): FeedbackComment[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((c): FeedbackComment[] => {
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

/** `null` for a kind this screen does not know: it has no editor to send the curator to. */
export function toFeedbackItem(r: ItemFeedbackSummaryRow): FeedbackItem | null {
  if (!isFeedbackKind(r.item_kind) || typeof r.item_id !== 'string') return null
  const noReason = count(r.no_reason_count)
  return {
    kind: r.item_kind,
    itemId: r.item_id,
    itemName: r.item_name,
    language: typeof r.language === 'string' ? r.language : null,
    up: count(r.up_count),
    down: count(r.down_count),
    wrong: count(r.wrong_info_count),
    disliked: Math.max(0, count(r.disliked_count) - noReason),
    downNoReason: noReason,
    lastVoteAt: r.last_vote_at,
    comments: toComments(r.recent_comments),
  }
}

const SORT_KEY: Record<StorySort, (i: FeedbackItem) => number> = {
  wrong: (i) => i.wrong,
  dislike: (i) => i.disliked + i.downNoReason,
  downNoReason: (i) => i.downNoReason,
  up: (i) => i.up,
  lastVote: (i) => (i.lastVoteAt ? Date.parse(i.lastVoteAt) : 0),
}

/**
 * Only items with at least one down on the current text, the reason filter, then the order: the
 * chosen column desc, ties by total down desc, then by last vote.
 */
export function toFeedbackList(
  rows: ItemFeedbackSummaryRow[],
  filter: { reason: StoryReasonFilter | null; sort: StorySort }
): FeedbackItem[] {
  const key = SORT_KEY[filter.sort]
  return rows
    .map(toFeedbackItem)
    .filter((i): i is FeedbackItem => i !== null && i.down > 0)
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

/**
 * Where the curator corrects the text of the item. POI and place open their editor on the
 * description tab (`placeToolHref`); a route opens the edit modal of `/routes` by `editId`. An event
 * has no editor reachable by link (it edits in a modal of `/events` with no deep link): `null`, and
 * the name is shown without a link.
 */
export function feedbackEditHref(
  item: Pick<FeedbackItem, 'kind' | 'itemId'>,
  target: { locale: string; returnTo: string; returnLabel: string }
): string | null {
  if (item.kind === 'poi' || item.kind === 'place') {
    return placeToolHref({
      ...target,
      attractionId: item.itemId,
      entityKind: item.kind,
      pendency: 'audio_description',
    })
  }
  if (item.kind === 'route') return `/${target.locale}/routes?editId=${encodeURIComponent(item.itemId)}`
  return null
}

/** The database's refusals, as HTTP. Until the migration is applied the function does not exist: 503 `not_available`. */
export function storyFeedbackErrorStatus(code: string | null | undefined): { status: number; error: string } {
  if (code === 'PGRST202' || code === '42883') return { status: 503, error: 'not_available' }
  if (code === '42501') return { status: 403, error: 'forbidden' }
  return { status: 500, error: 'internal' }
}
