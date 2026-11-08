/**
 * #1052, BR-COMUNICACAO-022: a direct push nobody received is written on its inbox row, in
 * `drive.user_notifications.delivery_failed_at` and `delivery_error`, and writing it never takes
 * the send down. FCM and the OAuth exchange are faked through `fetch`; the database through the
 * supabase-js fake.
 *
 * Run: deno test --allow-env --allow-read --import-map=supabase/functions/_tests/import_map.json \
 *   supabase/functions/_tests/
 */
import { assert, assertEquals } from './assert.ts';
import { fetchBodies, fetchCalls, loadHandler, network, scenario } from './harness.ts';
import { routeRevisionSendBody } from '../_shared/route-revision-push.ts';

const USER = '55555555-5555-4555-8555-555555555555';
const INBOX_ID = '66666666-6666-4666-8666-666666666666';
const TOKENS = ['tok-aaaaaaaa-device-one', 'tok-bbbbbbbb-device-two'];

// A real RSA key, because the function signs its OAuth assertion with WebCrypto before `fetch`.
const keyPair = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true,
  ['sign', 'verify'],
);
const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', keyPair.privateKey));
Deno.env.set('FIREBASE_PRIVATE_KEY', btoa(String.fromCharCode(...pkcs8)));
Deno.env.set('FIREBASE_PROJECT_ID', 'tuggi-test');
Deno.env.set('FIREBASE_CLIENT_EMAIL', 'push@tuggi-test.iam.gserviceaccount.test');

const handler = await loadHandler('firebase-push-notification');

function fcmRefusal(errorCode: string): Response {
  return new Response(
    JSON.stringify({
      error: {
        code: 404,
        status: 'NOT_FOUND',
        message: 'Requested entity was not found.',
        details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode }],
      },
    }),
    { status: 404 },
  );
}

/** FCM answers the n-th send with `answers[n]`; the OAuth exchange always succeeds. */
function scriptFcm(answers: Array<() => Response>): void {
  let sent = 0;
  network.reply = (url) => {
    if (url.startsWith('https://oauth2.googleapis.com/')) {
      return new Response(JSON.stringify({ access_token: 'test-access-token' }), { status: 200 });
    }
    if (url.includes('fcm.googleapis.com')) return answers[sent++]();
    return new Response('{}', { status: 400 });
  };
}

function setDevices(tokens: string[]): void {
  scenario.tables = {
    fcm_tokens: tokens.map((fcm_token) => ({ user_id: USER, fcm_token })),
    profiles: [],
    user_notifications: (chain: string[]) => (chain.includes('insert') ? { id: INBOX_ID } : null),
  };
  scenario.rpcs = { push_allowed: { data: true, error: null } };
  scenario.tableErrors = {};
}

async function sendDirect(): Promise<{ status: number; body: Record<string, unknown> }> {
  scenario.calls.length = 0;
  scenario.writes.length = 0;
  fetchCalls.length = 0;
  const res = await handler(
    new Request('http://edge.test/functions/v1/firebase-push-notification/send', {
      method: 'POST',
      headers: { authorization: 'Bearer test-service-role-key', 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'user',
        userIds: [USER],
        notification: { title: 'Hoje em Búzios', body: 'Toque para ver.', data: { type: 'generic' } },
      }),
    }),
  );
  return { status: res.status, body: await res.json() };
}

function deliveryWrites(): Array<Record<string, unknown>> {
  return scenario.writes
    .filter((w) => w.table === 'user_notifications' && w.op === 'update')
    .map((w) => w.values as Record<string, unknown>);
}

Deno.test('BR-COMUNICACAO-022 (#1052): FCM refusing every token writes delivery_failed_at and the FCM codes, no token', async () => {
  setDevices(TOKENS);
  scriptFcm([() => fcmRefusal('UNREGISTERED'), () => fcmRefusal('QUOTA_EXCEEDED')]);

  const { status, body } = await sendDirect();

  assertEquals(status, 200);
  assertEquals((body.gate as Record<string, number>).not_delivered, 1);
  const writes = deliveryWrites();
  assertEquals(writes.length, 1);
  assertEquals(writes[0].delivery_error, 'QUOTA_EXCEEDED,UNREGISTERED');
  assert(!Number.isNaN(Date.parse(String(writes[0].delivery_failed_at))), 'delivery_failed_at is a timestamp');
  for (const token of TOKENS) {
    assert(!JSON.stringify(writes).includes(token.slice(0, 8)), 'no token reaches the row');
  }
});

Deno.test('BR-COMUNICACAO-022 (#1052): one device accepted means received, nothing is written', async () => {
  setDevices(TOKENS);
  scriptFcm([() => new Response('{"name":"projects/x/messages/1"}', { status: 200 }), () => fcmRefusal('UNREGISTERED')]);

  const { status, body } = await sendDirect();

  assertEquals(status, 200);
  assertEquals((body.gate as Record<string, number>).sent, 1);
  assertEquals(deliveryWrites(), []);
});

Deno.test('BR-COMUNICACAO-022 (#1052): no active device is the gate not_delivered too, written as NO_ACTIVE_TOKEN', async () => {
  setDevices([]);
  scriptFcm([]);

  const { status, body } = await sendDirect();

  assertEquals(status, 200);
  assertEquals((body.gate as Record<string, number>).not_delivered, 1);
  assertEquals(deliveryWrites().map((w) => w.delivery_error), ['NO_ACTIVE_TOKEN']);
  assertEquals(fetchCalls.filter((u) => u.includes('fcm.googleapis.com')), []);
});

Deno.test('BR-COMUNICACAO-022 (#1052): a failed write is logged and the send still answers its tally', async () => {
  setDevices(TOKENS);
  scenario.tableErrors = {
    user_notifications: (chain) => (chain.includes('update') ? { code: 'PGRST204' } : null),
  };
  scriptFcm([() => fcmRefusal('UNREGISTERED'), () => fcmRefusal('UNREGISTERED')]);

  const logged: string[] = [];
  const realError = console.error;
  console.error = (...args: unknown[]) => logged.push(args.map(String).join(' '));
  let result: { status: number; body: Record<string, unknown> };
  try {
    result = await sendDirect();
  } finally {
    console.error = realError;
  }

  assertEquals(result.status, 200);
  assertEquals(result.body.success, true);
  assertEquals((result.body.gate as Record<string, number>).not_delivered, 1);
  assertEquals(deliveryWrites().length, 1);
  const line = logged.find((l) => l.includes('delivery failure not recorded'));
  assert(line, 'the failed write is logged');
  assert(line.includes('PGRST204') && !line.includes(USER) && !line.includes(TOKENS[0].slice(0, 8)), line);
});

/**
 * #1123, BR-COMUNICACAO-019 3.o (operator, 2026-11-08): the route revision row reaches the Correio
 * with push on or off; the push itself still needs the gate's yes. One row per call, never two.
 */
const ROUTE = '77777777-7777-4777-8777-777777777777';
const routeRevisionBody = routeRevisionSendBody({
  decision: 'approved',
  edit: false,
  routeId: ROUTE,
  routeName: 'Praias de Búzios',
  authorId: USER,
  language: 'pt',
});

async function sendBody(body: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  scenario.calls.length = 0;
  scenario.writes.length = 0;
  fetchCalls.length = 0;
  fetchBodies.length = 0;
  const res = await handler(
    new Request('http://edge.test/functions/v1/firebase-push-notification/send', {
      method: 'POST',
      headers: { authorization: 'Bearer test-service-role-key', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: await res.json() };
}

function inboxInserts(): Array<Record<string, unknown>> {
  return scenario.writes
    .filter((w) => w.table === 'user_notifications' && w.op === 'insert')
    .map((w) => w.values as Record<string, unknown>);
}

function fcmSends(): string[] {
  return fetchCalls.filter((u) => u.includes('fcm.googleapis.com'));
}

const accepted = () => new Response('{"name":"projects/x/messages/1"}', { status: 200 });

Deno.test('BR-COMUNICACAO-019 3.o (#1123): route revision with push off writes the Correio row and sends nothing', async () => {
  setDevices(TOKENS);
  scenario.rpcs = { push_allowed: { data: false, error: null } };
  scriptFcm([]);

  const { status, body } = await sendBody(routeRevisionBody);

  assertEquals(status, 200);
  assertEquals((body.gate as Record<string, number>).denied, 1);
  const rows = inboxInserts();
  assertEquals(rows.length, 1);
  assertEquals(rows[0].user_id, USER);
  assertEquals(rows[0].type, 'route_revision_approved');
  assertEquals(rows[0].title, 'Seu roteiro foi aprovado');
  assertEquals(rows[0].deeplink, `tuggi://route?id=${ROUTE}`);
  assertEquals(fcmSends(), []);
  assertEquals(deliveryWrites().map((w) => w.delivery_error), ['PUSH_NOT_ALLOWED']);
});

Deno.test('BR-COMUNICACAO-019 3.o (#1123): route revision with push on writes one row and sends one push carrying its id', async () => {
  setDevices([TOKENS[0]]);
  scriptFcm([accepted]);

  const { status, body } = await sendBody(routeRevisionBody);

  assertEquals(status, 200);
  assertEquals((body.gate as Record<string, number>).sent, 1);
  assertEquals(inboxInserts().length, 1);
  const pushes = fetchBodies.filter((_, i) => fetchCalls[i].includes('fcm.googleapis.com'));
  assertEquals(pushes.length, 1);
  const data = JSON.parse(String(pushes[0])).message.data;
  assertEquals(data.notification_id, INBOX_ID);
  assertEquals(data.type, 'route_revision_approved');
  assertEquals(deliveryWrites(), []);
});

Deno.test('BR-COMUNICACAO-019 3.o.5 (#1123): route revision push refused by FCM keeps the row and marks the failure', async () => {
  setDevices([TOKENS[0]]);
  scriptFcm([() => fcmRefusal('UNREGISTERED')]);

  const { status, body } = await sendBody(routeRevisionBody);

  assertEquals(status, 200);
  assertEquals((body.gate as Record<string, number>).not_delivered, 1);
  assertEquals(inboxInserts().length, 1);
  assertEquals(deliveryWrites().map((w) => w.delivery_error), ['UNREGISTERED']);
});

Deno.test('BR-COMUNICACAO-019 3.o (#1123): route revision with the gate unavailable keeps the row and says so', async () => {
  setDevices(TOKENS);
  scenario.rpcs = { push_allowed: { data: null, error: { code: '57014' } } };
  scriptFcm([]);

  const { body } = await sendBody(routeRevisionBody);

  assertEquals((body.gate as Record<string, number>).gate_error, 1);
  assertEquals(inboxInserts().length, 1);
  assertEquals(fcmSends(), []);
  assertEquals(deliveryWrites().map((w) => w.delivery_error), ['PUSH_GATE_UNAVAILABLE']);
});

Deno.test('BR-COMUNICACAO-019 item 9 (#1123): any other kind with push off still writes no row', async () => {
  setDevices(TOKENS);
  scenario.rpcs = { push_allowed: { data: false, error: null } };
  scriptFcm([]);

  for (const pushKind of ['cms_direct', 'first_story', 'daily_summary', 'weekly_thursday_local']) {
    const { body } = await sendBody({ ...routeRevisionBody, push_kind: pushKind });
    const gate = body.gate as Record<string, number>;
    assertEquals(gate.denied, 1, pushKind);
    assertEquals(inboxInserts(), [], pushKind);
    assertEquals(deliveryWrites(), [], pushKind);
    assertEquals(fcmSends(), [], pushKind);
  }
});
