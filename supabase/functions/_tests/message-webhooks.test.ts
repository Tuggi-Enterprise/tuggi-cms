/**
 * #1231, BR-COMUNICACAO-024 items 5 and 7: the provider webhooks (`_shared/message-webhooks.ts`,
 * `whatsapp-webhook`, `sms-webhook`): signatures, delivery statuses that settle the confirmation,
 * and stop replies. Providers are simulated.
 */
import { assert, assertEquals } from './assert.ts';
import { loadHandler, network, scenario } from './harness.ts';
import {
  applyReply,
  applyStatus,
  languageOfNumber,
  parseTwilioInbound,
  parseTwilioStatus,
  parseWhatsappNotification,
  twilioSignature,
  verifyMetaSignature,
  verifyTwilioSignature,
} from '../_shared/message-webhooks.ts';
import type { MessageDeps } from '../_shared/phone-confirmation.ts';

const USER = '99999999-aaaa-4bbb-8ccc-dddddddddddd';
const PHONE = '+5511987654321';

Deno.test('Meta signature: sha256= hex HMAC-SHA256 of the raw body (known vector), and anything else fails', async () => {
  const body = 'The quick brown fox jumps over the lazy dog';
  const good = 'sha256=f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8';
  assert(await verifyMetaSignature(body, good, 'key'));
  assert(!(await verifyMetaSignature(body + ' ', good, 'key')));
  assert(!(await verifyMetaSignature(body, good, 'other')));
  assert(!(await verifyMetaSignature(body, null, 'key')));
  assert(!(await verifyMetaSignature(body, good, undefined)));
});

Deno.test("Twilio signature: the example of Twilio's validator, and a changed parameter fails", async () => {
  const url = 'https://mycompany.com/myapp.php?foo=1&bar=2';
  const params = { CallSid: 'CA1234567890ABCDE', Caller: '+14158675309', Digits: '1234', From: '+14158675309', To: '+18005551212' };
  assertEquals(await twilioSignature(url, params, '12345'), 'RSOYDt4T1cUTdK1PDd93/VVr8B8=');
  assert(await verifyTwilioSignature(url, params, 'RSOYDt4T1cUTdK1PDd93/VVr8B8=', '12345'));
  assert(!(await verifyTwilioSignature(url, { ...params, Digits: '1235' }, 'RSOYDt4T1cUTdK1PDd93/VVr8B8=', '12345')));
  assert(!(await verifyTwilioSignature(url, params, 'RSOYDt4T1cUTdK1PDd93/VVr8B8=', undefined)));
});

Deno.test('the notifications are read into statuses (code only) and replies', () => {
  const wa = parseWhatsappNotification({
    entry: [
      {
        changes: [
          {
            value: {
              statuses: [
                { id: 'wamid.1', status: 'delivered' },
                { id: 'wamid.2', status: 'failed', errors: [{ code: 131026, title: 'Message undeliverable +5511987654321' }] },
                { id: 'wamid.3', status: 'read' },
                { id: 'wamid.4', status: 'deleted' },
              ],
              messages: [
                { from: '5511987654321', type: 'text', text: { body: 'PARAR' } },
                { from: '5511987654321', type: 'button', button: { text: 'Parar lembretes', payload: 'stop' } },
              ],
            },
          },
        ],
      },
    ],
  });
  assertEquals(wa.statuses, [
    { providerMessageId: 'wamid.1', outcome: 'delivered', code: null },
    { providerMessageId: 'wamid.2', outcome: 'failed', code: '131026' },
    { providerMessageId: 'wamid.3', outcome: 'delivered', code: null },
  ]);
  assertEquals(wa.replies, [{ from: PHONE, text: 'PARAR' }, { from: PHONE, text: 'Parar lembretes' }]);
  assertEquals(parseTwilioStatus({ MessageSid: 'SM1', MessageStatus: 'undelivered', ErrorCode: '30003' }), {
    providerMessageId: 'SM1',
    outcome: 'failed',
    code: '30003',
  });
  assertEquals(parseTwilioStatus({ MessageSid: 'SM1', MessageStatus: 'delivered' })?.outcome, 'delivered');
  assertEquals(parseTwilioInbound({ From: '+15550001111', Body: 'STOP' }), { from: '+15550001111', text: 'STOP' });
  assertEquals([languageOfNumber(PHONE), languageOfNumber('+33612345678'), languageOfNumber('+81312345678')], ['pt', 'fr', 'en']);
});

function deps(status: Record<string, unknown>, contact: Record<string, unknown> | null = {}) {
  const calls: { fn: string; args?: Record<string, unknown> }[] = [];
  const sent: string[] = [];
  const answers: Record<string, unknown> = {
    record_message_status: status,
    get_phone_contact:
      contact === null
        ? null
        : {
            user_id: USER,
            phone_e164: PHONE,
            channel: null,
            delivery_state: 'pending',
            stopped: false,
            message_channels: ['whatsapp', 'sms'],
            confirmation: true,
            language: 'pt-BR',
            language_base: 'pt',
            ...contact,
          },
    get_provider_secrets: { 'sms.account_id': 'AC1', 'sms.auth_token': 't', 'sms.sender': '+15550001111' },
    set_phone_delivery_state: true,
    stop_phone_messages_by_reply: 2,
  };
  const d: MessageDeps = {
    drive: {
      rpc: (fn: string, args?: Record<string, unknown>) => {
        calls.push({ fn, args });
        return Promise.resolve({ data: answers[fn] ?? null, error: null });
      },
    },
    fetch: ((input: string | URL | Request, init?: RequestInit) => {
      sent.push(`${String(input)} ${String(init?.body ?? '')}`);
      return Promise.resolve(new Response(JSON.stringify({ sid: 'SM9' }), { status: 201 }));
    }) as typeof fetch,
    log: () => {},
  };
  const of = (fn: string) => calls.filter((c) => c.fn === fn).map((c) => c.args);
  return { d, calls, sent, of };
}

const CONFIRMATION = { found: true, changed: true, id: 's1', user_id: USER, trip_id: null, piece: 'phone_confirmation' };

Deno.test('BR-COMUNICACAO-024 item 5: a delivered confirmation records the channel that delivered', async () => {
  const t = deps({ ...CONFIRMATION, outcome: 'delivered' });
  const out = await applyStatus(t.d, 'whatsapp', { providerMessageId: 'wamid.1', outcome: 'delivered', code: null });
  assertEquals(out.settled, 'confirmed');
  assertEquals(t.of('record_message_status'), [{ p_channel: 'whatsapp', p_provider_message_id: 'wamid.1', p_outcome: 'delivered', p_reason: null }]);
  assertEquals(t.of('set_phone_delivery_state'), [{ p_user_id: USER, p_phone_e164: PHONE, p_state: 'confirmed', p_channel: 'whatsapp' }]);
});

Deno.test('BR-COMUNICACAO-024 item 5: WhatsApp 131026 on the confirmation goes by SMS once, when SMS is on', async () => {
  const t = deps({ ...CONFIRMATION, outcome: 'failed' });
  const out = await applyStatus(t.d, 'whatsapp', { providerMessageId: 'wamid.2', outcome: 'failed', code: '131026' });
  assertEquals(out.settled, 'fallback_sms');
  assertEquals(t.sent.length, 1);
  assert(t.sent[0].startsWith('https://api.twilio.com/'), t.sent[0]);
  assertEquals(t.of('record_message_send').map((a) => [a?.p_piece, a?.p_channel, a?.p_outcome]), [['phone_confirmation', 'sms', 'sent']]);
  assertEquals(t.of('set_phone_delivery_state').length, 0, 'the SMS only sent waits for its own status');
});

Deno.test('BR-COMUNICACAO-024 item 6: WhatsApp 131026 with SMS off is "no channel"', async () => {
  const t = deps({ ...CONFIRMATION, outcome: 'failed' }, { message_channels: ['whatsapp'] });
  const out = await applyStatus(t.d, 'whatsapp', { providerMessageId: 'wamid.2', outcome: 'failed', code: '131026' });
  assertEquals(out.settled, 'no_channel');
  assertEquals(t.sent.length, 0);
  assertEquals(t.of('set_phone_delivery_state')[0]?.p_state, 'no_channel');
});

Deno.test('BR-COMUNICACAO-024 item 5: the last rung refusing the number is undeliverable; another failure blames nobody', async () => {
  const sms = deps({ ...CONFIRMATION, outcome: 'failed' });
  assertEquals((await applyStatus(sms.d, 'sms', { providerMessageId: 'SM1', outcome: 'failed', code: '30006' })).settled, 'undeliverable');
  const passing = deps({ ...CONFIRMATION, outcome: 'failed' });
  assertEquals((await applyStatus(passing.d, 'sms', { providerMessageId: 'SM1', outcome: 'failed', code: '30008' })).settled, null);
  assertEquals(passing.of('set_phone_delivery_state').length, 0);
});

Deno.test('a repeated or late status, or one of a reminder, settles nothing', async () => {
  const repeated = deps({ ...CONFIRMATION, changed: false, outcome: 'delivered' });
  assertEquals((await applyStatus(repeated.d, 'whatsapp', { providerMessageId: 'w', outcome: 'delivered', code: null })).settled, null);
  assert(!repeated.calls.some((c) => c.fn === 'get_phone_contact'));
  const reminder = deps({ ...CONFIRMATION, piece: 'trip_reminder_before', outcome: 'failed' });
  assertEquals((await applyStatus(reminder.d, 'whatsapp', { providerMessageId: 'w', outcome: 'failed', code: '131026' })).settled, null);
  assertEquals(reminder.sent.length, 0);
  const stopped = deps({ ...CONFIRMATION, outcome: 'delivered' }, { stopped: true });
  assertEquals((await applyStatus(stopped.d, 'whatsapp', { providerMessageId: 'w', outcome: 'delivered', code: null })).settled, null);
});

Deno.test('BR-COMUNICACAO-024 item 7: a stop word stops the number on every account; any other text does nothing', async () => {
  const t = deps({});
  assert(await applyReply(t.d, { from: PHONE, text: ' Stop ' }));
  assertEquals(t.of('stop_phone_messages_by_reply'), [{ p_phone_e164: PHONE }]);
  assert(!(await applyReply(t.d, { from: PHONE, text: 'quando é a viagem?' })));
  assertEquals(t.of('stop_phone_messages_by_reply').length, 1);
});

// ===============================================================================================
// THE HANDLERS
// ===============================================================================================

const wa = await loadHandler('whatsapp-webhook');
const sms = await loadHandler('sms-webhook');
const APP_SECRET = 'meta-app-secret';

async function metaSign(body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(APP_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
  return `sha256=${[...sig].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

function scriptSecrets() {
  const statuses: unknown[] = [];
  scenario.rpcs = {
    get_provider_secrets: (a) => ({
      data:
        a?.p_channel === 'whatsapp'
          ? { 'whatsapp.app_secret': APP_SECRET, 'whatsapp.webhook_verify_token': 'verify-me' }
          : { 'sms.auth_token': 'twilio-token' },
      error: null,
    }),
    record_message_status: (a) => (statuses.push(a), { data: { found: true, changed: false }, error: null }),
  };
  return statuses;
}

Deno.test('whatsapp-webhook GET answers the challenge only for the verify token', async () => {
  scriptSecrets();
  const ok = await wa(new Request('http://edge.test/whatsapp-webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=42'));
  assertEquals([ok.status, await ok.text()], [200, '42']);
  const bad = await wa(new Request('http://edge.test/whatsapp-webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=42'));
  assertEquals(bad.status, 403);
});

Deno.test('whatsapp-webhook POST: an unsigned body writes nothing; a signed one records the status', async () => {
  const statuses = scriptSecrets();
  const body = JSON.stringify({ entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.1', status: 'delivered' }] } }] }] });
  const unsigned = await wa(new Request('http://edge.test/whatsapp-webhook', { method: 'POST', body, headers: { 'x-hub-signature-256': 'sha256=00' } }));
  assertEquals(unsigned.status, 401);
  assertEquals(statuses.length, 0);
  const signed = await wa(new Request('http://edge.test/whatsapp-webhook', { method: 'POST', body, headers: { 'x-hub-signature-256': await metaSign(body) } }));
  assertEquals(signed.status, 200);
  assertEquals(statuses, [{ p_channel: 'whatsapp', p_provider_message_id: 'wamid.1', p_outcome: 'delivered', p_reason: null }]);
});

Deno.test('sms-webhook: the signature covers the URL we gave Twilio; a forged callback writes nothing', async () => {
  const statuses = scriptSecrets();
  const params = { MessageSid: 'SM1', MessageStatus: 'delivered' };
  const form = new URLSearchParams(params).toString();
  const forged = await sms(new Request('http://edge.test/sms-webhook/status', { method: 'POST', body: form, headers: { 'x-twilio-signature': 'AAAA' } }));
  assertEquals(forged.status, 403);
  assertEquals(statuses.length, 0);
  const signature = await twilioSignature('http://supabase.test/functions/v1/sms-webhook/status', params, 'twilio-token');
  const good = await sms(new Request('http://edge.test/sms-webhook/status', { method: 'POST', body: form, headers: { 'x-twilio-signature': signature } }));
  assertEquals(good.status, 204);
  assertEquals(statuses, [{ p_channel: 'sms', p_provider_message_id: 'SM1', p_outcome: 'delivered', p_reason: null }]);
});

// The harness is one process for every file: leave the shared scenario and network as found.
Deno.test('cleanup: the shared fakes go back to their defaults', () => {
  scenario.user = null;
  scenario.rpcs = {};
  scenario.tables = {};
  network.reply = () => new Response('{}', { status: 400 });
});
