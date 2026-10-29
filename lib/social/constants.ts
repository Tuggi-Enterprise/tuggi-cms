/**
 * Numbers of the social screen (#1059) that the client and the routes share.
 *
 * `MIN_POSTS` is the floor of a group: under it, `social.own_media_ranking` and
 * `social.account_engagement` answer a null rate (migration 20261029160000), the screen prints no
 * number, and the weekly recommendation is not written. The Edge Function holds the same value as
 * `MIN_POSTS` in `_shared/social-collect.ts`; `tests/api/social-analytics.test.ts` compares the two.
 */
export const MIN_POSTS = 3

/** The window of the competitors' mix, frequency and engagement (spec 4.1). */
export const ACCOUNT_WINDOW_DAYS = 30

/** A competitor silent for longer than this is marked on its "last post" cell (spec 4.1). */
export const STALE_POST_DAYS = 14
