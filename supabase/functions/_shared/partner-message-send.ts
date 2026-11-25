/**
 * The partner message round (#1264, BR-COMUNICACAO-026): who said yes to a partner gets that
 * partner's message in the Correio, by push and by e-mail, sent by the Tuggi.
 * Contract: `docs/contracts/tuggi-do-parceiro.md` §11.3.
 *
 * - `drive.claim_partner_message_recipients(p_limit)` until it answers no row. The database already
 *   applied the yes read now (item 2), the window in the person's zone (4.d), the person's cap (4.b)
 *   and the language (6.f), and wrote the Correio line (3.a, `notification_id`). An empty answer
 *   means nobody is left now, never a batch that fell into the log.
 * - A claimed row never comes back, so every channel is recorded with
 *   `drive.record_partner_message_delivery`, accepted (`null`) or the code of the failure.
 * - Push (3.b): `push_kind = 'partner_message'`, consent only, the Correio row handed over, no image
 *   (7.g), silent (Android channel `partner_messages`, iOS `passive`).
 * - E-mail (3.c, 5.d, 6.c): sender of the Tuggi domain, replies to the Tuggi, the footer with why the
 *   person gets it, the stop link of that partner and the general unsubscribe, and the one-click
 *   `List-Unsubscribe` (RFC 8058). Links carry the `recipient_id` signed with HMAC
 *   (`unsubscribe-link.ts`), never an account id nor an address. The Apple relay rule
 *   (BR-COMUNICACAO-020 item 7) stays here, as for every tourist e-mail.
 * - The button of the e-mail goes through `/click`, which records the open (6.e: a click counts, a
 *   pixel does not) and redirects only to the URL signed into the link.
 *
 * Pure: client, `fetch` and the push sender come in. Logs carry counts and codes only: no address,
 * no account id, no recipient id (log without PII, CLAUDE.md §6).
 */
import { renderEmail, renderText } from './emailLayout.ts';
import { isApplePrivateRelayAddress, isRelayDomainVerified } from './newsletter-metrics.ts';
import {
  consentDate,
  fill,
  PARTNER_EMAIL_COPY,
  PARTNER_MESSAGE_ANDROID_CHANNEL,
  PARTNER_MESSAGE_FOOTER_VERSION,
  partnerMessageLang,
  type PartnerMessageLang,
} from './partner-message-copy.ts';
import { singleGateOutcome, type DriveRpc } from './push-gate.ts';
import { SERVICE_UNSUBSCRIBE, TOURIST_APP_LINK } from './tourist-email.ts';
import { buildUnsubscribeUrl, isOneClickProbe, signScopedId, stopLinkHeaders, verifyScopedId } from './unsubscribe-link.ts';

export const PARTNER_MESSAGE_PUSH_KIND = 'partner_message';
export const PARTNER_MESSAGE_TYPE = 'partner_message';

/** People claimed per call of the claim (its default, contract §11.3). */
export const CLAIM_LIMIT = 100;

/** People sent at the same time inside one claimed batch. */
const CONCURRENCY = 10;

/**
 * Stop claiming after this long. A claimed person is answered once, so a batch is always finished,
 * and the next job (every 15 minutes) takes who is left inside the window. The job waits 60 s for
 * the answer; the function itself may run longer, and nothing depends on the job reading it.
 */
export const ROUND_BUDGET_MS = 100_000;

/** The push lives until the end of the person's window (22h), a few hours after it leaves. */
const PUSH_TTL_SECONDS = 6 * 3600;

const RESEND_URL = 'https://api.resend.com/emails';

/** One row of `drive.claim_partner_message_recipients`. */
export interface PartnerMessageRecipient {
  recipient_id: string;
  message_id: string;
  user_id: string;
  client_id: string;
  partner_name: string;
  partner_handle: string;
  language: string;
  title: string;
  summary: string;
  subject: string;
  preheader: string | null;
  body: string;
  button_label: string;
  button_kind: string;
  button_ref: string | null;
  button_url: string | null;
  image_path: string | null;
  image_alt: string | null;
  notification_id: string;
  push: boolean;
  email: string | null;
  consent_at: string | null;
}

export interface PartnerEmailConfig {
  /** Resend key: the CMS slot `email.api_key`, or the project's `RESEND_API_KEY`. */
  apiKey: string;
  /** Display name Tuggi, address of the Tuggi domain (6.c). */
  from: string;
  /** Replies go to the Tuggi, never to the partner (6.c). */
  replyTo: string;
  /** Where `partner-message-send/stop` and `/click` live. */
  functionsUrl: string;
  /** Where the site's `/unsubscribe` page lives (the general unsubscribe, BR-COMUNICACAO-020 item 4). */
  siteUrl: string;
  /** Where the public bucket `partner-message-images` is served from (`<project_url>`). */
  storageUrl: string;
  /** `NEWSLETTER_SECRET`, the one secret of every unsubscribe link. */
  secret: string;
  relayDomainVerifiedRaw: string | null | undefined;
}

export interface PartnerMessageDeps {
  drive: DriveRpc;
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  /** `createPushSender(...).send`, in process, or a stand-in. */
  sendPush: (body: Record<string, unknown>, internal: { inboxRowId: string }) => Promise<{ status: number; body: unknown }>;
  /** `null` when there is no key or no secret: every e-mail is recorded as `not_configured`. */
  email: PartnerEmailConfig | null;
  log: (line: string) => void;
  limit?: number;
  budgetMs?: number;
  /** Milliseconds now; `Date.now` when absent. */
  clock?: () => number;
}

type Tally = { sent: number; failed: number };

export interface PartnerMessageReport {
  claimed: number;
  batches: number;
  push: Tally;
  email: Tally;
  /** The round stopped claiming on its time budget; the next job goes on. */
  out_of_time: boolean;
}

export class PartnerMessageClaimError extends Error {
  constructor(readonly code: string) {
    super(`claim_partner_message_recipients failed: ${code}`);
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecipient(value: unknown): value is PartnerMessageRecipient {
  const r = value as PartnerMessageRecipient | null;
  return (
    !!r &&
    typeof r.recipient_id === 'string' && UUID_RE.test(r.recipient_id) &&
    typeof r.user_id === 'string' &&
    typeof r.notification_id === 'string' &&
    typeof r.title === 'string' &&
    typeof r.summary === 'string' &&
    typeof r.body === 'string'
  );
}

/** Only a code reaches the database: `[A-Za-z0-9_.:-]`, up to 64 (contract §11.3 item 4). */
export function deliveryCode(raw: string): string {
  const clean = raw.replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 64);
  return clean || 'unknown';
}

async function record(deps: PartnerMessageDeps, r: PartnerMessageRecipient, channel: 'push' | 'email', error: string | null) {
  const { error: rpcError } = await deps.drive.rpc('record_partner_message_delivery', {
    p_recipient_id: r.recipient_id,
    p_channel: channel,
    p_error: error === null ? null : deliveryCode(error),
  });
  if (rpcError) deps.log(`[partner-message-send] record_partner_message_delivery failed: ${rpcError.code ?? 'unknown'}`);
}

/** The `/send` body of one partner push. No image (7.g), no sound (3.b), the Correio row rides along. */
export function partnerPushBody(r: PartnerMessageRecipient): Record<string, unknown> {
  return {
    type: 'user',
    userIds: [r.user_id],
    push_kind: PARTNER_MESSAGE_PUSH_KIND,
    notification: {
      title: r.title,
      body: r.summary,
      // The tap opens the message in the Correio: `notification_id` is added by the sender from
      // the handed-over row, the rest tells the app what it is. No link: the button lives inside.
      data: { type: PARTNER_MESSAGE_TYPE, message_id: r.message_id, client_id: r.client_id },
      silent: true,
      androidChannelId: PARTNER_MESSAGE_ANDROID_CHANNEL,
    },
    priority: 'normal',
    ttl: PUSH_TTL_SECONDS,
  };
}

/** The gate's outcome as the delivery code the database keeps; `null` = accepted by FCM. */
export function pushOutcomeCode(status: number, body: unknown): string | null {
  if (status < 200 || status >= 300) return `http_${status}`;
  switch (singleGateOutcome(body)) {
    case 'sent':
      return null;
    case 'denied':
    case 'inactive':
      return 'PUSH_NOT_ALLOWED';
    case 'gate_missing':
    case 'gate_error':
      return 'PUSH_GATE_UNAVAILABLE';
    case 'not_delivered':
      return 'NOT_DELIVERED';
    default:
      return 'unknown';
  }
}

async function pushOne(deps: PartnerMessageDeps, r: PartnerMessageRecipient): Promise<boolean> {
  let code: string | null;
  try {
    const answer = await deps.sendPush(partnerPushBody(r), { inboxRowId: r.notification_id });
    code = pushOutcomeCode(answer.status, answer.body);
  } catch {
    code = 'exception';
  }
  await record(deps, r, 'push', code);
  return code === null;
}

/**
 * Where the e-mail button lands. A website goes as recorded and approved; a `tuggi://` link has no
 * page a mail client can open, so it opens the app by our universal link, as the other tourist
 * e-mails do (`TOURIST_APP_LINK`).
 */
export function emailButtonTarget(buttonUrl: string | null): string {
  return buttonUrl && /^https?:\/\//i.test(buttonUrl.trim()) ? buttonUrl.trim() : TOURIST_APP_LINK;
}

export async function buildStopUrl(r: Pick<PartnerMessageRecipient, 'recipient_id'>, lang: PartnerMessageLang, config: PartnerEmailConfig) {
  const s = await signScopedId('partner_message', r.recipient_id, config.secret);
  const q = new URLSearchParams({ r: r.recipient_id.toLowerCase(), s, lang });
  return `${config.functionsUrl.replace(/\/$/, '')}/partner-message-send/stop?${q.toString()}`;
}

export async function buildClickUrl(r: Pick<PartnerMessageRecipient, 'recipient_id'>, target: string, config: PartnerEmailConfig) {
  const s = await signScopedId('partner_message_click', r.recipient_id, config.secret, target);
  const q = new URLSearchParams({ r: r.recipient_id.toLowerCase(), u: target, s });
  return `${config.functionsUrl.replace(/\/$/, '')}/partner-message-send/click?${q.toString()}`;
}

/** The public URL of the one image (7.g), or `undefined`. The path shape is checked by the database. */
function imageUrl(path: string | null, config: PartnerEmailConfig): string | undefined {
  if (!path) return undefined;
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return `${config.storageUrl.replace(/\/$/, '')}/storage/v1/object/public/partner-message-images/${encoded}`;
}

/**
 * The e-mail of one recipient, in the layout of every Tuggi e-mail. Every field the partner wrote
 * is escaped by the layout; the button URL only appears inside our signed click link.
 */
export async function renderPartnerMessageEmail(
  r: PartnerMessageRecipient,
  config: PartnerEmailConfig
): Promise<{ subject: string; html: string; text: string; headers: Record<string, string> } | null> {
  if (!r.email) return null;
  const lang = partnerMessageLang(r.language);
  const handle = r.partner_handle;
  const date = consentDate(r.consent_at, lang);
  const stopUrl = await buildStopUrl(r, lang, config);
  const clickUrl = await buildClickUrl(r, emailButtonTarget(r.button_url), config);
  const generalUrl = await buildUnsubscribeUrl(r.email, config.siteUrl, config.secret, lang);
  const why = date ? fill(PARTNER_EMAIL_COPY.footer_why[lang], { handle, date }) : '';
  const content = {
    subject: r.subject,
    preheader: r.preheader || r.summary,
    eyebrow: PARTNER_EMAIL_COPY.eyebrow[lang],
    hero_image_url: imageUrl(r.image_path, config),
    hero_alt: r.image_alt ?? '',
    // One paragraph per blank line; a single line break stays a line break.
    paragraphs: r.body.split(/\r?\n\s*\r?\n/),
    cta_label: r.button_label,
    cta_url: clickUrl,
  };
  const opts = {
    unsubscribeUrl: stopUrl,
    locale: lang,
    footerNote: [why, PARTNER_EMAIL_COPY.footer_reply[lang]].filter(Boolean).join('\n'),
    unsubscribeLabel: fill(PARTNER_EMAIL_COPY.footer_stop_partner[lang], { handle }),
    extraLinks: [{ label: SERVICE_UNSUBSCRIBE[lang], url: generalUrl }],
  };
  return {
    subject: r.subject,
    html: renderEmail(content, opts),
    text: renderText(content, opts),
    // RFC 8058: the header URL is `/stop` marked `o=1`; there only the one-click POST writes.
    headers: stopLinkHeaders(stopUrl),
  };
}

async function emailOne(deps: PartnerMessageDeps, r: PartnerMessageRecipient): Promise<boolean> {
  const config = deps.email;
  if (!config) {
    await record(deps, r, 'email', 'not_configured');
    return false;
  }
  // BR-COMUNICACAO-020 item 7: no relay address before the domain is registered with Apple.
  if (!isRelayDomainVerified(config.relayDomainVerifiedRaw) && isApplePrivateRelayAddress(r.email)) {
    await record(deps, r, 'email', 'apple_relay_unverified');
    return false;
  }
  const mail = await renderPartnerMessageEmail(r, config);
  if (!mail) {
    await record(deps, r, 'email', 'missing_fact');
    return false;
  }
  let code: string | null = null;
  try {
    const res = await deps.fetch(RESEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: config.from, to: [r.email], reply_to: config.replyTo, ...mail }),
    });
    const body = (await res.json().catch(() => null)) as { id?: unknown } | null;
    if (!res.ok || typeof body?.id !== 'string') code = `http_${res.status}`;
  } catch {
    code = 'network';
  }
  await record(deps, r, 'email', code);
  return code === null;
}

/** One person: push and e-mail, each on its own; one failing never stops the other. */
async function deliver(deps: PartnerMessageDeps, r: PartnerMessageRecipient, report: PartnerMessageReport) {
  if (r.push) {
    const ok = await pushOne(deps, r).catch(() => false);
    report.push[ok ? 'sent' : 'failed'] += 1;
  }
  if (r.email) {
    const ok = await emailOne(deps, r).catch(() => false);
    report.email[ok ? 'sent' : 'failed'] += 1;
  }
}

/** One round. Throws `PartnerMessageClaimError` when a claim fails; a channel failure never throws. */
export async function runPartnerMessageRound(deps: PartnerMessageDeps): Promise<PartnerMessageReport> {
  const clock = deps.clock ?? Date.now;
  const started = clock();
  const budget = deps.budgetMs ?? ROUND_BUDGET_MS;
  const report: PartnerMessageReport = {
    claimed: 0,
    batches: 0,
    push: { sent: 0, failed: 0 },
    email: { sent: 0, failed: 0 },
    out_of_time: false,
  };
  for (;;) {
    if (clock() - started >= budget) {
      report.out_of_time = true;
      break;
    }
    const { data, error } = await deps.drive.rpc('claim_partner_message_recipients', { p_limit: deps.limit ?? CLAIM_LIMIT });
    if (error) {
      deps.log(`[partner-message-send] ${JSON.stringify(report)}`);
      throw new PartnerMessageClaimError(error.code ?? 'unknown');
    }
    const rows = Array.isArray(data) ? data : [];
    if (rows.length === 0) break;
    report.batches += 1;
    report.claimed += rows.length;
    const recipients = rows.filter(isRecipient);
    if (recipients.length < rows.length) deps.log(`[partner-message-send] ${rows.length - recipients.length} malformed row(s) skipped`);
    for (let i = 0; i < recipients.length; i += CONCURRENCY) {
      await Promise.all(recipients.slice(i, i + CONCURRENCY).map((r) => deliver(deps, r, report)));
    }
  }
  deps.log(`[partner-message-send] ${JSON.stringify(report)}`);
  return report;
}

// ------------------------------------------------------------------ the HTTP surface

export interface PartnerMessageHttpDeps {
  /** The bearer is our machine key (`ef_secret_key`, presented by the job). */
  isMachineKey: (bearer: string) => boolean;
  /** `NEWSLETTER_SECRET`. Without it no link verifies. */
  secret: string;
  /** A drive client on the service role, made only when a request needs the database. */
  drive: () => DriveRpc;
  run: () => Promise<PartnerMessageReport>;
  log: (line: string) => void;
}

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const text = (body: string, status: number) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });

/**
 *   POST /             machine key only (the job, every 15 minutes) -> 200 report, 500 claim failed, 401
 *   GET|POST /stop?r=&s=&lang=   signed, public -> 200 the confirmation; 400 a link we did not sign;
 *                      404 the recipient is gone (account deleted); 500 the write failed.
 *                      GET is the footer link (one tap, no login); POST is RFC 8058 one-click.
 *                      GET with `o=1` is the header URL fetched by anti-spam: 200, writes nothing.
 *   GET /click?r=&u=&s=          signed, public -> 302 to `u`; 400 a link we did not sign.
 */
export async function handlePartnerMessageRequest(req: Request, deps: PartnerMessageHttpDeps): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/.*\/partner-message-send/, '') || '/';

  if (path === '/stop') {
    if (req.method !== 'GET' && req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    const lang = partnerMessageLang(url.searchParams.get('lang'));
    const recipient = await verifyScopedId('partner_message', url.searchParams.get('r'), url.searchParams.get('s'), deps.secret);
    if (!recipient) return json({ error: 'invalid_link' }, 400);
    if (isOneClickProbe(req, url)) return text(PARTNER_EMAIL_COPY.stop_header_get[lang], 200);
    const { data, error } = await deps.drive().rpc('stop_partner_messages_by_link', {
      p_recipient_id: recipient,
      p_text_version: PARTNER_MESSAGE_FOOTER_VERSION,
    });
    if (error) {
      deps.log(`[partner-message-send] stop failed: ${error.code ?? 'unknown'}`);
      return text(PARTNER_EMAIL_COPY.stop_error[lang], 500);
    }
    const answer = data as { partner_handle?: unknown } | null;
    if (!answer) return json({ error: 'link_not_found' }, 404);
    const handle = typeof answer.partner_handle === 'string' ? answer.partner_handle : '';
    return text(fill(PARTNER_EMAIL_COPY.stop_done[lang], { handle }), 200);
  }

  if (path === '/click') {
    if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
    const target = url.searchParams.get('u') ?? '';
    // Only http(s): what `emailButtonTarget` can produce. Anything else was not written by us.
    if (!/^https?:\/\//i.test(target)) return json({ error: 'invalid_link' }, 400);
    const recipient = await verifyScopedId('partner_message_click', url.searchParams.get('r'), url.searchParams.get('s'), deps.secret, target);
    if (!recipient) return json({ error: 'invalid_link' }, 400);
    // The open is a measure: a failed write is logged and the person still reaches the page.
    const { error } = await deps.drive().rpc('record_partner_message_email_click', { p_recipient_id: recipient });
    if (error) deps.log(`[partner-message-send] click not recorded: ${error.code ?? 'unknown'}`);
    return new Response(null, { status: 302, headers: { Location: target, 'Cache-Control': 'no-store' } });
  }

  if (path !== '/' && path !== '/run') return json({ error: 'not_found' }, 404);
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!deps.isMachineKey(bearer)) return json({ error: 'unauthorized' }, 401);
  try {
    return json(await deps.run(), 200);
  } catch (error) {
    const code = error instanceof PartnerMessageClaimError ? error.code : 'internal';
    deps.log(`[partner-message-send] round aborted: ${code}`);
    return json({ error: 'server_error' }, 500);
  }
}
