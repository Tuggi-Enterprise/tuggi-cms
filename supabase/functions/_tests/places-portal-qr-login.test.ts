/**
 * #1271: `places-portal-qr-login`, the computer signing in to the Portal Locais by a QR the app
 * approves. BR-B2B-069 item 4; contract `docs/contracts/login-por-qr.md` §3.
 *
 * The handler gets a fake admin client that records every call; nothing reaches a database or the
 * network. The last tests load `places-portal-qr-login/index.ts` through the harness, to prove the
 * deployed function wires the real secret gate and the right RPC.
 */
import { assert, assertEquals } from './assert.ts';
import { loadHandler, scenario } from './harness.ts';
import { handlePortalQrLogin, type QrLoginDb } from '../_shared/places-portal-qr-login.ts';

const CODE = '3f9c0a7e5b1d4c2e8a6f0b9d7c5e3a1f';
const POLL = '9a1e'.repeat(16);
const USER = '5b2f8c1d-3e4a-4b6c-9d7e-0f1a2b3c4d5e';
const EMAIL = 'dono@exemplo.com.br';
const HASH = 'pkce_0123456789abcdef0123456789abcdef0123456789abcdef01234567';
const SECRET = 'test-places-secret';

type Err = { code?: string; status?: number } | null;

interface Fake {
  create?: { data: unknown; error: Err };
  poll?: { data: unknown; error: Err };
  user?: { data: unknown; error: Err };
  link?: { data: unknown; error: Err };
  throws?: boolean;
}

function fakeDb(f: Fake) {
  const calls: Array<{ fn: string; schema?: string; args: unknown }> = [];
  const db = {
    schema: (name: string) => ({
      rpc: (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, schema: name, args });
        if (f.throws) return Promise.reject(new Error('network'));
        const a = fn === 'portal_qr_login_create' ? f.create : fn === 'portal_qr_login_poll' ? f.poll : undefined;
        return Promise.resolve(a ?? { data: null, error: null });
      },
    }),
    auth: {
      admin: {
        getUserById: (id: string) => {
          calls.push({ fn: 'getUserById', args: id });
          return Promise.resolve(f.user ?? { data: { user: { id: USER, email: EMAIL } }, error: null });
        },
        generateLink: (params: unknown) => {
          calls.push({ fn: 'generateLink', args: params });
          return Promise.resolve(
            f.link ?? { data: { user: { id: USER, email: EMAIL }, properties: { hashed_token: HASH, action_link: `https://x/verify?token=${HASH}` } }, error: null },
          );
        },
      },
    },
  };
  return { calls, db: db as unknown as QrLoginDb };
}

function post(body: unknown, headers: Record<string, string> = { 'x-places-secret': SECRET }): Request {
  return new Request('http://edge.test/places-portal-qr-login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function run(body: unknown, f: Fake = {}, authorized = true) {
  const { calls, db } = fakeDb(f);
  const res = await handlePortalQrLogin(post(body), { isAuthorized: () => authorized, db });
  const raw = await res.text();
  return { status: res.status, raw, json: JSON.parse(raw), calls };
}

const approved = { data: [{ state: 'approved', user_id: USER }], error: null };

Deno.test('BR-B2B-069 4: without the secret nothing runs', async () => {
  const r = await run({ action: 'create', user_agent: 'UA', city: 'Paraty' }, {}, false);
  assertEquals(r.status, 401);
  assertEquals(r.json, { error: 'unauthorized' });
  assertEquals(r.calls, []);
});

Deno.test('create passes the user agent and the city to portal_qr_login_create, in the partner schema', async () => {
  const r = await run(
    { action: 'create', user_agent: 'Mozilla/5.0 Chrome/131', city: 'São Paulo' },
    { create: { data: [{ code: CODE, poll_token: POLL, expires_at: '2026-11-24T15:02:00Z' }], error: null } },
  );
  assertEquals(r.status, 200);
  assertEquals(r.json, { code: CODE, poll_token: POLL, expires_at: '2026-11-24T15:02:00Z' });
  assertEquals(r.calls, [{ fn: 'portal_qr_login_create', schema: 'partner', args: { p_user_agent: 'Mozilla/5.0 Chrome/131', p_city: 'São Paulo' } }]);
});

Deno.test('create without user agent or city sends null, never another value', async () => {
  const r = await run({ action: 'create', user_agent: 42 }, { create: { data: [{ code: CODE, poll_token: POLL, expires_at: 'x' }], error: null } });
  assertEquals(r.status, 200);
  assertEquals(r.calls[0].args, { p_user_agent: null, p_city: null });
});

Deno.test('create: a database error or another shape is a 502, with no code or token', async () => {
  const err = await run({ action: 'create' }, { create: { data: null, error: { code: '42883' } } });
  assertEquals([err.status, err.json], [502, { error: 'unavailable' }]);
  const shape = await run({ action: 'create' }, { create: { data: [{ code: 'short', poll_token: POLL, expires_at: 'x' }], error: null } });
  assertEquals([shape.status, shape.json], [502, { error: 'unavailable' }]);
  assert(!shape.raw.includes(POLL), 'the poll token of a bad row does not leave');
});

Deno.test('BR-B2B-069 4.c: poll approved answers only state and token_hash; the account id and the e-mail stay inside', async () => {
  const r = await run({ action: 'poll', poll_token: POLL }, { poll: approved });
  assertEquals(r.status, 200);
  assertEquals(r.json, { state: 'approved', token_hash: HASH });
  assert(!r.raw.includes(USER), 'user_id never leaves the function');
  assert(!r.raw.includes(EMAIL), 'the e-mail never leaves the function');
  assert(!r.raw.includes('action_link') && !r.raw.includes('https://x/verify'), 'the link GoTrue built never leaves');
  assertEquals(r.calls, [
    { fn: 'portal_qr_login_poll', schema: 'partner', args: { p_poll_token: POLL } },
    { fn: 'getUserById', args: USER },
    { fn: 'generateLink', args: { type: 'magiclink', email: EMAIL } },
  ]);
});

Deno.test('BR-B2B-069 4.d: a poll that is not approved carries no token_hash and asks for no link', async () => {
  for (const state of ['pending', 'refused', 'expired', 'consumed', 'invalid']) {
    // The database fills user_id only on approved; a stray one must not leave either.
    const r = await run({ action: 'poll', poll_token: POLL }, { poll: { data: [{ state, user_id: state === 'pending' ? USER : null }], error: null } });
    assertEquals([r.status, r.json], [200, { state }], state);
    assert(!r.raw.includes(USER), `${state}: no user_id`);
    assertEquals(r.calls.map((c) => c.fn), ['portal_qr_login_poll'], state);
  }
});

Deno.test('BR-B2B-069 4.d: generateLink failing after approved is the terminal error state', async () => {
  const r = await run({ action: 'poll', poll_token: POLL }, { poll: approved, link: { data: null, error: { status: 500 } } });
  assertEquals([r.status, r.json], [502, { state: 'error' }]);
  assert(!r.raw.includes(EMAIL) && !r.raw.includes(USER));
});

Deno.test('approved but the account has no e-mail, or the read fails: error, and no link is asked', async () => {
  const noEmail = await run({ action: 'poll', poll_token: POLL }, { poll: approved, user: { data: { user: { id: USER, email: null } }, error: null } });
  assertEquals([noEmail.status, noEmail.json], [502, { state: 'error' }]);
  assertEquals(noEmail.calls.map((c) => c.fn), ['portal_qr_login_poll', 'getUserById']);
  const failed = await run({ action: 'poll', poll_token: POLL }, { poll: approved, user: { data: null, error: { status: 404 } } });
  assertEquals([failed.status, failed.json], [502, { state: 'error' }]);
});

Deno.test('poll: a malformed token is invalid without a round trip; a missing one is a bad body', async () => {
  const bad = await run({ action: 'poll', poll_token: 'nope' });
  assertEquals([bad.status, bad.json, bad.calls.length], [200, { state: 'invalid' }, 0]);
  const missing = await run({ action: 'poll' });
  assertEquals([missing.status, missing.json], [400, { error: 'invalid_body' }]);
});

Deno.test('poll: a database error, an unknown state or a throw is a retryable 502', async () => {
  const err = await run({ action: 'poll', poll_token: POLL }, { poll: { data: null, error: { code: 'XX000' } } });
  assertEquals([err.status, err.json], [502, { error: 'unavailable' }]);
  const odd = await run({ action: 'poll', poll_token: POLL }, { poll: { data: [{ state: 'scanned' }], error: null } });
  assertEquals([odd.status, odd.json], [502, { error: 'unavailable' }]);
  const threw = await run({ action: 'poll', poll_token: POLL }, { throws: true });
  assertEquals([threw.status, threw.json], [502, { error: 'unavailable' }]);
});

Deno.test('another method, a broken body or an unknown action is refused', async () => {
  const { db } = fakeDb({});
  const get = await handlePortalQrLogin(new Request('http://edge.test/x'), { isAuthorized: () => true, db });
  assertEquals(get.status, 405);
  assertEquals((await run('{not json')).status, 400);
  assertEquals((await run([1])).status, 400);
  assertEquals((await run({ action: 'approve' })).status, 400);
});

Deno.test('no log line carries the code, the poll token, the account id or the e-mail', async () => {
  const lines: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => lines.push(args.map(String).join(' '));
  try {
    await run({ action: 'poll', poll_token: POLL }, { poll: approved, link: { data: null, error: { status: 500 } } });
    await run({ action: 'poll', poll_token: POLL }, { poll: approved, user: { data: null, error: { status: 404 } } });
    await run({ action: 'create' }, { create: { data: [{ code: CODE }], error: null } });
    await run({ action: 'poll', poll_token: POLL }, { poll: { data: null, error: { code: 'XX000' } } });
  } finally {
    console.error = original;
  }
  assert(lines.length === 4, `four failures logged, got ${lines.length}`);
  for (const line of lines) {
    for (const secret of [CODE, POLL, USER, EMAIL]) assert(!line.includes(secret), `log leaks: ${line}`);
  }
});

// --- the deployed function, end to end through the harness ---------------------------------

let handler: ((req: Request) => Response | Promise<Response>) | null = null;
async function deployed() {
  if (!handler) {
    Deno.env.set('PLACES_CMS_SECRET', SECRET);
    handler = await loadHandler('places-portal-qr-login');
  }
  scenario.calls.length = 0;
  return handler;
}

Deno.test('index.ts: no secret or a wrong one is a 401 before any database call', async () => {
  const h = await deployed();
  for (const headers of [{}, { 'x-places-secret': 'wrong' }] as Record<string, string>[]) {
    const res = await h(post({ action: 'create' }, headers));
    assertEquals(res.status, 401);
    await res.body?.cancel();
  }
  assertEquals(scenario.calls, []);
});

Deno.test('index.ts: with the secret, create reaches portal_qr_login_create', async () => {
  const h = await deployed();
  scenario.rpcs.portal_qr_login_create = { data: [{ code: CODE, poll_token: POLL, expires_at: '2026-11-24T15:02:00Z' }], error: null };
  try {
    const res = await h(post({ action: 'create', user_agent: 'UA', city: null }));
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { code: CODE, poll_token: POLL, expires_at: '2026-11-24T15:02:00Z' });
    assertEquals(scenario.calls, ['rpc:portal_qr_login_create']);
  } finally {
    delete scenario.rpcs.portal_qr_login_create;
  }
});

// --- #1303: the app opens the portal already signed in (`app_open`) -----------------------------

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1In0.c2lnbmF0dXJl';

interface AccountFake {
  get?: { data: unknown; error: Err };
  approve?: { data: unknown; error: Err };
}

async function runAsApp(body: unknown, f: Fake & AccountFake = {}, authorization: string | null = `Bearer ${JWT}`) {
  const { calls, db } = fakeDb(f);
  const tokens: string[] = [];
  const account = (jwt: string) => {
    tokens.push(jwt);
    return {
      schema: (name: string) => ({
        rpc: (fn: string, args: Record<string, unknown>) => {
          calls.push({ fn, schema: name, args });
          const a = fn === 'get_portal_qr_login_v1' ? f.get : fn === 'approve_portal_qr_login_v1' ? f.approve : undefined;
          return Promise.resolve(a ?? { data: null, error: null });
        },
      }),
    };
  };
  const headers: Record<string, string> = authorization ? { authorization } : {};
  const res = await handlePortalQrLogin(post(body, headers), {
    isAuthorized: () => false,
    db,
    asAccount: account as never,
  });
  const raw = await res.text();
  return { status: res.status, raw, json: JSON.parse(raw), calls, tokens };
}

const mayGo = { data: { state: 'invalid', user_agent: null, city: null, expires_at: null }, error: null };
const created = { data: [{ code: CODE, poll_token: POLL, expires_at: '2026-11-25T15:02:00Z' }], error: null };

Deno.test('BR-B2B-069 4.g and 4.h, #1303: app_open creates the request and approves it AS the app account, and answers the poll token', async () => {
  const r = await runAsApp({ action: 'app_open' }, { get: mayGo, create: created, approve: { data: { ok: true, reason: null }, error: null } });
  assertEquals(r.status, 200);
  assertEquals(r.json, { state: 'ready', handoff_token: POLL });
  assertEquals(r.tokens, [JWT]);
  assertEquals(
    r.calls.map((c) => `${c.schema}.${c.fn}`),
    ['drive.get_portal_qr_login_v1', 'partner.portal_qr_login_create', 'drive.approve_portal_qr_login_v1'],
  );
  // Nobody is asked a question about this request: no browser, no city.
  assertEquals(r.calls[1].args, { p_user_agent: null, p_city: null });
  assertEquals(r.calls[2].args, { p_code: CODE });
  // The code never leaves: only the poll token, which the portal spends once.
  assert(!r.raw.includes(CODE));
});

Deno.test('BR-B2B-069 4.g and 4.h, #1303: an account or a session that may not approve gets its state, and no request is created', async () => {
  for (const state of ['not_eligible', 'not_a_partner', 'needs_email_link']) {
    const r = await runAsApp({ action: 'app_open' }, { get: { data: { state }, error: null }, create: created });
    assertEquals(r.status, 200);
    assertEquals(r.json, { state });
    assertEquals(r.calls.map((c) => c.fn), ['get_portal_qr_login_v1']);
  }
});

Deno.test('#1303: the approve that refuses after the get (the account changed) answers the refusal, never a token', async () => {
  const r = await runAsApp(
    { action: 'app_open' },
    { get: mayGo, create: created, approve: { data: { ok: false, reason: 'needs_email_link' }, error: null } },
  );
  assertEquals(r.json, { state: 'needs_email_link' });
  assert(!r.raw.includes(POLL));
});

Deno.test('#1303: no session or a JWT PostgREST refuses is a 401, before any request exists', async () => {
  for (const code of ['42501', 'PGRST301', 'PGRST303']) {
    const r = await runAsApp({ action: 'app_open' }, { get: { data: null, error: { code } }, create: created });
    assertEquals(r.status, 401);
    assertEquals(r.calls.map((c) => c.fn), ['get_portal_qr_login_v1']);
  }
});

Deno.test('#1303: without a bearer JWT nothing runs; with one, only app_open exists', async () => {
  for (const authorization of [null, 'Bearer not-a-jwt', `Basic ${JWT}`]) {
    const r = await runAsApp({ action: 'app_open' }, { get: mayGo, create: created }, authorization);
    assertEquals(r.status, 401);
    assertEquals(r.calls, []);
  }
  for (const action of ['create', 'poll']) {
    const r = await runAsApp({ action, poll_token: POLL }, { get: mayGo, create: created });
    assertEquals(r.status, 401);
    assertEquals(r.calls, []);
  }
});

Deno.test('#1303: the Worker with the secret cannot call app_open', async () => {
  const { calls, db } = fakeDb({ create: created });
  const res = await handlePortalQrLogin(post({ action: 'app_open' }), { isAuthorized: () => true, db, asAccount: () => { throw new Error('no account'); } });
  assertEquals(res.status, 400);
  assertEquals(calls, []);
});

Deno.test('#1303: a database failure or another shape is a 502, with no code, token or JWT in the log', async () => {
  const lines: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => lines.push(args.map(String).join(' '));
  try {
    assertEquals((await runAsApp({ action: 'app_open' }, { get: { data: null, error: { code: 'XX000' } } })).status, 502);
    assertEquals((await runAsApp({ action: 'app_open' }, { get: { data: { state: 'pending' }, error: null } })).status, 502);
    assertEquals((await runAsApp({ action: 'app_open' }, { get: mayGo, create: { data: null, error: { code: 'XX000' } } })).status, 502);
    assertEquals((await runAsApp({ action: 'app_open' }, { get: mayGo, create: { data: [{ code: CODE }], error: null } })).status, 502);
    assertEquals((await runAsApp({ action: 'app_open' }, { get: mayGo, create: created, approve: { data: null, error: { code: 'XX000' } } })).status, 502);
    assertEquals((await runAsApp({ action: 'app_open' }, { get: mayGo, create: created, approve: { data: { ok: 'x' }, error: null } })).status, 502);
  } finally {
    console.error = original;
  }
  assertEquals(lines.length, 6);
  for (const line of lines) {
    for (const secret of [CODE, POLL, JWT]) assert(!line.includes(secret), `log leaks: ${line}`);
  }
});

Deno.test('index.ts, #1303: app_open with the app JWT reaches the get, the create and the approve', async () => {
  const h = await deployed();
  scenario.rpcs.get_portal_qr_login_v1 = mayGo;
  scenario.rpcs.portal_qr_login_create = created;
  scenario.rpcs.approve_portal_qr_login_v1 = { data: { ok: true, reason: null }, error: null };
  try {
    const res = await h(post({ action: 'app_open' }, { authorization: `Bearer ${JWT}` }));
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { state: 'ready', handoff_token: POLL });
    assertEquals(scenario.calls, ['rpc:get_portal_qr_login_v1', 'rpc:portal_qr_login_create', 'rpc:approve_portal_qr_login_v1']);
  } finally {
    delete scenario.rpcs.get_portal_qr_login_v1;
    delete scenario.rpcs.portal_qr_login_create;
    delete scenario.rpcs.approve_portal_qr_login_v1;
  }
});
