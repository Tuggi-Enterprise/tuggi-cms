/** Reads of the Acquisition page (#1171): `core.dashboard_acquisition` and `social.acquisition_funnel`. */

export const MONTH = '2026-11-01'

export const MONTHS = ['2026-11-01', '2026-10-01']

export const ACQUISITION = {
  month: MONTH,
  scoped: false,
  summary: {
    total: 64, with_partner: 9, located: 41, outside_boundaries: 12, without_origin: 11, from_fallback: 3,
    distinct_cities: 9, distinct_countries: 4, in_clusters: 18, origin_within_1h: 47, days_elapsed: 9,
  },
  daily: Array.from({ length: 9 }, (_, i) => ({ day: `2026-11-0${i + 1}`, total: 7, with_partner: 1, cumulative: 7 * (i + 1) })),
  cities: [
    { city: 'Cabo Frio', country: 'Brazil', status: 'located', total: 18, with_partner: 4 },
    { city: 'Armação dos Búzios', country: 'Brazil', status: 'located', total: 12, with_partner: 3 },
    { city: '', country: 'Brazil', status: 'outside_boundaries', total: 12, with_partner: 0 },
    { city: '', country: '', status: 'without_origin', total: 11, with_partner: 0 },
  ],
  countries: [
    { country: 'Brazil', status: 'identified', total: 48, with_partner: 8, ios: 15, android: 33 },
    { country: 'Argentina', status: 'identified', total: 5, with_partner: 1, ios: 2, android: 3 },
    { country: '', status: 'without_origin', total: 11, with_partner: 0, ios: 4, android: 7 },
  ],
  platforms: [
    { platform: 'android', total: 41, with_partner: 6 },
    { platform: 'ios', total: 21, with_partner: 3 },
    { platform: '', total: 2, with_partner: 0 },
  ],
  partners: [{ partner_id: 'p1', name: 'Locadora Sol', total: 9 }],
  clusters: [],
}

const NO_SOURCE = { apple_store: null, play: null, site_channels: null, search_console: null, ga4: null }

/** Today's production: only the app's GA4 collects, the stores, the website and Search Console have no collector. */
export const FUNNEL_TODAY = {
  coverage: { ...NO_SOURCE, ga4: '2026-08-20' },
  through: { ...NO_SOURCE, ga4: '2026-11-08' },
  site: [],
  stores: [],
  terms: [],
  queries: [],
  installs: [
    { store: 'app_store', installs_ga4: 23, installs_store: null, uninstalls: null },
    { store: 'play_store', installs_ga4: 48, installs_store: null, uninstalls: null },
  ],
}

/** Every collector on, the App Store starting inside October: the shape the design spec draws. */
export const FUNNEL_FULL = {
  coverage: { apple_store: '2026-10-12', play: '2026-09-01', site_channels: '2026-09-01', search_console: '2026-09-01', ga4: '2026-08-20' },
  through: { apple_store: '2026-10-31', play: '2026-10-31', site_channels: '2026-10-31', search_console: '2026-10-31', ga4: '2026-10-31' },
  site: [
    { channel: 'Organic Search', sessions: 1840, users: 1610, clicks_app_store: 61, clicks_play_store: 94 },
    { channel: 'Direct', sessions: 920, users: 805, clicks_app_store: 40, clicks_play_store: 52 },
    { channel: 'Organic Social', sessions: 410, users: 377, clicks_app_store: 18, clicks_play_store: 33 },
    { channel: 'Paid Search', sessions: 35, users: 31, clicks_app_store: 1, clicks_play_store: 2 },
    { channel: 'Display', sessions: 12, users: 12, clicks_app_store: 0, clicks_play_store: 0 },
  ],
  stores: [
    { store: 'app_store', source: 'store_search', impressions: 3200, page_views: 620, downloads: 150 },
    { store: 'app_store', source: 'store_browse', impressions: 760, page_views: 210, downloads: 28 },
    { store: 'app_store', source: 'web_referrer', impressions: 180, page_views: 160, downloads: 26 },
    { store: 'app_store', source: 'app_referrer', impressions: 40, page_views: 22, downloads: 4 },
    { store: 'app_store', source: 'other', impressions: 30, page_views: 8, downloads: 2 },
    { store: 'play_store', source: 'store_search', impressions: null, page_views: 540, downloads: 132 },
    { store: 'play_store', source: 'store_browse', impressions: null, page_views: 170, downloads: 31 },
    { store: 'play_store', source: 'third_party', impressions: null, page_views: 130, downloads: 24 },
    { store: 'play_store', source: 'other', impressions: null, page_views: 20, downloads: 3 },
  ],
  terms: [
    { store: 'play_store', term: 'búzios guia', page_views: 120, downloads: 41 },
    { store: 'play_store', term: 'audio guia turismo região dos lagos', page_views: 88, downloads: 27 },
    { store: 'play_store', term: 'cabo frio', page_views: 64, downloads: 12 },
  ],
  queries: [
    { query: 'o que fazer em búzios', clicks: 210, impressions: 5400, position: 6.4 },
    { query: 'tuggi', clicks: 160, impressions: 410, position: 1.1 },
    { query: 'passeios em arraial do cabo', clicks: 72, impressions: 3900, position: 11.8 },
  ],
  installs: [
    { store: 'app_store', installs_ga4: 152, installs_store: 189, uninstalls: 31 },
    { store: 'play_store', installs_ga4: 171, installs_store: 176, uninstalls: 58 },
  ],
}

// ── #1309: stores by country and the store search position (contract banco-para-cms Parte 31) ──

const october = Array.from({ length: 31 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`)

/** The job dates of `social.collector_runs`: the stores since September, the search tracker since October. */
export const ASO_JOBS = [
  { job: 'apple_store', covered_from: '2026-09-01' },
  { job: 'play', covered_from: '2026-09-01' },
  { job: 'store_rank', covered_from: '2026-10-01' },
]

/**
 * October by country. The App Store detail only starts on 12/10 (a floor), Play covers the month. Italy
 * has no Play row (unknown, never 0), Argentina no App Store row. App Store countries add up to 200
 * downloads, 10 under the 210 of the funnel; Play to 190, the funnel's.
 */
export const COUNTRY_DAYS = [
  ...october.slice(11).flatMap((day) => [
    { day, store: 'app_store', country: 'BR', impressions: 150, page_views: 40, downloads: 7 },
    { day, store: 'app_store', country: 'US', impressions: 30, page_views: 6, downloads: 2 },
    { day, store: 'app_store', country: 'IT', impressions: 15, page_views: 3, downloads: 1 },
  ]),
  ...october.flatMap((day) => [
    { day, store: 'play_store', country: 'BR', impressions: null, page_views: 20, downloads: 5 },
    { day, store: 'play_store', country: 'US', impressions: null, page_views: 3, downloads: 1 },
  ]),
  { day: '2026-10-05', store: 'play_store', country: 'AR', impressions: null, page_views: 10, downloads: 4 },
]

export const RANK_KEYWORDS = [
  { id: 'k-audio', keyword: 'audioguia', country: 'BR', active: true },
  { id: 'k-guide', keyword: 'guia de viagem', country: 'BR', active: true },
  { id: 'k-route', keyword: 'roteiro', country: 'BR', active: true },
  { id: 'k-boat', keyword: 'passeio de barco', country: 'BR', active: true },
  { id: 'k-lisbon', keyword: 'audioguia lisboa', country: 'PT', active: true },
]

export const RANK_APPS = [
  { id: 'own-ios', store: 'app_store', name: 'Tuggi', is_own: true },
  { id: 'own-play', store: 'play_store', name: 'Tuggi', is_own: true },
  { id: 'gyg-ios', store: 'app_store', name: 'GetYourGuide', is_own: false },
  { id: 'smart-ios', store: 'app_store', name: 'SmartGuide', is_own: false },
  { id: 'voice-ios', store: 'app_store', name: 'VoiceMap', is_own: false },
  { id: 'steves-ios', store: 'app_store', name: 'Rick Steves', is_own: false },
  { id: 'gyg-play', store: 'play_store', name: 'GetYourGuide', is_own: false },
  { id: 'smart-play', store: 'play_store', name: 'SmartGuide', is_own: false },
  { id: 'voice-play', store: 'play_store', name: 'VoiceMap', is_own: false },
]

/** Our position by keyword on day `i` (0 is 01/10): up 3 on audioguia, down 2 on guia, out of roteiro after 25/10, never in passeio de barco. */
const OWN: Record<string, (i: number) => number | null> = {
  'k-audio': (i) => 7 - Math.round((3 * i) / 30),
  'k-guide': (i) => 16 + Math.round((2 * i) / 30),
  'k-route': (i) => (i < 25 ? 30 : null),
  'k-boat': () => null,
}
const RIVALS: Record<string, number | null> = { gyg: 2, smart: null, voice: 11, steves: 14 }
/** Play blocked the reading from 14/10 to 17/10: no row of the store those days. */
const PLAY_BLOCKED = new Set(['2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17'])

/** October of the search tracker: 1,052 rows, past one page of PostgREST. */
export const RANK_DAYS = october.flatMap((day, i) =>
  (['app_store', 'play_store'] as const).flatMap((store) => {
    if (store === 'play_store' && PLAY_BLOCKED.has(day)) return []
    const suffix = store === 'app_store' ? 'ios' : 'play'
    const read = store === 'app_store' ? 200 : 50
    return Object.keys(OWN).flatMap((keyword_id) => [
      { day, store, keyword_id, app_id: `own-${suffix}`, position: OWN[keyword_id](i), results_read: read },
      ...Object.entries(RIVALS)
        .filter(([name]) => store === 'app_store' || name !== 'steves')
        .map(([name, position]) => ({ day, store, keyword_id, app_id: `${name}-${suffix}`, position, results_read: read })),
    ])
  })
)
