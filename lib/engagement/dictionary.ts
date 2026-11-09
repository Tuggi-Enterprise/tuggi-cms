/**
 * The dictionary at the foot of the Engagement report (#1154): for each line, what it counts, the
 * event or table it reads and its source. The words live in i18n (`reports.engagement.dictionary.items`);
 * this owns the order, the source and which grid rows each entry explains, so a test proves every
 * row of the grid has a definition with the right source (DS-COMPONENTE-084 item 2: GA4 and the
 * database are named apart, never mixed).
 */

import type { RowSource } from '@/lib/engagement/cells'

export interface DictionaryEntry {
  key: string
  source: RowSource
  /** The `GridRow` keys this entry defines; empty for a number outside the grid (tiles, modes, clicks). */
  rows: readonly string[]
}

export const ENGAGEMENT_DICTIONARY: readonly DictionaryEntry[] = [
  { key: 'engaged', source: 'ga4', rows: [] },
  { key: 'active_ga4', source: 'ga4', rows: ['active_ga4'] },
  // `active_by` reads the selected use: each of the three defines it for its own use.
  { key: 'use_open', source: 'bank', rows: ['active_by'] },
  { key: 'use_trip', source: 'bank', rows: ['active_by'] },
  { key: 'use_audio', source: 'bank', rows: ['active_by'] },
  { key: 'new_by', source: 'bank', rows: ['new_by'] },
  { key: 'screen_minutes', source: 'ga4', rows: ['screen_minutes'] },
  { key: 'guide_time', source: 'bank', rows: ['guide_median', 'guide_p75'] },
  { key: 'guide_fg_bg', source: 'bank', rows: [] },
  { key: 'modes', source: 'bank', rows: [] },
  { key: 'sessions_ga4', source: 'ga4', rows: ['sessions_ga4'] },
  { key: 'days', source: 'bank', rows: ['days_1', 'days_2', 'days_3_5', 'days_6_plus'] },
  { key: 'returned_next', source: 'bank', rows: ['returned_next'] },
  { key: 'activation', source: 'bank', rows: ['audio_24h', 'audio_7d'] },
  { key: 'cohort_size', source: 'bank', rows: ['cohort_size'] },
  { key: 'ret', source: 'bank', rows: ['ret_d1', 'ret_d7', 'ret_d30', 'ret_d60', 'ret_d90'] },
  { key: 'ret_on', source: 'bank', rows: ['ret_on_d1', 'ret_on_d7', 'ret_on_d30'] },
  { key: 'second', source: 'bank', rows: ['second_30', 'second_60', 'second_90'] },
  { key: 'clicks', source: 'ga4', rows: [] },
]
