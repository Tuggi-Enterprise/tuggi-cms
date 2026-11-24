/**
 * The dictionary at the foot of the Engagement report (#1154, spec-cms-relatorio-engajamento-2026-11
 * §D5): for each number, the label the screen prints, what it counts, the event or table it reads
 * and its source.
 *
 * The words are not copied here: `terms` are the i18n keys the line itself prints and `definition` is
 * the hint the line already carries (copy cms-relatorio-engajamento-dicionario-e-receita §1.1), so
 * renaming a line renames its entry and a definition exists in one place. The event or table is not
 * translated and lives here, beside the line's definition. This owns the order (the page's, §D5 item
 * 4), the source and which grid rows each entry explains, so a test proves every row of the grid has
 * a definition with the right source (DS-COMPONENTE-084 item 2: GA4 and the database are named
 * apart, never mixed). Keys are relative to `Pages.Dashboard.reports.engagement`.
 */

import type { RowSource } from '@/lib/engagement/cells'

export interface DictionaryEntry {
  key: string
  /** The labels the screen prints for this number, joined on one line. */
  terms: readonly string[]
  definition: string
  /** Placeholder values of the definition that are not the selected use. */
  values?: Readonly<Record<string, string>>
  /** Event, metric or table, as the query names it. */
  origin: string
  source: RowSource
  /** The `GridRow` keys this entry defines; empty for a number outside the grid. */
  rows: readonly string[]
}

const TRIPS = 'drive.trip_sessions'
const USE_TABLES = 'drive.app_opens · drive.trip_sessions · drive.poi_visits'

const days = (n: string): DictionaryEntry => ({
  key: `days_${n}`,
  terms: [`rows.days_${n}`],
  definition: `rows.days_${n}_hint`,
  origin: USE_TABLES,
  source: 'bank',
  rows: [`days_${n}`],
})

const mode = (m: string): DictionaryEntry => ({
  key: `mode_${m}`,
  terms: [`summary.modes.${m}`],
  definition: `summary.modes.help_${m}`,
  origin: `${TRIPS} · drive.app_opens`,
  source: 'bank',
  rows: [],
})

export const ENGAGEMENT_DICTIONARY: readonly DictionaryEntry[] = [
  // tiles
  { key: 'engaged', terms: ['summary.tiles.engaged'], definition: 'summary.tiles.engaged_hint', origin: 'GA4 ENGAGED_EVENTS · button_clicked (ENGAGED_BUTTONS)', source: 'ga4', rows: [] },
  { key: 'guide_median', terms: ['summary.tiles.guide_median', 'rows.guide_median'], definition: 'rows.guide_median_hint', origin: `${TRIPS}.duration`, source: 'bank', rows: ['guide_median'] },
  { key: 'screen_minutes', terms: ['summary.tiles.screen_minutes', 'rows.screen_minutes'], definition: 'rows.screen_minutes_hint', origin: 'GA4 userEngagementDuration ÷ activeUsers', source: 'ga4', rows: ['screen_minutes'] },
  { key: 'returned_next', terms: ['summary.tiles.returned', 'rows.returned_next'], definition: 'rows.returned_next_hint', origin: USE_TABLES, source: 'bank', rows: ['returned_next'] },
  // ways of use
  mode('drive_only'),
  mode('explore_only'),
  mode('both'),
  { key: 'guide_fg_bg', terms: ['summary.modes.fg', 'summary.modes.bg', 'summary.modes.bg_share'], definition: 'dictionary.fg_bg', origin: 'drive.session_heartbeats.app_state', source: 'bank', rows: [] },
  // days of use
  days('1'),
  days('2'),
  days('3_5'),
  days('6_plus'),
  // use funnel
  { key: 'installs', terms: ['summary.use_funnel.installs'], definition: 'summary.use_funnel.installs_hint', origin: 'GA4 first_open → social.funnel_daily', source: 'ga4', rows: [] },
  { key: 'entered', terms: ['summary.use_funnel.entered'], definition: 'summary.use_funnel.entered_hint', origin: 'core.dashboard_acquisition', source: 'bank', rows: [] },
  { key: 'new_engaged', terms: ['summary.use_funnel.new_engaged'], definition: 'summary.use_funnel.new_engaged_hint', origin: 'GA4 ENGAGED_EVENTS · firstSessionDate', source: 'ga4', rows: [] },
  { key: 'used', terms: ['summary.use_funnel.used'], definition: 'summary.use_funnel.used_hint', origin: `${TRIPS} · drive.poi_visits`, source: 'bank', rows: [] },
  { key: 'consumed_1h', terms: ['summary.use_funnel.consumed_1h'], definition: 'summary.use_funnel.consumed_1h_hint', origin: 'drive.time_credit_consumption', source: 'bank', rows: [] },
  // purchase funnel
  { key: 'purchased', terms: ['summary.purchase_funnel.purchased'], definition: 'summary.purchase_funnel.purchased_hint', origin: 'drive.time_credit_grants · drive.subscription_history', source: 'bank', rows: [] },
  { key: 'tested', terms: ['summary.purchase_funnel.tested'], definition: 'summary.purchase_funnel.tested_hint', origin: 'drive.time_credit_consumption', source: 'bank', rows: [] },
  { key: 'untested', terms: ['summary.purchase_funnel.untested'], definition: 'summary.purchase_funnel.untested_hint', origin: 'drive.time_credit_consumption', source: 'bank', rows: [] },
  { key: 'paywall_viewed', terms: ['summary.purchase_funnel.paywall_viewed'], definition: 'summary.purchase_funnel.paywall_viewed_hint', origin: 'GA4 paywall_viewed', source: 'ga4', rows: [] },
  // free minutes histogram
  { key: 'free_minutes', terms: ['summary.free_minutes.title'], definition: 'summary.free_minutes.hint', origin: 'core.cms_get_free_minutes_histogram', source: 'bank', rows: [] },
  // cohorts
  { key: 'activation', terms: ['rows.audio_24h', 'rows.audio_7d'], definition: 'rows.audio_24h_hint', origin: `${TRIPS} · drive.poi_visits (audio_played)`, source: 'bank', rows: ['audio_24h', 'audio_7d'] },
  { key: 'cohort_size', terms: ['rows.cohort_size'], definition: 'rows.cohort_size_hint', origin: TRIPS, source: 'bank', rows: ['cohort_size'] },
  { key: 'ret', terms: ['rows.ret_d1', 'rows.ret_d7', 'rows.ret_d30', 'rows.ret_d60', 'rows.ret_d90'], definition: 'rows.ret_hint', values: { days: 'N' }, origin: TRIPS, source: 'bank', rows: ['ret_d1', 'ret_d7', 'ret_d30', 'ret_d60', 'ret_d90'] },
  { key: 'ret_on', terms: ['rows.ret_on_d1', 'rows.ret_on_d7', 'rows.ret_on_d30'], definition: 'rows.ret_on_hint', values: { days: 'N' }, origin: TRIPS, source: 'bank', rows: ['ret_on_d1', 'ret_on_d7', 'ret_on_d30'] },
  { key: 'second', terms: ['rows.second_30', 'rows.second_60', 'rows.second_90'], definition: 'rows.second_hint', values: { days: 'N' }, origin: TRIPS, source: 'bank', rows: ['second_30', 'second_60', 'second_90'] },
  // detail
  { key: 'active_ga4', terms: ['rows.active_ga4'], definition: 'rows.active_ga4_hint', origin: 'GA4 activeUsers', source: 'ga4', rows: ['active_ga4'] },
  { key: 'active_by', terms: ['rows.active_by'], definition: 'rows.active_by_hint', origin: USE_TABLES, source: 'bank', rows: ['active_by'] },
  { key: 'use_open', terms: ['use_open'], definition: 'dictionary.use_open', origin: 'drive.app_opens', source: 'bank', rows: [] },
  { key: 'use_trip', terms: ['use_trip'], definition: 'dictionary.use_trip', origin: `${TRIPS}.start_time`, source: 'bank', rows: [] },
  { key: 'use_audio', terms: ['use_audio'], definition: 'dictionary.use_audio', origin: 'drive.poi_visits (audio_played)', source: 'bank', rows: [] },
  { key: 'new_by', terms: ['rows.new_by'], definition: 'rows.new_by_hint', origin: USE_TABLES, source: 'bank', rows: ['new_by'] },
  { key: 'guide_p75', terms: ['rows.guide_p75'], definition: 'rows.guide_p75_hint', origin: `${TRIPS}.duration`, source: 'bank', rows: ['guide_p75'] },
  { key: 'sessions_ga4', terms: ['rows.sessions_ga4'], definition: 'rows.sessions_ga4_hint', origin: 'GA4 sessionsPerUser', source: 'ga4', rows: ['sessions_ga4'] },
  { key: 'clicks', terms: ['card_clicks'], definition: 'dictionary.clicks', origin: 'GA4 button_clicked', source: 'ga4', rows: [] },
]
