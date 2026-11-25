// _shared/places-portal-qr-login.ts
//
// The handler of `places-portal-qr-login` (#1271, BR-B2B-069 item 4): the computer signs in to the
// Portal Locais by a QR the app approves. Contract: `docs/contracts/login-por-qr.md` §3 (workspace).
//
// The portal's Worker calls it with `x-places-secret`, for two actions:
//  · `create` → `partner.portal_qr_login_create`: `{code, poll_token, expires_at}`;
//  · `poll`   → `partner.portal_qr_login_poll`; on `approved`, the account's e-mail
//    (`auth.admin.getUserById`) and a magic link for it (`auth.admin.generateLink`, which sends no
//    e-mail), answered as `{state: 'approved', token_hash}`.
//
// #1303: the app calls it with the JWT of its signed-in account, for one action, `app_open` ("Configurar
// minha conta no portal" opens the portal already signed in, in the phone's browser). The request is
// created here and approved BY THAT SESSION (`drive.approve_portal_qr_login_v1` with the app's JWT), so
// the proof of BR-B2B-069 4.g and 4.h is the database's, the same as the QR's (contract §2.5). The
// answer is the poll token, which the app puts in the URL fragment of the portal; the portal's Worker
// spends it with `poll`, once, within the 2 minutes after the approval. No second way to the sign-in.
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

/** #1303: a client that acts as the app's signed-in account (its JWT), for the `drive.*` functions. */
export interface QrLoginAccountDb {
  schema(name: 'drive'): { rpc(fn: string, args: Record<string, unknown>): Answer<unknown> };
}

export interface QrLoginDeps {
  isAuthorized: (req: Request) => boolean;
  db: QrLoginDb;
  /** #1303: `app_open` only; without it the action does not exist. */
  asAccount?: (jwt: string) => QrLoginAccountDb;
}

/** What `app_open` answers when the account or the session may not open the portal (contract §2.3). */
export const APP_OPEN_REFUSALS = ['not_eligible', 'not_a_partner', 'needs_email_link'] as const;
type AppOpenRefusal = (typeof APP_OPEN_REFUSALS)[number];
const isRefusal = (v: unknown): v is AppOpenRefusal => APP_OPEN_REFUSALS.includes(v as AppOpenRefusal);

/** No session, or a JWT PostgREST does not take (bad, expired, or of another project). */
const NO_SESSION_CODES = new Set(['42501', 'PGRST301', 'PGRST302', 'PGRST303']);
const isNoSession = (e: QrLoginError) => NO_SESSION_CODES.has(e.code ?? '') || e.status === 401;

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

/**
 * #1303 `app_open`: the account of `jwt` opens the portal in the phone's browser. Three calls, in an
 * order that writes nothing for whoever may not:
 *  1. the get as the account, with an empty code: it checks the JWT (PostgREST) and answers the account
 *     and the session before the code (contract §2.3), so a refusal comes back before any request exists;
 *     `invalid` (the empty code) means the account and the session may go on;
 *  2. `create` with the service role, with no user agent and no city: nobody is asked a question;
 *  3. the approve AS THE ACCOUNT: the same proof of the mailbox as the QR (§2.5).
 * The answer is `{state: 'ready', handoff_token}`, where `handoff_token` is the poll token.
 */
async function appOpen(jwt: string, db: QrLoginDb, account: QrLoginAccountDb): Promise<Response> {
  const asked = await account.schema('drive').rpc('get_portal_qr_login_v1', { p_code: '' });
  if (asked.error) {
    if (isNoSession(asked.error)) return json(401, { error: 'unauthorized' });
    console.error('[places-portal-qr-login] app_open get failed', codeOf(asked.error));
    return json(502, { error: 'unavailable' });
  }
  const before = firstRow(asked.data)?.state;
  if (isRefusal(before)) return json(200, { state: before });
  if (before !== 'invalid') {
    console.error('[places-portal-qr-login] app_open get returned another shape');
    return json(502, { error: 'unavailable' });
  }

  const created = await db.schema('partner').rpc('portal_qr_login_create', { p_user_agent: null, p_city: null });
  if (created.error) {
    console.error('[places-portal-qr-login] app_open create failed', codeOf(created.error));
    return json(502, { error: 'unavailable' });
  }
  const row = firstRow(created.data);
  const code = row?.code;
  const pollToken = row?.poll_token;
  if (typeof code !== 'string' || !CODE.test(code) || typeof pollToken !== 'string' || !POLL_TOKEN.test(pollToken)) {
    console.error('[places-portal-qr-login] app_open create returned another shape');
    return json(502, { error: 'unavailable' });
  }

  const approved = await account.schema('drive').rpc('approve_portal_qr_login_v1', { p_code: code });
  if (approved.error) {
    if (isNoSession(approved.error)) return json(401, { error: 'unauthorized' });
    console.error('[places-portal-qr-login] app_open approve failed', codeOf(approved.error));
    return json(502, { error: 'unavailable' });
  }
  const decision = firstRow(approved.data);
  // The window to spend it is the database's (`partner.portal_qr_login_ttl()`, 2 minutes from the approval).
  if (decision?.ok === true) return json(200, { state: 'ready', handoff_token: pollToken });
  // The account changed between the get and the approve: the same refusal, and the request dies alone.
  if (decision?.ok === false && isRefusal(decision.reason)) return json(200, { state: decision.reason });
  console.error('[places-portal-qr-login] app_open approve returned another shape');
  return json(502, { error: 'unavailable' });
}

/** `Bearer <jwt>`, the three dot-separated parts of a JWT; anything else is no account. */
const BEARER = /^Bearer\s+([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;

export async function handlePortalQrLogin(req: Request, deps: QrLoginDeps): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const byWorker = deps.isAuthorized(req);
  // #1303: without the secret, only the app's account may come in, and only for `app_open`.
  const jwt = byWorker ? null : (BEARER.exec(req.headers.get('authorization') ?? '')?.[1] ?? null);
  if (!byWorker && (!jwt || !deps.asAccount)) return json(401, { error: 'unauthorized' });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'invalid_body' });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json(400, { error: 'invalid_body' });
  const b = body as Record<string, unknown>;
  try {
    if (jwt && deps.asAccount) {
      if (b.action === 'app_open') return await appOpen(jwt, deps.db, deps.asAccount(jwt));
      return json(401, { error: 'unauthorized' });
    }
    if (b.action === 'create') return await create(b, deps.db);
    if (b.action === 'poll') return await poll(b, deps.db);
  } catch {
    // supabase-js answers `{ error }`; a throw is the network or the runtime.
    console.error('[places-portal-qr-login]', b.action, 'threw');
    return json(502, { error: 'unavailable' });
  }
  return json(400, { error: 'invalid_body' });
}
