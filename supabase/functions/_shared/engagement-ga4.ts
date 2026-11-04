// _shared/engagement-ga4.ts
//
// The GA4 half of the CMS Engagement report (#1094, spec-cms-relatorio-engajamento-2026-11 §4 and §5):
// per month of the app property, active users, engagement time and sessions per user, and the
// `button_clicked` events by screen and button. Read only; the database half is
// `drive.cms_get_engagement_monthly` and the two are never divided by each other (DS-COMPONENTE-084
// item 2).
//
// Import-free, on top of `ga4Runner` (`_shared/ga4-data.ts`), so the CMS tests load it as is.
//
// Data API v1beta, checked 2026-11-04: `yearMonth` answers `YYYYMM` in the property time zone;
// `userEngagementDuration` is seconds; `sessionsPerUser` is sessions / activeUsers;
// `customEvent:<parameter>` needs the parameter registered as a custom dimension; `endDate` accepts
// `today`; rows whose metrics are all zero are left out. Filters: `platform` answers `iOS` /
// `Android`, `countryId` answers ISO 3166-1 alpha-2, the format of `drive.profiles.country`.

export const ENGAGEMENT_CLICK_EVENT = 'button_clicked';
export const ENGAGEMENT_SCREEN_DIMENSION = 'customEvent:screen_name';
export const ENGAGEMENT_BUTTON_DIMENSION = 'customEvent:button_name';

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
};

export type EngagementGa4Click = { month: string; screen: string; button: string; events: number; users: number };

export type EngagementGa4Report = { months: EngagementGa4Month[]; clicks: EngagementGa4Click[] };

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

function filterOf(q: EngagementGa4Query, extra: Record<string, unknown>[] = []): Record<string, unknown> | undefined {
  const exact = (fieldName: string, value: string) => ({ filter: { fieldName, stringFilter: { matchType: 'EXACT', value } } });
  const parts = [
    ...(q.platform ? [exact('platform', GA4_PLATFORM[q.platform])] : []),
    ...(q.country ? [exact('countryId', q.country)] : []),
    ...extra,
  ];
  if (parts.length === 0) return undefined;
  if (parts.length === 1) return parts[0];
  return { andGroup: { expressions: parts } };
}

const dateRanges = (q: EngagementGa4Query) => [{ startDate: `${q.fromMonth}-01`, endDate: 'today' }];

/** Users, engagement time and sessions per user, one row per `yearMonth`. */
export function usersReportBody(q: EngagementGa4Query): Record<string, unknown> {
  const filter = filterOf(q);
  return {
    dateRanges: dateRanges(q),
    dimensions: [{ name: 'yearMonth' }],
    metrics: [{ name: 'activeUsers' }, { name: 'userEngagementDuration' }, { name: 'sessionsPerUser' }],
    ...(filter ? { dimensionFilter: filter } : {}),
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
export function parseUsersReport(body: unknown): EngagementGa4Month[] {
  const out: EngagementGa4Month[] = [];
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

/** Both reports. Throws what `ga4Runner` throws (`ga4_token_<status>`, `ga4_report_<status>`). */
export async function readEngagementGa4(
  run: (body: Record<string, unknown>) => Promise<unknown>,
  q: EngagementGa4Query,
): Promise<EngagementGa4Report> {
  const [users, clicks] = await Promise.all([run(usersReportBody(q)), run(clicksReportBody(q))]);
  return { months: parseUsersReport(users), clicks: parseClicksReport(clicks) };
}
