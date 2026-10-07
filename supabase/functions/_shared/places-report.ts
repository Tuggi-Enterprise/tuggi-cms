// _shared/places-report.ts
//
// The pure half of `places-report` (#907): the monthly report of a place that is live, for the
// Portal Locais. Rule BR-B2B-059. Contract: `docs/contracts/places-cms.md` (workspace).
//
// Import-free, so the CMS tests run it under Node. The gate and the RPC come in as arguments;
// `places-report/index.ts` only wires `isPlacesSecret` and the admin client into them.
//
// The numbers, the floors (100 and 10) and the month list are the database's
// (`partner.place_monthly_report`). This function validates the request, maps the errors and
// passes the JSON on as it came.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

export interface ReportRequest {
  submissionId: string;
  /** First day of the month, `YYYY-MM-01`; null asks the database for the current month. */
  month: string | null;
}

/** `{submission_id: uuid, month?: "YYYY-MM" | null}`, nothing looser. */
export function parseReportRequest(body: unknown): ReportRequest | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const { submission_id, month } = body as Record<string, unknown>;
  if (typeof submission_id !== 'string' || !UUID.test(submission_id)) return null;
  if (month === undefined || month === null) {
    return { submissionId: submission_id.toLowerCase(), month: null };
  }
  if (typeof month !== 'string' || !MONTH.test(month)) return null;
  return { submissionId: submission_id.toLowerCase(), month: `${month}-01` };
}

export interface RpcError {
  code?: string | null;
  message?: string | null;
}

export type ReportError = 'not_live' | 'month_not_available' | 'unavailable';

/** `not_live` (P0001) is 409, a month outside the list (22023) is 404, anything else 502. */
export function reportErrorFor(error: RpcError): { status: number; error: ReportError } {
  if (error.code === 'P0001' && error.message === 'not_live') return { status: 409, error: 'not_live' };
  if (error.code === '22023') return { status: 404, error: 'month_not_available' };
  return { status: 502, error: 'unavailable' };
}

const METRICS = ['passersby_300m', 'story_played'] as const;

/**
 * The database's JSON as it came, with one guard (BR-B2B-059 item 5): a metric without
 * `has_data: true` never carries a count, whatever the row says.
 */
export function shapeReportResponse(report: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...report };
  for (const key of METRICS) {
    const metric = report[key];
    if (metric && typeof metric === 'object' && (metric as Record<string, unknown>).has_data !== true) {
      out[key] = { ...(metric as Record<string, unknown>), has_data: false, count: null };
    }
  }
  return out;
}

export interface ReportDeps {
  isAuthorized: (req: Request) => boolean;
  monthlyReport: (
    submissionId: string,
    month: string | null,
  ) => Promise<{ data: unknown; error: RpcError | null }>;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export async function handlePlacesReport(req: Request, deps: ReportDeps): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  if (!deps.isAuthorized(req)) return json(401, { error: 'unauthorized' });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'invalid_body' });
  }
  const request = parseReportRequest(body);
  if (!request) return json(400, { error: 'invalid_body' });

  let result: { data: unknown; error: RpcError | null };
  try {
    result = await deps.monthlyReport(request.submissionId, request.month);
  } catch {
    console.error('[places-report] place_monthly_report threw');
    return json(502, { error: 'unavailable' });
  }

  const { data, error } = result;
  if (error) {
    const mapped = reportErrorFor(error);
    // The code only: the message of a PostgREST error can echo the arguments.
    if (mapped.status === 502) console.error('[places-report] place_monthly_report failed', error.code ?? 'no_code');
    return json(mapped.status, { error: mapped.error });
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    console.error('[places-report] place_monthly_report returned no object');
    return json(502, { error: 'unavailable' });
  }
  return json(200, shapeReportResponse(data as Record<string, unknown>));
}
