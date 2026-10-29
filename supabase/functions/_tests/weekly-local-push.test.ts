/**
 * #1047: the weekly push sender, `_shared/weekly-local-push.ts` and `weekly-local-push/index.ts`.
 * BR-COMUNICACAO-019 item 3.m, BR-COMUNICACAO-012 item 1.7.
 *
 * The module gets a fake `drive` client and a fake `send`, so every claim row, every `/send` body
 * and every `finish_weekly_push` call is read back. The handler tests prove the gate in front and,
 * with the real sender of `_shared/push-send.ts`, that a run reaches FCM with no call to another
 * function (#1046).
 */
import { assert, assertEquals } from './assert.ts';
import { fetchCalls, loadHandler, network, scenario } from './harness.ts';
import { type DriveRpc, PUSH_KINDS } from '../_shared/push-gate.ts';
import { runWeeklyLocalPush, SEND_CONCURRENCY, type WeeklyPushDeps } from '../_shared/weekly-local-push.ts';

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

/** A fake run: `claim` is what the claim answers, `reply` what the sender answers for each body. */
function fakeRun(
  claim: { data: unknown; error: { code?: string } | null },
  reply: (body: Record<string, unknown>) => Response | Promise<Response>,
  finishAnswer: (args: Record<string, unknown>) => { data: unknown; error: { code?: string } | null } = () => ({
    data: true,
    error: null,
  }),
): { deps: WeeklyPushDeps; trail: Trail } {
  const trail: Trail = { rpcs: [], sends: [], logs: [] };
  const drive: DriveRpc = {
    rpc(fn, args) {
      trail.rpcs.push({ fn, args });
      if (fn === 'claim_weekly_push') return Promise.resolve(claim);
      if (fn === 'finish_weekly_push') return Promise.resolve(finishAnswer(args ?? {}));
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
  assertEquals(report, { claimed: 1, outcomes: { sent: 1, denied: 0, not_delivered: 0, failed: 0 }, invalid: 0, unfinished: 0 });
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

Deno.test('BR-COMUNICACAO-019 3.m (#1047): the two weekly kinds are unrequested and do not need "using the app"', () => {
  for (const kind of ['weekly_thursday_local', 'weekly_saturday_local'] as const) {
    assertEquals([kind, PUSH_KINDS[kind].requested, PUSH_KINDS[kind].requiresActive], [kind, false, false]);
  }
});

// ---- the handler: the gate in front of the run ----

const handler = await loadHandler('weekly-local-push');

function call(authorization: string | null, method = 'POST'): Promise<Response> {
  scenario.calls.length = 0;
  fetchCalls.length = 0;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (authorization !== null) headers.authorization = authorization;
  return Promise.resolve(handler(new Request('http://edge.test/weekly-local-push', { method, headers })));
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
  });
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
  scenario.rpcs = {
    claim_weekly_push: { data: rows, error: null },
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
  assertEquals(report, { claimed: 120, outcomes: { sent: 120, denied: 0, not_delivered: 0, failed: 0 }, invalid: 0, unfinished: 0 });
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
});
