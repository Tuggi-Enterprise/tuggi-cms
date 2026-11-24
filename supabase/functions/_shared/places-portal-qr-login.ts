// _shared/places-portal-qr-login.ts
//
// The handler of `places-portal-qr-login` (#1271, BR-B2B-069 item 4): the computer signs in to the
// Portal Locais by a QR the app approves. Contract: `docs/contracts/login-por-qr.md` §3 (workspace).
//
// Only the portal's Worker calls it, with `x-places-secret`. Two actions:
//  · `create` → `partner.portal_qr_login_create`: `{code, poll_token, expires_at}`;
//  · `poll`   → `partner.portal_qr_login_poll`; on `approved`, the account's e-mail
//    (`auth.admin.getUserById`) and a magic link for it (`auth.admin.generateLink`, which sends no
//    e-mail), answered as `{state: 'approved', token_hash}`.
//
// The account id and the e-mail never leave this function, and never reach a log: the Worker only
// sees `state` and `token_hash`. No log line carries the code or the poll token either.
//
// Import-free, so the Deno tests drive it with a fake client; `places-portal-qr-login/index.ts`
// only wires the secret gate and the admin client into it.

export interface QrLoginError {
  code?: string | null;
  status?: number | null;
}

type Answer<T> = PromiseLike<{ data: T; error: QrLoginError | null }>;

/** The slice of the supabase-js admin client this handler uses. */
export interface QrLoginDb {
  schema(name: 'partner'): { rpc(fn: string, args: Record<string, unknown>): Answer<unknown> };
  auth: {
    admin: {
      getUserById(id: string): Answer<{ user: { email?: string | null } | null } | null>;
      generateLink(params: { type: 'magiclink'; email: string }): Answer<{ properties?: { hashed_token?: string | null } | null } | null>;
    };
  };
}

export interface QrLoginDeps {
  isAuthorized: (req: Request) => boolean;
  db: QrLoginDb;
}

/** The states of `partner.portal_qr_login_poll` (contract §2.2). */
export const POLL_STATES = ['pending', 'approved', 'refused', 'expired', 'consumed', 'invalid'] as const;
export type PollState = (typeof POLL_STATES)[number];

const CODE = /^[0-9a-f]{32}$/;
const POLL_TOKEN = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The edge's `User-Agent` and city are cleaned by the database (D5); this only bounds the payload. */
const MAX_TEXT = 2000;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

const text = (v: unknown): string | null => (typeof v === 'string' ? v.slice(0, MAX_TEXT) : null);
const firstRow = (data: unknown): Record<string, unknown> | null => {
  const row = Array.isArray(data) ? data[0] : data;
  return row && typeof row === 'object' && !Array.isArray(row) ? (row as Record<string, unknown>) : null;
};
const codeOf = (e: QrLoginError | null | undefined) => e?.code ?? (e?.status ? String(e.status) : 'no_code');

async function create(body: Record<string, unknown>, db: QrLoginDb): Promise<Response> {
  const { data, error } = await db
    .schema('partner')
    .rpc('portal_qr_login_create', { p_user_agent: text(body.user_agent), p_city: text(body.city) });
  if (error) {
    // The code only: the message of a PostgREST error can echo the arguments.
    console.error('[places-portal-qr-login] create failed', codeOf(error));
    return json(502, { error: 'unavailable' });
  }
  const row = firstRow(data);
  const code = row?.code;
  const pollToken = row?.poll_token;
  const expiresAt = row?.expires_at;
  if (typeof code !== 'string' || !CODE.test(code) || typeof pollToken !== 'string' || !POLL_TOKEN.test(pollToken) || typeof expiresAt !== 'string') {
    console.error('[places-portal-qr-login] create returned another shape');
    return json(502, { error: 'unavailable' });
  }
  return json(200, { code, poll_token: pollToken, expires_at: expiresAt });
}

/**
 * The request is already `consumed` when this runs: the poll that answered `approved` spent it (D4).
 * A failure here cannot be retried, so it answers the terminal `error` state (contract §3), with a
 * 502 so the platform logs count it as a failure. The computer asks for a new QR.
 */
const signInFailed = (step: string, error: QrLoginError | null | undefined) => {
  console.error('[places-portal-qr-login] approved but no sign-in:', step, codeOf(error));
  return json(502, { state: 'error' });
};

async function poll(body: Record<string, unknown>, db: QrLoginDb): Promise<Response> {
  const token = body.poll_token;
  if (typeof token !== 'string') return json(400, { error: 'invalid_body' });
  // What the database would answer for it, without the round trip.
  if (!POLL_TOKEN.test(token.trim().toLowerCase())) return json(200, { state: 'invalid' });

  const { data, error } = await db.schema('partner').rpc('portal_qr_login_poll', { p_poll_token: token });
  if (error) {
    console.error('[places-portal-qr-login] poll failed', codeOf(error));
    return json(502, { error: 'unavailable' });
  }
  const row = firstRow(data);
  const state = row?.state;
  if (!POLL_STATES.includes(state as PollState)) {
    console.error('[places-portal-qr-login] poll returned another shape');
    return json(502, { error: 'unavailable' });
  }
  if (state !== 'approved') return json(200, { state });

  const userId = row?.user_id;
  if (typeof userId !== 'string' || !UUID.test(userId)) return signInFailed('user_id', null);
  const user = await db.auth.admin.getUserById(userId);
  const email = user.data?.user?.email;
  if (user.error || typeof email !== 'string' || !email) return signInFailed('user', user.error);
  const link = await db.auth.admin.generateLink({ type: 'magiclink', email });
  const tokenHash = link.data?.properties?.hashed_token;
  if (link.error || typeof tokenHash !== 'string' || !tokenHash) return signInFailed('link', link.error);
  return json(200, { state: 'approved', token_hash: tokenHash });
}

export async function handlePortalQrLogin(req: Request, deps: QrLoginDeps): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  if (!deps.isAuthorized(req)) return json(401, { error: 'unauthorized' });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'invalid_body' });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json(400, { error: 'invalid_body' });
  const b = body as Record<string, unknown>;
  try {
    if (b.action === 'create') return await create(b, deps.db);
    if (b.action === 'poll') return await poll(b, deps.db);
  } catch {
    // supabase-js answers `{ error }`; a throw is the network or the runtime.
    console.error('[places-portal-qr-login]', b.action, 'threw');
    return json(502, { error: 'unavailable' });
  }
  return json(400, { error: 'invalid_body' });
}
