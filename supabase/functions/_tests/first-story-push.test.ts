/**
 * #1072: the first story push, `_shared/first-story-push.ts` and `first-story-push/index.ts`.
 * BR-COMUNICACAO-019 item 3.n, BR-COMUNICACAO-008, BR-IDIOMA-001 item 3. Criteria:
 * `docs/design/copy/push-2026-11.md`, B.2; contract `docs/contracts/notificacoes.md` §14.
 *
 * The module gets a fake `drive` client and a fake `send`. The handler tests prove the machine key
 * in front and, with the real sender of `_shared/push-send.ts`, that the push asks consent only,
 * takes no cap slot, writes its inbox row, and that the mark comes before every send: at most once.
 */
import { assert, assertEquals } from './assert.ts';
import { fetchCalls, loadHandler, network, scenario } from './harness.ts';
import { type DriveRpc, PUSH_KINDS } from '../_shared/push-gate.ts';
import {
  FIRST_STORY_COPY,
  firstStoryCopy,
  type FirstStoryDeps,
  firstStoryRunFailed,
  runFirstStoryPush,
  SEND_CONCURRENCY,
} from '../_shared/first-story-push.ts';

const USER_A = '33333333-3333-4333-8333-333333333333';
const USER_B = '44444444-4444-4444-8444-444444444444';
const NOW = new Date('2026-11-03T15:00:00Z');

interface Trail {
  rpcs: Array<{ fn: string; args?: Record<string, unknown> }>;
  sends: Array<Record<string, unknown>>;
  logs: string[];
  /** RPCs and sends in the order they happened: `rpc:<fn>` and `send`. */
  order: string[];
}

type Answer = { data: unknown; error: { code?: string } | null };

function fakeRun(
  candidates: Answer,
  reply: (body: Record<string, unknown>) => Response | Promise<Response>,
  markAnswer: (attempt: number) => Answer = () => ({ data: 1, error: null }),
): { deps: FirstStoryDeps; trail: Trail } {
  const trail: Trail = { rpcs: [], sends: [], logs: [], order: [] };
  let markAttempts = 0;
  const drive: DriveRpc = {
    rpc(fn, args) {
      trail.rpcs.push({ fn, args });
      trail.order.push(`rpc:${fn}`);
      if (fn === 'get_first_story_push_candidates') return Promise.resolve(candidates);
      if (fn === 'mark_first_story_push_sent') return Promise.resolve(markAnswer(++markAttempts));
      return Promise.resolve({ data: null, error: { code: 'unexpected' } });
    },
  };
  return {
    trail,
    deps: {
      drive,
      now: NOW,
      send: async (body) => {
        trail.sends.push(body);
        trail.order.push('send');
        const res = await reply(body);
        return { status: res.status, body: await res.json().catch(() => null) };
      },
      log: (line) => trail.logs.push(line),
    },
  };
}

function gateAnswer(outcome: string, status = 200): Response {
  return new Response(JSON.stringify({ success: true, result: {}, gate: { [outcome]: 1 } }), { status });
}

const row = (user_id: string, language: string | null = 'pt') => ({ user_id, language, time_zone: 'America/Sao_Paulo' });

function marks(trail: Trail) {
  return trail.rpcs.filter((c) => c.fn === 'mark_first_story_push_sent').map((c) => c.args);
}

// ---- the copy: B.2 ----

Deno.test('BR-COMUNICACAO-019 3.n.5, B.2.1: title up to 40 and body up to 110 in six languages, no variable, ? ! or emoji', () => {
  assertEquals(Object.keys(FIRST_STORY_COPY).sort(), ['de', 'en', 'es', 'fr', 'it', 'pt']);
  for (const [lang, copy] of Object.entries(FIRST_STORY_COPY)) {
    assert(copy.title.length <= 40, `${lang} title ${copy.title.length}`);
    assert(copy.body.length <= 110, `${lang} body ${copy.body.length}`);
    for (const s of [copy.title, copy.body]) {
      assert(!/\{\{|[?!]|\p{Extended_Pictographic}/u.test(s), `${lang}: ${s}`);
    }
  }
});

Deno.test('BR-COMUNICACAO-008 items 1 and 3, B.2.2: no order to turn the guide on, no hours', () => {
  const activation = /ligar|ativar|activate|turn on|encender|activar|attivare|accendere|activer|allumer|einschalten|aktivieren|anschalten/i;
  const hours = /hora|hour|\bora\b|\bore\b|heure|Stunde/i;
  for (const [lang, copy] of Object.entries(FIRST_STORY_COPY)) {
    for (const s of [copy.title, copy.body]) {
      assert(!activation.test(s), `${lang} activation: ${s}`);
      assert(!hours.test(s), `${lang} hours: ${s}`);
    }
  }
});

Deno.test('BR-COMUNICACAO-019 item 11, B.2.3: `de` and its regional tags read German; outside the six reads English', () => {
  for (const raw of ['de', 'de-AT', 'de_CH']) assertEquals(firstStoryCopy(raw), FIRST_STORY_COPY.de);
  for (const raw of ['zh', 'ko', '', null, undefined, 42]) assertEquals(firstStoryCopy(raw), FIRST_STORY_COPY.en);
  assertEquals(firstStoryCopy('pt-BR'), FIRST_STORY_COPY.pt);
});

Deno.test('BR-COMUNICACAO-019 3.n.6: first_story is outside every cap, unrequested, for anyone with push on', () => {
  assertEquals(PUSH_KINDS.first_story, { requested: false, requiresActive: false, vacancyPriority: 4, outsideCaps: true });
});

// ---- the run ----

Deno.test('BR-COMUNICACAO-019 3.n.3 (#1072): one mark with every candidate, then one /send each to tuggi://map in its language', async () => {
  const { deps, trail } = fakeRun({ data: [row(USER_A, 'de'), row(USER_B, 'es')], error: null }, () => gateAnswer('sent'), () => ({ data: 2, error: null }));
  const report = await runFirstStoryPush(deps);

  assertEquals(trail.rpcs[0], { fn: 'get_first_story_push_candidates', args: { p_now: NOW.toISOString() } });
  assertEquals(trail.sends.length, 2);
  const byUser = new Map(trail.sends.map((b) => [(b.userIds as string[])[0], b]));
  const a = byUser.get(USER_A)!;
  assertEquals(a.type, 'user');
  assertEquals(a.push_kind, 'first_story');
  const notification = a.notification as { title: string; body: string; data: Record<string, unknown> };
  assertEquals([notification.title, notification.body], [FIRST_STORY_COPY.de.title, FIRST_STORY_COPY.de.body]);
  assertEquals(notification.data, { type: 'first_story', deeplink: 'tuggi://map' });
  assertEquals((byUser.get(USER_B)!.notification as { title: string }).title, FIRST_STORY_COPY.es.title);
  const marked = marks(trail);
  assertEquals(marked.length, 1);
  assertEquals((marked[0]!.p_user_ids as string[]).sort(), [USER_A, USER_B]);
  // At most once: the mark is written before the first send.
  assertEquals(trail.order, ['rpc:get_first_story_push_candidates', 'rpc:mark_first_story_push_sent', 'send', 'send']);
  assertEquals(report, { candidates: 2, outcomes: { sent: 2, denied: 0, not_delivered: 0, failed: 0 }, invalid: 0, marked: 2, unmarked: 0 });
});

Deno.test('BR-COMUNICACAO-019 3.n.3 (#1072): every valid candidate is marked before the sends, whatever the provider answers', async () => {
  const people = [USER_A, USER_B, '55555555-5555-4555-8555-555555555555', '66666666-6666-4666-8666-666666666666'];
  const answers: Record<string, () => Response> = {
    [people[0]]: () => gateAnswer('sent'),
    [people[1]]: () => gateAnswer('denied'),
    [people[2]]: () => gateAnswer('not_delivered'),
    [people[3]]: () => new Response('{"error":"boom"}', { status: 500 }),
  };
  const { deps, trail } = fakeRun({ data: people.map((p) => row(p)), error: null }, (b) => answers[(b.userIds as string[])[0]](), () => ({ data: 4, error: null }));
  const report = await runFirstStoryPush(deps);
  assertEquals(marks(trail), [{ p_user_ids: people }]);
  assertEquals(report.outcomes, { sent: 1, denied: 1, not_delivered: 1, failed: 1 });
  assertEquals([report.marked, report.unmarked, firstStoryRunFailed(report)], [4, 0, false]);
});

Deno.test('BR-COMUNICACAO-019 3.n.3 (#1072): a person whose send failed does not come back in the next run', async () => {
  // A candidate query that honours the mark, the way drive.first_story_push_sends does.
  const recorded = new Set<string>();
  const sends: string[] = [];
  const drive: DriveRpc = {
    rpc(fn, args) {
      if (fn === 'get_first_story_push_candidates') {
        return Promise.resolve({ data: [USER_A, USER_B].filter((id) => !recorded.has(id)).map((id) => row(id)), error: null });
      }
      if (fn === 'mark_first_story_push_sent') {
        const ids = (args?.p_user_ids ?? []) as string[];
        ids.forEach((id) => recorded.add(id));
        return Promise.resolve({ data: ids.length, error: null });
      }
      return Promise.resolve({ data: null, error: { code: 'unexpected' } });
    },
  };
  const deps: FirstStoryDeps = {
    drive,
    now: NOW,
    send: (body) => {
      const id = (body.userIds as string[])[0];
      sends.push(id);
      return Promise.resolve(id === USER_A ? { status: 500, body: null } : { status: 200, body: { gate: { sent: 1 } } });
    },
    log: () => {},
  };
  const first = await runFirstStoryPush(deps);
  assertEquals([first.outcomes.failed, first.outcomes.sent, first.marked], [1, 1, 2]);
  const second = await runFirstStoryPush(deps);
  assertEquals([second.candidates, sends.sort()], [0, [USER_A, USER_B].sort()]);
});

Deno.test('#1072: a denied push is still marked; no candidate, nothing at all', async () => {
  const denied = fakeRun({ data: [row(USER_A)], error: null }, () => gateAnswer('denied'));
  const deniedReport = await runFirstStoryPush(denied.deps);
  assertEquals([marks(denied.trail), deniedReport.outcomes.denied], [[{ p_user_ids: [USER_A] }], 1]);
  const empty = fakeRun({ data: [], error: null }, () => gateAnswer('sent'));
  const report = await runFirstStoryPush(empty.deps);
  assertEquals([empty.trail.sends.length, marks(empty.trail).length, report.candidates], [0, 0, 0]);
});

Deno.test('BR-COMUNICACAO-019 3.n.3: a repeated row is one send; a row without a valid id is not sent', async () => {
  const { deps, trail } = fakeRun(
    { data: [row(USER_A), row(USER_A), { user_id: 'not-a-uuid', language: 'pt' }, null], error: null },
    () => gateAnswer('sent'),
  );
  const report = await runFirstStoryPush(deps);
  assertEquals(trail.sends.length, 1);
  assertEquals(marks(trail), [{ p_user_ids: [USER_A] }]);
  assertEquals(report.invalid, 2);
});

Deno.test('BR-COMUNICACAO-019 3.n.3 (#1072): a mark that fails is tried once more, then the sends go out', async () => {
  const retried = fakeRun({ data: [row(USER_A)], error: null }, () => gateAnswer('sent'), (n) =>
    n === 1 ? { data: null, error: { code: '57014' } } : { data: 1, error: null });
  const ok = await runFirstStoryPush(retried.deps);
  assertEquals([marks(retried.trail).length, retried.trail.sends.length, ok.marked, ok.unmarked], [2, 1, 1, 0]);
  assertEquals(retried.trail.order.slice(-1), ['send']);
});

Deno.test('BR-COMUNICACAO-019 3.n.3 (#1072): a mark that fails twice sends to nobody and the run is a failure', async () => {
  const { deps, trail } = fakeRun({ data: [row(USER_A), row(USER_B)], error: null }, () => gateAnswer('sent'), () => ({ data: null, error: { code: '42501' } }));
  const report = await runFirstStoryPush(deps);
  assertEquals([marks(trail).length, trail.sends.length], [2, 0]);
  assertEquals(report, { candidates: 2, outcomes: { sent: 0, denied: 0, not_delivered: 0, failed: 0 }, invalid: 0, marked: 0, unmarked: 2 });
  assertEquals(firstStoryRunFailed(report), true);
  assert(trail.logs.some((l) => l.includes('mark attempt 2 failed: 42501')));
});

Deno.test('#1072: a failed candidate query throws and sends nothing', async () => {
  const { deps, trail } = fakeRun({ data: null, error: { code: '42501' } }, () => gateAnswer('sent'));
  let thrown = '';
  try {
    await runFirstStoryPush(deps);
  } catch (error) {
    thrown = (error as { code?: string }).code ?? '';
  }
  assertEquals([thrown, trail.sends.length], ['42501', 0]);
});

Deno.test('BR-USUARIO-043 (#1072): the logs carry no user id and no text of the push', async () => {
  const { deps, trail } = fakeRun({ data: [row(USER_A), row(USER_B)], error: null }, (b) =>
    (b.userIds as string[])[0] === USER_A ? Promise.reject(new TypeError(`down for ${USER_A}`)) : gateAnswer('sent'));
  await runFirstStoryPush(deps);
  const logs = trail.logs.join('\n');
  assert(logs.includes('send failed'));
  for (const secret of [USER_A, USER_B, FIRST_STORY_COPY.pt.title, 'Parabéns']) assert(!logs.includes(secret), secret);
});

Deno.test('#1072: sends go out in batches of the sender width', async () => {
  const people = Array.from({ length: SEND_CONCURRENCY * 2 + 3 }, (_, i) => `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`);
  let inFlight = 0;
  let peak = 0;
  const { deps, trail } = fakeRun({ data: people.map((p) => row(p)), error: null }, async () => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 1));
    inFlight -= 1;
    return gateAnswer('sent');
  });
  const report = await runFirstStoryPush(deps);
  assertEquals(report.outcomes.sent, people.length);
  assertEquals((marks(trail)[0]!.p_user_ids as string[]).length, people.length);
  assert(peak <= SEND_CONCURRENCY, `peak ${peak}`);
});

// ---- the handler ----

const handler = await loadHandler('first-story-push');

function call(authorization: string | null, method = 'POST'): Promise<Response> {
  scenario.calls.length = 0;
  fetchCalls.length = 0;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (authorization !== null) headers.authorization = authorization;
  return Promise.resolve(handler(new Request('http://edge.test/first-story-push', { method, headers })));
}

Deno.test('#1072: without the machine key nothing is read and nothing is sent, admin session included', async () => {
  for (const auth of [null, 'Bearer user-session-token', 'Bearer sb_publishable_xyz', 'Bearer test-service-role-key-but-wrong']) {
    const res = await call(auth);
    assertEquals([auth, res.status], [auth, 401]);
    assertEquals([auth, scenario.calls, fetchCalls], [auth, [], []]);
  }
  assertEquals((await call('Bearer test-service-role-key', 'GET')).status, 405);
});

Deno.test('BR-COMUNICACAO-019 3.n.6 (#1072): with the real sender, consent is asked, no cap slot is taken, the inbox says first_story', async () => {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', keyPair.privateKey));
  Deno.env.set('FIREBASE_PRIVATE_KEY', btoa(String.fromCharCode(...pkcs8)));
  Deno.env.set('FIREBASE_PROJECT_ID', 'tuggi-test');
  Deno.env.set('FIREBASE_CLIENT_EMAIL', 'push@tuggi-test.iam.gserviceaccount.test');

  scenario.rpcs = {
    get_first_story_push_candidates: { data: [row(USER_A, 'de'), row(USER_B, 'pt')], error: null },
    push_allowed: { data: true, error: null },
    record_push_sent: { data: null, error: null },
    mark_first_story_push_sent: { data: 2, error: null },
  };
  scenario.tables = {
    fcm_tokens: [USER_A, USER_B].map((user_id) => ({ user_id, fcm_token: `tok-${user_id}` })),
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
  assertEquals(report, { candidates: 2, outcomes: { sent: 2, denied: 0, not_delivered: 0, failed: 0 }, invalid: 0, marked: 2, unmarked: 0 });
  assertEquals(fetchCalls.filter((u) => u.includes('/functions/v1/')), []);
  assertEquals(fetchCalls.filter((u) => u.includes('fcm.googleapis.com')).length, 2);
  assertEquals(scenario.calls.filter((c) => c === 'rpc:push_allowed').length, 2);
  assertEquals(scenario.calls.filter((c) => c === 'rpc:record_push_sent').length, 0);
  const markAt = scenario.calls.indexOf('rpc:mark_first_story_push_sent');
  assert(markAt >= 0 && markAt < scenario.calls.indexOf('rpc:push_allowed'), 'the mark precedes the first send');
  const inbox = scenario.writes.filter((w) => w.table === 'user_notifications' && w.op === 'insert');
  assertEquals(inbox.map((w) => (w.values as { type: string }).type), ['first_story', 'first_story']);
  const de = inbox.find((w) => (w.values as { user_id: string }).user_id === USER_A)!.values as Record<string, unknown>;
  assertEquals([de.title, de.deeplink], [FIRST_STORY_COPY.de.title, 'tuggi://map']);
});

Deno.test('BR-COMUNICACAO-019 3.n.3 (#1072): the handler answers 500 with the report when the mark fails twice, and FCM is never called', async () => {
  scenario.rpcs = {
    get_first_story_push_candidates: { data: [row(USER_A, 'de')], error: null },
    mark_first_story_push_sent: { data: null, error: { code: '57014' } },
  };
  scenario.tableErrors = {};
  scenario.writes.length = 0;
  const res = await call('Bearer test-service-role-key');
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { candidates: 1, outcomes: { sent: 0, denied: 0, not_delivered: 0, failed: 0 }, invalid: 0, marked: 0, unmarked: 1 });
  assertEquals(fetchCalls.filter((u) => u.includes('fcm.googleapis.com')), []);
  assertEquals(scenario.calls.filter((c) => c === 'rpc:mark_first_story_push_sent').length, 2);
  assertEquals(scenario.calls.filter((c) => c === 'rpc:push_allowed').length, 0);
});
