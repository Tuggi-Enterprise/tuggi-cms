/**
 * #1047: the weekly push sender, `_shared/weekly-local-push.ts` and `weekly-local-push/index.ts`.
 * BR-COMUNICACAO-019 item 3.m, BR-COMUNICACAO-012 item 1.7.
 *
 * #1205: the claim is paged (`p_limit`), and the handler takes an optional `now` to replay an hour.
 *
 * The module gets a fake `drive` client and a fake `send`, so every claim row, every `/send` body
 * and every `finish_weekly_push` call is read back. The handler tests prove the gate in front and,
 * with the real sender of `_shared/push-send.ts`, that a run reaches FCM with no call to another
 * function (#1046).
 */
import { assert, assertEquals } from './assert.ts';
import { fetchCalls, loadHandler, network, scenario } from './harness.ts';
import { type DriveRpc, PUSH_KINDS } from '../_shared/push-gate.ts';
import {
  CLAIM_PAGE_SIZE,
  MAX_CLAIM_PAGES,
  parseRunBody,
  runWeeklyLocalPush,
  SEND_CONCURRENCY,
  type WeeklyPushDeps,
} from '../_shared/weekly-local-push.ts';
import { PUSH_BODY_MAX, PUSH_TITLE_MAX, TRIP_PUSH_COPY } from '../_shared/trip-message-copy.ts';
import { isFirstSaturday, reminderReachable, tripQuestionPush } from '../_shared/trip-question.ts';

/** The tally of a run with no first-Saturday question in it. */
const NO_QUESTION = { asked: 0, marked: 0, already_spent: 0, mark_failed: 0, audience_failed: 0 };

const USER_A = '33333333-3333-4333-8333-333333333333';
const USER_B = '44444444-4444-4444-8444-444444444444';

function claimRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    send_id: 101,
    user_id: USER_A,
    piece: 'thursday',
    push_kind: 'weekly_thursday_local',
    local_date: '2026-10-29',
    language: 'pt',
    variant: 'event',
    title: 'Hoje à noite em Búzios: “Festival de Jazz”',
    body: 'Começa às 20h, a 3 km de você. Toque para ver.',
    deeplink: 'tuggi://event?id=55555555-5555-4555-8555-555555555555',
    item_id: '55555555-5555-4555-8555-555555555555',
    ...overrides,
  };
}

interface Trail {
  rpcs: Array<{ fn: string; args?: Record<string, unknown> }>;
  sends: Array<{ body: Record<string, unknown> }>;
  logs: string[];
}

type RpcAnswer = { data: unknown; error: { code?: string } | null };

/**
 * A fake run: `claim` is what the claim answers (a function answers per page, 1 first), `reply`
 * what the sender answers for each body. A fixed answer is the first page; later pages are empty.
 */
function fakeRun(
  claim: RpcAnswer | ((page: number) => RpcAnswer),
  reply: (body: Record<string, unknown>) => Response | Promise<Response>,
  finishAnswer: (args: Record<string, unknown>) => { data: unknown; error: { code?: string } | null } = () => ({
    data: true,
    error: null,
  }),
  other?: (fn: string, args: Record<string, unknown>) => RpcAnswer | undefined,
): { deps: WeeklyPushDeps; trail: Trail } {
  const trail: Trail = { rpcs: [], sends: [], logs: [] };
  let page = 0;
  const drive: DriveRpc = {
    rpc(fn, args) {
      trail.rpcs.push({ fn, args });
      if (fn === 'claim_weekly_push') {
        page += 1;
        if (typeof claim === 'function') return Promise.resolve(claim(page));
        return Promise.resolve(page === 1 ? claim : { data: [], error: null });
      }
      if (fn === 'finish_weekly_push') return Promise.resolve(finishAnswer(args ?? {}));
      const answer = other?.(fn, args ?? {});
      if (answer) return Promise.resolve(answer);
      return Promise.resolve({ data: null, error: { code: 'unexpected' } });
    },
  };
  const deps: WeeklyPushDeps = {
    drive,
    // The answer `/send` would give, read the way the route writes it: status and JSON body.
    send: async (body) => {
      trail.sends.push({ body });
      const res = await reply(body);
      return { status: res.status, body: await res.json().catch(() => null) };
    },
    log: (line) => trail.logs.push(line),
  };
  return { deps, trail };
}

/** The answer of a one-person `/send` whose gate said `outcome`. */
function gateAnswer(outcome: string, status = 200): Response {
  return new Response(JSON.stringify({ success: true, result: {}, gate: { [outcome]: 1 } }), { status });
}

function finishes(trail: Trail): Array<Record<string, unknown> | undefined> {
  return trail.rpcs.filter((c) => c.fn === 'finish_weekly_push').map((c) => c.args);
}

function claims(trail: Trail): Array<Record<string, unknown> | undefined> {
  return trail.rpcs.filter((c) => c.fn === 'claim_weekly_push').map((c) => c.args);
}

/** `count` claim rows with distinct send ids starting at `first`. */
function page(count: number, first: number): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, i) => claimRow({ send_id: first + i }));
}

Deno.test('BR-COMUNICACAO-019 3.m (#1047): a claim row becomes one /send with the row push_kind and deeplink, then closes sent', async () => {
  const { deps, trail } = fakeRun({ data: [claimRow()], error: null }, () => gateAnswer('sent'));
  const report = await runWeeklyLocalPush(deps);

  assertEquals(trail.sends.length, 1);
  const send = trail.sends[0];
  assertEquals(send.body.type, 'user');
  assertEquals(send.body.userIds, [USER_A]);
  assertEquals(send.body.push_kind, 'weekly_thursday_local');
  const notification = send.body.notification as { data: Record<string, unknown> };
  assertEquals(notification.data.deeplink, 'tuggi://event?id=55555555-5555-4555-8555-555555555555');
  assertEquals(notification.data.type, 'weekly_thursday_local');
  assertEquals(finishes(trail), [{ p_send_id: 101, p_outcome: 'sent' }]);
  assertEquals(report, { claimed: 1, outcomes: { sent: 1, denied: 0, not_delivered: 0, failed: 0 }, invalid: 0, unfinished: 0, trip_question: NO_QUESTION });
});

Deno.test('BR-COMUNICACAO-019 3.m (#1047): title and body reach /send exactly as the database wrote them', async () => {
  const title = '  Sábado: “Rota dos Fortes”, Cabo Frio — 4 paradas ';
  const body = 'Linha 1\nLinha 2 com acento: é, ç, ã. {name}';
  const { deps, trail } = fakeRun(
    { data: [claimRow({ push_kind: 'weekly_saturday_local', variant: 'route', title, body, deeplink: 'tuggi://route?id=x' })], error: null },
    () => gateAnswer('sent'),
  );
  await runWeeklyLocalPush(deps);
  const notification = trail.sends[0].body.notification as Record<string, unknown>;
  assertEquals([notification.title, notification.body], [title, body]);
  assertEquals(trail.sends[0].body.push_kind, 'weekly_saturday_local');
  assertEquals((notification.data as Record<string, unknown>).variant, 'route');
});

Deno.test('BR-COMUNICACAO-019 3.m.8 (#1047): a send the gate denies closes denied', async () => {
  const { deps, trail } = fakeRun({ data: [claimRow()], error: null }, () => gateAnswer('denied'));
  const report = await runWeeklyLocalPush(deps);
  assertEquals(finishes(trail), [{ p_send_id: 101, p_outcome: 'denied' }]);
  assertEquals(report.outcomes.denied, 1);
});

Deno.test('BR-COMUNICACAO-019 3.m (#1047): no device closes not_delivered', async () => {
  const { deps, trail } = fakeRun({ data: [claimRow()], error: null }, () => gateAnswer('not_delivered'));
  await runWeeklyLocalPush(deps);
  assertEquals(finishes(trail), [{ p_send_id: 101, p_outcome: 'not_delivered' }]);
});

Deno.test('#1047: every error of the send closes failed and is logged without the person', async () => {
  const errors: Array<[string, (body: Record<string, unknown>) => Response | Promise<Response>]> = [
    ['thrown', () => Promise.reject(new TypeError('network down for 33333333-3333-4333-8333-333333333333'))],
    ['500', () => new Response('{"error":"boom"}', { status: 500 })],
    ['400 unknown kind', () => new Response('{"error":"INVALID_PUSH_KIND"}', { status: 400 })],
    ['2xx without a tally', () => new Response('{"success":true}', { status: 200 })],
    ['2xx not json', () => new Response('ok', { status: 200 })],
    ['gate_error', () => gateAnswer('gate_error')],
    ['gate_missing', () => gateAnswer('gate_missing')],
    ['failed', () => gateAnswer('failed')],
  ];
  for (const [name, reply] of errors) {
    const { deps, trail } = fakeRun({ data: [claimRow()], error: null }, reply);
    const report = await runWeeklyLocalPush(deps);
    assertEquals([name, finishes(trail)], [name, [{ p_send_id: 101, p_outcome: 'failed' }]]);
    assertEquals([name, report.outcomes.failed], [name, 1]);
    const logs = trail.logs.join('\n');
    assert(logs.includes('failed'), `${name}: the failure was not logged`);
    assert(!logs.includes(USER_A), `${name}: the log carries the user id`);
    assert(!logs.includes('Festival'), `${name}: the log carries the copy`);
  }
});

Deno.test('#1047: a row that cannot be read is not sent and closes failed', async () => {
  const bad = [
    claimRow({ send_id: 201, push_kind: 'cms_broadcast' }),
    claimRow({ send_id: 202, push_kind: 'weekly_podium' }),
    claimRow({ send_id: 203, title: '   ' }),
    claimRow({ send_id: 204, deeplink: 'https://evil.test' }),
    claimRow({ send_id: 205, user_id: 'not-a-uuid' }),
  ];
  const { deps, trail } = fakeRun({ data: bad, error: null }, () => gateAnswer('sent'));
  const report = await runWeeklyLocalPush(deps);
  assertEquals(trail.sends.length, 0);
  assertEquals(
    finishes(trail),
    [201, 202, 203, 204, 205].map((id) => ({ p_send_id: id, p_outcome: 'failed' })),
  );
  assertEquals([report.invalid, report.outcomes.failed, report.unfinished], [5, 5, 0]);
});

Deno.test('#1047: a failed claim throws, so the handler answers 500 and nothing is sent', async () => {
  const { deps, trail } = fakeRun({ data: null, error: { code: '42501' } }, () => gateAnswer('sent'));
  let thrown = '';
  try {
    await runWeeklyLocalPush(deps);
  } catch (error) {
    thrown = (error as { code?: string }).code ?? '';
  }
  assertEquals(thrown, '42501');
  assertEquals(trail.sends.length, 0);
});

Deno.test('#1047: a finish that errors or finds the row closed is counted as unfinished, never hidden', async () => {
  const { deps, trail } = fakeRun(
    { data: [claimRow({ send_id: 301 }), claimRow({ send_id: 302, user_id: USER_B })], error: null },
    () => gateAnswer('sent'),
    (args) => (args.p_send_id === 301 ? { data: null, error: { code: '57014' } } : { data: false, error: null }),
  );
  const report = await runWeeklyLocalPush(deps);
  assertEquals([report.outcomes.sent, report.unfinished], [2, 2]);
  assert(trail.logs.some((l) => l.includes('finish 301') && l.includes('57014')));
  assert(trail.logs.some((l) => l.includes('finish 302') && l.includes('already closed')));
});

Deno.test('#1047: every claimed row is sent once and closed once, in batches', async () => {
  const rows = Array.from({ length: SEND_CONCURRENCY * 2 + 3 }, (_, i) => claimRow({ send_id: 1000 + i }));
  let inFlight = 0;
  let peak = 0;
  const { deps, trail } = fakeRun({ data: rows, error: null }, async () => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 1));
    inFlight -= 1;
    return gateAnswer('sent');
  });
  const report = await runWeeklyLocalPush(deps);
  assertEquals(report.outcomes.sent, rows.length);
  assertEquals(finishes(trail).map((a) => a?.p_send_id).sort(), rows.map((r) => r.send_id).sort());
  assert(peak <= SEND_CONCURRENCY, `peak ${peak}`);
});

// ---- #1205: the claim in pages ----

Deno.test('BR-COMUNICACAO-019 3.m (#1205): three pages (50, 50, 7) are all sent and summed in one report', async () => {
  const pages = [page(50, 1000), page(50, 2000), page(7, 3000)];
  const { deps, trail } = fakeRun((n) => ({ data: pages[n - 1] ?? [], error: null }), () => gateAnswer('sent'));
  const report = await runWeeklyLocalPush(deps);
  assertEquals(CLAIM_PAGE_SIZE, 50);
  assertEquals(claims(trail).length, 3, 'the short page ends the run, no fourth claim');
  assertEquals(trail.sends.length, 107);
  assertEquals(finishes(trail).length, 107);
  assertEquals(report, { claimed: 107, outcomes: { sent: 107, denied: 0, not_delivered: 0, failed: 0 }, invalid: 0, unfinished: 0, trip_question: NO_QUESTION });
});

Deno.test('#1205: invalid rows, outcomes and unfinished rows of every page add up', async () => {
  const first = page(50, 1000);
  first[0] = claimRow({ send_id: 1000, push_kind: 'cms_broadcast' });
  const pages = [first, [claimRow({ send_id: 2000 }), claimRow({ send_id: 2001 })]];
  const { deps } = fakeRun(
    (n) => ({ data: pages[n - 1] ?? [], error: null }),
    (body) => gateAnswer((body.userIds as string[])[0] === USER_A ? 'denied' : 'sent'),
    (args) => (args.p_send_id === 2001 ? { data: false, error: null } : { data: true, error: null }),
  );
  const report = await runWeeklyLocalPush(deps);
  assertEquals(report, { claimed: 52, outcomes: { sent: 0, denied: 51, not_delivered: 0, failed: 1 }, invalid: 1, unfinished: 1, trip_question: NO_QUESTION });
});

Deno.test('#1205: a page shorter than the page size stops the run, an empty one too', async () => {
  for (const sizes of [[49], [0], [50, 0]]) {
    const { deps, trail } = fakeRun((n) => ({ data: page(sizes[n - 1] ?? 0, n * 1000), error: null }), () => gateAnswer('sent'));
    await runWeeklyLocalPush(deps);
    assertEquals([sizes, claims(trail).length], [sizes, sizes.length]);
  }
});

Deno.test('#1205: the page cap stops a claim that never runs dry, and says so in the log', async () => {
  const { deps, trail } = fakeRun((n) => ({ data: page(50, n * 1000), error: null }), () => gateAnswer('sent'));
  const report = await runWeeklyLocalPush(deps);
  assertEquals(MAX_CLAIM_PAGES, 40);
  assertEquals(claims(trail).length, MAX_CLAIM_PAGES);
  assertEquals(report.claimed, 50 * MAX_CLAIM_PAGES);
  assert(trail.logs.some((l) => l.includes('page cap')), 'the cap was not logged');
});

Deno.test('#1205: every claim carries p_limit, and p_now when the run has an instant', async () => {
  const now = new Date('2026-11-19T21:02:00.000Z');
  const pages = [page(50, 1000), page(3, 2000)];
  const { deps, trail } = fakeRun((n) => ({ data: pages[n - 1] ?? [], error: null }), () => gateAnswer('sent'));
  await runWeeklyLocalPush({ ...deps, now });
  assertEquals(claims(trail), [
    { p_limit: 50, p_now: '2026-11-19T21:02:00.000Z' },
    { p_limit: 50, p_now: '2026-11-19T21:02:00.000Z' },
  ]);

  const plain = fakeRun({ data: [], error: null }, () => gateAnswer('sent'));
  await runWeeklyLocalPush(plain.deps);
  assertEquals(claims(plain.trail), [{ p_limit: 50 }]);
});

Deno.test('#1205: a failed first claim still throws, with the code that aborted 2026-11-19', async () => {
  const { deps, trail } = fakeRun(() => ({ data: null, error: { code: '57014' } }), () => gateAnswer('sent'));
  let thrown = '';
  try {
    await runWeeklyLocalPush(deps);
  } catch (error) {
    thrown = (error as { code?: string }).code ?? '';
  }
  assertEquals(thrown, '57014');
  assertEquals(trail.sends.length, 0);
});

Deno.test('#1205: a failed second claim returns what already left, and logs the code', async () => {
  const { deps, trail } = fakeRun(
    (n) => (n === 1 ? { data: page(50, 1000), error: null } : { data: null, error: { code: '57014' } }),
    () => gateAnswer('sent'),
  );
  const report = await runWeeklyLocalPush(deps);
  assertEquals(claims(trail).length, 2);
  assertEquals(report, { claimed: 50, outcomes: { sent: 50, denied: 0, not_delivered: 0, failed: 0 }, invalid: 0, unfinished: 0, trip_question: NO_QUESTION });
  assert(trail.logs.some((l) => l.includes('claim page 2') && l.includes('57014')), 'the failed page was not logged');
});

// ---- #1205: the optional body of the handler ----

Deno.test('#1205: the body is empty, {} or carries an ISO 8601 now', () => {
  assertEquals(parseRunBody(''), {});
  assertEquals(parseRunBody('  '), {});
  assertEquals(parseRunBody('{}'), {});
  assertEquals(parseRunBody('{"other":1}'), {});
  const utc = parseRunBody('{"now":"2026-11-19T21:02:00Z"}') as { now: Date };
  assertEquals(utc.now.toISOString(), '2026-11-19T21:02:00.000Z');
  const offset = parseRunBody('{"now":"2026-11-19T18:02:00.000-03:00"}') as { now: Date };
  assertEquals(offset.now.toISOString(), '2026-11-19T21:02:00.000Z');
});

Deno.test('#1205: a now that is not an ISO 8601 date-time, or a body that is not an object, is invalid_now', () => {
  const bad = [
    '{"now":"2026-11-19"}',
    '{"now":"2026-11-19T18:02:00"}',
    '{"now":"19/11/2026 18:02"}',
    '{"now":"2026-13-40T99:99:00Z"}',
    '{"now":""}',
    '{"now":null}',
    '{"now":1763586120000}',
    '[]',
    '"2026-11-19T21:02:00Z"',
    'null',
    '{not json',
  ];
  for (const text of bad) assertEquals([text, parseRunBody(text)], [text, { error: 'invalid_now' }]);
});

Deno.test('BR-COMUNICACAO-019 3.m (#1047): the two weekly kinds are unrequested and do not need "using the app"', () => {
  for (const kind of ['weekly_thursday_local', 'weekly_saturday_local'] as const) {
    assertEquals([kind, PUSH_KINDS[kind].requested, PUSH_KINDS[kind].requiresActive], [kind, false, false]);
  }
});

// ---- the handler: the gate in front of the run ----

const handler = await loadHandler('weekly-local-push');

function call(authorization: string | null, method = 'POST', body?: string): Promise<Response> {
  scenario.calls.length = 0;
  fetchCalls.length = 0;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (authorization !== null) headers.authorization = authorization;
  return Promise.resolve(handler(new Request('http://edge.test/weekly-local-push', { method, headers, body })));
}

Deno.test('#1047: without the machine key nothing is claimed and nothing is sent', async () => {
  for (const auth of [null, 'Bearer user-session-token', 'Bearer sb_publishable_xyz', 'test-service-role-key-but-wrong']) {
    const res = await call(auth);
    assertEquals([auth, res.status], [auth, 401]);
    assertEquals([auth, scenario.calls, fetchCalls], [auth, [], []]);
  }
  assertEquals((await call('Bearer test-service-role-key', 'GET')).status, 405);
});

Deno.test('#1047: the cron call with the machine key claims and answers the tally', async () => {
  const res = await call('Bearer test-service-role-key');
  assertEquals(res.status, 200);
  assertEquals(scenario.calls, ['rpc:claim_weekly_push']);
  assertEquals(await res.json(), {
    claimed: 0,
    outcomes: { sent: 0, denied: 0, not_delivered: 0, failed: 0 },
    invalid: 0,
    unfinished: 0,
    trip_question: { asked: 0, marked: 0, already_spent: 0, mark_failed: 0, audience_failed: 0 },
  });
});

Deno.test('#1205: the cron body {} runs for now; a past now reaches the claim as p_now', async () => {
  const seen: Array<Record<string, unknown> | undefined> = [];
  scenario.rpcs = { claim_weekly_push: (args) => (seen.push(args), { data: [], error: null }) };
  assertEquals((await call('Bearer test-service-role-key', 'POST', '{}')).status, 200);
  assertEquals((await call('Bearer test-service-role-key', 'POST', '{"now":"2026-11-19T21:02:00Z"}')).status, 200);
  assertEquals(seen, [{ p_limit: 50 }, { p_limit: 50, p_now: '2026-11-19T21:02:00.000Z' }]);
  scenario.rpcs = {};
});

Deno.test('#1205: an invalid now answers 400 and claims nothing; without the key it is still 401', async () => {
  const res = await call('Bearer test-service-role-key', 'POST', '{"now":"ontem"}');
  assertEquals(res.status, 400);
  assertEquals(await res.json(), { error: 'invalid_now' });
  assertEquals(scenario.calls, []);
  const replay = await call('Bearer user-session-token', 'POST', '{"now":"2026-11-19T21:02:00Z"}');
  assertEquals(replay.status, 401);
  assertEquals(scenario.calls, []);
});

// ---- #1046: the whole run, with the real sender, against the Supabase function-to-function budget ----

Deno.test('BR-COMUNICACAO-019 3.m (#1046): 120 claimed people all leave, through the gate, with no call to another function', async () => {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', keyPair.privateKey));
  Deno.env.set('FIREBASE_PRIVATE_KEY', btoa(String.fromCharCode(...pkcs8)));
  Deno.env.set('FIREBASE_PROJECT_ID', 'tuggi-test');
  Deno.env.set('FIREBASE_CLIENT_EMAIL', 'push@tuggi-test.iam.gserviceaccount.test');

  const people = Array.from({ length: 120 }, (_, i) => `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`);
  const rows = people.map((user_id, i) => claimRow({ send_id: 5000 + i, user_id }));
  // The claim hands out at most `p_limit` rows a call, each already written, like the database does.
  const queue = [...rows];
  scenario.rpcs = {
    claim_weekly_push: (args) => ({ data: queue.splice(0, Number(args?.p_limit)), error: null }),
    unrequested_push_policy: { data: null, error: null },
    push_allowed: { data: true, error: null },
    record_push_sent: { data: null, error: null },
    finish_weekly_push: { data: true, error: null },
  };
  scenario.tables = {
    fcm_tokens: people.map((user_id) => ({ user_id, fcm_token: `tok-${user_id}` })),
    profiles: [],
    user_notifications: (chain: string[]) => (chain.includes('insert') ? { id: crypto.randomUUID() } : null),
    notification_logs: [{ id: 1 }],
  };
  scenario.tableErrors = {};
  scenario.writes.length = 0;
  network.reply = (url) => {
    if (url.startsWith('https://oauth2.googleapis.com/')) {
      return new Response(JSON.stringify({ access_token: 'test-access-token' }), { status: 200 });
    }
    if (url.includes('fcm.googleapis.com')) return new Response('{"name":"projects/x/messages/1"}', { status: 200 });
    return new Response('{}', { status: 400 });
  };

  const res = await call('Bearer test-service-role-key');
  const report = await res.json();

  assertEquals(res.status, 200);
  assertEquals(report, { claimed: 120, outcomes: { sent: 120, denied: 0, not_delivered: 0, failed: 0 }, invalid: 0, unfinished: 0, trip_question: NO_QUESTION });
  assertEquals(fetchCalls.filter((u) => u.includes('/functions/v1/')), []);
  assertEquals(fetchCalls.filter((u) => u.startsWith('https://oauth2.googleapis.com/')).length, 1);
  assertEquals(fetchCalls.filter((u) => u.includes('fcm.googleapis.com')).length, 120);
  assertEquals(scenario.calls.filter((c) => c === 'rpc:push_allowed').length, 120);
  assertEquals(scenario.calls.filter((c) => c === 'rpc:record_push_sent').length, 120);
  const inbox = scenario.writes.filter((w) => w.table === 'user_notifications' && w.op === 'insert');
  assertEquals(inbox.map((w) => (w.values as { user_id: string }).user_id).sort(), [...people].sort());
  assertEquals((inbox[0].values as { type: string }).type, 'weekly_thursday_local');
  assertEquals(scenario.writes.filter((w) => w.table === 'notification_logs').length, 120);
  assertEquals(scenario.calls.filter((c) => c === 'rpc:finish_weekly_push').length, 120);
  assertEquals(scenario.calls.filter((c) => c === 'rpc:claim_weekly_push').length, 3);
});

// ---- #1276, BR-COMUNICACAO-019 3.u.3 and 3.u.2: the trip question on the first Saturday ----

/** 2026-12-05 is the first Saturday of December; 2026-12-12 the second. */
const FIRST_SATURDAY = '2026-12-05';
const SECOND_SATURDAY = '2026-12-12';

function saturdayRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return claimRow({
    piece: 'saturday',
    push_kind: 'weekly_saturday_local',
    local_date: FIRST_SATURDAY,
    variant: 'route',
    title: 'Sábado em Búzios: “Rota dos Fortes”',
    body: 'Quatro paradas perto de você, em Búzios.',
    deeplink: 'tuggi://route?id=66666666-6666-4666-8666-666666666666',
    item_id: '66666666-6666-4666-8666-666666666666',
    ...overrides,
  });
}

const SETTINGS_ON = {
  switches: [
    { key: 'trip_reminder.enabled', is_on: true },
    { key: 'channel.push', is_on: true },
    { key: 'channel.email', is_on: true },
  ],
};

/** The other RPCs of a run with the question: who is in the audience, the switches and the mark. */
function questionRpcs(opts: {
  audience?: string[] | { code: string };
  settings?: unknown;
  mark?: RpcAnswer;
} = {}): (fn: string, args: Record<string, unknown>) => RpcAnswer | undefined {
  return (fn) => {
    if (fn === 'trip_question_audience') {
      const a = opts.audience ?? [USER_A];
      return Array.isArray(a) ? { data: a.map((user_id) => ({ user_id })), error: null } : { data: null, error: a };
    }
    if (fn === 'cms_get_trip_settings') return { data: 'settings' in opts ? opts.settings : SETTINGS_ON, error: null };
    if (fn === 'mark_trip_question_sent') return opts.mark ?? { data: true, error: null };
    return undefined;
  };
}

const sentNotification = (trail: Trail, i = 0) =>
  trail.sends[i].body.notification as { title: string; body: string; data: Record<string, unknown> };

const marks = (trail: Trail) => trail.rpcs.filter((c) => c.fn === 'mark_trip_question_sent').map((c) => c.args);

Deno.test('BR-COMUNICACAO-019 3.u.3 and 3.u.2 (#1276): first Saturday, in the audience: the question goes in place of the Saturday piece and the month is spent', async () => {
  const { deps, trail } = fakeRun({ data: [saturdayRow()], error: null }, () => gateAnswer('sent'), undefined, questionRpcs());
  const report = await runWeeklyLocalPush(deps);

  const audience = trail.rpcs.find((c) => c.fn === 'trip_question_audience');
  assertEquals(audience?.args, { p_channel: 'push', p_user_ids: [USER_A] });
  assertEquals(trail.sends.length, 1, 'the question is never one push more');
  const send = trail.sends[0].body;
  assertEquals(send.push_kind, 'weekly_saturday_local', 'the question takes the Saturday slot of item 4.1');
  const n = sentNotification(trail);
  assertEquals(n.title, TRIP_PUSH_COPY.next_ask_title.pt);
  assertEquals(n.body, TRIP_PUSH_COPY.next_ask_body.pt);
  assertEquals(n.data, { type: 'weekly_saturday_local', deeplink: 'tuggi://trip?ask=1', variant: 'trip_next_ask', piece: 'trip_next_ask' });
  assertEquals(marks(trail), [{ p_user_id: USER_A, p_channel: 'push' }]);
  const order = trail.rpcs.map((c) => c.fn);
  assert(order.indexOf('mark_trip_question_sent') < order.indexOf('finish_weekly_push'), 'mark before the row closes');
  assertEquals(finishes(trail), [{ p_send_id: 101, p_outcome: 'sent' }]);
  assertEquals(report.trip_question, { asked: 1, marked: 1, already_spent: 0, mark_failed: 0, audience_failed: 0 });
});

Deno.test('BR-COMUNICACAO-019 3.u.3 (#1276): the second Saturday sends the usual piece and never asks the audience', async () => {
  const { deps, trail } = fakeRun(
    { data: [saturdayRow({ local_date: SECOND_SATURDAY })], error: null },
    () => gateAnswer('sent'),
    undefined,
    questionRpcs(),
  );
  const report = await runWeeklyLocalPush(deps);
  assertEquals(trail.rpcs.some((c) => c.fn === 'trip_question_audience'), false);
  const n = sentNotification(trail);
  assertEquals([n.title, n.data.deeplink, n.data.variant, 'piece' in n.data], [
    'Sábado em Búzios: “Rota dos Fortes”',
    'tuggi://route?id=66666666-6666-4666-8666-666666666666',
    'route',
    false,
  ]);
  assertEquals(marks(trail), []);
  assertEquals(report.trip_question, NO_QUESTION);
});

Deno.test('BR-COMUNICACAO-019 3.u.3 (#1276): a Thursday piece in the first week is never the question', async () => {
  const { deps, trail } = fakeRun(
    { data: [claimRow({ local_date: '2026-12-03' })], error: null },
    () => gateAnswer('sent'),
    undefined,
    questionRpcs(),
  );
  await runWeeklyLocalPush(deps);
  assertEquals(trail.rpcs.some((c) => c.fn === 'trip_question_audience'), false);
  assertEquals(sentNotification(trail).data.variant, 'event');
});

Deno.test('BR-COMUNICACAO-019 3.u.1 (#1276): first Saturday, outside the audience: the usual piece, no mark', async () => {
  const rows = [saturdayRow(), saturdayRow({ send_id: 102, user_id: USER_B })];
  const { deps, trail } = fakeRun({ data: rows, error: null }, () => gateAnswer('sent'), undefined, questionRpcs({ audience: [USER_B] }));
  const report = await runWeeklyLocalPush(deps);
  const byUser = new Map(trail.sends.map((s) => [(s.body.userIds as string[])[0], s.body.notification as { title: string; data: Record<string, unknown> }]));
  assertEquals(byUser.get(USER_A)?.data.variant, 'route');
  assertEquals(byUser.get(USER_A)?.title, 'Sábado em Búzios: “Rota dos Fortes”');
  assertEquals(byUser.get(USER_B)?.data.piece, 'trip_next_ask');
  assertEquals(marks(trail), [{ p_user_id: USER_B, p_channel: 'push' }]);
  assertEquals(trail.rpcs.filter((c) => c.fn === 'trip_question_audience').length, 1, 'one audience read per page');
  assertEquals(report.trip_question.asked, 1);
});

Deno.test('BR-COMUNICACAO-019 3.u.2 and 3.m.8 (#1276): a question the gate drops or the FCM refuses spends nothing', async () => {
  for (const [outcome, closed] of [['denied', 'denied'], ['not_delivered', 'not_delivered'], ['failed', 'failed'], ['gate_error', 'failed']] as const) {
    const { deps, trail } = fakeRun({ data: [saturdayRow()], error: null }, () => gateAnswer(outcome), undefined, questionRpcs());
    const report = await runWeeklyLocalPush(deps);
    assertEquals([outcome, sentNotification(trail).data.piece], [outcome, 'trip_next_ask']);
    assertEquals([outcome, marks(trail)], [outcome, []]);
    assertEquals([outcome, finishes(trail)], [outcome, [{ p_send_id: 101, p_outcome: closed }]]);
    assertEquals([outcome, report.trip_question.marked], [outcome, 0]);
  }
  const { deps, trail } = fakeRun({ data: [saturdayRow()], error: null }, () => new Response('{}', { status: 500 }), undefined, questionRpcs());
  await runWeeklyLocalPush(deps);
  assertEquals(marks(trail), []);
});

Deno.test('BR-COMUNICACAO-019 3.u.2 (#1276): a month the e-mail already spent is logged, and the row still closes sent', async () => {
  const { deps, trail } = fakeRun(
    { data: [saturdayRow()], error: null },
    () => gateAnswer('sent'),
    undefined,
    questionRpcs({ mark: { data: false, error: null } }),
  );
  const report = await runWeeklyLocalPush(deps);
  assertEquals(report.trip_question, { asked: 1, marked: 0, already_spent: 1, mark_failed: 0, audience_failed: 0 });
  assertEquals(finishes(trail), [{ p_send_id: 101, p_outcome: 'sent' }]);
  assert(trail.logs.some((l) => l.includes('already spent')));
  assert(!trail.logs.join('\n').includes(USER_A), 'the log carries the user id');
});

Deno.test('#1276: a mark that fails is counted and logged without the person; the row still closes sent', async () => {
  const { deps, trail } = fakeRun(
    { data: [saturdayRow()], error: null },
    () => gateAnswer('sent'),
    undefined,
    questionRpcs({ mark: { data: null, error: { code: 'TGU37' } } }),
  );
  const report = await runWeeklyLocalPush(deps);
  assertEquals(report.trip_question.mark_failed, 1);
  assertEquals(finishes(trail), [{ p_send_id: 101, p_outcome: 'sent' }]);
  assert(trail.logs.some((l) => l.includes('TGU37')));
  assert(!trail.logs.join('\n').includes(USER_A));
});

Deno.test('#1276: an audience that cannot be read sends the usual piece and counts it', async () => {
  const { deps, trail } = fakeRun(
    { data: [saturdayRow()], error: null },
    () => gateAnswer('sent'),
    undefined,
    questionRpcs({ audience: { code: 'PGRST202' } }),
  );
  const report = await runWeeklyLocalPush(deps);
  assertEquals(sentNotification(trail).data.variant, 'route');
  assertEquals(marks(trail), []);
  assertEquals(report.trip_question.audience_failed, 1);
  assertEquals(report.outcomes.sent, 1);
});

Deno.test('BR-COMUNICACAO-023 item 5 (#1276): with the reminder or the push channel off, or unreadable, the question promises no reminder', async () => {
  const off = [
    { switches: [{ key: 'trip_reminder.enabled', is_on: false }, { key: 'channel.push', is_on: true }] },
    { switches: [{ key: 'trip_reminder.enabled', is_on: true }, { key: 'channel.push', is_on: false }] },
    null,
  ];
  for (const settings of off) {
    const { deps, trail } = fakeRun({ data: [saturdayRow()], error: null }, () => gateAnswer('sent'), undefined, questionRpcs({ settings }));
    await runWeeklyLocalPush(deps);
    assertEquals([JSON.stringify(settings), sentNotification(trail).body], [JSON.stringify(settings), TRIP_PUSH_COPY.next_ask_body_no_reminder.pt]);
  }
  // The switches are read once per run, not once per person.
  const rows = [saturdayRow(), saturdayRow({ send_id: 102, user_id: USER_B })];
  const { deps, trail } = fakeRun({ data: rows, error: null }, () => gateAnswer('sent'), undefined, questionRpcs({ audience: [USER_A, USER_B] }));
  await runWeeklyLocalPush(deps);
  assertEquals(trail.rpcs.filter((c) => c.fn === 'cms_get_trip_settings').length, 1);
});

Deno.test('BR-COMUNICACAO-019 3.u.5 and 11 (#1276): the question in six languages, within 40 and 110, names no destination and no hours', () => {
  for (const lang of ['pt', 'en', 'es', 'fr', 'it', 'de'] as const) {
    for (const reminder of [true, false]) {
      const push = tripQuestionPush(lang, reminder);
      assert(push.title.length <= PUSH_TITLE_MAX, `${lang} title ${push.title.length}: ${push.title}`);
      assert(push.body.length <= PUSH_BODY_MAX, `${lang} body ${push.body.length}: ${push.body}`);
      assert(!/\{\{|\d/.test(push.title + push.body), `${lang}: a placeholder or a number`);
      assert(!/\b(horas?|hours?|heures?|ore|Stunden?)\b/iu.test(push.title + push.body), `${lang}: speaks of hours`);
    }
  }
  assertEquals(tripQuestionPush('fr', true).title, 'Un prochain voyage en vue ?');
  assertEquals(tripQuestionPush('de-DE', true).body, TRIP_PUSH_COPY.next_ask_body.de);
  assertEquals(tripQuestionPush('xx', true).title, TRIP_PUSH_COPY.next_ask_title.en);
});

Deno.test('BR-COMUNICACAO-019 3.u.5 (#1276): the question carries nothing of the piece it replaces', async () => {
  const { deps, trail } = fakeRun({ data: [saturdayRow({ language: 'it' })], error: null }, () => gateAnswer('sent'), undefined, questionRpcs());
  await runWeeklyLocalPush(deps);
  const n = sentNotification(trail);
  assertEquals([n.title, n.body], [TRIP_PUSH_COPY.next_ask_title.it, TRIP_PUSH_COPY.next_ask_body.it]);
  assert(!JSON.stringify(trail.sends[0].body).includes('Búzios'), 'the destination of the replaced piece leaked');
  assert(!JSON.stringify(trail.sends[0].body).includes('66666666'), 'the item of the replaced piece leaked');
});

Deno.test('BR-COMUNICACAO-019 3.u.3 (#1276): the first Saturday is a Saturday in days 1 to 7 of the local month', () => {
  for (const d of ['2026-12-05', '2027-01-02', '2027-05-01', '2027-08-07']) assertEquals([d, isFirstSaturday(d)], [d, true]);
  for (const d of ['2026-12-12', '2026-12-04', '2026-12-06', '2027-05-08', '2026-02-30', '2026-12-5', '', null, undefined]) {
    assertEquals([d, isFirstSaturday(d as string)], [d, false]);
  }
});

Deno.test('BR-COMUNICACAO-023 item 5 (#1276): a reminder reaches the person only with the reminder and the channel both on', () => {
  assertEquals(reminderReachable(SETTINGS_ON, 'push'), true);
  assertEquals(reminderReachable(SETTINGS_ON, 'email'), true);
  assertEquals(reminderReachable({ switches: [{ key: 'trip_reminder.enabled', is_on: true }] }, 'push'), false);
  assertEquals(reminderReachable({ switches: [{ key: 'trip_reminder.enabled', is_on: 'true' }, { key: 'channel.push', is_on: true }] }, 'push'), false);
  for (const bad of [null, undefined, {}, { switches: 'on' }, []]) assertEquals(reminderReachable(bad, 'push'), false);
});

Deno.test('BR-COMUNICACAO-019 3.u.3 (#1276): only the Saturday row is replaced, even when the audience names the person of another row', async () => {
  const rows = [claimRow({ local_date: '2026-12-03' }), saturdayRow({ send_id: 102, user_id: USER_B })];
  const { deps, trail } = fakeRun({ data: rows, error: null }, () => gateAnswer('sent'), undefined, questionRpcs({ audience: [USER_A, USER_B] }));
  await runWeeklyLocalPush(deps);
  const audience = trail.rpcs.find((c) => c.fn === 'trip_question_audience');
  assertEquals(audience?.args, { p_channel: 'push', p_user_ids: [USER_B] });
  const byUser = new Map(trail.sends.map((s) => [(s.body.userIds as string[])[0], (s.body.notification as { data: Record<string, unknown> }).data]));
  assertEquals(byUser.get(USER_A)?.variant, 'event');
  assertEquals(byUser.get(USER_B)?.piece, 'trip_next_ask');
  assertEquals(marks(trail), [{ p_user_id: USER_B, p_channel: 'push' }]);
});
