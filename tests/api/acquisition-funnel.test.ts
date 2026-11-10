/**
 * The acquisition funnel of the Acquisition page (#1171): rate, floor and "no data" by source.
 *
 * The defects these guard against are the ones DS-COMPONENTE-084 names: a store with no collector
 * printing 0 (a measurement nobody made), a store that covers part of the month printing its number
 * as the whole month, and a rate across two rulers. On the App Store the base is impressions, because
 * Apple counts the "Get" tapped straight from a search result as a download with no page view, so
 * downloads over page views goes past 100 % and means nothing. Google Play has no impressions, so its
 * base is the page view.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  enteredByStore,
  funnelCoverage,
  originTable,
  parseAcquisitionFunnel,
  showsStoreLag,
  siteTable,
  sourceCoverage,
  storeFunnel,
  storeTotals,
} from '../../lib/acquisition/funnel'

const MONTH = '2026-10-01'

/** The empty shape of the contract (Parte 28): no collector anywhere. */
const EMPTY = {
  coverage: { apple_store: null, play: null, site_channels: null, search_console: null, ga4: null },
  through: { apple_store: null, play: null, site_channels: null, search_console: null, ga4: null },
  site: [],
  stores: [],
  terms: [],
  queries: [],
  installs: [
    { store: 'app_store', installs_ga4: null, installs_store: null, uninstalls: null },
    { store: 'play_store', installs_ga4: null, installs_store: null, uninstalls: null },
  ],
}

const FULL = { apple_store: '2026-09-01', play: '2026-09-01', site_channels: '2026-09-01', search_console: '2026-09-01', ga4: '2026-09-01' }
const THROUGH_END = { apple_store: '2026-10-31', play: '2026-10-31', site_channels: '2026-10-31', search_console: '2026-10-31', ga4: '2026-10-31' }

const stepOf = (view: ReturnType<typeof storeFunnel>, key: string) => {
  const s = view.steps.find((x) => x.key === key)
  assert.ok(s, `step ${key} exists`)
  return s
}

test('DS-COMPONENTE-084 item 1: coverage has three states, with the reason of none', () => {
  assert.deepEqual(sourceCoverage(MONTH, null, null).state, 'none')
  assert.equal(sourceCoverage(MONTH, null, null).none, 'not_configured')

  const later = sourceCoverage(MONTH, '2026-11-03', null)
  assert.equal(later.state, 'none')
  assert.equal(later.none, 'before_start')
  assert.equal(later.from, '2026-11-03')

  const since = sourceCoverage(MONTH, '2026-10-12', '2026-10-31')
  assert.equal(since.state, 'partial', 'a collector that starts inside the month is a floor')
  assert.equal(since.from, '2026-10-12')

  assert.equal(sourceCoverage(MONTH, '2026-10-01', '2026-10-31').state, 'full', 'covering from the first day is full')
  assert.equal(sourceCoverage(MONTH, '2026-01-01', '2026-10-31').state, 'full')
})

test('DS-COMPONENTE-084 item 1: a source whose last day is before the end of the month is a floor', () => {
  // The month still open, or a collector that stopped: the last days are missing, never zero.
  const open = sourceCoverage(MONTH, '2026-09-01', '2026-10-27')
  assert.equal(open.state, 'partial')
  assert.equal(open.through, '2026-10-27')

  const stopped = sourceCoverage(MONTH, '2026-09-01', '2026-09-20')
  assert.equal(stopped.state, 'partial', 'a through before the first day of the month is partial, not full')
  assert.equal(stopped.through, '2026-09-20')

  const nothing = sourceCoverage(MONTH, '2026-09-01', null)
  assert.equal(nothing.state, 'partial')
  assert.equal(nothing.noRows, true)

  // February has 28 days: the last day comes from the calendar, not from a constant 31.
  assert.equal(sourceCoverage('2026-02-10', '2026-01-01', '2026-02-28').state, 'full')
})

test('DS-COMPONENTE-084 item 1: no collector prints no number in the store funnel, never 0', () => {
  const f = parseAcquisitionFunnel(EMPTY)
  const cov = funnelCoverage(f, MONTH)
  for (const store of ['app_store', 'play_store'] as const) {
    const view = storeFunnel(store, f, cov, 7)
    for (const key of ['impressions', 'page_views', 'downloads', 'installs_ga4']) {
      const s = stepOf(view, key)
      assert.equal(s.value, null, `${store} ${key} is unknown`)
      assert.equal(s.state, 'unknown')
      assert.equal(s.rate, null)
    }
    assert.equal(stepOf(view, 'entered').value, 7, 'entered is the bank, another boundary, and keeps its value')
    const totals = storeTotals(store, f.stores, cov[store === 'app_store' ? 'apple_store' : 'play'])
    assert.deepEqual(totals, { impressions: null, pageViews: null, downloads: null })
  }
  assert.deepEqual(f.installs.app_store, { installsGa4: null, installsStore: null, uninstalls: null })
})

test('DS-COMPONENTE-084 item 1: GA4 installs measured while the stores have no collector', () => {
  // Today's real state: only the app's GA4 collects. Its row prints; the store rows stay unknown.
  const f = parseAcquisitionFunnel({
    ...EMPTY,
    coverage: { ...EMPTY.coverage, ga4: '2026-09-01' },
    through: { ...EMPTY.through, ga4: '2026-10-31' },
    installs: [
      { store: 'app_store', installs_ga4: 60, installs_store: null, uninstalls: null },
      { store: 'play_store', installs_ga4: 0, installs_store: null, uninstalls: null },
    ],
  })
  const cov = funnelCoverage(f, MONTH)
  const ios = storeFunnel('app_store', f, cov, 41)
  assert.equal(stepOf(ios, 'installs_ga4').value, 60)
  assert.equal(stepOf(ios, 'installs_ga4').hollow, true)
  assert.equal(stepOf(ios, 'installs_ga4').rate, null, 'GA4 is another ruler: no rate')
  assert.equal(stepOf(ios, 'downloads').value, null)
  const android = storeFunnel('play_store', f, cov, 0)
  assert.equal(stepOf(android, 'installs_ga4').value, 0, 'zero measured by GA4 is 0, not unknown')
  assert.equal(stepOf(android, 'installs_ga4').state, 'measured')
})

test('DS-COMPONENTE-084 item 2: the Play base is the page view, and its impressions are never 0', () => {
  const f = parseAcquisitionFunnel({
    ...EMPTY,
    coverage: FULL,
    through: THROUGH_END,
    stores: [
      { store: 'play_store', source: 'store_search', impressions: null, page_views: 600, downloads: 150 },
      { store: 'play_store', source: 'third_party', impressions: null, page_views: 260, downloads: 40 },
    ],
  })
  const view = storeFunnel('play_store', f, funnelCoverage(f, MONTH), 77)
  const impressions = stepOf(view, 'impressions')
  assert.equal(impressions.value, null)
  assert.equal(impressions.reason, 'not_measured')
  assert.equal(view.base, 860, 'the base falls on the page view')
  assert.equal(stepOf(view, 'page_views').rate, 1)
  assert.equal(stepOf(view, 'downloads').rate?.toFixed(3), (190 / 860).toFixed(3))
  assert.equal(stepOf(view, 'entered').rate, null, 'entered is hollow: no rate across rulers')
})

test('DS-COMPONENTE-084 item 2: App Store downloads above page views are a gain, not a rate over 100 %', () => {
  const f = parseAcquisitionFunnel({
    ...EMPTY,
    coverage: FULL,
    through: THROUGH_END,
    stores: [{ store: 'app_store', source: 'store_search', impressions: 4000, page_views: 100, downloads: 150 }],
  })
  const view = storeFunnel('app_store', f, funnelCoverage(f, MONTH), 41)
  assert.equal(view.base, 4000, 'the App Store base is the impression')
  const downloads = stepOf(view, 'downloads')
  assert.equal(downloads.rate, 150 / 4000)
  assert.ok((downloads.rate as number) < 1, 'never downloads over page views')
  assert.equal(downloads.gain, 50, 'the excess over page views prints as a gain')
  assert.equal(downloads.lost, null)
})

test('DS-COMPONENTE-084 item 2: a zero base prints no rate', () => {
  const f = parseAcquisitionFunnel({
    ...EMPTY,
    coverage: FULL,
    through: THROUGH_END,
    stores: [{ store: 'play_store', source: 'store_search', impressions: null, page_views: 0, downloads: 0 }],
  })
  const view = storeFunnel('play_store', f, funnelCoverage(f, MONTH), 0)
  assert.equal(stepOf(view, 'page_views').value, 0, 'zero measured is 0')
  assert.equal(stepOf(view, 'downloads').rate, null, 'denominator zero: no rate')
  const rows = originTable('play_store', f.stores, funnelCoverage(f, MONTH).play)
  assert.equal(rows.find((r) => r.source === 'store_search')?.conversion, null)
})

test('DS-COMPONENTE-084 items 1 and 2: partial coverage marks a floor and keeps the rate inside the store', () => {
  const f = parseAcquisitionFunnel({
    ...EMPTY,
    coverage: { ...FULL, apple_store: '2026-10-12' },
    through: THROUGH_END,
    stores: [{ store: 'app_store', source: 'store_search', impressions: 1000, page_views: 200, downloads: 50 }],
    installs: [
      { store: 'app_store', installs_ga4: 30, installs_store: 20, uninstalls: 4 },
      { store: 'play_store', installs_ga4: 12, installs_store: 0, uninstalls: 0 },
    ],
  })
  const view = storeFunnel('app_store', f, funnelCoverage(f, MONTH), 10)
  for (const key of ['impressions', 'page_views', 'downloads']) {
    assert.equal(stepOf(view, key).state, 'floor', `${key} is a floor`)
  }
  assert.equal(stepOf(view, 'downloads').rate, 0.05, 'same report, same window: the rate still prints')
  assert.equal(stepOf(view, 'installs_ga4').state, 'measured', 'GA4 has its own boundary')
})

test('the origin table adds up to the store funnel, and a source the store does not classify is not a row', () => {
  const stores = [
    { store: 'app_store', source: 'store_search', impressions: 3000, page_views: 700, downloads: 150 },
    { store: 'app_store', source: 'web_referrer', impressions: 200, page_views: 200, downloads: 40 },
    { store: 'app_store', source: 'third_party', impressions: 10, page_views: 10, downloads: 5 },
    { store: 'play_store', source: 'store_search', impressions: null, page_views: 500, downloads: 100 },
  ]
  const f = parseAcquisitionFunnel({ ...EMPTY, coverage: FULL, through: THROUGH_END, stores })
  const cov = funnelCoverage(f, MONTH).apple_store
  const rows = originTable('app_store', f.stores, cov)
  assert.deepEqual(
    rows.map((r) => r.source),
    ['store_search', 'store_browse', 'web_referrer', 'app_referrer', 'other', 'total']
  )
  assert.equal(rows.find((r) => r.source === 'store_browse')?.downloads, 0, 'a listed source with no row, covered, is 0')
  assert.equal(rows.find((r) => r.source === 'other')?.downloads, 5, 'an unclassified source adds up in other')
  const total = rows.find((r) => r.source === 'total')!
  const funnel = storeTotals('app_store', f.stores, cov)
  assert.deepEqual({ impressions: total.impressions, pageViews: total.pageViews, downloads: total.downloads }, funnel)
  assert.equal(total.conversion, 195 / 3210, 'App Store conversion is downloads over impressions')

  const play = originTable('play_store', f.stores, funnelCoverage(f, MONTH).play)
  assert.ok(!play.some((r) => r.source === ('web_referrer' as string)), 'Play does not split web from app')
  assert.equal(play.find((r) => r.source === 'store_search')?.conversion, 0.2, 'Play conversion is downloads over page views')
})

test('DS-COMPONENTE-084 item 2: the website total has no users, because a person comes by two channels', () => {
  const t = siteTable(
    parseAcquisitionFunnel({
      ...EMPTY,
      site: [
        { channel: 'Organic Search', sessions: 120, users: 100, clicks_app_store: 4, clicks_play_store: 6 },
        { channel: 'Direct', sessions: 300, users: 250, clicks_app_store: 10, clicks_play_store: 12 },
        { channel: 'Paid Search', sessions: 5, users: 5, clicks_app_store: 0, clicks_play_store: 1 },
        { channel: 'Display', sessions: 3, users: 3, clicks_app_store: null, clicks_play_store: null },
        { channel: 'Email', sessions: 0, users: 0, clicks_app_store: 0, clicks_play_store: 0 },
      ],
    }).site
  )
  assert.deepEqual(
    t.rows.map((r) => r.key),
    ['Direct', 'Organic_Search', 'other'],
    'by sessions, other last, a channel with no session is not a row'
  )
  assert.deepEqual(t.rows[2].channels, ['Paid Search', 'Display'])
  assert.equal(t.rows[2].sessions, 8)
  assert.equal(t.rows[2].clicksAppStore, 0)
  assert.equal(t.total.users, null)
  assert.equal(t.total.sessions, 428)
  assert.equal(t.total.clicksPlayStore, 19)
})

test('entered splits by system: iOS to the App Store, Android to Google Play, the unknown to neither', () => {
  assert.deepEqual(
    enteredByStore([
      { platform: 'ios', total: 41 },
      { platform: 'android', total: 77 },
      { platform: '', total: 3 },
    ]),
    { app_store: 41, play_store: 77, unassigned: 3 }
  )
  assert.deepEqual(enteredByStore([]), { app_store: 0, play_store: 0, unassigned: 0 })
})

test('the store lag note shows while the month is open and for 7 days after it', () => {
  assert.equal(showsStoreLag(MONTH, new Date('2026-10-15T12:00:00Z')), true)
  assert.equal(showsStoreLag(MONTH, new Date('2026-11-07T12:00:00Z')), true)
  assert.equal(showsStoreLag(MONTH, new Date('2026-11-09T12:00:00Z')), false)
})

test('a numeric string from PostgREST is read, and a missing field stays null', () => {
  const f = parseAcquisitionFunnel({
    ...EMPTY,
    queries: [{ query: 'buzios o que fazer', clicks: '12', impressions: 300, position: '4.25' }],
  })
  assert.deepEqual(f.queries[0], { query: 'buzios o que fazer', clicks: 12, impressions: 300, position: 4.25 })
  assert.equal(parseAcquisitionFunnel(null).coverage.apple_store, null)
  assert.deepEqual(parseAcquisitionFunnel(null).installs.play_store, { installsGa4: null, installsStore: null, uninstalls: null })
})
