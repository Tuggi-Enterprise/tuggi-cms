/**
 * #1231, BR-COMUNICACAO-023: the trip reminder (`_shared/trip-reminder.ts`, `trip-reminder`), its
 * e-mail stop link of scope `trip_reminder`, the copy of the push and the e-mail, and the CMS "send a
 * test to me" (`trip-message-test`). #1238: one reminder per trip, with that trip's hours or none.
 * Providers and the database are simulated.
 */
import { assert, assertEquals } from './assert.ts';
import { fetchCalls, loadHandler, network, scenario } from './harness.ts';
import { PUSH_KINDS } from '../_shared/push-gate.ts';
import {
  PUSH_BODY_MAX,
  PUSH_TITLE_MAX,
  TRIP_EMAIL_COPY,
  TRIP_PUSH_COPY,
  safeCity,
  tripReminderEmail,
  tripReminderPush,
  type TripFacts,
} from '../_shared/trip-message-copy.ts';
import { runTripReminders, type DueReminder, type TripReminderDeps } from '../_shared/trip-reminder.ts';
import { parseTestRequest, sendTestMessage } from '../_shared/trip-message-test.ts';
import { buildScopedStopUrl, encodeEmail, signEmail, verifyScopedStop } from '../_shared/unsubscribe-link.ts';

const NOW = new Date('2027-01-05T13:00:00Z');
const USER = '77777777-8888-4999-8aaa-bbbbbbbbbbbb';
const SECRET = 'test-newsletter-secret';

const BEFORE: DueReminder = {
  trip_id: 'trip-1',
  user_id: USER,
  piece: 'trip_reminder_before',
  trip_date: '2027-01-12',
  date_precision: 'day',
  destination: { city: 'Lisboa', country_code: 'PT' },
  language: 'pt-BR',
  language_base: 'pt',
  push: true,
  email: 'ana@example.com',
  phone: { phone_e164: '+5511987654321', channel: 'whatsapp', delivery_state: 'confirmed', message_channels: ['whatsapp'] },
  trip_hours: { minutes: 60, expires_at: '2027-03-06T13:00:00Z' },
};

type Call = { fn: string; args: Record<string, unknown> | undefined };

function fakeDeps(over: Partial<TripReminderDeps> & { reminders?: unknown; entitlement?: unknown } = {}) {
  const calls: Call[] = [];
  const pushes: Record<string, unknown>[] = [];
  const mails: Record<string, unknown>[] = [];
  const lines: string[] = [];
  const answers: Record<string, unknown> = {
    claim_due_trip_reminders: over.reminders ?? [BEFORE],
    get_entitlement: over.entitlement ?? { state: 'metered', balance_minutes: 90 },
    get_provider_secrets: { 'whatsapp.access_token': 'EAAG-token', 'whatsapp.phone_number_id': '123' },
    cms_get_trip_settings: {
      templates: [
        { channel: 'whatsapp', piece: 'trip_reminder_before', language: 'pt', template_name: 'trip_hours_released', provider_language: 'pt_BR' },
      ],
    },
    record_message_send: 'rec',
  };
  const deps: TripReminderDeps = {
    drive: {
      rpc: (fn: string, args?: Record<string, unknown>) => {
        calls.push({ fn, args });
        return Promise.resolve({ data: answers[fn] ?? null, error: null });
      },
    },
    fetch: ((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('https://api.resend.com/')) {
        mails.push(JSON.parse(String(init?.body)));
        return Promise.resolve(new Response(JSON.stringify({ id: 'resend-1' }), { status: 200 }));
      }
      if (url.startsWith('https://graph.facebook.com/')) {
        return Promise.resolve(new Response(JSON.stringify({ messages: [{ id: 'wamid.T' }] }), { status: 200 }));
      }
      return Promise.resolve(new Response('{}', { status: 404 }));
    }) as typeof fetch,
    log: (l) => lines.push(l),
    sendPush: (body) => {
      pushes.push(body);
      return Promise.resolve({ status: 200, body: { gate: { sent: 1 } } });
    },
    email: { apiKey: 're_test', from: 'Tuggi <news@tuggi.app>', functionsUrl: 'https://p.supabase.co/functions/v1', secret: SECRET, relayDomainVerifiedRaw: undefined },
    now: NOW,
    ...over,
  };
  const recorded = () => calls.filter((c) => c.fn === 'record_message_send').map((c) => c.args as Record<string, unknown>);
  return { deps, calls, pushes, mails, lines, recorded };
}

// ===============================================================================================
// THE RUN
// ===============================================================================================

Deno.test('BR-COMUNICACAO-023 items 3 and 7: one reminder goes by push, e-mail and phone in the same run, each recorded', async () => {
  const f = fakeDeps();
  const report = await runTripReminders(f.deps);
  assertEquals(report, { claimed: 1, push: { sent: 1, failed: 0 }, email: { sent: 1, failed: 0 }, phone: { sent: 1, failed: 0, skipped_month: 0 } });
  assertEquals(f.calls[0], { fn: 'claim_due_trip_reminders', args: { p_limit: 50 } });
  assertEquals(f.recorded().map((r) => [r.p_channel, r.p_outcome, r.p_piece, r.p_trip_id]), [
    ['push', 'sent', 'trip_reminder_before', 'trip-1'],
    ['email', 'sent', 'trip_reminder_before', 'trip-1'],
    ['whatsapp', 'sent', 'trip_reminder_before', 'trip-1'],
  ]);
  assertEquals(f.recorded()[1].p_provider_message_id, 'resend-1');
});

Deno.test('BR-COMUNICACAO-016 and 019 3.s: the reminder push declares `trip_reminder`, a requested kind outside every cap', async () => {
  const f = fakeDeps();
  await runTripReminders(f.deps);
  const push = f.pushes[0] as { push_kind: string; userIds: string[]; notification: { title: string; body: string; data: Record<string, string> } };
  assertEquals(push.push_kind, 'trip_reminder');
  assertEquals(push.userIds, [USER]);
  assertEquals(push.notification.data, { type: 'trip_reminder', deeplink: 'tuggi://map', piece: 'trip_reminder_before', variant: 'a' });
  assertEquals(push.notification.title, 'Lisboa está chegando');
  assertEquals(push.notification.body, 'Você ganhou 1 h de guia para a viagem, já no seu saldo. Vale até 6 de março.');
  assertEquals(PUSH_KINDS.trip_reminder, { requested: true, requiresActive: false, vacancyPriority: 4, outsideCaps: true });
});

Deno.test('BR-COMUNICACAO-023 item 7: a channel that fails or throws does not stop the others, and is recorded with its code', async () => {
  const f = fakeDeps({
    sendPush: () => Promise.reject(new Error('fcm down')),
    fetch: ((input: string | URL | Request) =>
      Promise.resolve(
        String(input).startsWith('https://api.resend.com/')
          ? new Response('{}', { status: 429 })
          : new Response(JSON.stringify({ error: { code: 131026, message: 'the number +5511987654321' } }), { status: 400 })
      )) as typeof fetch,
  });
  const report = await runTripReminders(f.deps);
  assertEquals([report.push.failed, report.email.failed, report.phone.failed], [1, 1, 1]);
  assertEquals(f.recorded().map((r) => [r.p_channel, r.p_outcome, r.p_reason]), [
    ['push', 'failed', 'exception'],
    ['email', 'failed', 'http_429'],
    ['whatsapp', 'failed', '131026'],
  ]);
});

Deno.test('the claim failing aborts the run with its code; an empty claim sends nothing', async () => {
  const f = fakeDeps();
  f.deps.drive = { rpc: () => Promise.resolve({ data: null, error: { code: 'PGRST202' } }) };
  let code = '';
  try {
    await runTripReminders(f.deps);
  } catch (e) {
    code = (e as { code?: string }).code ?? '';
  }
  assertEquals(code, 'PGRST202');
  const empty = fakeDeps({ reminders: [] });
  assertEquals((await runTripReminders(empty.deps)).claimed, 0);
  assertEquals(empty.pushes.length + empty.mails.length, 0);
});

Deno.test('BR-COMUNICACAO-023 item 6: the day reminder reads the balance; with it M4, without it (or unlimited) M5', async () => {
  const day: DueReminder = { ...BEFORE, piece: 'trip_reminder_day', trip_hours: null, phone: null, email: null };
  const withBalance = fakeDeps({ reminders: [day] });
  await runTripReminders(withBalance.deps);
  assertEquals((withBalance.pushes[0] as { notification: { title: string } }).notification.title, 'Boa viagem · 1 h 30 min de guia');
  for (const entitlement of [{ state: 'metered', balance_minutes: 0 }, { state: 'unlimited', balance_minutes: 0 }]) {
    const f = fakeDeps({ reminders: [day], entitlement });
    await runTripReminders(f.deps);
    assertEquals((f.pushes[0] as { notification: { title: string } }).notification.title, 'Boa viagem');
  }
});

Deno.test('BR-COMUNICACAO-023 item 6: with a month only, the day reminder does not say today, and the phone models (which do) are skipped', async () => {
  const month: DueReminder = { ...BEFORE, piece: 'trip_reminder_day', date_precision: 'month', trip_date: '2027-02-01', trip_hours: null };
  const f = fakeDeps({ reminders: [month] });
  const report = await runTripReminders(f.deps);
  assertEquals(report.phone.skipped_month, 1);
  const push = (f.pushes[0] as { notification: { title: string; body: string } }).notification;
  assertEquals(push.title, 'Sua viagem é este mês');
  const mail = f.mails[0] as { text: string; subject: string };
  assertEquals(mail.subject, 'Sua viagem é este mês');
  assert(!/hoje/i.test(mail.text), 'the month e-mail says today');
  assert(mail.text.includes('fevereiro de 2027'), 'the detail line lost the month');
});

Deno.test('#1238 BR-COMUNICACAO-023 item 6: a month-only trip is reminded on day 1, so no language titles that e-mail "have a great trip"', () => {
  const month: TripFacts = { ...BEFORE, piece: 'trip_reminder_day', date_precision: 'month', trip_date: '2027-02-01', trip_hours: null, balance_minutes: 90 };
  for (const lang of ['pt', 'en', 'es', 'fr', 'it'] as const) {
    for (const balance_minutes of [90, 0]) {
      const subject = tripReminderEmail({ ...month, balance_minutes }, lang, NOW)?.subject;
      assertEquals(subject, TRIP_PUSH_COPY.month_title[lang]);
      assert(subject !== TRIP_EMAIL_COPY.day_subject[lang], `${lang}: ${subject}`);
    }
  }
  assertEquals(tripReminderEmail({ ...month, balance_minutes: 0 }, 'en', NOW)?.subject, 'Your trip is this month');
  // A trip with a day keeps the greeting of the day.
  assertEquals(tripReminderEmail({ ...month, date_precision: 'day', trip_date: '2027-01-05' }, 'pt', NOW)?.subject, 'Boa viagem');
});

Deno.test('#1238 BR-MONETIZACAO-091 items 2.a and 9: two trips of one account get one reminder each, each naming the hours credited to that trip', async () => {
  // The bands are deliberately off (week with 1 h): the message follows the grant, never the band.
  const first: DueReminder = { ...BEFORE, duration_band: 'week' };
  const second: DueReminder = {
    ...BEFORE,
    trip_id: 'trip-2',
    trip_date: '2027-01-08',
    destination: { city: 'Paraty', country_code: 'BR' },
    duration_band: 'long',
    trip_hours: { minutes: 180, expires_at: '2027-03-06T13:00:00Z' },
    phone: null,
  };
  const f = fakeDeps({ reminders: [first, second] });
  const report = await runTripReminders(f.deps);
  assertEquals([report.claimed, report.push.sent, report.email.sent], [2, 2, 2]);
  const pushes = f.pushes.map((p) => {
    const { title, body } = (p as { notification: { title: string; body: string } }).notification;
    return { title, body };
  });
  assertEquals(pushes, [
    { title: 'Lisboa está chegando', body: 'Você ganhou 1 h de guia para a viagem, já no seu saldo. Vale até 6 de março.' },
    { title: 'Paraty está chegando', body: 'Você ganhou 3 h de guia para a viagem, já no seu saldo. Vale até 6 de março.' },
  ]);
  const texts = f.mails.map((m) => (m as { text: string }).text);
  assert(texts[0].includes('você ganhou 1 h de guia para ela'), texts[0]);
  assert(texts[1].includes('daqui a 3 dias, e você ganhou 3 h de guia para ela'), texts[1]);
  assertEquals(
    f.recorded().map((r) => [r.p_channel, r.p_trip_id]),
    [
      ['push', 'trip-1'],
      ['email', 'trip-1'],
      ['whatsapp', 'trip-1'],
      ['push', 'trip-2'],
      ['email', 'trip-2'],
    ]
  );
});

Deno.test('#1238 BR-MONETIZACAO-091 item 5 and ceiling: a trip that got no hours (interval, or overlapping a credited trip) is reminded without any hours line', async () => {
  const f = fakeDeps({ reminders: [{ ...BEFORE, duration_band: 'long', trip_hours: null, phone: null }] });
  const report = await runTripReminders(f.deps);
  assertEquals([report.push.sent, report.email.sent], [1, 1]);
  const push = (f.pushes[0] as { notification: { title: string; body: string } }).notification;
  assertEquals(push.title, 'Lisboa daqui a 7 dias');
  const mail = f.mails[0] as { subject: string; text: string };
  assertEquals(mail.subject, 'Sua viagem é daqui a 7 dias');
  for (const text of [push.title, push.body, mail.subject, mail.text]) {
    assert(!/ganhou|de guia|\d+\s?h\b|\d+\s?min\b/i.test(text), text);
  }
});

Deno.test('BR-COMUNICACAO-020 item 7: a relay address before the domain is verified is recorded, not mailed', async () => {
  const f = fakeDeps({ reminders: [{ ...BEFORE, email: 'x@privaterelay.appleid.com', push: false, phone: null }] });
  await runTripReminders(f.deps);
  assertEquals(f.mails.length, 0);
  assertEquals(f.recorded().map((r) => [r.p_channel, r.p_reason]), [['email', 'apple_relay_unverified']]);
});

Deno.test('copy §9.b: the reminder e-mail stops by its own signed link, scope trip_reminder, also in the RFC 8058 header', async () => {
  const f = fakeDeps({ reminders: [{ ...BEFORE, push: false, phone: null }] });
  await runTripReminders(f.deps);
  const mail = f.mails[0] as { to: string[]; subject: string; html: string; text: string; headers: Record<string, string> };
  assertEquals(mail.to, ['ana@example.com']);
  assertEquals(mail.subject, 'Você ganhou horas de guia para a viagem');
  const link = mail.headers['List-Unsubscribe'].slice(1, -1);
  assert(link.startsWith('https://p.supabase.co/functions/v1/trip-reminder/stop?'), link);
  assertEquals(mail.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  const u = new URL(link);
  assertEquals(u.searchParams.get('scope'), 'trip_reminder');
  assertEquals(await verifyScopedStop('trip_reminder', u.searchParams.get('e'), u.searchParams.get('s'), SECRET), 'ana@example.com');
  assert(mail.text.includes('Parar os lembretes de viagem por e-mail'), 'the footer link label');
  assert(mail.text.includes('Lisboa · 12 de janeiro de 2027'), 'the detail line');
  assert(mail.text.includes('Você recebe este e-mail porque pediu o lembrete da sua viagem no Tuggi.'));
});

Deno.test('the general unsubscribe signature does not open the trip link, nor a tampered one', async () => {
  const e = encodeEmail('ana@example.com');
  assertEquals(await verifyScopedStop('trip_reminder', e, await signEmail('ana@example.com', SECRET), SECRET), null);
  const url = new URL(await buildScopedStopUrl('trip_reminder', 'ana@example.com', 'https://x.test/functions/v1', SECRET, 'pt'));
  assertEquals(await verifyScopedStop('trip_reminder', encodeEmail('bia@example.com'), url.searchParams.get('s'), SECRET), null);
  assertEquals(await verifyScopedStop('trip_reminder', e, url.searchParams.get('s'), 'other-secret'), null);
});

Deno.test('security-reviewer #1230 condition 3: no address, number or secret in the run log', async () => {
  const f = fakeDeps();
  await runTripReminders(f.deps);
  for (const line of f.lines) assert(!/ana@example|5511987654321|EAAG|re_test|7777/.test(line), line);
});

// ===============================================================================================
// THE COPY
// ===============================================================================================

const LANGS = ['pt', 'en', 'es', 'fr', 'it', 'de'];

Deno.test('BR-COMUNICACAO-019 item 11 and copy §9.a: every reminder push, six languages, inside 40 and 110, no claim of a story at the destination', () => {
  const cases: TripFacts[] = [
    { ...BEFORE, balance_minutes: null },
    { ...BEFORE, trip_hours: null, balance_minutes: null },
    { ...BEFORE, piece: 'trip_reminder_day', trip_hours: null, balance_minutes: 90 },
    { ...BEFORE, piece: 'trip_reminder_day', trip_hours: null, balance_minutes: 0 },
    { ...BEFORE, piece: 'trip_reminder_day', date_precision: 'month', trip_hours: null, balance_minutes: 90 },
    { ...BEFORE, trip_hours: null, date_precision: 'month', balance_minutes: null },
    { ...BEFORE, destination: { city: 'São José dos Campos do Norte', country_code: 'BR' }, trip_hours: null, balance_minutes: null },
  ];
  for (const facts of cases) {
    for (const lang of LANGS) {
      const push = tripReminderPush(facts, lang, NOW);
      assert(push, `${facts.piece}/${lang}`);
      assert(push.title.length <= PUSH_TITLE_MAX, `${lang} title ${push.title}`);
      assert(push.body.length <= PUSH_BODY_MAX, `${lang} body ${push.body.length}: ${push.body}`);
      assert(!/[?!]|\{\{/.test(push.title + push.body), `${lang}: ${push.title} ${push.body}`);
      assert(!/ao chegar|when you get there|al llegar|sur place|quando arrivi|vor ort/i.test(push.body), `${lang} claims a story at the destination`);
    }
  }
  assertEquals(tripReminderPush({ ...BEFORE, trip_hours: null, balance_minutes: null }, 'de', NOW)?.title, 'Lisboa in 7 Tagen');
});

Deno.test('BR-COMUNICACAO-023 item 6: the first reminder says until when the trip hours are valid', () => {
  for (const lang of LANGS) {
    const push = tripReminderPush({ ...BEFORE, balance_minutes: null }, lang, NOW);
    assert(push && /6|mar/i.test(push.body), `${lang}: ${push?.body}`);
  }
  const mail = tripReminderEmail({ ...BEFORE, balance_minutes: null }, 'en', NOW);
  assertEquals(mail?.paragraphs[1], 'Your trip is in 7 days, and you got 1 h of guide time for it, already in your Tuggi balance and valid until March 6.');
});

Deno.test('a destination that is not a name is dropped, never the message', () => {
  assertEquals(safeCity('Lisboa'), 'Lisboa');
  assertEquals(safeCity("L'Aquila"), "L'Aquila");
  for (const bad of ['[click](https://x.test)', 'win $$$ now', '<b>x</b>', 'a'.repeat(41), '']) assertEquals(safeCity(bad), null);
  const push = tripReminderPush({ ...BEFORE, destination: { city: '[click](https://x.test)', country_code: 'PT' }, balance_minutes: null }, 'pt', NOW);
  assertEquals(push?.title, 'Sua viagem está chegando');
});

// ===============================================================================================
// THE HANDLERS
// ===============================================================================================

Deno.env.set('NEWSLETTER_SECRET', SECRET);
Deno.env.set('CMS_JOB_SECRET', 'cms-job-secret');
const reminderHandler = await loadHandler('trip-reminder');
const testHandler = await loadHandler('trip-message-test');

Deno.test('trip-reminder /run refuses anyone but the machine key, and claims nothing', async () => {
  scenario.calls.length = 0;
  const res = await reminderHandler(new Request('http://edge.test/trip-reminder/run', { method: 'POST', headers: { authorization: 'Bearer user-jwt' } }));
  assertEquals(res.status, 401);
  assertEquals(scenario.calls.length, 0);
});

Deno.test('trip-reminder /stop: a signed link stops the reminder e-mails of that address and answers in the reader language', async () => {
  const stops: unknown[] = [];
  scenario.rpcs = { stop_trip_reminder_emails: (a) => (stops.push(a), { data: 1, error: null }) };
  const link = await buildScopedStopUrl('trip_reminder', 'Ana@Example.com', 'http://edge.test', SECRET, 'fr');
  const res = await reminderHandler(new Request(link, { method: 'GET' }));
  assertEquals(res.status, 200);
  assertEquals(await res.text(), "C'est fait, tu ne recevras plus de rappels de voyage par e-mail.");
  assertEquals(stops, [{ p_email: 'ana@example.com' }]);
  const post = await reminderHandler(new Request(link, { method: 'POST', body: 'List-Unsubscribe=One-Click' }));
  assertEquals(post.status, 200);
});

Deno.test('trip-reminder /stop: a link we did not sign, or without the scope, writes nothing', async () => {
  const stops: unknown[] = [];
  scenario.rpcs = { stop_trip_reminder_emails: (a) => (stops.push(a), { data: 1, error: null }) };
  const link = new URL(await buildScopedStopUrl('trip_reminder', 'ana@example.com', 'http://edge.test', SECRET, 'pt'));
  const general = `http://edge.test/trip-reminder/stop?e=${encodeEmail('ana@example.com')}&s=${await signEmail('ana@example.com', SECRET)}&scope=trip_reminder`;
  link.searchParams.delete('scope');
  for (const url of [general, link.href]) {
    assertEquals((await reminderHandler(new Request(url))).status, 400);
  }
  assertEquals(stops.length, 0);
});

Deno.test('trip-message-test: the body is a piece and a channel, nothing else', () => {
  assertEquals(parseTestRequest({ piece: 'trip_reminder_day', channel: 'sms' }), { piece: 'trip_reminder_day', channel: 'sms' });
  for (const bad of [{ piece: 'test', channel: 'push' }, { piece: 'trip_reminder_day', channel: 'telegram' }, null, 'x']) {
    assertEquals(parseTestRequest(bad), null);
  }
});

Deno.test('BR-COMUNICACAO-024 item 9: trip-message-test refuses whoever is not an active admin of core.cms_users', async () => {
  scenario.user = { id: USER, email: 'curator@tuggi.app', is_anonymous: false };
  scenario.tables = { cms_users: null };
  const res = await testHandler(
    new Request('http://edge.test/trip-message-test', {
      method: 'POST',
      headers: { authorization: 'Bearer admin-session', 'x-cms-job-secret': 'cms-job-secret', 'content-type': 'application/json' },
      body: JSON.stringify({ piece: 'trip_reminder_before', channel: 'push' }),
    })
  );
  assertEquals(res.status, 403);
  assert(!scenario.calls.includes('rpc:record_message_send'));
  scenario.user = null;
  const anon = await testHandler(
    new Request('http://edge.test/trip-message-test', { method: 'POST', headers: { authorization: 'Bearer x', 'x-cms-job-secret': 'cms-job-secret' } })
  );
  assertEquals(anon.status, 401);
  // Without the CMS job secret nobody reaches the token check.
  scenario.calls.length = 0;
  scenario.user = { id: USER, email: 'curator@tuggi.app', is_anonymous: false };
  const noSecret = await testHandler(new Request('http://edge.test/trip-message-test', { method: 'POST', headers: { authorization: 'Bearer admin-session' } }));
  assertEquals(noSecret.status, 401);
  assertEquals(scenario.calls.includes('auth:getUser'), false);
});

Deno.test('BR-COMUNICACAO-024 item 9: the test goes to the admin, is recorded as `test`, and answers ok, channel and the code', async () => {
  const admin = { userId: USER, email: 'curator@tuggi.app', phone: '+5521999990000', language: 'pt-BR' };
  const f = fakeDeps();
  const push = await sendTestMessage(f.deps, admin, { piece: 'trip_reminder_before', channel: 'push' });
  assertEquals(push, { ok: true, channel: 'push' });
  assertEquals((f.pushes[0] as { userIds: string[] }).userIds, [USER]);
  const mail = await sendTestMessage(f.deps, admin, { piece: 'trip_reminder_day', channel: 'email' });
  assertEquals(mail, { ok: true, channel: 'email' });
  assertEquals((f.mails[0] as { to: string[] }).to, ['curator@tuggi.app']);
  const sms = await sendTestMessage(f.deps, admin, { piece: 'trip_reminder_before', channel: 'sms' });
  assertEquals(sms, { ok: false, channel: 'sms', error_code: 'not_configured' });
  assertEquals(f.recorded().map((r) => [r.p_piece, r.p_user_id, r.p_channel, r.p_outcome]), [
    ['test', null, 'push', 'sent'],
    ['test', null, 'email', 'sent'],
    ['test', null, 'sms', 'failed'],
  ]);
  const noPhone = await sendTestMessage(f.deps, { ...admin, phone: null }, { piece: 'phone_confirmation', channel: 'whatsapp' });
  assertEquals(noPhone.error_code, 'no_phone');
  const confirmByPush = await sendTestMessage(f.deps, admin, { piece: 'phone_confirmation', channel: 'push' });
  assertEquals(confirmByPush.error_code, 'piece_not_on_channel');
  assertEquals(fetchCalls.filter((u) => u.includes('graph.facebook.com')).length, 0);
  network.reply = () => new Response('{}', { status: 400 });
});

// The harness is one process for every file: leave the shared scenario and network as found.
Deno.test('cleanup: the shared fakes go back to their defaults', () => {
  scenario.user = null;
  scenario.rpcs = {};
  scenario.tables = {};
  network.reply = () => new Response('{}', { status: 400 });
});
