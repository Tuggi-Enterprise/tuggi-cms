/**
 * #1264, BR-COMUNICACAO-026: the partner message round (`_shared/partner-message-send.ts`) and the
 * two signed links of its e-mail. Contract `docs/contracts/tuggi-do-parceiro.md` §11.3.
 * Providers and the database are simulated; nothing here reaches the network.
 */
import { assert, assertEquals } from './assert.ts';
import { PUSH_KINDS } from '../_shared/push-gate.ts';
import { buildFcmMessage } from '../_shared/push-send.ts';
import { PARTNER_MESSAGE_FOOTER_VERSION } from '../_shared/partner-message-copy.ts';
import {
  buildClickUrl,
  buildStopUrl,
  emailButtonTarget,
  handlePartnerMessageRequest,
  renderPartnerMessageEmail,
  runPartnerMessageRound,
  withPartnerMessageUtm,
  type PartnerEmailConfig,
  type PartnerMessageDeps,
  type PartnerMessageHttpDeps,
  type PartnerMessageRecipient,
} from '../_shared/partner-message-send.ts';
import { signScopedId } from '../_shared/unsubscribe-link.ts';

const SECRET = 'test-newsletter-secret';
const USER = '77777777-8888-4999-8aaa-bbbbbbbbbbbb';
const RECIPIENT = 'aaaaaaaa-1111-4222-8333-444444444444';
const OTHER_RECIPIENT = 'bbbbbbbb-1111-4222-8333-444444444444';
const EMAIL = 'ana@example.com';

const ROW: PartnerMessageRecipient = {
  recipient_id: RECIPIENT,
  message_id: 'mmmmmmmm-1111-4222-8333-444444444444',
  user_id: USER,
  client_id: 'cccccccc-1111-4222-8333-444444444444',
  partner_name: 'Pousada Vila do Mar',
  partner_handle: 'viladomar',
  language: 'pt',
  title: 'Pousada Vila do Mar: jazz no sábado',
  summary: 'Música ao vivo no jardim, sábado, 28 de novembro, às 20h. A entrada é livre.',
  subject: 'Pousada Vila do Mar: jazz no jardim, sábado às 20h',
  preheader: null,
  body: 'Neste sábado o Trio Maré toca no jardim.\n\nA entrada é livre.',
  button_label: 'Reservar o jantar',
  button_kind: 'website',
  button_ref: null,
  button_url: 'https://viladomar.example/reservas',
  image_path: null,
  image_alt: null,
  notification_id: 'nnnnnnnn-1111-4222-8333-444444444444',
  push: true,
  email: EMAIL,
  consent_at: '2026-11-20T15:00:00Z',
};

const CONFIG: PartnerEmailConfig = {
  apiKey: 're_test',
  from: 'Tuggi <news@tuggi.app>',
  replyTo: 'suporte@tuggi.app',
  functionsUrl: 'https://proj.functions.test/functions/v1',
  siteUrl: 'https://www.tuggi.app',
  storageUrl: 'https://proj.supabase.test',
  secret: SECRET,
  relayDomainVerifiedRaw: 'false',
};

type Call = { fn: string; args: Record<string, unknown> | undefined };

function fakeRound(over: { batches?: unknown[][]; gate?: string; claimError?: boolean; budgetMs?: number; email?: PartnerEmailConfig | null } = {}) {
  const calls: Call[] = [];
  const pushes: { body: Record<string, unknown>; internal: { inboxRowId: string } }[] = [];
  const mails: Record<string, unknown>[] = [];
  const lines: string[] = [];
  const batches = [...(over.batches ?? [[ROW]])];
  let now = 0;
  const deps: PartnerMessageDeps = {
    drive: {
      rpc: (fn: string, args?: Record<string, unknown>) => {
        calls.push({ fn, args });
        if (fn === 'claim_partner_message_recipients') {
          if (over.claimError) return Promise.resolve({ data: null, error: { code: '22023' } });
          now += 10;
          return Promise.resolve({ data: batches.shift() ?? [], error: null });
        }
        return Promise.resolve({ data: true, error: null });
      },
    },
    fetch: (_input: string, init?: RequestInit) => {
      mails.push(JSON.parse(String(init?.body)));
      return Promise.resolve(new Response(JSON.stringify({ id: 'resend-1' }), { status: 200 }));
    },
    sendPush: (body, internal) => {
      pushes.push({ body, internal });
      return Promise.resolve({ status: 200, body: { success: true, gate: { [over.gate ?? 'sent']: 1 } } });
    },
    email: over.email === undefined ? CONFIG : over.email,
    log: (line) => lines.push(line),
    budgetMs: over.budgetMs,
    clock: () => now,
  };
  return { deps, calls, pushes, mails, lines };
}

const deliveries = (calls: Call[]) =>
  calls.filter((c) => c.fn === 'record_partner_message_delivery').map((c) => [c.args?.p_channel, c.args?.p_error]);

// ------------------------------------------------------------------ the round

Deno.test('BR-COMUNICACAO-026 items 2 to 4: the round claims until the database answers no row, and records each channel once', async () => {
  const second = { ...ROW, recipient_id: OTHER_RECIPIENT, push: false };
  const f = fakeRound({ batches: [[ROW], [second]] });
  const report = await runPartnerMessageRound(f.deps);
  assertEquals(f.calls.filter((c) => c.fn === 'claim_partner_message_recipients').length, 3);
  assertEquals(f.calls[0].args, { p_limit: 100 });
  assertEquals(report.claimed, 2);
  assertEquals(report.batches, 2);
  assertEquals(report.push, { sent: 1, failed: 0 });
  assertEquals(report.email, { sent: 2, failed: 0 });
  assertEquals(deliveries(f.calls), [['push', null], ['email', null], ['email', null]]);
});

Deno.test('BR-COMUNICACAO-026 items 3.b and 7.g: the push is silent, on its own channel, without image, with the Correio row handed over', async () => {
  const f = fakeRound();
  await runPartnerMessageRound(f.deps);
  const { body, internal } = f.pushes[0];
  assertEquals(internal, { inboxRowId: ROW.notification_id });
  assertEquals(body.push_kind, 'partner_message');
  assertEquals(body.userIds, [USER]);
  const n = body.notification as Record<string, unknown>;
  assertEquals(n.title, ROW.title);
  assertEquals(n.body, ROW.summary);
  assertEquals(n.silent, true);
  assertEquals(n.androidChannelId, 'partner_messages');
  assertEquals('imageUrl' in n, false);
  assertEquals(n.data, { type: 'partner_message', message_id: ROW.message_id, client_id: ROW.client_id });
});

Deno.test('BR-COMUNICACAO-026 item 3.b: the FCM message of a silent push has no sound, the Android channel and the iOS passive level', () => {
  const silent = buildFcmMessage({ title: 't', body: 'b', data: { notification_id: 'n' }, silent: true, androidChannelId: 'partner_messages' }, 'normal', 60) as any;
  assertEquals('sound' in silent.android.notification, false);
  assertEquals(silent.android.notification.channel_id, 'partner_messages');
  assertEquals('sound' in silent.apns.payload.aps, false);
  assertEquals(silent.apns.payload.aps['interruption-level'], 'passive');
  assertEquals('image' in silent.notification, false);
  // Every other push is unchanged.
  const loud = buildFcmMessage({ title: 't', body: 'b', data: {} }, 'high', 60) as any;
  assertEquals(loud.android.notification.sound, 'default');
  assertEquals('channel_id' in loud.android.notification, false);
  assertEquals(loud.apns.payload.aps.sound, 'default');
  assertEquals('interruption-level' in loud.apns.payload.aps, false);
});

Deno.test('BR-COMUNICACAO-026 item 4.d: the push kind is outside every cap of 019 and asks consent only', () => {
  assertEquals(PUSH_KINDS.partner_message, { requested: false, requiresActive: false, vacancyPriority: 4, outsideCaps: true });
});

Deno.test('BR-COMUNICACAO-026 item 3.b: a push the gate refuses is recorded with its code, and the e-mail still leaves', async () => {
  const f = fakeRound({ gate: 'denied' });
  const report = await runPartnerMessageRound(f.deps);
  assertEquals(deliveries(f.calls), [['push', 'PUSH_NOT_ALLOWED'], ['email', null]]);
  assertEquals(report.push, { sent: 0, failed: 1 });
  assertEquals(report.email, { sent: 1, failed: 0 });
});

Deno.test('BR-COMUNICACAO-020 item 7: a relay address of Apple gets no e-mail before the domain is registered', async () => {
  const f = fakeRound({ batches: [[{ ...ROW, push: false, email: 'x1y2@privaterelay.appleid.com' }]] });
  await runPartnerMessageRound(f.deps);
  assertEquals(f.mails.length, 0);
  assertEquals(deliveries(f.calls), [['email', 'apple_relay_unverified']]);
});

Deno.test('BR-COMUNICACAO-026 item 3.c: without a key or a secret the e-mail is recorded as not configured', async () => {
  const f = fakeRound({ batches: [[{ ...ROW, push: false }]], email: null });
  await runPartnerMessageRound(f.deps);
  assertEquals(deliveries(f.calls), [['email', 'not_configured']]);
});

Deno.test('#1264: a failed claim stops the round with its code; a malformed row is skipped', async () => {
  const f = fakeRound({ claimError: true });
  let code = '';
  try {
    await runPartnerMessageRound(f.deps);
  } catch (e) {
    code = (e as { code?: string }).code ?? '';
  }
  assertEquals(code, '22023');
  const g = fakeRound({ batches: [[{ nope: true }, ROW]] });
  const report = await runPartnerMessageRound(g.deps);
  assertEquals(report.claimed, 2);
  assertEquals(report.push.sent, 1);
});

Deno.test('#1264: the round stops claiming on its time budget, after finishing the batch it holds', async () => {
  const f = fakeRound({ batches: [[ROW], [ROW], [ROW]], budgetMs: 15 });
  const report = await runPartnerMessageRound(f.deps);
  assertEquals(report.batches, 2);
  assertEquals(report.out_of_time, true);
});

Deno.test('CLAUDE.md §6: the round logs counts and codes, never an address, an account or a recipient', async () => {
  const f = fakeRound({ gate: 'denied' });
  await runPartnerMessageRound(f.deps);
  const all = f.lines.join('\n');
  assert(all.length > 0);
  for (const pii of [EMAIL, USER, RECIPIENT, ROW.notification_id]) assert(!all.includes(pii), pii);
});

// ------------------------------------------------------------------ the e-mail

Deno.test('BR-COMUNICACAO-026 items 5.d and 6.c: sender and reply of the Tuggi, the footer with why, the stop of that partner, the general unsubscribe and List-Unsubscribe', async () => {
  const f = fakeRound({ batches: [[{ ...ROW, push: false }]] });
  await runPartnerMessageRound(f.deps);
  const mail = f.mails[0] as { from: string; to: string[]; reply_to: string; subject: string; html: string; text: string; headers: Record<string, string> };
  assertEquals(mail.from, 'Tuggi <news@tuggi.app>');
  assertEquals(mail.reply_to, 'suporte@tuggi.app');
  assertEquals(mail.to, [EMAIL]);
  assertEquals(mail.subject, ROW.subject);
  const stop = await buildStopUrl(ROW, 'pt', CONFIG);
  assertEquals(mail.headers['List-Unsubscribe'], `<${stop}&o=1>`);
  assertEquals(mail.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert(mail.html.includes('Mensagem de parceiro'));
  assert(mail.html.includes('aceitou as mensagens de @viladomar pelo Tuggi em 20 de novembro de 2026'));
  assert(mail.html.includes('Respostas a este e-mail chegam ao Tuggi.'));
  assert(mail.html.includes('Parar as mensagens de @viladomar'));
  assert(mail.html.includes('Parar de receber avisos e novidades do Tuggi'));
  assert(mail.html.includes('https://www.tuggi.app/pt-br/unsubscribe?'));
  assert(mail.text.includes('Parar as mensagens de @viladomar'));
  // The partner links carry the recipient only: no account id, no address.
  for (const href of [stop, await buildClickUrl(ROW, ROW.button_url!, CONFIG)]) {
    assert(!href.includes(USER) && !href.includes(EMAIL) && !href.includes(encodeURIComponent(EMAIL)), href);
    assert(href.includes(`r=${RECIPIENT}`), href);
  }
});

Deno.test('#1264 security: every field the partner wrote is escaped, and the button URL only travels inside our signed link', async () => {
  const evil: PartnerMessageRecipient = {
    ...ROW,
    subject: 'Vila <img src=x onerror=alert(1)>',
    preheader: '<script>alert("pre")</script>',
    body: '<script>alert(1)</script>\n\n<a href="https://evil.test">clique</a>',
    button_label: '<b>Reservar</b>',
    button_url: 'https://viladomar.example/?q="><script>alert(2)</script>',
    image_path: 'cccccccc-1111-4222-8333-444444444444/abc.png',
    image_alt: '"><script>alert(3)</script>',
  };
  const mail = await renderPartnerMessageEmail(evil, CONFIG);
  assert(mail);
  for (const raw of ['<script', '<img src=x', '<b>Reservar', '<a href="https://evil.test"', '"><script']) {
    assert(!mail.html.includes(raw), `raw markup in the html: ${raw}`);
  }
  assert(mail.html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  // The button href is our click route; the partner URL is inside its query, encoded.
  const hrefs = [...mail.html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  const cta = hrefs.find((h) => h.includes('/partner-message-send/click?'));
  assert(cta, 'the button goes through /click');
  assert(!hrefs.some((h) => h.startsWith('https://viladomar.example')), 'no direct link to the partner site');
  assert(mail.html.includes('/storage/v1/object/public/partner-message-images/cccccccc-1111-4222-8333-444444444444/abc.png'));
});

Deno.test('#1264: a tuggi:// button opens the app by our universal link in the e-mail', async () => {
  const mail = await renderPartnerMessageEmail({ ...ROW, button_kind: 'partner_place', button_url: 'tuggi://place?id=1' }, CONFIG);
  assert(mail);
  assert(mail.html.includes(encodeURIComponent('https://tuggi.app/download')));
  assert(!mail.html.includes('tuggi://'));
});

// ------------------------------------------------------------------ the HTTP surface

function fakeHttp(answer: { data?: unknown; error?: { code: string } | null } = { data: { partner_handle: 'viladomar', partner_name: 'Pousada Vila do Mar', stopped: true } }) {
  const calls: Call[] = [];
  const lines: string[] = [];
  let ran = 0;
  const deps: PartnerMessageHttpDeps = {
    isMachineKey: (bearer) => bearer === 'machine-key',
    secret: SECRET,
    drive: () => ({
      rpc: (fn: string, args?: Record<string, unknown>) => {
        calls.push({ fn, args });
        return Promise.resolve({ data: answer.data ?? null, error: answer.error ?? null });
      },
    }),
    run: () => {
      ran += 1;
      return Promise.resolve({ claimed: 0, batches: 0, push: { sent: 0, failed: 0 }, email: { sent: 0, failed: 0 }, out_of_time: false });
    },
    log: (line) => lines.push(line),
  };
  return { deps, calls, lines, ran: () => ran };
}

const at = (path: string, method = 'GET', headers: Record<string, string> = {}) =>
  new Request(`https://proj.functions.test/functions/v1/partner-message-send${path}`, { method, headers });

Deno.test('#1264: the round answers only the machine key of the job', async () => {
  const f = fakeHttp();
  assertEquals((await handlePartnerMessageRequest(at('', 'POST'), f.deps)).status, 401);
  assertEquals((await handlePartnerMessageRequest(at('', 'POST', { Authorization: 'Bearer anon-jwt' }), f.deps)).status, 401);
  assertEquals(f.ran(), 0);
  const ok = await handlePartnerMessageRequest(at('', 'POST', { Authorization: 'Bearer machine-key' }), f.deps);
  assertEquals(ok.status, 200);
  assertEquals(f.ran(), 1);
});

Deno.test('BR-COMUNICACAO-026 item 5.d: the footer link stops that partner in one tap, with the version of the footer, GET and one-click POST', async () => {
  const stop = new URL(await buildStopUrl(ROW, 'pt', CONFIG));
  for (const method of ['GET', 'POST']) {
    const f = fakeHttp();
    const res = await handlePartnerMessageRequest(at(`/stop${stop.search}`, method), f.deps);
    assertEquals(res.status, 200);
    assertEquals(await res.text(), 'Pronto. Você não recebe mais as mensagens de @viladomar. Os outros avisos do Tuggi continuam como estavam.');
    assertEquals(f.calls, [{ fn: 'stop_partner_messages_by_link', args: { p_recipient_id: RECIPIENT, p_text_version: PARTNER_MESSAGE_FOOTER_VERSION } }]);
  }
});

Deno.test('#1264 security, RFC 8058 §1: a GET of the List-Unsubscribe URL (o=1) answers 200 and writes nothing; only the one-click POST writes', async () => {
  const stop = await buildStopUrl(ROW, 'pt', CONFIG);
  const mail = await renderPartnerMessageEmail(ROW, CONFIG);
  const header = new URL(mail!.headers['List-Unsubscribe'].slice(1, -1));
  assertEquals(header.href, `${stop}&o=1`);

  const probe = fakeHttp();
  const get = await handlePartnerMessageRequest(at(`/stop${header.search}`), probe.deps);
  assertEquals(get.status, 200);
  assertEquals(await get.text(), 'Para parar estas mensagens, use o link no fim do e-mail.');
  assertEquals(probe.calls, []);

  const oneClick = fakeHttp();
  const post = await handlePartnerMessageRequest(at(`/stop${header.search}`, 'POST'), oneClick.deps);
  assertEquals(post.status, 200);
  assertEquals(oneClick.calls, [{ fn: 'stop_partner_messages_by_link', args: { p_recipient_id: RECIPIENT, p_text_version: PARTNER_MESSAGE_FOOTER_VERSION } }]);

  // The mark does not open a link we did not sign.
  const forged = new URL(header.href);
  forged.searchParams.set('s', 'forged');
  assertEquals((await handlePartnerMessageRequest(at(`/stop${forged.search}`, 'POST'), fakeHttp().deps)).status, 400);
});

Deno.test('#1264 security: a stop link we did not sign is refused before the database (invalid HMAC, other recipient, click scope)', async () => {
  const good = new URL(await buildStopUrl(ROW, 'pt', CONFIG));
  const s = good.searchParams.get('s')!;
  const clickSig = await signScopedId('partner_message_click', RECIPIENT, SECRET, ROW.button_url!);
  const forged = [
    `?r=${RECIPIENT}&s=${s.slice(0, -2)}xx`,
    `?r=${OTHER_RECIPIENT}&s=${s}`,
    `?r=${RECIPIENT}&s=${clickSig}`,
    `?r=${RECIPIENT}`,
    `?r=not-a-uuid&s=${s}`,
  ];
  for (const q of forged) {
    const f = fakeHttp();
    const res = await handlePartnerMessageRequest(at(`/stop${q}`), f.deps);
    assertEquals(res.status, 400, q);
    assertEquals(f.calls.length, 0, q);
  }
});

Deno.test('#1264: a stop whose recipient is gone answers 404, and a failed write answers the error text of the copy', async () => {
  const stop = new URL(await buildStopUrl(ROW, 'en', CONFIG));
  const gone = await handlePartnerMessageRequest(at(`/stop${stop.search}`), fakeHttp({ data: null }).deps);
  assertEquals(gone.status, 404);
  const f = fakeHttp({ error: { code: '57014' } });
  const failed = await handlePartnerMessageRequest(at(`/stop${stop.search}`), f.deps);
  assertEquals(failed.status, 500);
  assert((await failed.text()).startsWith("We couldn't save that right now."));
  assertEquals(f.lines, ['[partner-message-send] stop failed: 57014']);
});

Deno.test('BR-COMUNICACAO-026 item 6.e: the click counts the open and redirects to the URL signed into the link', async () => {
  const click = new URL(await buildClickUrl(ROW, ROW.button_url!, CONFIG));
  const f = fakeHttp({ data: true });
  const res = await handlePartnerMessageRequest(at(`/click${click.search}`), f.deps);
  assertEquals(res.status, 302);
  assertEquals(res.headers.get('Location'), ROW.button_url);
  assertEquals(f.calls, [{ fn: 'record_partner_message_email_click', args: { p_recipient_id: RECIPIENT } }]);
});

Deno.test('#1264 security: the click never redirects to a URL that is not the one signed (no open redirect)', async () => {
  const click = new URL(await buildClickUrl(ROW, ROW.button_url!, CONFIG));
  const s = click.searchParams.get('s')!;
  const stopSig = await signScopedId('partner_message', RECIPIENT, SECRET);
  const forged = [
    new URLSearchParams({ r: RECIPIENT, u: 'https://evil.test/phish', s }),
    new URLSearchParams({ r: OTHER_RECIPIENT, u: ROW.button_url!, s }),
    new URLSearchParams({ r: RECIPIENT, u: ROW.button_url!, s: stopSig }),
    new URLSearchParams({ r: RECIPIENT, u: 'javascript:alert(1)', s }),
    new URLSearchParams({ r: RECIPIENT, u: ROW.button_url! }),
  ];
  for (const q of forged) {
    const f = fakeHttp({ data: true });
    const res = await handlePartnerMessageRequest(at(`/click?${q.toString()}`), f.deps);
    assertEquals(res.status, 400, q.toString());
    assertEquals(res.headers.get('Location'), null);
    assertEquals(f.calls.length, 0, q.toString());
  }
});

Deno.test('#1264: a failed click record still takes the person to the page, and logs only the code', async () => {
  const click = new URL(await buildClickUrl(ROW, ROW.button_url!, CONFIG));
  const f = fakeHttp({ error: { code: '40001' } });
  const res = await handlePartnerMessageRequest(at(`/click${click.search}`), f.deps);
  assertEquals(res.status, 302);
  assertEquals(f.lines, ['[partner-message-send] click not recorded: 40001']);
});

const UTM = `utm_source=tuggi&utm_medium=partner_message&utm_campaign=${ROW.message_id}`;

Deno.test('#1289 item 12: a site URL without a query gets the three UTM parameters', () => {
  assertEquals(withPartnerMessageUtm('https://viladomar.example/reservas', ROW.message_id), `https://viladomar.example/reservas?${UTM}`);
});

Deno.test('#1289 item 12: a site URL with a query keeps it in its order and encoding, and the fragment at the end', () => {
  assertEquals(
    withPartnerMessageUtm('https://viladomar.example/r?dia=s%C3%A1bado&mesa=2#jantar', ROW.message_id),
    `https://viladomar.example/r?dia=s%C3%A1bado&mesa=2&${UTM}#jantar`,
  );
  assertEquals(
    withPartnerMessageUtm('https://x.example/?utm_source=insta&ref=a&UTM_MEDIUM=bio', ROW.message_id),
    `https://x.example/?ref=a&${UTM}`,
  );
  assertEquals(withPartnerMessageUtm('https://x.example/a?', null), 'https://x.example/a?utm_source=tuggi&utm_medium=partner_message');
});

Deno.test('#1289 item 12: the e-mail button signs and redirects to the site with the UTM; a tuggi:// button takes none; the row is untouched', async () => {
  const row = { ...ROW, button_url: 'https://viladomar.example/reservas?mesa=2#jantar' };
  const target = emailButtonTarget(row.button_url, row.message_id);
  assertEquals(target, `https://viladomar.example/reservas?mesa=2&${UTM}#jantar`);
  assertEquals(emailButtonTarget('tuggi://place?id=1', row.message_id), 'https://tuggi.app/download');
  const mail = await renderPartnerMessageEmail(row, CONFIG);
  assert(mail);
  const click = await buildClickUrl(row, target, CONFIG);
  assert(mail.html.includes(click.replaceAll('&', '&amp;')) || mail.html.includes(click), 'the button is the signed click of the UTM target');
  assertEquals(row.button_url, 'https://viladomar.example/reservas?mesa=2#jantar');
});
