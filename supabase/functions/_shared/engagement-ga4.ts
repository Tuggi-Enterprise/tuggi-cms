// _shared/engagement-ga4.ts
//
// The GA4 half of the CMS Engagement report (#1094, spec-cms-relatorio-engajamento-2026-11 §4 and §5):
// per month of the app property, active users, engagement time and sessions per user, the people
// with at least one engaged event (#1099, spec Parte B §B14.1), and the `button_clicked` events by
// screen and button, the people of the month's cohort with an engaged event (#1101, spec Parte C
// §C15.1), the devices that opened the purchase screen (#1156, spec Parte D §D3) and, since #1161 (spec Parte E
// §E12 item 10), the other four paywall events, the permission answers by type and status, the daily active
// windows averaged by month and the story starts and natural ends. Read only; the database half is
// `drive.cms_get_engagement_monthly` and the two are never divided by each other (DS-COMPONENTE-084
// item 2).
//
// On top of `ga4Runner` and `ga4AppFilter` (`_shared/ga4-data.ts`, import-free too), so the CMS
// tests load it as is. Every report excludes the devices that are not tourists (#1149).
//
// Data API v1beta, checked 2026-11-04: `yearMonth` answers `YYYYMM` in the property time zone;
// `userEngagementDuration` is seconds; `sessionsPerUser` is sessions / activeUsers;
// `customEvent:<parameter>` needs the parameter registered as a custom dimension; `endDate` accepts
// `today`; rows whose metrics are all zero are left out; `totalUsers` under an event filter counts
// the distinct users with at least one event that passed it; `inListFilter` matches any of its values;
// `firstSessionDate` is "the date the user's first session occurred, formatted as YYYYMMDD", one per
// user, so the rows of one `yearMonth` split its users without repeating any. Filters: `platform` answers `iOS` /
// `Android`, `countryId` answers ISO 3166-1 alpha-2, the format of `drive.profiles.country`.

import { ga4AppFilter } from './ga4-data.ts';

export const ENGAGEMENT_CLICK_EVENT = 'button_clicked';
export const ENGAGEMENT_SCREEN_DIMENSION = 'customEvent:screen_name';
export const ENGAGEMENT_BUTTON_DIMENSION = 'customEvent:button_name';
/** The app's `ANALYTICS_EVENTS.PAYWALL_VIEWED` (tuggi-drive-v2 `src/features/analytics/types.ts`). */
export const PAYWALL_VIEWED_EVENT = 'paywall_viewed';
/**
 * The five paywall events of the app (`ANALYTICS_EVENTS.PAYWALL_*`), to the field of the month that counts
 * the devices with at least one of them (#1161).
 */
export const PAYWALL_EVENTS = {
  paywall_viewed: 'paywallViewedUsers',
  paywall_dismissed: 'paywallDismissedUsers',
  paywall_plan_tapped: 'paywallPlanTappedUsers',
  paywall_purchase_failed: 'paywallPurchaseFailedUsers',
  paywall_converted: 'paywallConvertedUsers',
} as const;
type PaywallField = (typeof PAYWALL_EVENTS)[keyof typeof PAYWALL_EVENTS];

/**
 * `permission_result` (#948): `permission_type` and `status` are its parameters (tuggi-drive-v2
 * `PermissionResultEventParams`). The report reads the three the page shows; `background_location` stays out.
 */
export const PERMISSION_EVENT = 'permission_result';
export const PERMISSION_TYPE_DIMENSION = 'customEvent:permission_type';
export const PERMISSION_STATUS_DIMENSION = 'customEvent:status';
export const PERMISSION_TYPES = ['location', 'motion', 'notifications'] as const;
export const PERMISSION_STATUSES = ['granted', 'denied', 'blocked', 'limited'] as const;
/** "Allowed" is `granted` or `limited` (iOS provisional push), spec §E7.2. */
export const PERMISSION_ALLOWED: readonly string[] = ['granted', 'limited'];
type PermissionType = (typeof PERMISSION_TYPES)[number];

/** Story starts and ends (#1126); `completion` is `natural` or `stopped` (`StoryCompletion`). */
export const STORY_START_EVENT = 'story_play_start';
export const STORY_COMPLETE_EVENT = 'story_play_complete';
export const STORY_COMPLETION_DIMENSION = 'customEvent:completion';
const STORY_COMPLETIONS: readonly string[] = ['natural', 'stopped'];

/**
 * "Engaged" (#1099, operator 2026-11-04): opened the app and did at least one of these. The lists
 * live here only: the query reads them and the tests import them. Not engaged: opening alone,
 * permission prompts, a banner shown.
 */
export const ENGAGED_EVENTS: readonly string[] = ['guide_session_start', 'detail_card_opened', 'story_play_start'];
/** `button_clicked` counts only with one of these `button_name` values (#1095 for the Explore taps). */
export const ENGAGED_BUTTONS: readonly string[] = [
  'poi_navigate',
  'event_navigate',
  'route_navigate',
  'search_this_area',
  'explore_chip_opened',
  'explore_tab_selected',
  'explore_filter_opened',
];

/** The app platforms the CMS filters by, to the value of the GA4 `platform` dimension. */
const GA4_PLATFORM: Record<string, string> = { ios: 'iOS', android: 'Android' };

export type EngagementGa4Query = {
  /** First month read, `YYYY-MM`. The last one is the current month (`endDate: today`). */
  fromMonth: string;
  platform: 'ios' | 'android' | null;
  /** ISO 3166-1 alpha-2, upper case. */
  country: string | null;
};

export type EngagementGa4Month = {
  month: string;
  activeUsers: number;
  engagementSeconds: number;
  /** `null` when GA4 sent no number. */
  sessionsPerUser: number | null;
  /** People with at least one engaged event; a month GA4 left out of that report is a measured 0. */
  engagedUsers: number;
  /** Of those, the ones whose first session fell in the same month (#1101); same rule for a missing month. */
  newEngagedUsers: number;
  /**
   * Devices with at least one `paywall_viewed` in the month (#1156). GA4 leaves out a zero row, so a
   * missing month after the first one with the event is a measured 0, and a month before it is `null`:
   * the event was not being collected, and that is unknown, not zero (DS-COMPONENTE-084 item 1).
   */
  paywallViewedUsers: number | null;
  /** The other paywall events (#1161), devices, by the same rule as `paywallViewedUsers`. */
  paywallDismissedUsers: number | null;
  paywallPlanTappedUsers: number | null;
  paywallPurchaseFailedUsers: number | null;
  paywallConvertedUsers: number | null;
  /**
   * Devices that answered each system permission (#1161): `asked` with any status, `allowed` with
   * `granted` or `limited`, and one count per status. Distinct devices per line, so the statuses do not sum
   * to `asked` (a device may deny and then grant). `null` before the first month with an answer of that
   * type, and the whole object `null` while GA4 refuses the custom dimensions.
   */
  permissions: Record<PermissionType, PermissionMonth | null> | null;
  /**
   * `active1DayUsers`, `active7DayUsers` and `active28DayUsers` of each day GA4 answered, averaged over those
   * days (#1161). A day is left out only when the 28-day window is empty too. `null` with no day.
   */
  active1DayAvg: number | null;
  active7DayAvg: number | null;
  active28DayAvg: number | null;
  /** Events, not devices (#1161): starts, ends with any `completion`, and ends with `completion = natural`. */
  storyStarts: number | null;
  storyCompletes: number | null;
  /** `null` before `EngagementGa4Report.storyCompletionSince` and while GA4 refuses the dimension. */
  storyCompletesNatural: number | null;
};

export type PermissionMonth = { asked: number; allowed: number; byStatus: Record<(typeof PERMISSION_STATUSES)[number], number> };

export type EngagementGa4Click = { month: string; screen: string; button: string; events: number; users: number };

export type EngagementGa4Report = {
  months: EngagementGa4Month[];
  clicks: EngagementGa4Click[];
  /** The first month with a `story_play_complete` that carries `completion` (#1161); `null` with none yet. */
  storyCompletionSince: string | null;
  /**
   * The reports GA4 refused with the code it answered (`permissions: ga4_report_400` while a custom dimension
   * is not registered): their fields are `null`, and the rest of the report stands.
   */
  unavailable: Record<string, string>;
};

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const COUNTRY = /^[A-Z]{2}$/;

/** The body of the function, or null when any field is not one the report accepts. */
export function parseEngagementGa4Query(raw: unknown): EngagementGa4Query | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const fromMonth = r.from_month;
  if (typeof fromMonth !== 'string' || !MONTH.test(fromMonth) || fromMonth < '2020-01') return null;
  const platform = r.platform ?? null;
  if (platform !== null && platform !== 'ios' && platform !== 'android') return null;
  const country = r.country ?? null;
  if (country !== null && (typeof country !== 'string' || !COUNTRY.test(country))) return null;
  return { fromMonth, platform, country };
}

/** The report's own filter, AND NOT the devices that are not tourists (#1149): never empty. */
function filterOf(q: EngagementGa4Query, extra: Record<string, unknown>[] = []): Record<string, unknown> {
  const exact = (fieldName: string, value: string) => ({ filter: { fieldName, stringFilter: { matchType: 'EXACT', value } } });
  const parts = [
    ...(q.platform ? [exact('platform', GA4_PLATFORM[q.platform])] : []),
    ...(q.country ? [exact('countryId', q.country)] : []),
    ...extra,
  ];
  return ga4AppFilter(parts.length > 0 ? { andGroup: { expressions: parts } } : undefined);
}

const dateRanges = (q: EngagementGa4Query) => [{ startDate: `${q.fromMonth}-01`, endDate: 'today' }];
const exactEvent = (value: string) => ({ filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value } } });
const inList = (fieldName: string, values: readonly string[]) => ({ filter: { fieldName, inListFilter: { values: [...values] } } });

/** Users, engagement time and sessions per user, one row per `yearMonth`. */
export function usersReportBody(q: EngagementGa4Query): Record<string, unknown> {
  return {
    dateRanges: dateRanges(q),
    dimensions: [{ name: 'yearMonth' }],
    metrics: [{ name: 'activeUsers' }, { name: 'userEngagementDuration' }, { name: 'sessionsPerUser' }],
    dimensionFilter: filterOf(q),
    orderBys: [{ dimension: { dimensionName: 'yearMonth' } }],
    limit: '1000',
  };
}

/** `button_clicked` by month, screen and button: events and users. */
export function clicksReportBody(q: EngagementGa4Query): Record<string, unknown> {
  const event = { filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: ENGAGEMENT_CLICK_EVENT } } };
  return {
    dateRanges: dateRanges(q),
    dimensions: [{ name: 'yearMonth' }, { name: ENGAGEMENT_SCREEN_DIMENSION }, { name: ENGAGEMENT_BUTTON_DIMENSION }],
    metrics: [{ name: 'eventCount' }, { name: 'totalUsers' }],
    dimensionFilter: filterOf(q, [event]),
    limit: '10000',
  };
}

/** The engaged events, or `button_clicked` with an engaged button (spec §B14.1). */
function engagedFilter(): Record<string, unknown> {
  return {
    orGroup: {
      expressions: [
        inList('eventName', ENGAGED_EVENTS),
        {
          andGroup: {
            expressions: [
              { filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: ENGAGEMENT_CLICK_EVENT } } },
              inList(ENGAGEMENT_BUTTON_DIMENSION, ENGAGED_BUTTONS),
            ],
          },
        },
      ],
    },
  };
}

/** Distinct users with at least one engaged event, one row per `yearMonth` (spec §B14.1). */
export function engagedReportBody(q: EngagementGa4Query): Record<string, unknown> {
  return {
    dateRanges: dateRanges(q),
    dimensions: [{ name: 'yearMonth' }],
    metrics: [{ name: 'totalUsers' }],
    dimensionFilter: filterOf(q, [engagedFilter()]),
    orderBys: [{ dimension: { dimensionName: 'yearMonth' } }],
    limit: '1000',
  };
}

/**
 * The same engaged users split by the date of their first session (spec §C15.1): the parser keeps
 * the rows whose first session is in the row's month, the cohort of the month.
 */
export function newEngagedReportBody(q: EngagementGa4Query): Record<string, unknown> {
  return {
    dateRanges: dateRanges(q),
    dimensions: [{ name: 'yearMonth' }, { name: 'firstSessionDate' }],
    metrics: [{ name: 'totalUsers' }],
    dimensionFilter: filterOf(q, [engagedFilter()]),
    limit: '10000',
  };
}

/** Distinct users with each paywall event, one row per `yearMonth` and event (#1156, #1161). */
export function paywallReportBody(q: EngagementGa4Query): Record<string, unknown> {
  return {
    dateRanges: dateRanges(q),
    dimensions: [{ name: 'yearMonth' }, { name: 'eventName' }],
    metrics: [{ name: 'totalUsers' }],
    dimensionFilter: filterOf(q, [inList('eventName', Object.keys(PAYWALL_EVENTS))]),
    limit: '1000',
  };
}

/** `permission_result` users by month, type and status (#1161). Needs both custom dimensions registered. */
export function permissionStatusReportBody(q: EngagementGa4Query): Record<string, unknown> {
  return {
    dateRanges: dateRanges(q),
    dimensions: [{ name: 'yearMonth' }, { name: PERMISSION_TYPE_DIMENSION }, { name: PERMISSION_STATUS_DIMENSION }],
    metrics: [{ name: 'totalUsers' }],
    dimensionFilter: filterOf(q, [exactEvent(PERMISSION_EVENT)]),
    limit: '1000',
  };
}

/**
 * `permission_result` users by month and type, of any status (`allowed: false`) or of `granted`/`limited`
 * (`allowed: true`): distinct devices, which the per-status rows cannot give by summing (#1161).
 */
export function permissionTypeReportBody(q: EngagementGa4Query, allowed: boolean): Record<string, unknown> {
  return {
    dateRanges: dateRanges(q),
    dimensions: [{ name: 'yearMonth' }, { name: PERMISSION_TYPE_DIMENSION }],
    metrics: [{ name: 'totalUsers' }],
    dimensionFilter: filterOf(q, [exactEvent(PERMISSION_EVENT), ...(allowed ? [inList(PERMISSION_STATUS_DIMENSION, PERMISSION_ALLOWED)] : [])]),
    limit: '1000',
  };
}

/** The three active windows by day (#1161): the window of each row ends on its date. */
export function activeDailyReportBody(q: EngagementGa4Query): Record<string, unknown> {
  return {
    dateRanges: dateRanges(q),
    dimensions: [{ name: 'date' }],
    metrics: [{ name: 'active1DayUsers' }, { name: 'active7DayUsers' }, { name: 'active28DayUsers' }],
    dimensionFilter: filterOf(q),
    limit: '1000',
  };
}

/** Story starts and ends, events by month and event name (#1161). */
export function storyEventsReportBody(q: EngagementGa4Query): Record<string, unknown> {
  return {
    dateRanges: dateRanges(q),
    dimensions: [{ name: 'yearMonth' }, { name: 'eventName' }],
    metrics: [{ name: 'eventCount' }],
    dimensionFilter: filterOf(q, [inList('eventName', [STORY_START_EVENT, STORY_COMPLETE_EVENT])]),
    limit: '1000',
  };
}

/** `story_play_complete` events by month and `completion` (#1161). Needs the custom dimension registered. */
export function storyCompletionReportBody(q: EngagementGa4Query): Record<string, unknown> {
  return {
    dateRanges: dateRanges(q),
    dimensions: [{ name: 'yearMonth' }, { name: STORY_COMPLETION_DIMENSION }],
    metrics: [{ name: 'eventCount' }],
    dimensionFilter: filterOf(q, [exactEvent(STORY_COMPLETE_EVENT)]),
    limit: '1000',
  };
}

type RawRow = { dimensionValues?: { value?: unknown }[]; metricValues?: { value?: unknown }[] };

function rowsOf(body: unknown): RawRow[] {
  const rows = body && typeof body === 'object' ? (body as { rows?: unknown }).rows : undefined;
  return Array.isArray(rows) ? (rows as RawRow[]) : [];
}

/** `202608` to `2026-08`; null for anything else. */
function monthOf(v: unknown): string | null {
  if (typeof v !== 'string' || !/^\d{6}$/.test(v)) return null;
  const m = `${v.slice(0, 4)}-${v.slice(4)}`;
  return MONTH.test(m) ? m : null;
}

const metric = (r: RawRow, i: number): number | null => {
  const raw = r.metricValues?.[i]?.value;
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

const dimension = (r: RawRow, i: number): string | null => {
  const v = r.dimensionValues?.[i]?.value;
  return typeof v === 'string' ? v : null;
};

/** One entry per month GA4 answered, oldest first. A row without a month or users is dropped. */
type UsersMonth = Pick<EngagementGa4Month, 'month' | 'activeUsers' | 'engagementSeconds' | 'sessionsPerUser'>;

export function parseUsersReport(body: unknown): UsersMonth[] {
  const out: UsersMonth[] = [];
  for (const r of rowsOf(body)) {
    const month = monthOf(dimension(r, 0));
    const activeUsers = metric(r, 0);
    if (!month || activeUsers === null) continue;
    out.push({
      month,
      activeUsers: Math.floor(activeUsers),
      engagementSeconds: metric(r, 1) ?? 0,
      sessionsPerUser: metric(r, 2),
    });
  }
  return out.sort((a, b) => a.month.localeCompare(b.month));
}

/** Engaged users by month; a row it cannot read is dropped. */
export function parseEngagedReport(body: unknown): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rowsOf(body)) {
    const month = monthOf(dimension(r, 0));
    const users = metric(r, 0);
    if (month && users !== null) out.set(month, Math.floor(users));
  }
  return out;
}

/**
 * Engaged users of the month's cohort: only rows whose `firstSessionDate` falls in the row's
 * `yearMonth`, summed by month. `(not set)` and any date that is not `YYYYMMDD` are dropped.
 */
export function parseNewEngagedReport(body: unknown): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rowsOf(body)) {
    const ym = dimension(r, 0);
    const month = monthOf(ym);
    const first = dimension(r, 1);
    const users = metric(r, 0);
    if (!month || users === null || first === null || !/^\d{8}$/.test(first) || first.slice(0, 6) !== ym) continue;
    out.set(month, (out.get(month) ?? 0) + Math.floor(users));
  }
  return out;
}

/** One entry per month, screen and button; the screen and button names travel raw. */
export function parseClicksReport(body: unknown): EngagementGa4Click[] {
  const out: EngagementGa4Click[] = [];
  for (const r of rowsOf(body)) {
    const month = monthOf(dimension(r, 0));
    const screen = dimension(r, 1);
    const button = dimension(r, 2);
    const events = metric(r, 0);
    const users = metric(r, 1);
    if (!month || screen === null || button === null || events === null || users === null) continue;
    out.push({ month, screen, button, events: Math.floor(events), users: Math.floor(users) });
  }
  return out;
}

/**
 * A GA4 count of a month for an event GA4 began to receive at some point: the count, a measured 0 from the
 * first month with a row on (GA4 leaves out a zero row), and `null` before it, when the event was not
 * collected (see `EngagementGa4Month.paywallViewedUsers`; DS-COMPONENTE-084 item 1).
 */
export function countSinceFirst(month: string, byMonth: Map<string, number>): number | null {
  const first = [...byMonth.keys()].sort()[0];
  if (first === undefined || month < first) return null;
  return byMonth.get(month) ?? 0;
}

/** Rows of `yearMonth` and one string dimension to `Map<key, Map<month, n>>`; `(not set)` and bad rows drop. */
function byKeyAndMonth(body: unknown, keyAt = 1): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const r of rowsOf(body)) {
    const month = monthOf(dimension(r, 0));
    const key = dimension(r, keyAt);
    const v = metric(r, 0);
    if (!month || key === null || key === '(not set)' || v === null) continue;
    const m = out.get(key) ?? new Map<string, number>();
    m.set(month, (m.get(month) ?? 0) + Math.floor(v));
    out.set(key, m);
  }
  return out;
}

/** Users of each paywall event by month: one map per event (#1161). */
export function parsePaywallReport(body: unknown): Map<string, Map<string, number>> {
  return byKeyAndMonth(body);
}

export type PermissionReports = { byStatus: unknown; asked: unknown; allowed: unknown };

/**
 * The permission lines of a month for each type: `null` before the first month with an answer of that type,
 * then GA4's counts, with a missing row a measured 0 (#1161).
 */
export function permissionsOf(month: string, reports: PermissionReports): Record<PermissionType, PermissionMonth | null> {
  const asked = byKeyAndMonth(reports.asked);
  const allowed = byKeyAndMonth(reports.allowed);
  const status = new Map<string, Map<string, number>>();
  for (const r of rowsOf(reports.byStatus)) {
    const m = monthOf(dimension(r, 0));
    const type = dimension(r, 1);
    const st = dimension(r, 2);
    const v = metric(r, 0);
    if (!m || type === null || st === null || v === null) continue;
    const key = `${type}|${st}`;
    const byMonth = status.get(key) ?? new Map<string, number>();
    byMonth.set(m, Math.floor(v));
    status.set(key, byMonth);
  }
  const out = {} as Record<PermissionType, PermissionMonth | null>;
  for (const type of PERMISSION_TYPES) {
    const a = asked.get(type) ?? new Map<string, number>();
    const askedN = countSinceFirst(month, a);
    if (askedN === null) {
      out[type] = null;
      continue;
    }
    const byStatus = {} as PermissionMonth['byStatus'];
    for (const st of PERMISSION_STATUSES) byStatus[st] = status.get(`${type}|${st}`)?.get(month) ?? 0;
    out[type] = { asked: askedN, allowed: allowed.get(type)?.get(month) ?? 0, byStatus };
  }
  return out;
}

/** The three daily windows averaged over the days GA4 answered in each month (#1161). */
export function parseActiveDaily(body: unknown): Map<string, { d1: number; d7: number; d28: number }> {
  const sums = new Map<string, { d1: number; d7: number; d28: number; days: number }>();
  for (const r of rowsOf(body)) {
    const date = dimension(r, 0);
    if (date === null || !/^\d{8}$/.test(date)) continue;
    const month = monthOf(date.slice(0, 6));
    const d1 = metric(r, 0);
    const d7 = metric(r, 1);
    const d28 = metric(r, 2);
    if (!month || d1 === null || d7 === null || d28 === null) continue;
    const s = sums.get(month) ?? { d1: 0, d7: 0, d28: 0, days: 0 };
    sums.set(month, { d1: s.d1 + d1, d7: s.d7 + d7, d28: s.d28 + d28, days: s.days + 1 });
  }
  const oneDecimal = (x: number) => Math.round(x * 10) / 10;
  const out = new Map<string, { d1: number; d7: number; d28: number }>();
  for (const [month, s] of sums) out.set(month, { d1: oneDecimal(s.d1 / s.days), d7: oneDecimal(s.d7 / s.days), d28: oneDecimal(s.d28 / s.days) });
  return out;
}

/** The first month whose `story_play_complete` carries a `completion` value (#1161); `null` with none. */
export function completionSinceOf(byCompletion: Map<string, Map<string, number>>): string | null {
  const months = STORY_COMPLETIONS.flatMap((c) => [...(byCompletion.get(c)?.keys() ?? [])]).sort();
  return months[0] ?? null;
}

type Run = (body: Record<string, unknown>) => Promise<unknown>;

/** GA4 answers at most ten requests at once per property; the reports go five at a time. */
const GA4_PARALLEL = 5;

async function inBatches<T>(tasks: (() => Promise<T>)[]): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < tasks.length; i += GA4_PARALLEL) out.push(...(await Promise.all(tasks.slice(i, i + GA4_PARALLEL).map((t) => t()))));
  return out;
}

/** A report that reads a custom dimension: a refusal is recorded and its fields go `null`, the rest stands. */
const soft = (run: Run, body: Record<string, unknown>, name: string, unavailable: Record<string, string>) => async () => {
  try {
    return await run(body);
  } catch (error) {
    unavailable[name] = error instanceof Error && /^ga4_(token|report)_\d+$/.test(error.message) ? error.message : 'ga4_unreachable';
    return null;
  }
};

/**
 * The reports. A refusal of a report on standard dimensions throws what `ga4Runner` throws
 * (`ga4_token_<status>`, `ga4_report_<status>`); a refusal of one on a custom dimension of #1161 only
 * empties its fields and is named in `unavailable`.
 */
export async function readEngagementGa4(run: Run, q: EngagementGa4Query): Promise<EngagementGa4Report> {
  const unavailable: Record<string, string> = {};
  const [users, engaged, newEngaged, clicks, paywall, active, stories, byStatus, asked, allowed, completion] = await inBatches<unknown>([
    () => run(usersReportBody(q)),
    () => run(engagedReportBody(q)),
    () => run(newEngagedReportBody(q)),
    () => run(clicksReportBody(q)),
    () => run(paywallReportBody(q)),
    () => run(activeDailyReportBody(q)),
    () => run(storyEventsReportBody(q)),
    soft(run, permissionStatusReportBody(q), 'permissions', unavailable),
    soft(run, permissionTypeReportBody(q, false), 'permissions', unavailable),
    soft(run, permissionTypeReportBody(q, true), 'permissions', unavailable),
    soft(run, storyCompletionReportBody(q), 'story_completion', unavailable),
  ]);
  const byMonth = parseEngagedReport(engaged);
  const newByMonth = parseNewEngagedReport(newEngaged);
  const paywallByEvent = parsePaywallReport(paywall);
  const activeByMonth = parseActiveDaily(active);
  const storyByEvent = byKeyAndMonth(stories);
  const permissionsOk = !('permissions' in unavailable);
  const byCompletion = 'story_completion' in unavailable ? null : byKeyAndMonth(completion);
  const storyCompletionSince = byCompletion ? completionSinceOf(byCompletion) : null;
  // A month with active users and no engaged row: GA4 leaves out a row whose metric is zero.
  const months = parseUsersReport(users).map((m) => {
    const paywallFields = {} as Record<PaywallField, number | null>;
    for (const [event, field] of Object.entries(PAYWALL_EVENTS)) paywallFields[field] = countSinceFirst(m.month, paywallByEvent.get(event) ?? new Map());
    const act = activeByMonth.get(m.month);
    const natural = byCompletion && storyCompletionSince !== null && m.month >= storyCompletionSince ? (byCompletion.get('natural')?.get(m.month) ?? 0) : null;
    return {
      ...m,
      engagedUsers: byMonth.get(m.month) ?? 0,
      newEngagedUsers: newByMonth.get(m.month) ?? 0,
      ...paywallFields,
      permissions: permissionsOk ? permissionsOf(m.month, { byStatus, asked, allowed }) : null,
      active1DayAvg: act?.d1 ?? null,
      active7DayAvg: act?.d7 ?? null,
      active28DayAvg: act?.d28 ?? null,
      storyStarts: countSinceFirst(m.month, storyByEvent.get(STORY_START_EVENT) ?? new Map()),
      storyCompletes: countSinceFirst(m.month, storyByEvent.get(STORY_COMPLETE_EVENT) ?? new Map()),
      storyCompletesNatural: natural,
    } as EngagementGa4Month;
  });
  return { months, clicks: parseClicksReport(clicks), storyCompletionSince, unavailable };
}
