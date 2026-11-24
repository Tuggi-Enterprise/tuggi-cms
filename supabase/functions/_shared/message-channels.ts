/**
 * The message channels to the phone (BR-COMUNICACAO-024): the WhatsApp Cloud API and SMS (Twilio,
 * the `dev`'s choice by market practice, item 12), and the ladder that tries them in the order the
 * server gives (`message_channels`, WhatsApp then SMS). #1231.
 *
 * Both channels ship built and switched off (no WhatsApp account, no SMS provider, operator
 * 2026-11-23): nothing here runs until the CMS turns a `channel.*` switch on and fills the secrets.
 *
 * - Secrets come from `drive.get_provider_secrets(channel)` and are passed in; they never reach a
 *   log, an error or a return value (security-reviewer, #1230, condition 3).
 * - A provider error becomes its CODE and nothing else (`131026`, `21211`), because the provider's
 *   text can carry the number (condition 4). `record_message_send` cleans digits again on its side.
 * - WhatsApp sends only approved models, by the name the CMS stores per language (item 8). A model
 *   never carries what a person typed (condition 2): the parameters are numbers and dates.
 *
 * Pure: `fetch` is passed in, no remote import, no `Deno` global.
 */
import type { CopyPiece, PhoneVars } from './trip-message-copy.ts';
import { smsText, whatsappParameters } from './trip-message-copy.ts';
import type { RankingCopyLang } from './ranking-comm-i18n.ts';

export type PhoneChannel = 'whatsapp' | 'sms';
export const PHONE_CHANNELS: readonly PhoneChannel[] = ['whatsapp', 'sms'];

export function isPhoneChannel(value: unknown): value is PhoneChannel {
  return value === 'whatsapp' || value === 'sms';
}

/** The pieces a WhatsApp model exists for (`drive.message_templates.piece`). */
export type TemplatePiece = 'phone_confirmation' | 'trip_reminder_before' | 'trip_reminder_day';

/** `drive.record_message_send.p_piece`. */
export type MessagePiece = TemplatePiece | 'test';

/** The Graph API version the Cloud API is called with; the same as the Tempora's. */
export const GRAPH_API_VERSION = 'v26.0';

/**
 * Cloud API error 131026, "Message undeliverable", whose reasons include "The recipient phone number
 * is not a WhatsApp phone number" (error codes page, consulted 2026-11-23). It may come in the send
 * answer or in the status webhook, so both read it.
 */
export const WHATSAPP_UNDELIVERABLE = '131026';

/**
 * Codes that say the NUMBER cannot be reached on that channel, as opposed to our configuration or a
 * passing failure: only these may lead to "check your number" (BR-COMUNICACAO-024 item 5) or to "no
 * channel" (item 6). Twilio: 21211 invalid `To`, 21614 not a mobile, 21610 the number replied STOP
 * to us, 30003 unreachable, 30005 unknown, 30006 landline (Twilio error dictionary).
 */
export const NUMBER_PROBLEM_CODES: Readonly<Record<PhoneChannel, readonly string[]>> = {
  whatsapp: [WHATSAPP_UNDELIVERABLE],
  sms: ['21211', '21614', '21610', '30003', '30005', '30006'],
};

export function isNumberProblem(channel: PhoneChannel, code: string | null): boolean {
  return code !== null && NUMBER_PROBLEM_CODES[channel].includes(code);
}

export interface ProviderSend {
  outcome: 'sent' | 'failed';
  providerMessageId: string | null;
  /** The provider error code, or one of ours (`not_configured`, `no_template`, `network`, `http_<status>`). */
  reason: string | null;
}

type Secrets = Record<string, string | undefined>;

const CODE_RE = /^[A-Za-z0-9_]{1,40}$/;

/** The code of an error answer, never its text. */
function errorCode(body: unknown, status: number, channel: PhoneChannel): string {
  const raw =
    channel === 'whatsapp'
      ? (body as { error?: { code?: unknown } } | null)?.error?.code
      : (body as { code?: unknown } | null)?.code;
  const code = raw === undefined || raw === null ? '' : String(raw);
  return CODE_RE.test(code) ? code : `http_${status}`;
}

export interface WhatsappTemplateMessage {
  to: string;
  templateName: string;
  /** The code Meta expects (`pt_BR`, `en_US`, `fr`). */
  languageCode: string;
  parameters: string[];
}

/**
 * One model by the Cloud API: `POST /{phone-number-id}/messages` with `type: template`. The answer
 * carries `messages[0].id` (the `wamid`), which the status webhook names.
 */
export async function sendWhatsappTemplate(
  fetchImpl: typeof fetch,
  secrets: Secrets,
  msg: WhatsappTemplateMessage
): Promise<ProviderSend> {
  const token = secrets['whatsapp.access_token'];
  const phoneNumberId = secrets['whatsapp.phone_number_id'];
  if (!token || !phoneNumberId) return { outcome: 'failed', providerMessageId: null, reason: 'not_configured' };
  const template: Record<string, unknown> = { name: msg.templateName, language: { code: msg.languageCode } };
  if (msg.parameters.length > 0) {
    template.components = [{ type: 'body', parameters: msg.parameters.map((text) => ({ type: 'text', text })) }];
  }
  let res: Response;
  try {
    res = await fetchImpl(`https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(phoneNumberId)}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: msg.to.replace(/^\+/, ''),
        type: 'template',
        template,
      }),
    });
  } catch {
    return { outcome: 'failed', providerMessageId: null, reason: 'network' };
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) return { outcome: 'failed', providerMessageId: null, reason: errorCode(body, res.status, 'whatsapp') };
  const id = (body as { messages?: { id?: unknown }[] } | null)?.messages?.[0]?.id;
  return typeof id === 'string' && id
    ? { outcome: 'sent', providerMessageId: id, reason: null }
    : { outcome: 'failed', providerMessageId: null, reason: 'no_message_id' };
}

/**
 * A free text on WhatsApp: only inside the 24 h window a message of the person opens (the answer to
 * a stop reply, §9.c). Nothing else uses it: outside the window only models go.
 */
export async function sendWhatsappText(fetchImpl: typeof fetch, secrets: Secrets, to: string, text: string): Promise<ProviderSend> {
  const token = secrets['whatsapp.access_token'];
  const phoneNumberId = secrets['whatsapp.phone_number_id'];
  if (!token || !phoneNumberId) return { outcome: 'failed', providerMessageId: null, reason: 'not_configured' };
  try {
    const res = await fetchImpl(`https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(phoneNumberId)}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: to.replace(/^\+/, ''), type: 'text', text: { body: text } }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) return { outcome: 'failed', providerMessageId: null, reason: errorCode(body, res.status, 'whatsapp') };
    const id = (body as { messages?: { id?: unknown }[] } | null)?.messages?.[0]?.id;
    return { outcome: 'sent', providerMessageId: typeof id === 'string' ? id : null, reason: null };
  } catch {
    return { outcome: 'failed', providerMessageId: null, reason: 'network' };
  }
}

export interface SmsMessage {
  to: string;
  body: string;
  /** Where Twilio posts the delivery status (`sms-webhook`). */
  statusCallback?: string;
}

/**
 * One SMS by Twilio: `POST /2010-04-01/Accounts/{sid}/Messages.json`, Basic auth with the account
 * SID and the auth token. `sms.sender` is a number (`+1...`) or a Messaging Service (`MG...`).
 */
export async function sendTwilioSms(fetchImpl: typeof fetch, secrets: Secrets, msg: SmsMessage): Promise<ProviderSend> {
  const sid = secrets['sms.account_id'];
  const token = secrets['sms.auth_token'];
  const sender = secrets['sms.sender'];
  if (!sid || !token || !sender) return { outcome: 'failed', providerMessageId: null, reason: 'not_configured' };
  const form = new URLSearchParams({ To: msg.to, Body: msg.body });
  if (/^MG[0-9a-f]{32}$/i.test(sender)) form.set('MessagingServiceSid', sender);
  else form.set('From', sender);
  if (msg.statusCallback) form.set('StatusCallback', msg.statusCallback);
  let res: Response;
  try {
    res = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${sid}:${token}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });
  } catch {
    return { outcome: 'failed', providerMessageId: null, reason: 'network' };
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) return { outcome: 'failed', providerMessageId: null, reason: errorCode(body, res.status, 'sms') };
  const id = (body as { sid?: unknown } | null)?.sid;
  return typeof id === 'string' && id
    ? { outcome: 'sent', providerMessageId: id, reason: null }
    : { outcome: 'failed', providerMessageId: null, reason: 'no_message_id' };
}

/** One row of `cms_get_trip_settings().templates`. */
export interface MessageTemplate {
  channel: string;
  piece: string;
  language: string;
  template_name: string;
  provider_language: string;
}

/** The model for this piece in the person's language, else in English, else none. */
export function pickTemplate(
  templates: readonly MessageTemplate[],
  channel: PhoneChannel,
  piece: TemplatePiece,
  languageBase: string | null
): MessageTemplate | null {
  const of = (lang: string) =>
    templates.find((t) => t.channel === channel && t.piece === piece && t.language === lang && t.template_name) ?? null;
  return of(String(languageBase ?? '').toLowerCase()) ?? of('en');
}

export interface PhoneMessage {
  /** Which model of the CMS (WhatsApp). */
  templatePiece: TemplatePiece;
  /** Which text of §9 (SMS) and which parameters (WhatsApp). */
  copyPiece: CopyPiece;
  lang: RankingCopyLang;
  /** `drive.profiles.language` reduced to its base, as the models are stored. */
  languageBase: string | null;
  vars: Partial<PhoneVars>;
}

export interface LadderAttempt {
  channel: PhoneChannel;
  outcome: 'sent' | 'failed';
  reason: string | null;
  providerMessageId: string | null;
}

export interface LadderDeps {
  fetch: typeof fetch;
  /** `drive.get_provider_secrets(channel)`; `{}` when none is configured. */
  secrets: (channel: PhoneChannel) => Promise<Secrets>;
  templates: () => Promise<readonly MessageTemplate[]>;
  /** `drive.record_message_send` for one attempt. Sucess is proved by this row. */
  record: (attempt: LadderAttempt) => Promise<void>;
  /** The status webhook of the SMS (Twilio `StatusCallback`). */
  smsStatusCallback?: string;
}

/**
 * What the phone's delivery state should become after a ladder:
 * - `null`: a channel accepted the message (only "sent": the webhook says delivered or failed, and
 *   a message only sent WAITS, without a second send, item 5), or a failure was ours (no secret, no
 *   model, the network), which says nothing about the number;
 * - `no_channel`: the only channels on are WhatsApp and it said the number is not on it (item 6);
 * - `undeliverable`: every channel refused the number (item 5: the app asks to check it).
 */
export type LadderState = 'no_channel' | 'undeliverable' | null;

export interface LadderResult {
  sent: PhoneChannel | null;
  attempts: LadderAttempt[];
  state: LadderState;
}

export function stateAfterFailures(attempts: readonly LadderAttempt[]): LadderState {
  if (attempts.length === 0 || attempts.some((a) => a.outcome === 'sent')) return null;
  if (!attempts.every((a) => isNumberProblem(a.channel, a.reason))) return null;
  return attempts.every((a) => a.channel === 'whatsapp') ? 'no_channel' : 'undeliverable';
}

async function sendOne(deps: LadderDeps, channel: PhoneChannel, to: string, message: PhoneMessage): Promise<ProviderSend> {
  const secrets = await deps.secrets(channel).catch(() => ({}) as Secrets);
  if (channel === 'whatsapp') {
    const templates = await deps.templates().catch(() => [] as MessageTemplate[]);
    const template = pickTemplate(templates, 'whatsapp', message.templatePiece, message.languageBase);
    if (!template) return { outcome: 'failed', providerMessageId: null, reason: 'no_template' };
    const parameters = whatsappParameters(message.copyPiece, message.vars);
    if (!parameters) return { outcome: 'failed', providerMessageId: null, reason: 'missing_fact' };
    return sendWhatsappTemplate(deps.fetch, secrets, {
      to,
      templateName: template.template_name,
      languageCode: template.provider_language,
      parameters,
    });
  }
  const body = smsText(message.copyPiece, message.lang, message.vars);
  if (!body) return { outcome: 'failed', providerMessageId: null, reason: 'missing_fact' };
  return sendTwilioSms(deps.fetch, secrets, { to, body, statusCallback: deps.smsStatusCallback });
}

/**
 * Tries the channels in order and stops at the first that accepts. Every attempt is recorded,
 * accepted or not. A refusal moves to the next channel at once: nothing left, so nothing doubles.
 */
export async function sendByLadder(
  deps: LadderDeps,
  phoneE164: string,
  channels: readonly PhoneChannel[],
  message: PhoneMessage
): Promise<LadderResult> {
  const attempts: LadderAttempt[] = [];
  for (const channel of channels) {
    let result: ProviderSend;
    try {
      result = await sendOne(deps, channel, phoneE164, message);
    } catch {
      result = { outcome: 'failed', providerMessageId: null, reason: 'internal' };
    }
    const attempt: LadderAttempt = { channel, ...result };
    attempts.push(attempt);
    try {
      await deps.record(attempt);
    } catch {
      // The send stands; the missing row is the caller's log line, never a second send.
    }
    if (result.outcome === 'sent') return { sent: channel, attempts, state: null };
  }
  return { sent: null, attempts, state: stateAfterFailures(attempts) };
}

/** The channels to try, in the server's order: the one already found first, when it is still on. */
export function channelOrder(known: unknown, messageChannels: unknown): PhoneChannel[] {
  const on = (Array.isArray(messageChannels) ? messageChannels : []).filter(isPhoneChannel);
  if (isPhoneChannel(known) && on.includes(known)) return [known];
  return on;
}
