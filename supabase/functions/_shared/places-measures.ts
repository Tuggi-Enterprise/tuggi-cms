// _shared/places-measures.ts
//
// The pure half of `places-measures` (#1145): the measures of BR-B2B-068 for the overview of the Portal
// Locais. Contract: `docs/contracts/places-cms.md` (workspace) and `identidade-publica.md`, "As medidas".
//
// Import-free, so the CMS tests run it under Node. The gate and the reads come in as arguments;
// `places-measures/index.ts` only wires `isPlacesSecret` and the admin client into them.
//
// Who may see which partner: the portal's Worker proves, with the user's token, that the signed-in
// account owns the submission, and sends only the submission id. The partner is resolved HERE, from
// the submission row, with the secret key. A client id in the body is never read.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** `{submission_id: uuid, month?: "YYYY-MM" | null}`. Any other key is ignored, `client_id` included. */
export function parseMeasuresRequest(body: unknown): { submissionId: string; month: string | null } | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const { submission_id, month } = body as Record<string, unknown>;
  if (typeof submission_id !== 'string' || !UUID.test(submission_id)) return null;
  if (month !== undefined && month !== null && (typeof month !== 'string' || !MONTH.test(month))) return null;
  return { submissionId: submission_id.toLowerCase(), month: typeof month === 'string' ? month : null };
}

export interface RpcError {
  code?: string | null;
  message?: string | null;
}

/** The three ways a submission reaches its partner (`partner.place_submissions`). */
export type SubmissionLink = { client_id: unknown; legacy_client_id: unknown; attraction_id: unknown };

const id = (v: unknown): string | null => (typeof v === 'string' && UUID.test(v) ? v : null);

const COMMISSION = ['no_tax_id', 'no_rate', 'to_be_settled', 'settled'] as const;
export type CommissionStatus = (typeof COMMISSION)[number];

export type Measures = {
  month: string;
  since_month: string;
  commission: { status: CommissionStatus; amount_cents: number | null; currency: string | null };
  listened: number | null;
  saved: number | null;
  downloaded: number | null;
  profile_visits: number | null;
};

const count = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null);

/**
 * The function's answer with only the contract's keys. A count that is not a non-negative integer
 * becomes null (the portal shows "sem dado", never a zero). Null when the frame itself is wrong.
 */
export function shapeMeasures(data: unknown): Measures | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  if (typeof d.month !== 'string' || !MONTH.test(d.month)) return null;
  if (typeof d.since_month !== 'string' || !MONTH.test(d.since_month)) return null;
  const c = d.commission;
  if (!c || typeof c !== 'object' || Array.isArray(c)) return null;
  const { status, amount_cents, currency } = c as Record<string, unknown>;
  if (!COMMISSION.includes(status as CommissionStatus)) return null;
  const settled = status === 'settled';
  return {
    month: d.month,
    since_month: d.since_month,
    commission: {
      status: status as CommissionStatus,
      amount_cents: settled ? count(amount_cents) : null,
      currency: settled && typeof currency === 'string' ? currency : null,
    },
    listened: count(d.listened),
    saved: count(d.saved),
    downloaded: count(d.downloaded),
    profile_visits: count(d.profile_visits),
  };
}

export interface MeasuresDeps {
  isAuthorized: (req: Request) => boolean;
  /** The submission's partner links; `data: null` when there is no such submission. */
  submission: (submissionId: string) => Promise<{ data: SubmissionLink | null; error: RpcError | null }>;
  /** `core.attractions.partner_client_id` of the place's POI. */
  attractionPartner: (attractionId: string) => Promise<{ data: unknown; error: RpcError | null }>;
  /** `partner.get_partner_measures_as(p_client_id, p_month)`; `month` is the first day, or null for the current month. */
  measures: (clientId: string, month: string | null) => Promise<{ data: unknown; error: RpcError | null }>;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

class Upstream extends Error {}

/**
 * The partner of a submission: the client of a no-address partner (`client_id`, written at approval),
 * the pre-portal client of a mirror (`legacy_client_id`), or the partner of the place's POI. Null when
 * the submission has none yet (draft, in review, rejected).
 */
async function partnerOf(submissionId: string, deps: MeasuresDeps): Promise<string | null> {
  const s = await deps.submission(submissionId);
  if (s.error) throw new Upstream(`submission ${s.error.code ?? 'no_code'}`);
  if (!s.data) return null;
  const direct = id(s.data.client_id) ?? id(s.data.legacy_client_id);
  if (direct) return direct;
  const poi = id(s.data.attraction_id);
  if (!poi) return null;
  const a = await deps.attractionPartner(poi);
  if (a.error) throw new Upstream(`attraction ${a.error.code ?? 'no_code'}`);
  return id(a.data);
}

export async function handlePlacesMeasures(req: Request, deps: MeasuresDeps): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  if (!deps.isAuthorized(req)) return json(401, { error: 'unauthorized' });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'invalid_body' });
  }
  const request = parseMeasuresRequest(body);
  if (!request) return json(400, { error: 'invalid_body' });

  try {
    const clientId = await partnerOf(request.submissionId, deps);
    if (!clientId) return json(200, { measures: null });
    const { data, error } = await deps.measures(clientId, request.month ? `${request.month}-01` : null);
    if (error) {
      // BR-B2B-068 item 2: a month that has not started is the caller's mistake, not an outage.
      if (error.code === '22023') return json(400, { error: 'invalid_month' });
      if (error.code === 'P0002') return json(200, { measures: null });
      // The code only: the message of a PostgREST error can echo the arguments.
      console.error('[places-measures] get_partner_measures_as failed', error.code ?? 'no_code');
      return json(502, { error: 'unavailable' });
    }
    const measures = shapeMeasures(data);
    if (!measures) {
      console.error('[places-measures] get_partner_measures_as returned another shape');
      return json(502, { error: 'unavailable' });
    }
    return json(200, { measures });
  } catch (e) {
    console.error('[places-measures] read failed', e instanceof Upstream ? e.message : 'threw');
    return json(502, { error: 'unavailable' });
  }
}
