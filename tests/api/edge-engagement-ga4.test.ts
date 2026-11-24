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
// The exclusion of the devices that are not tourists (#1149), from its one builder.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let notTourist: any

before(async () => {
  ga4 = await import(pathToFileURL(resolve(FUNCTIONS, '_shared/engagement-ga4.ts')).href)
  const data = await import(pathToFileURL(resolve(FUNCTIONS, '_shared/ga4-data.ts')).href)
  notTourist = data.ga4AppFilter()
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
  // #1149: with no filter of its own, the report still leaves out the devices that are not tourists.
  assert.deepEqual(plain.dimensionFilter, notTourist)

  const filtered = ga4.usersReportBody({ fromMonth: '2026-08', platform: 'ios', country: 'BR' })
  assert.deepEqual(filtered.dimensionFilter, {
    andGroup: {
      expressions: [
        { filter: { fieldName: 'platform', stringFilter: { matchType: 'EXACT', value: 'iOS' } } },
        { filter: { fieldName: 'countryId', stringFilter: { matchType: 'EXACT', value: 'BR' } } },
        notTourist,
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
    notTourist,
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

/** A GA4 double that answers each report of `readEngagementGa4` by its dimensions and filter. */
function ga4Double(opts: { refuseCustom?: boolean } = {}) {
  const bodies: { dimensions: { name: string }[]; metrics: { name: string }[]; dimensionFilter?: unknown }[] = []
  const run = async (body: { dimensions: { name: string }[]; metrics: { name: string }[] }) => {
    bodies.push(body)
    const dims = body.dimensions.map((d) => d.name)
    const text = JSON.stringify(body)
    if (opts.refuseCustom && dims.some((d) => d === 'customEvent:permission_type' || d === 'customEvent:completion')) throw new Error('ga4_report_400')
    if (dims.includes('customEvent:screen_name')) return { rows: [] }
    if (dims.includes('firstSessionDate')) return { rows: [row(['202610', '20261003'], ['40'])] }
    // the engaged filter names story_play_start too: it answers before the story report
    if (text.includes('"guide_session_start"')) return { rows: [row(['202610'], ['189'])] }
    if (dims[0] === 'date') return { rows: [row(['20261001'], ['4', '20', '60']), row(['20261002'], ['6', '22', '62']), row(['20261101'], ['3', '18', '55'])] }
    if (dims.includes('customEvent:status')) {
      return { rows: [row(['202610', 'location', 'granted'], ['30']), row(['202610', 'location', 'denied'], ['8']), row(['202610', 'motion', 'granted'], ['12'])] }
    }
    if (dims.includes('customEvent:permission_type')) {
      return text.includes('"limited"')
        ? { rows: [row(['202610', 'location'], ['31']), row(['202610', 'motion'], ['12'])] }
        : { rows: [row(['202610', 'location'], ['36']), row(['202610', 'motion'], ['15']), row(['202609', 'location'], ['20'])] }
    }
    if (dims.includes('customEvent:completion')) return { rows: [row(['202610', 'natural'], ['70']), row(['202610', 'stopped'], ['30']), row(['202609', '(not set)'], ['50'])] }
    if (text.includes('"story_play_start"')) {
      return { rows: [row(['202609', 'story_play_start'], ['200']), row(['202610', 'story_play_start'], ['160']), row(['202609', 'story_play_complete'], ['50']), row(['202610', 'story_play_complete'], ['100'])] }
    }
    if (text.includes('"paywall_viewed"')) {
      return { rows: [row(['202610', 'paywall_viewed'], ['12']), row(['202610', 'paywall_plan_tapped'], ['5']), row(['202609', 'paywall_dismissed'], ['3'])] }
    }
    return { rows: [row(['202609'], ['327', '156960', '2.1']), row(['202610'], ['262', '157200', '2.4'])] }
  }
  return { bodies, run }
}

const Q = { fromMonth: '2026-08', platform: null, country: null }

test('#1094 #1099 #1101 #1156 #1161: eleven reports through one runner, never more than five at once, every one with the non-tourist exclusion; a standard report refused surfaces as the runner error', async () => {
  const { bodies, run } = ga4Double()
  let open = 0
  let peak = 0
  const report = await ga4.readEngagementGa4(async (body: { dimensions: { name: string }[]; metrics: { name: string }[] }) => {
    open++
    peak = Math.max(peak, open)
    await new Promise((r) => setTimeout(r, 1))
    try {
      return await run(body)
    } finally {
      open--
    }
  }, Q)
  assert.equal(bodies.length, 11)
  assert.ok(peak <= 5, `peak ${peak}`)
  for (const body of bodies) {
    assert.ok(JSON.stringify(body.dimensionFilter).includes(JSON.stringify(notTourist)), JSON.stringify(body.dimensions))
  }
  assert.deepEqual(report.unavailable, {})
  assert.equal(report.months.length, 2)
  const [sep, oct] = report.months
  assert.equal(sep.engagedUsers, 0)
  assert.equal(oct.engagedUsers, 189)
  assert.equal(oct.newEngagedUsers, 40)
  await assert.rejects(
    ga4.readEngagementGa4(async () => { throw new Error('ga4_report_403') }, Q),
    /ga4_report_403/,
  )
})

test('#1161 DS-COMPONENTE-084 item 1: each paywall event is null before its first month and a measured 0 after it, event by event', async () => {
  const { run } = ga4Double()
  const { months: [sep, oct] } = await ga4.readEngagementGa4(run, Q)
  // viewed first appears in October: September is unknown, not 0
  assert.equal(sep.paywallViewedUsers, null)
  assert.equal(oct.paywallViewedUsers, 12)
  assert.equal(oct.paywallPlanTappedUsers, 5)
  // dismissed first appears in September: October without a row is a measured 0
  assert.equal(sep.paywallDismissedUsers, 3)
  assert.equal(oct.paywallDismissedUsers, 0)
  // never received: unknown in every month
  assert.equal(oct.paywallConvertedUsers, null)
  assert.equal(oct.paywallPurchaseFailedUsers, null)
  const body = ga4.paywallReportBody({ fromMonth: '2026-08', platform: 'android', country: 'BR' })
  assert.deepEqual(body.dimensions, [{ name: 'yearMonth' }, { name: 'eventName' }])
  assert.deepEqual(body.metrics, [{ name: 'totalUsers' }])
  const filter = JSON.stringify(body.dimensionFilter)
  for (const part of ['"paywall_viewed"', '"paywall_dismissed"', '"paywall_plan_tapped"', '"paywall_purchase_failed"', '"paywall_converted"', '"Android"', '"BR"']) assert.ok(filter.includes(part), part)
})

test('#1161: permissions per type are distinct devices, asked of any status and allowed of granted or limited, with each status beside; a type never answered is null', async () => {
  const { run } = ga4Double()
  const { months: [sep, oct] } = await ga4.readEngagementGa4(run, Q)
  assert.deepEqual(oct.permissions.location, { asked: 36, allowed: 31, byStatus: { granted: 30, denied: 8, blocked: 0, limited: 0 } })
  assert.deepEqual(oct.permissions.motion, { asked: 15, allowed: 12, byStatus: { granted: 12, denied: 0, blocked: 0, limited: 0 } })
  assert.equal(oct.permissions.notifications, null)
  // location first answered in September; motion only in October
  assert.equal(sep.permissions.location.asked, 20)
  assert.equal(sep.permissions.motion, null)
  const allowed = ga4.permissionTypeReportBody(Q, true)
  assert.deepEqual(allowed.dimensions, [{ name: 'yearMonth' }, { name: 'customEvent:permission_type' }])
  assert.ok(JSON.stringify(allowed.dimensionFilter).includes('{"fieldName":"customEvent:status","inListFilter":{"values":["granted","limited"]}}'))
  assert.ok(!JSON.stringify(ga4.permissionTypeReportBody(Q, false).dimensionFilter).includes('customEvent:status'))
  assert.deepEqual(ga4.permissionStatusReportBody(Q).dimensions.map((d: { name: string }) => d.name), ['yearMonth', 'customEvent:permission_type', 'customEvent:status'])
})

test('#1161: the daily active windows are averaged over the days of each month, one decimal', async () => {
  const { run } = ga4Double()
  const { months: [, oct] } = await ga4.readEngagementGa4(run, Q)
  assert.equal(oct.active1DayAvg, 5)
  assert.equal(oct.active7DayAvg, 21)
  assert.equal(oct.active28DayAvg, 61)
  const body = ga4.activeDailyReportBody(Q)
  assert.deepEqual(body.dimensions, [{ name: 'date' }])
  assert.deepEqual(body.metrics.map((m: { name: string }) => m.name), ['active1DayUsers', 'active7DayUsers', 'active28DayUsers'])
})

test('#1161 DS-COMPONENTE-084 item 1: story starts and ends are events; natural ends are null before the first month that carries completion', async () => {
  const { run } = ga4Double()
  const report = await ga4.readEngagementGa4(run, Q)
  const [sep, oct] = report.months
  assert.equal(report.storyCompletionSince, '2026-10')
  assert.deepEqual([sep.storyStarts, sep.storyCompletes, sep.storyCompletesNatural], [200, 50, null])
  assert.deepEqual([oct.storyStarts, oct.storyCompletes, oct.storyCompletesNatural], [160, 100, 70])
  assert.deepEqual(ga4.storyCompletionReportBody(Q).metrics, [{ name: 'eventCount' }])
})

test('#1161: GA4 refusing the custom dimensions empties permissions and natural ends, names them, and keeps the rest of the report', async () => {
  const { run } = ga4Double({ refuseCustom: true })
  const report = await ga4.readEngagementGa4(run, Q)
  assert.deepEqual(report.unavailable, { permissions: 'ga4_report_400', story_completion: 'ga4_report_400' })
  assert.equal(report.storyCompletionSince, null)
  const oct = report.months[1]
  assert.equal(oct.permissions, null)
  assert.equal(oct.storyCompletesNatural, null)
  assert.equal(oct.storyStarts, 160)
  assert.equal(oct.paywallViewedUsers, 12)
})

test('#1101 spec C16 item 10 BR-COMUNICACAO-022 item 4: new engaged users sum only the rows whose first session is inside the month; (not set) and a bad date are dropped', () => {
  const byMonth = ga4.parseNewEngagedReport({
    rows: [
      row(['202610', '20261003'], ['40']),
      row(['202610', '20261031'], ['5']),
      row(['202610', '20260915'], ['70']), // first session in September: not October's cohort
      row(['202610', '(not set)'], ['9']),
      row(['202611', '20261101'], ['3']),
      row(['202611', '2026110'], ['1']),
      row(['bad', '20261101'], ['1']),
      row(['202611', '20261102'], ['x']),
    ],
  })
  assert.deepEqual([...byMonth.entries()], [['2026-10', 45], ['2026-11', 3]])
  assert.equal(ga4.parseNewEngagedReport({}).size, 0)
})

test('#1101 spec C15.1: the new engaged report is totalUsers by yearMonth and firstSessionDate, under the same filter as the engaged one', () => {
  for (const q of [{ fromMonth: '2026-08', platform: null, country: null }, { fromMonth: '2026-08', platform: 'ios', country: 'BR' }]) {
    const body = ga4.newEngagedReportBody(q)
    const engaged = ga4.engagedReportBody(q)
    assert.deepEqual(body.dimensions, [{ name: 'yearMonth' }, { name: 'firstSessionDate' }])
    assert.deepEqual(body.metrics, [{ name: 'totalUsers' }])
    assert.deepEqual(body.dateRanges, engaged.dateRanges)
    assert.deepEqual(body.dimensionFilter, engaged.dimensionFilter)
  }
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
  assert.deepEqual(plain.dimensionFilter, { andGroup: { expressions: [engaged, notTourist] } })
  const filtered = ga4.engagedReportBody({ fromMonth: '2026-08', platform: 'ios', country: 'BR' })
  assert.deepEqual(filtered.dimensionFilter.andGroup.expressions, [
    { filter: { fieldName: 'platform', stringFilter: { matchType: 'EXACT', value: 'iOS' } } },
    { filter: { fieldName: 'countryId', stringFilter: { matchType: 'EXACT', value: 'BR' } } },
    engaged,
    notTourist,
  ])
})

test('#1156 DS-COMPONENTE-084 item 1: a count is unknown before the first month with the event, and after it a missing month is a measured 0', () => {
  assert.equal(ga4.PAYWALL_VIEWED_EVENT, 'paywall_viewed')
  const byMonth = new Map([['2026-09', 30], ['2026-11', 4]])
  assert.equal(ga4.countSinceFirst('2026-08', byMonth), null)
  assert.equal(ga4.countSinceFirst('2026-09', byMonth), 30)
  assert.equal(ga4.countSinceFirst('2026-10', byMonth), 0)
  assert.equal(ga4.countSinceFirst('2026-11', byMonth), 4)
  assert.equal(ga4.countSinceFirst('2026-11', new Map()), null)
})

test('#1094: the function gates with requireAdmin before it reads the body or the credential, and logs no Google body', () => {
  const src = readFileSync(resolve(FUNCTIONS, 'engagement-ga4/index.ts'), 'utf8')
  const gate = src.indexOf('await requireAdmin(req)')
  assert.ok(gate > 0, 'requireAdmin gate')
  assert.ok(gate < src.indexOf('req.json()'), 'gate before the body')
  assert.ok(gate < src.indexOf('parseServiceAccount(Deno.env'), 'gate before the credential')
  assert.doesNotMatch(src, /console\.(log|error)\([^)]*error\.message/)
})
