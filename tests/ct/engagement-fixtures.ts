import type { EngagementBankReport, EngagementGa4Month, EngagementGa4Report } from '@/lib/engagement/report'
import type { UsageMonth, UsageReport } from '@/lib/engagement/usage'
import type { FreeMinutesHistogram } from '@/lib/engagement/free-minutes'
import type { ConversionFunnel } from '@/lib/conversion/funnel'

/** The fixture of the Engagement report CT (#1094): the numbers of the spec §7 sketch. */
export const TODAY = '2026-11-04'
export const MONTHS = ['2026-08', '2026-09', '2026-10', '2026-11']

const du = (d1: number | null, d2: number | null, d3_5: number | null, d6_plus: number | null) => ({ d1, d2, d3_5, d6_plus })
const none = du(null, null, null, null)

export const BANK: EngagementBankReport = {
  has_mode_fields: true,
  // the function deployed today does not send cohort.retention_on (#1155)
  has_retention_on: false,
  data_since: { open: '2026-10-28', trip: '2026-08-01', audio: '2026-08-01' },
  months: [
    {
      month: '2026-08', active: { open: null, trip: 150, audio: 204 }, new: { open: null, trip: 142, audio: 160 },
      guide_minutes_median: 31, guide_minutes_p75: 72,
      modes: { drive_only: null, explore_only: null, both: null }, guide_foreground_minutes_median: null, guide_background_minutes_median: null, guide_background_share: null,
      days_used: { open: none, trip: du(100, 30, 15, 5), audio: du(131, 40, 26, null) },
      returned_next_month: { open: null, trip: 0.1, audio: 0.12 }, activation: { audio_24h: null, audio_7d: null },
      cohort: { size: 142, retention: { d1: 0.23, d7: 0.31, d30: 0.14, d60: 0.09, d90: null }, retention_on: { d1: null, d7: null, d30: null }, second_trip: { d30: 0.11, d60: 0.15, d90: null } },
    },
    {
      month: '2026-09', active: { open: null, trip: 160, audio: 231 }, new: { open: null, trip: 128, audio: 142 },
      guide_minutes_median: 28, guide_minutes_p75: 65,
      modes: { drive_only: null, explore_only: null, both: null }, guide_foreground_minutes_median: null, guide_background_minutes_median: null, guide_background_share: null,
      days_used: { open: none, trip: du(110, 30, 15, 5), audio: du(152, 44, 28, 7) },
      returned_next_month: { open: null, trip: 0.09, audio: 0.11 }, activation: { audio_24h: null, audio_7d: null },
      cohort: { size: 128, retention: { d1: 0.25, d7: 0.29, d30: 0.12, d60: null, d90: null }, retention_on: { d1: null, d7: null, d30: null }, second_trip: { d30: 0.09, d60: null, d90: null } },
    },
    {
      month: '2026-10', active: { open: null, trip: 120, audio: 187 }, new: { open: null, trip: 97, audio: 98 },
      guide_minutes_median: 35, guide_minutes_p75: 80,
      modes: { drive_only: null, explore_only: null, both: null }, guide_foreground_minutes_median: null, guide_background_minutes_median: null, guide_background_share: null,
      days_used: { open: none, trip: du(80, 25, 10, 5), audio: du(118, 39, 24, 6) },
      returned_next_month: { open: null, trip: 0.08, audio: 0.09 }, activation: { audio_24h: null, audio_7d: null },
      cohort: { size: 97, retention: { d1: 0.21, d7: 0.27, d30: null, d60: null, d90: null }, retention_on: { d1: null, d7: null, d30: null }, second_trip: { d30: null, d60: null, d90: null } },
    },
    {
      month: '2026-11', active: { open: 41, trip: 20, audio: 29 }, new: { open: 14, trip: 12, audio: 14 },
      guide_minutes_median: 22, guide_minutes_p75: 48,
      modes: { drive_only: 9, explore_only: 21, both: 11 }, guide_foreground_minutes_median: 18, guide_background_minutes_median: 14, guide_background_share: 0.44,
      days_used: { open: du(30, 8, null, null), trip: du(15, null, null, null), audio: du(21, 6, null, null) },
      returned_next_month: { open: null, trip: null, audio: null }, activation: { audio_24h: null, audio_7d: null },
      cohort: { size: 12, retention: { d1: null, d7: null, d30: null, d60: null, d90: null }, retention_on: { d1: null, d7: null, d30: null }, second_trip: { d30: null, d60: null, d90: null } },
    },
  ],
}

/** A GA4 month with the fields of #1161 unknown, so each fixture names only what it asserts. */
export function ga4Month(m: Partial<EngagementGa4Month> & Pick<EngagementGa4Month, 'month' | 'activeUsers'>): EngagementGa4Month {
  return {
    engagementSeconds: 0,
    sessionsPerUser: null,
    engagedUsers: null,
    newEngagedUsers: null,
    paywallViewedUsers: null,
    paywallDismissedUsers: null,
    paywallPlanTappedUsers: null,
    paywallPurchaseFailedUsers: null,
    paywallConvertedUsers: null,
    permissions: { location: null, motion: null, notifications: null },
    active1DayAvg: null,
    active7DayAvg: null,
    active28DayAvg: null,
    storyStarts: null,
    storyCompletes: null,
    storyCompletesNatural: null,
    ...m,
  }
}

export const GA4: EngagementGa4Report = {
  storyCompletionSince: null,
  months: [
    ga4Month({ month: '2026-08', activeUsers: 318, engagementSeconds: 318 * 540, sessionsPerUser: 2.3, engagedUsers: 160, newEngagedUsers: 120 }),
    ga4Month({ month: '2026-09', activeUsers: 327, engagementSeconds: 327 * 480, sessionsPerUser: 2.1, engagedUsers: 175, newEngagedUsers: 110, paywallViewedUsers: 140, paywallDismissedUsers: 93, paywallConvertedUsers: 8 }),
    // October with the numbers the deployed engagement-ga4 answered on 2026-11-09 (#1161)
    ga4Month({
      month: '2026-10', activeUsers: 262, engagementSeconds: 262 * 600, sessionsPerUser: 2.4, engagedUsers: 189, newEngagedUsers: 150,
      paywallViewedUsers: 95, paywallDismissedUsers: 79, paywallPlanTappedUsers: 2, paywallConvertedUsers: 9,
      permissions: { location: { asked: 61, allowed: 60 }, motion: { asked: 10, allowed: 8 }, notifications: { asked: 24, allowed: 19 } },
    }),
    ga4Month({ month: '2026-11', activeUsers: 41, engagementSeconds: 41 * 420, sessionsPerUser: 1.6, engagedUsers: 30, newEngagedUsers: 6, paywallViewedUsers: 12 }),
  ],
  clicks: [
    { month: '2026-10', screen: 'guide_map', button: 'start_guide', events: 301, users: 142 },
    { month: '2026-10', screen: 'guide_map', button: 'open_explore', events: 140, users: 88 },
    { month: '2026-10', screen: 'poi_detail', button: 'play_audio', events: 264, users: 118 },
    { month: '2026-10', screen: 'poi_detail', button: 'share', events: 31, users: 23 },
    { month: '2026-10', screen: 'passport', button: 'open_stamp', events: 40, users: 19 },
  ],
}

/** Thirteen months, for the scroll at 390 and the rule "eleven fit at 1440". */
export const MONTHS_11 = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']

/**
 * The clicks with the names the app sends (#1096): labelled taps, one name copy has no label, and a
 * screen whose events are all permission answers, which are not taps.
 */
export const GA4_NAMED: EngagementGa4Report = {
  ...GA4,
  clicks: [
    { month: '2026-10', screen: 'guide_map_screen', button: 'guide_module_opened', events: 410, users: 190 },
    { month: '2026-10', screen: 'guide_map_screen', button: 'discovery_banner_shown', events: 380, users: 170 },
    { month: '2026-10', screen: 'guide_map_screen', button: '(not set)', events: 12, users: 9 },
    { month: '2026-10', screen: 'single_detail', button: 'story_play_pressed', events: 220, users: 120 },
    { month: '2026-10', screen: 'permission_screen', button: 'location_permission_granted', events: 80, users: 75 },
    { month: '2026-10', screen: '(not set)', button: 'poi_navigate', events: 20, users: 14 },
  ],
}

/**
 * October of `core.dashboard_conversion_funnel` after #1100 (#1101, the spec §C11 sketch): 450
 * installed, 320 entered, 120 with an account; 120 tried free hours and 30 of them bought, 200 did not
 * try and 8 bought.
 */
export const CONVERSION: ConversionFunnel = {
  month: '2026-10',
  installs: { ios: 160, android: 290, total: 450 },
  entered: 320,
  account: 120,
  purchased: 38,
  testedFree: 120,
  purchasedAfterFree: 30,
  purchasedWithoutFree: 8,
  usedGuideOrStory: 250,
  consumed1h: 90,
}

/** The same month from the function before #1100: none of its four fields, nor the one of #1155. */
export const CONVERSION_OLD: ConversionFunnel = { ...CONVERSION, testedFree: null, purchasedAfterFree: null, purchasedWithoutFree: null, usedGuideOrStory: null, consumed1h: null }

/**
 * October of `core.cms_get_free_minutes_histogram` (#1156, contract Parte 26 §3): 320 entered, the 30
 * min to 1 h bucket hidden (1 to 4 people), the rest measured.
 */
export const FREE_MINUTES: FreeMinutesHistogram = {
  month: '2026-10',
  base: 320,
  buckets: [
    { fromMin: 0, toMin: 15, people: 150 },
    { fromMin: 15, toMin: 30, people: 60 },
    { fromMin: 30, toMin: 60, people: null },
    { fromMin: 60, toMin: 120, people: 70 },
    { fromMin: 120, toMin: 180, people: 25 },
    { fromMin: 180, toMin: null, people: 11 },
  ],
}

const usageMonth = (m: Partial<UsageMonth> & Pick<UsageMonth, 'month'>): UsageMonth => ({
  guide: null,
  km: null,
  movement: null,
  first_day: { entered: null, guide: null, story: null, guide_or_story: null, explore_only: null, nothing: null },
  usage_funnel: { entered: null, guide_on: null, first_story: null, used_1h: null, second_trip: null },
  purchase: { purchased: null, after_free: null, free_minutes_before_median: null },
  time_to_first_story: { people: null, minutes_median: null },
  ledger_coverage: null,
  ...m,
})

/**
 * `drive.cms_get_usage_monthly` (#1161, contract banco-para-cms Parte 27 §4). October is the example of
 * the contract, measured on 2026-11-09: 119 entered, 35 turned the guide on, 22 heard the first story, 12
 * used 1 hour, 6 took a 2nd trip. September is a fixture, larger, so October falls; August has movement on
 * 14 % of the trips (a floor) and the ledger's first month.
 */
export const USAGE: UsageReport = {
  data_since: { open: '2026-10-28', trip: '2025-07-31', audio: '2025-11-27', movement: '2026-07-29', ledger: '2026-08-18' },
  months: [
    usageMonth({
      month: '2026-08',
      guide: { people: 90, trips: 160, hours: 110 },
      km: { per_person_median: 3.1, people: 80, coverage: 0.7 },
      movement: { people: 12, vehicle_minutes_median: 9, walking_minutes_median: 2, stopped_minutes_median: 6, cycling_minutes_median: 0, coverage: 0.14 },
      first_day: { entered: 150, guide: 50, story: 30, guide_or_story: 60, explore_only: null, nothing: null },
      usage_funnel: { entered: 150, guide_on: 70, first_story: 40, used_1h: 15, second_trip: 20 },
      time_to_first_story: { people: 45, minutes_median: 14 },
      ledger_coverage: 'partial',
    }),
    usageMonth({
      month: '2026-09',
      guide: { people: 80, trips: 150, hours: 100 },
      km: { per_person_median: 2.4, people: 70, coverage: 0.8 },
      movement: { people: 60, vehicle_minutes_median: 4, walking_minutes_median: 1, stopped_minutes_median: 3, cycling_minutes_median: 0, coverage: 0.81 },
      first_day: { entered: 140, guide: 49, story: 30, guide_or_story: 56, explore_only: null, nothing: null },
      usage_funnel: { entered: 140, guide_on: 60, first_story: 35, used_1h: 18, second_trip: 12 },
      time_to_first_story: { people: 40, minutes_median: 12 },
      ledger_coverage: 'full',
    }),
    usageMonth({
      month: '2026-10',
      guide: { people: 44, trips: 89, hours: 62.8 },
      km: { per_person_median: 0.2, people: 40, coverage: 0.8315 },
      movement: { people: 38, vehicle_minutes_median: 0, walking_minutes_median: 0.3, stopped_minutes_median: 1.9, cycling_minutes_median: 0, coverage: 0.809 },
      first_day: { entered: 119, guide: 32, story: 24, guide_or_story: 37, explore_only: null, nothing: null },
      usage_funnel: { entered: 119, guide_on: 35, first_story: 22, used_1h: 12, second_trip: 6 },
      purchase: { purchased: 9, after_free: 1, free_minutes_before_median: 150 },
      time_to_first_story: { people: 27, minutes_median: 10.6 },
      ledger_coverage: 'full',
    }),
    usageMonth({
      month: '2026-11',
      guide: { people: 12, trips: 20, hours: 14 },
      km: { per_person_median: 1.1, people: 10, coverage: 0.9 },
      movement: { people: 10, vehicle_minutes_median: 3, walking_minutes_median: 1, stopped_minutes_median: 2, cycling_minutes_median: 0, coverage: 0.9 },
      first_day: { entered: 30, guide: 9, story: 6, guide_or_story: 11, explore_only: 12, nothing: 7 },
      usage_funnel: { entered: 30, guide_on: 10, first_story: 6, used_1h: 2, second_trip: 1 },
      time_to_first_story: { people: 6, minutes_median: 8 },
      ledger_coverage: 'full',
    }),
  ],
}
