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

/**
 * Days of account insights Meta keeps ("User Metrics data is stored for up to 90 days", Insights
 * guide): the growth chart starts there (#1063, copy `growth.meta_window`). The collector holds the
 * same value as `META_FUNNEL_MAX_DAYS` in `_shared/social-collect.ts`; the social test compares them.
 */
export const META_FUNNEL_MAX_DAYS = 90

/** Above this many days, the growth chart groups by week from Monday (#1063, spec G1). */
export const GROWTH_WEEKLY_FROM_DAYS = 120

/**
 * The window of "O que rende em cada mercado" (#1064, spec M3): ninety days, because the finest
 * dimension has seven groups per market, each under the floor `MIN_POSTS`.
 */
export const MARKET_WINDOW_DAYS = 90

/**
 * The "fora da curva" seal of a competitor's post (#1064, decision of the Tech Lead): interactions
 * per follower above `OUTLIER_FACTOR` times the median of that account's posts, and only for an
 * account with `OUTLIER_MIN_POSTS` posts or more. The competitor-posts payload carries both as
 * `outlier_rule`, and the copy reads them from there.
 */
export const OUTLIER_FACTOR = 3
export const OUTLIER_MIN_POSTS = 5
