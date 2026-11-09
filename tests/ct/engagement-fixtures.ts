import type { EngagementBankReport, EngagementGa4Report } from '@/lib/engagement/report'
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

export const GA4: EngagementGa4Report = {
  months: [
    { month: '2026-08', activeUsers: 318, engagementSeconds: 318 * 540, sessionsPerUser: 2.3, engagedUsers: 160, newEngagedUsers: 120 },
    { month: '2026-09', activeUsers: 327, engagementSeconds: 327 * 480, sessionsPerUser: 2.1, engagedUsers: 175, newEngagedUsers: 110 },
    { month: '2026-10', activeUsers: 262, engagementSeconds: 262 * 600, sessionsPerUser: 2.4, engagedUsers: 189, newEngagedUsers: 150 },
    { month: '2026-11', activeUsers: 41, engagementSeconds: 41 * 420, sessionsPerUser: 1.6, engagedUsers: 30, newEngagedUsers: 6 },
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
}

/** The same month from the function before #1100: none of its four fields. */
export const CONVERSION_OLD: ConversionFunnel = { ...CONVERSION, testedFree: null, purchasedAfterFree: null, purchasedWithoutFree: null, usedGuideOrStory: null }
