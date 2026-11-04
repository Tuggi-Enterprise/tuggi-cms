/**
 * #1094: `engagement-ga4`, the GA4 half of the Engagement report. The reports
 * (`_shared/engagement-ga4.ts`) take the runner as an argument, so they run here against a GA4
 * double. Deno source, loaded through a path built at run time: a static `.ts` import fails the
 * repo's `tsc`.
 *
 * Run with: npm run test:api
 */

import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const FUNCTIONS = resolve(import.meta.dirname, '../../supabase/functions')

// Untyped on purpose: a `typeof import` would pull the `.ts` sibling imports into `tsc` (TS5097).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ga4: any

before(async () => {
  ga4 = await import(pathToFileURL(resolve(FUNCTIONS, '_shared/engagement-ga4.ts')).href)
})

const row = (dims: string[], metrics: string[]) => ({
  dimensionValues: dims.map((value) => ({ value })),
  metricValues: metrics.map((value) => ({ value })),
})

test('#1094: the body is validated before GA4: month, platform and country of the contract only', () => {
  assert.deepEqual(ga4.parseEngagementGa4Query({ from_month: '2026-08' }), { fromMonth: '2026-08', platform: null, country: null })
  assert.deepEqual(ga4.parseEngagementGa4Query({ from_month: '2026-08', platform: 'ios', country: 'BR' }), { fromMonth: '2026-08', platform: 'ios', country: 'BR' })
  for (const bad of [null, {}, { from_month: '2026-13' }, { from_month: '2026-08', platform: 'web' }, { from_month: '2026-08', country: 'Brazil' }, { from_month: '2026-08', country: 'br' }]) {
    assert.equal(ga4.parseEngagementGa4Query(bad), null, JSON.stringify(bad))
  }
})

test('#1094: the users report reads by yearMonth until today, and platform and country become GA4 dimension filters', () => {
  const plain = ga4.usersReportBody({ fromMonth: '2026-08', platform: null, country: null })
  assert.deepEqual(plain.dateRanges, [{ startDate: '2026-08-01', endDate: 'today' }])
  assert.deepEqual(plain.dimensions, [{ name: 'yearMonth' }])
  assert.deepEqual(plain.metrics.map((m: { name: string }) => m.name), ['activeUsers', 'userEngagementDuration', 'sessionsPerUser'])
  assert.equal(plain.dimensionFilter, undefined)

  const filtered = ga4.usersReportBody({ fromMonth: '2026-08', platform: 'ios', country: 'BR' })
  assert.deepEqual(filtered.dimensionFilter, {
    andGroup: {
      expressions: [
        { filter: { fieldName: 'platform', stringFilter: { matchType: 'EXACT', value: 'iOS' } } },
        { filter: { fieldName: 'countryId', stringFilter: { matchType: 'EXACT', value: 'BR' } } },
      ],
    },
  })
})

test('#1094: the clicks report is button_clicked by month, screen_name and button_name, events and users', () => {
  const body = ga4.clicksReportBody({ fromMonth: '2026-08', platform: 'android', country: null })
  assert.deepEqual(body.dimensions.map((d: { name: string }) => d.name), ['yearMonth', 'customEvent:screen_name', 'customEvent:button_name'])
  assert.deepEqual(body.metrics.map((m: { name: string }) => m.name), ['eventCount', 'totalUsers'])
  assert.deepEqual(body.dimensionFilter.andGroup.expressions, [
    { filter: { fieldName: 'platform', stringFilter: { matchType: 'EXACT', value: 'Android' } } },
    { filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: 'button_clicked' } } },
  ])
})

test('#1094 BR-COMUNICACAO-022 item 4: parsing keeps a missing sessions number as null and drops rows it cannot read, never as 0', () => {
  const months = ga4.parseUsersReport({
    rows: [
      row(['202609'], ['327', '156960', '2.1']),
      row(['202608'], ['318', '171720', '']),
      row(['bad'], ['1', '1', '1']),
      row(['202610'], ['x', '1', '1']),
    ],
  })
  assert.deepEqual(months, [
    { month: '2026-08', activeUsers: 318, engagementSeconds: 171720, sessionsPerUser: null },
    { month: '2026-09', activeUsers: 327, engagementSeconds: 156960, sessionsPerUser: 2.1 },
  ])
  assert.deepEqual(ga4.parseUsersReport({}), [])

  const clicks = ga4.parseClicksReport({
    rows: [row(['202610', 'guide_map', 'start_guide'], ['301', '142']), row(['202610', 'guide_map'], ['1', '1'])],
  })
  assert.deepEqual(clicks, [{ month: '2026-10', screen: 'guide_map', button: 'start_guide', events: 301, users: 142 }])
})

test('#1094 #1099: the three reports go through one runner, a month without an engaged row is a measured 0, and a GA4 refusal surfaces as the runner error', async () => {
  const bodies: { metrics: { name: string }[] }[] = []
  const report = await ga4.readEngagementGa4(async (body: { dimensions: unknown[]; metrics: { name: string }[] }) => {
    bodies.push(body)
    if (body.dimensions.length > 1) return { rows: [] }
    if (body.metrics[0].name === 'totalUsers') return { rows: [row(['202610'], ['189'])] }
    return { rows: [row(['202609'], ['327', '156960', '2.1']), row(['202610'], ['262', '157200', '2.4'])] }
  }, { fromMonth: '2026-08', platform: null, country: null })
  assert.equal(bodies.length, 3)
  assert.deepEqual(report, {
    months: [
      { month: '2026-09', activeUsers: 327, engagementSeconds: 156960, sessionsPerUser: 2.1, engagedUsers: 0 },
      { month: '2026-10', activeUsers: 262, engagementSeconds: 157200, sessionsPerUser: 2.4, engagedUsers: 189 },
    ],
    clicks: [],
  })
  await assert.rejects(
    ga4.readEngagementGa4(async () => { throw new Error('ga4_report_403') }, { fromMonth: '2026-08', platform: null, country: null }),
    /ga4_report_403/,
  )
})

test('#1099: engaged people are totalUsers by yearMonth under one filter: the engaged events, or button_clicked with an engaged button, inside platform and country', () => {
  assert.deepEqual([...ga4.ENGAGED_EVENTS], ['guide_session_start', 'detail_card_opened', 'story_play_start'])
  assert.deepEqual([...ga4.ENGAGED_BUTTONS], [
    'poi_navigate', 'event_navigate', 'route_navigate', 'search_this_area', 'explore_chip_opened', 'explore_tab_selected', 'explore_filter_opened',
  ])
  // what the operator said does not count
  for (const name of ['app_open', 'discovery_banner_shown', 'location_permission_granted']) {
    assert.ok(!ga4.ENGAGED_EVENTS.includes(name) && !ga4.ENGAGED_BUTTONS.includes(name), name)
  }
  const engaged = {
    orGroup: {
      expressions: [
        { filter: { fieldName: 'eventName', inListFilter: { values: [...ga4.ENGAGED_EVENTS] } } },
        {
          andGroup: {
            expressions: [
              { filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: 'button_clicked' } } },
              { filter: { fieldName: 'customEvent:button_name', inListFilter: { values: [...ga4.ENGAGED_BUTTONS] } } },
            ],
          },
        },
      ],
    },
  }
  const plain = ga4.engagedReportBody({ fromMonth: '2026-08', platform: null, country: null })
  assert.deepEqual(plain.dimensions, [{ name: 'yearMonth' }])
  assert.deepEqual(plain.metrics, [{ name: 'totalUsers' }])
  assert.deepEqual(plain.dateRanges, [{ startDate: '2026-08-01', endDate: 'today' }])
  assert.deepEqual(plain.dimensionFilter, engaged)
  const filtered = ga4.engagedReportBody({ fromMonth: '2026-08', platform: 'ios', country: 'BR' })
  assert.deepEqual(filtered.dimensionFilter.andGroup.expressions, [
    { filter: { fieldName: 'platform', stringFilter: { matchType: 'EXACT', value: 'iOS' } } },
    { filter: { fieldName: 'countryId', stringFilter: { matchType: 'EXACT', value: 'BR' } } },
    engaged,
  ])
})

test('#1094: the function gates with requireAdmin before it reads the body or the credential, and logs no Google body', () => {
  const src = readFileSync(resolve(FUNCTIONS, 'engagement-ga4/index.ts'), 'utf8')
  const gate = src.indexOf('await requireAdmin(req)')
  assert.ok(gate > 0, 'requireAdmin gate')
  assert.ok(gate < src.indexOf('req.json()'), 'gate before the body')
  assert.ok(gate < src.indexOf('parseServiceAccount(Deno.env'), 'gate before the credential')
  assert.doesNotMatch(src, /console\.(log|error)\([^)]*error\.message/)
})
