/**
 * #1231, BR-COMUNICACAO-024: the message channels to the phone (WhatsApp Cloud API, Twilio SMS),
 * the ladder between them, and `phone-confirmation`, end to end with the providers simulated by
 * `fetch`. Both channels ship switched off; these tests are the proof they work when turned on.
 *
 * Conditions of the security-reviewer (#1230) proved here: the confirmation sends only on a claimed
 * row (1); the model parameters are numbers and dates (2); no number, token or secret in a log (3);
 * only the provider code reaches `record_message_send` (4).
 */
import { assert, assertEquals } from './assert.ts';
import { fetchBodies, fetchCalls, loadHandler, network, request, scenario } from './harness.ts';
import {
  channelOrder,
  pickTemplate,
  sendByLadder,
  sendTwilioSms,
  sendWhatsappTemplate,
  stateAfterFailures,
  type LadderAttempt,
  type LadderDeps,
} from '../_shared/message-channels.ts';
import { isStopReply, phoneVars, smsText, whatsappParameters, type TripFacts } from '../_shared/trip-message-copy.ts';

const PHONE = '+5511987654321';
const WA_SECRETS = { 'whatsapp.access_token': 'EAAG-test-token', 'whatsapp.phone_number_id': '1234567890' };
const SMS_SECRETS = { 'sms.account_id': 'AC0123', 'sms.auth_token': 'twilio-test-token', 'sms.sender': '+15550001111' };
const TEMPLATES = [
  { channel: 'whatsapp', piece: 'phone_confirmation', language: 'pt', template_name: 'trip_reminder_confirm', provider_language: 'pt_BR' },
  { channel: 'whatsapp', piece: 'phone_confirmation', language: 'en', template_name: 'trip_reminder_confirm', provider_language: 'en_US' },
  { channel: 'whatsapp', piece: 'trip_reminder_before', language: 'pt', template_name: 'trip_hours_released', provider_language: 'pt_BR' },
];

/** A fetch that answers by host, and keeps what it was asked. */
function providerFetch(answers: { whatsapp?: () => Response; sms?: () => Response }) {
  const asked: { url: string; init: RequestInit }[] = [];
  const f = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    asked.push({ url, init: init ?? {} });
    if (url.startsWith('https://graph.facebook.com/')) return Promise.resolve(answers.whatsapp?.() ?? new Response('{}', { status: 500 }));
    if (url.startsWith('https://api.twilio.com/')) return Promise.resolve(answers.sms?.() ?? new Response('{}', { status: 500 }));
    return Promise.resolve(new Response('{}', { status: 404 }));
  }) as typeof fetch;
  return { f, asked };
}

const waOk = () => new Response(JSON.stringify({ messages: [{ id: 'wamid.HBgTEST' }] }), { status: 200 });
const waFail = (code: number) =>
  new Response(JSON.stringify({ error: { code, message: `(#${code}) the recipient +5511987654321 failed` } }), { status: 400 });
const smsOk = () => new Response(JSON.stringify({ sid: 'SM0001', status: 'queued' }), { status: 201 });
const smsFail = (code: number) =>
  new Response(JSON.stringify({ code, message: `The 'To' number +5511987654321 is not valid.`, status: 400 }), { status: 400 });

// ===============================================================================================
// ADAPTERS
// ===============================================================================================

Deno.test('BR-COMUNICACAO-024 item 8: WhatsApp sends the approved model by name, language and parameters', async () => {
  const { f, asked } = providerFetch({ whatsapp: waOk });
  const out = await sendWhatsappTemplate(f, WA_SECRETS, {
    to: PHONE,
    templateName: 'trip_hours_released',
    languageCode: 'pt_BR',
    parameters: ['7 dias', '1 h', '21 de janeiro'],
  });
  assertEquals(out, { outcome: 'sent', providerMessageId: 'wamid.HBgTEST', reason: null });
  assertEquals(asked[0].url, 'https://graph.facebook.com/v26.0/1234567890/messages');
  assertEquals((asked[0].init.headers as Record<string, string>).Authorization, 'Bearer EAAG-test-token');
  const body = JSON.parse(String(asked[0].init.body));
  assertEquals(body.to, '5511987654321');
  assertEquals(body.type, 'template');
  assertEquals(body.template, {
    name: 'trip_hours_released',
    language: { code: 'pt_BR' },
    components: [{ type: 'body', parameters: [{ type: 'text', text: '7 dias' }, { type: 'text', text: '1 h' }, { type: 'text', text: '21 de janeiro' }] }],
  });
});

Deno.test('security-reviewer #1230 condition 4: a provider refusal keeps the code, never the text that carries the number', async () => {
  const wa = await sendWhatsappTemplate(providerFetch({ whatsapp: () => waFail(131026) }).f, WA_SECRETS, {
    to: PHONE,
    templateName: 'x',
    languageCode: 'pt_BR',
    parameters: [],
  });
  assertEquals(wa, { outcome: 'failed', providerMessageId: null, reason: '131026' });
  const sms = await sendTwilioSms(providerFetch({ sms: () => smsFail(21211) }).f, SMS_SECRETS, { to: PHONE, body: 'x' });
  assertEquals(sms, { outcome: 'failed', providerMessageId: null, reason: '21211' });
});

Deno.test('a channel without its secrets is not configured and calls nobody', async () => {
  const { f, asked } = providerFetch({ whatsapp: waOk, sms: smsOk });
  assertEquals((await sendWhatsappTemplate(f, {}, { to: PHONE, templateName: 'x', languageCode: 'en', parameters: [] })).reason, 'not_configured');
  assertEquals((await sendTwilioSms(f, { 'sms.account_id': 'AC1' }, { to: PHONE, body: 'x' })).reason, 'not_configured');
  assertEquals(asked.length, 0);
});

Deno.test('BR-COMUNICACAO-024 item 12: Twilio gets the form, Basic auth, the sender and the status callback', async () => {
  const { f, asked } = providerFetch({ sms: smsOk });
  const out = await sendTwilioSms(f, SMS_SECRETS, { to: PHONE, body: 'Tuggi: oi', statusCallback: 'https://x.test/sms-webhook/status' });
  assertEquals(out, { outcome: 'sent', providerMessageId: 'SM0001', reason: null });
  assertEquals(asked[0].url, 'https://api.twilio.com/2010-04-01/Accounts/AC0123/Messages.json');
  assertEquals((asked[0].init.headers as Record<string, string>).Authorization, `Basic ${btoa('AC0123:twilio-test-token')}`);
  const form = new URLSearchParams(String(asked[0].init.body));
  assertEquals([form.get('To'), form.get('From'), form.get('Body'), form.get('StatusCallback')], [
    PHONE,
    '+15550001111',
    'Tuggi: oi',
    'https://x.test/sms-webhook/status',
  ]);
  const service = providerFetch({ sms: smsOk });
  await sendTwilioSms(service.f, { ...SMS_SECRETS, 'sms.sender': `MG${'a'.repeat(32)}` }, { to: PHONE, body: 'x' });
  const serviceForm = new URLSearchParams(String(service.asked[0].init.body));
  assertEquals([serviceForm.get('MessagingServiceSid'), serviceForm.get('From')], [`MG${'a'.repeat(32)}`, null]);
});

// ===============================================================================================
// THE LADDER
// ===============================================================================================

function ladder(answers: { whatsapp?: () => Response; sms?: () => Response }, secrets = { ...WA_SECRETS, ...SMS_SECRETS }) {
  const recorded: LadderAttempt[] = [];
  const { f, asked } = providerFetch(answers);
  const deps: LadderDeps = {
    fetch: f,
    secrets: (channel) =>
      Promise.resolve(Object.fromEntries(Object.entries(secrets).filter(([k]) => k.startsWith(`${channel}.`)))),
    templates: () => Promise.resolve(TEMPLATES),
    record: (a) => {
      recorded.push(a);
      return Promise.resolve();
    },
  };
  return { deps, recorded, asked };
}

const CONFIRM = { templatePiece: 'phone_confirmation' as const, copyPiece: 'M1' as const, lang: 'pt' as const, languageBase: 'pt', vars: {} };

Deno.test('BR-COMUNICACAO-024 item 5: WhatsApp first; a number not on WhatsApp (131026) goes by SMS when SMS is on', async () => {
  const l = ladder({ whatsapp: () => waFail(131026), sms: smsOk });
  const out = await sendByLadder(l.deps, PHONE, ['whatsapp', 'sms'], CONFIRM);
  assertEquals(out.sent, 'sms');
  assertEquals(out.state, null);
  assertEquals(l.recorded.map((a) => [a.channel, a.outcome, a.reason, a.providerMessageId]), [
    ['whatsapp', 'failed', '131026', null],
    ['sms', 'sent', null, 'SM0001'],
  ]);
  const sms = new URLSearchParams(String(l.asked[1].init.body)).get('Body');
  assertEquals(sms, 'Tuggi: pronto, vamos te lembrar da sua viagem por aqui. Para sair, responda STOP.');
});

Deno.test('BR-COMUNICACAO-024 item 6: SMS off and the number not on WhatsApp is "no channel", not "check your number"', async () => {
  const l = ladder({ whatsapp: () => waFail(131026) });
  const out = await sendByLadder(l.deps, PHONE, ['whatsapp'], CONFIRM);
  assertEquals([out.sent, out.state], [null, 'no_channel']);
});

Deno.test('BR-COMUNICACAO-024 item 5: every channel refusing the number is "undeliverable"; our own failure blames nobody', async () => {
  const both = await sendByLadder(ladder({ whatsapp: () => waFail(131026), sms: () => smsFail(21211) }).deps, PHONE, ['whatsapp', 'sms'], CONFIRM);
  assertEquals(both.state, 'undeliverable');
  const config = await sendByLadder(ladder({ whatsapp: waOk }, {} as never).deps, PHONE, ['whatsapp'], CONFIRM);
  assertEquals([config.sent, config.state, config.attempts[0].reason], [null, null, 'not_configured']);
  const transient = await sendByLadder(ladder({ whatsapp: () => waFail(131000) }).deps, PHONE, ['whatsapp'], CONFIRM);
  assertEquals(transient.state, null);
  assertEquals(stateAfterFailures([]), null);
});

Deno.test('BR-COMUNICACAO-024 item 5: a message only "sent" waits; the next channel is not tried', async () => {
  const l = ladder({ whatsapp: waOk, sms: smsOk });
  const out = await sendByLadder(l.deps, PHONE, ['whatsapp', 'sms'], CONFIRM);
  assertEquals([out.sent, l.asked.length], ['whatsapp', 1]);
});

Deno.test('BR-COMUNICACAO-024 item 8: no model for the language falls back to English, and no model at all is a recorded failure', async () => {
  assertEquals(pickTemplate(TEMPLATES, 'whatsapp', 'phone_confirmation', 'fr')?.provider_language, 'en_US');
  assertEquals(pickTemplate(TEMPLATES, 'whatsapp', 'trip_reminder_day', 'pt'), null);
  const l = ladder({ whatsapp: waOk });
  const out = await sendByLadder(l.deps, PHONE, ['whatsapp'], { ...CONFIRM, templatePiece: 'trip_reminder_day', copyPiece: 'M5' });
  assertEquals([out.sent, l.recorded[0].reason, l.asked.length], [null, 'no_template', 0]);
});

Deno.test('the channel already found goes alone, when it is still on; otherwise the server order', () => {
  assertEquals(channelOrder('sms', ['whatsapp', 'sms']), ['sms']);
  assertEquals(channelOrder('sms', ['whatsapp']), ['whatsapp']);
  assertEquals(channelOrder(null, ['whatsapp', 'sms', 'telegram']), ['whatsapp', 'sms']);
});

// ===============================================================================================
// THE COPY OF THE PHONE MESSAGES
// ===============================================================================================

const FACTS: TripFacts = {
  piece: 'trip_reminder_before',
  trip_date: '2027-01-12',
  date_precision: 'day',
  destination: { city: 'Lisboa', country_code: 'PT' },
  trip_hours: { minutes: 60, expires_at: '2027-03-06T13:00:00Z' },
  balance_minutes: null,
};

Deno.test('security-reviewer #1230 condition 2: the phone messages carry numbers and dates, never the destination', () => {
  const now = new Date('2027-01-05T13:00:00Z');
  const { lang, vars } = phoneVars(FACTS, 'pt-BR', now);
  assertEquals(whatsappParameters('M2', vars), ['7 dias', '1 h', '6 de março']);
  const sms = smsText('M2', lang, vars) ?? '';
  assertEquals(sms, 'Tuggi: liberamos 1 h na sua carteira para a viagem, com validade até 06/03. Para sair, responda STOP.');
  for (const text of [sms, ...(whatsappParameters('M2', vars) ?? [])]) assert(!text.includes('Lisboa'), text);
  assertEquals(whatsappParameters('M4', {}), null, 'a missing balance is a refusal, not an empty parameter');
});

Deno.test('BR-COMUNICACAO-024 item 7: STOP and its synonyms are a stop reply, anything else is not', () => {
  for (const word of ['stop', ' PARAR ', 'Sair', 'baja', 'ARRET', 'stopp', 'annulla', 'Parar lembretes', 'Erinnerungen stoppen']) {
    assert(isStopReply(word), word);
  }
  for (const text of ['stop please call me', 'obrigado', '', null]) assert(!isStopReply(text), String(text));
});

// ===============================================================================================
// phone-confirmation, END TO END
// ===============================================================================================

const USER = '55555555-6666-4777-8888-999999999999';
const CONTACT = {
  user_id: USER,
  phone_e164: PHONE,
  calling_code: '55',
  channel: null,
  delivery_state: 'pending',
  stopped: false,
  message_channels: ['whatsapp'],
  confirmation: true,
  language: 'pt-BR',
  language_base: 'pt',
  confirmation_claimed_at: '2026-11-23T15:00:00Z',
};

const handler = await loadHandler('phone-confirmation');

function script(claim: unknown, channels = ['whatsapp']) {
  const args: Record<string, unknown[]> = {};
  const keep = (fn: string, answer: unknown) => (a: Record<string, unknown> | undefined) => {
    (args[fn] ??= []).push(a);
    return { data: answer, error: null };
  };
  scenario.user = { id: USER, email: 'tourist@example.test', is_anonymous: false };
  scenario.rpcs = {
    claim_phone_confirmation: keep('claim_phone_confirmation', claim === null ? null : { ...(claim as object), message_channels: channels }),
    get_provider_secrets: (a) => {
      (args.get_provider_secrets ??= []).push(a);
      return { data: a?.p_channel === 'whatsapp' ? WA_SECRETS : SMS_SECRETS, error: null };
    },
    cms_get_trip_settings: keep('cms_get_trip_settings', { templates: TEMPLATES }),
    record_message_send: keep('record_message_send', 'rec-1'),
    set_phone_delivery_state: keep('set_phone_delivery_state', true),
  };
  return args;
}

async function quietly<T>(fn: () => Promise<T>): Promise<{ value: T; lines: string[] }> {
  const lines: string[] = [];
  const log = console.log;
  const err = console.error;
  console.log = (...a: unknown[]) => lines.push(a.map(String).join(' '));
  console.error = (...a: unknown[]) => lines.push(a.map(String).join(' '));
  try {
    return { value: await fn(), lines };
  } finally {
    console.log = log;
    console.error = err;
  }
}

Deno.test('phone-confirmation refuses a request without a valid user token, and claims nothing', async () => {
  script(CONTACT);
  scenario.user = null;
  const res = await handler(request({}));
  assertEquals(res.status, 401);
  assert(!scenario.calls.includes('rpc:claim_phone_confirmation'));
});

Deno.test('security-reviewer #1230 condition 1: no claimed row, no message, and the answer is still ok', async () => {
  const args = script(null);
  const res = await handler(request({}));
  assertEquals([res.status, await res.json()], [200, { ok: true }]);
  assertEquals(args.claim_phone_confirmation, [{ p_user_id: USER }]);
  assert(!scenario.calls.includes('rpc:get_phone_contact'), 'the send was decided by a read');
  assert(!scenario.calls.includes('rpc:record_message_send'));
  assertEquals(fetchCalls.filter((u) => !u.startsWith('http://supabase.test')).length, 0);
});

Deno.test('BR-COMUNICACAO-024 item 5: a claimed row sends the confirmation model and records the send, by its effect', async () => {
  network.reply = (url) => (url.startsWith('https://graph.facebook.com/') ? waOk() : new Response('{}', { status: 404 }));
  const args = script(CONTACT);
  const { value: res, lines } = await quietly(async () => await handler(request({})));
  assertEquals([res.status, await res.json()], [200, { ok: true }]);
  const send = fetchBodies[fetchCalls.findIndex((u) => u.startsWith('https://graph.facebook.com/'))];
  assertEquals(JSON.parse(String(send)).template, { name: 'trip_reminder_confirm', language: { code: 'pt_BR' } });
  assertEquals(args.record_message_send, [
    {
      p_user_id: USER,
      p_piece: 'phone_confirmation',
      p_channel: 'whatsapp',
      p_outcome: 'sent',
      p_reason: null,
      p_provider_message_id: 'wamid.HBgTEST',
      p_phone_e164: PHONE,
      p_trip_id: null,
    },
  ]);
  assertEquals(args.set_phone_delivery_state, undefined, 'a message only sent waits for the webhook');
  for (const line of lines) {
    assert(!/5511987654321|4321|EAAG|twilio-test-token|55555555/.test(line), `log leaked: ${line}`);
  }
});

Deno.test('BR-COMUNICACAO-024 item 6: WhatsApp only, the number not on it: the state is no_channel', async () => {
  network.reply = (url) => (url.startsWith('https://graph.facebook.com/') ? waFail(131026) : new Response('{}', { status: 404 }));
  const args = script(CONTACT);
  const { value: res } = await quietly(async () => await handler(request({})));
  assertEquals(res.status, 200);
  assertEquals(args.set_phone_delivery_state, [{ p_user_id: USER, p_phone_e164: PHONE, p_state: 'no_channel', p_channel: null }]);
  assertEquals((args.record_message_send[0] as Record<string, unknown>).p_reason, '131026');
});

// The harness is one process for every file: leave the shared scenario and network as found.
Deno.test('cleanup: the shared fakes go back to their defaults', () => {
  scenario.user = null;
  scenario.rpcs = {};
  scenario.tables = {};
  network.reply = () => new Response('{}', { status: 400 });
});
