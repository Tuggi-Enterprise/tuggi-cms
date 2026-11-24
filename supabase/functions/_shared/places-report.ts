// _shared/places-report.ts
//
// The pure half of `places-report`: the published cycle reports of a place, for the reports tab of
// the Portal Locais (#994). Rule BR-B2B-059. Contract: `docs/contracts/places-cms.md` (workspace).
// Since #993 it reads `partner.report_cycle_list` (cycles of 21 to 20, frozen); the calendar month
// of #907 is gone.
//
// Import-free, so the CMS tests run it under Node. The gate and the RPC come in as arguments;
// `places-report/index.ts` only wires `isPlacesSecret` and the admin client into them.
//
// The cycles, their order and the payload are the database's. This function validates the request,
// keeps the four fields of each cycle and maps the errors.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `{submission_id: uuid}`. A `month` from the portal of #907 is ignored: there is no month to pick
 * any more, the list carries every published cycle.
 */
export function parseReportRequest(body: unknown): { submissionId: string } | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const { submission_id } = body as Record<string, unknown>;
  if (typeof submission_id !== 'string' || !UUID.test(submission_id)) return null;
  return { submissionId: submission_id.toLowerCase() };
}

export interface RpcError {
  code?: string | null;
  message?: string | null;
}

export type ReportCycle = { cycle_end: string; period_from: string; plan: string; payload: Record<string, unknown> };

/**
 * The database's list as it came, most recent first, with only `cycle_end`, `period_from`, `plan`
 * and `payload` of each cycle (nothing of the run, such as `email_sent_at`, reaches the portal).
 * An item without a date or a payload object is dropped. Null when the answer is not a list.
 */
export function shapeCycles(data: unknown): ReportCycle[] | null {
  const list = data === null ? [] : Array.isArray(data) ? data : null;
  if (!list) return null;
  const out: ReportCycle[] = [];
  for (const c of list) {
    if (!c || typeof c !== 'object') continue;
    const { cycle_end, period_from, plan, payload } = c as Record<string, unknown>;
    if (typeof cycle_end !== 'string' || !DATE.test(cycle_end)) continue;
    if (typeof period_from !== 'string' || !DATE.test(period_from)) continue;
    if (typeof plan !== 'string' || !payload || typeof payload !== 'object' || Array.isArray(payload)) continue;
    out.push({ cycle_end, period_from, plan, payload: payload as Record<string, unknown> });
  }
  return out;
}

export interface ReportDeps {
  isAuthorized: (req: Request) => boolean;
  cycleList: (submissionId: string) => Promise<{ data: unknown; error: RpcError | null }>;
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
    result = await deps.cycleList(request.submissionId);
  } catch {
    console.error('[places-report] report_cycle_list threw');
    return json(502, { error: 'unavailable' });
  }

  const { data, error } = result;
  if (error) {
    // The code only: the message of a PostgREST error can echo the arguments.
    console.error('[places-report] report_cycle_list failed', error.code ?? 'no_code');
    return json(502, { error: 'unavailable' });
  }
  const cycles = shapeCycles(data);
  if (!cycles) {
    console.error('[places-report] report_cycle_list returned no list');
    return json(502, { error: 'unavailable' });
  }
  return json(200, { cycles });
}
