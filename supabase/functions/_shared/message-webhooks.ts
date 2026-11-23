/**
 * The provider webhooks of the phone messages (BR-COMUNICACAO-024 items 5 and 7, #1231): delivery
 * statuses and stop replies, from the WhatsApp Cloud API (`whatsapp-webhook`) and Twilio
 * (`sms-webhook`). Contract `docs/contracts/viagem-marcada-e-lembrete.md`, #1231 item 3.
 *
 * - Nothing is read before the signature holds: Meta signs the raw body with the app secret
 *   (`X-Hub-Signature-256: sha256=<hex HMAC-SHA256>`); Twilio signs the URL it called plus the
 *   POST parameters sorted by name, each name followed by its value (`X-Twilio-Signature`, base64
 *   HMAC-SHA1 with the auth token; the algorithm of Twilio's own validator).
 * - A status moves the send forward only (`record_message_status`). For the confirmation it also
 *   settles the phone: delivered confirms the channel; WhatsApp 131026 goes down to SMS when SMS is
 *   on, else "no channel"; the last channel refusing the number is "undeliverable".
 * - A stop reply stops the number on every account (`stop_phone_messages_by_reply`), at once.
 * - The provider's error becomes its code; no number, no secret in a log.
 *
 * Pure: client and `fetch` come in.
 */
import { constantTimeEqual } from './constant-time.ts';
import { isNumberProblem, sendByLadder, WHATSAPP_UNDELIVERABLE, type PhoneChannel } from './message-channels.ts';
import { ladderDeps, type MessageDeps, type PhoneContact } from './phone-confirmation.ts';
import { normalizeCopyLang, type RankingCopyLang } from './ranking-comm-i18n.ts';
import { isStopReply } from './trip-message-copy.ts';

const enc = new TextEncoder();

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmac(hash: 'SHA-256' | 'SHA-1', secret: string, data: string): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash }, false, ['sign']);
  return crypto.subtle.sign('HMAC', key, enc.encode(data));
}

/** Meta: `sha256=` + hex HMAC-SHA256 of the raw body with the app secret. */
export async function verifyMetaSignature(rawBody: string, header: string | null, appSecret: string | undefined): Promise<boolean> {
  if (!header || !appSecret || !header.startsWith('sha256=')) return false;
  const expected = `sha256=${hex(await hmac('SHA-256', appSecret, rawBody))}`;
  return constantTimeEqual(expected, header);
}

/** Twilio: base64 HMAC-SHA1 of the URL plus every POST parameter, sorted by name, name then value. */
export async function twilioSignature(url: string, params: Record<string, string>, authToken: string): Promise<string> {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  const bytes = new Uint8Array(await hmac('SHA-1', authToken, data));
  return btoa(String.fromCharCode(...bytes));
}

export async function verifyTwilioSignature(
  url: string,
  params: Record<string, string>,
  header: string | null,
  authToken: string | undefined
): Promise<boolean> {
  if (!header || !authToken) return false;
  return constantTimeEqual(await twilioSignature(url, params, authToken), header);
}

export type DeliveryOutcome = 'sent' | 'delivered' | 'failed';

export interface StatusUpdate {
  providerMessageId: string;
  outcome: DeliveryOutcome;
  code: string | null;
}

export interface InboundReply {
  /** E.164 with the `+`. */
  from: string;
  text: string;
}

const CODE_RE = /^[A-Za-z0-9_]{1,40}$/;
const code = (v: unknown): string | null => {
  const s = v === undefined || v === null ? '' : String(v);
  return CODE_RE.test(s) ? s : null;
};
const e164 = (v: unknown): string | null => {
  const digits = String(v ?? '').replace(/[^0-9]/g, '');
  return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
};

/** `entry[].changes[].value.statuses[]` and `.messages[]` of a Cloud API notification. */
export function parseWhatsappNotification(body: unknown): { statuses: StatusUpdate[]; replies: InboundReply[] } {
  const statuses: StatusUpdate[] = [];
  const replies: InboundReply[] = [];
  const entries = (body as { entry?: unknown[] } | null)?.entry;
  for (const entry of Array.isArray(entries) ? entries : []) {
    const changes = (entry as { changes?: unknown[] })?.changes;
    for (const change of Array.isArray(changes) ? changes : []) {
      const value = (change as { value?: Record<string, unknown> })?.value ?? {};
      for (const s of Array.isArray(value.statuses) ? value.statuses : []) {
        const st = s as { id?: unknown; status?: unknown; errors?: { code?: unknown }[] };
        const outcome: DeliveryOutcome | null =
          st.status === 'delivered' || st.status === 'read' ? 'delivered' : st.status === 'failed' ? 'failed' : st.status === 'sent' ? 'sent' : null;
        if (typeof st.id === 'string' && st.id && outcome) {
          statuses.push({ providerMessageId: st.id, outcome, code: code(st.errors?.[0]?.code) });
        }
      }
      for (const m of Array.isArray(value.messages) ? value.messages : []) {
        const msg = m as { from?: unknown; text?: { body?: unknown }; button?: { text?: unknown; payload?: unknown }; interactive?: { button_reply?: { title?: unknown } } };
        const from = e164(msg.from);
        const text = msg.text?.body ?? msg.button?.text ?? msg.button?.payload ?? msg.interactive?.button_reply?.title;
        if (from && typeof text === 'string') replies.push({ from, text });
      }
    }
  }
  return { statuses, replies };
}

/** Twilio status callback: `MessageSid`, `MessageStatus`, `ErrorCode`. */
export function parseTwilioStatus(params: Record<string, string>): StatusUpdate | null {
  const id = params.MessageSid ?? params.SmsSid;
  const status = params.MessageStatus ?? params.SmsStatus;
  const outcome: DeliveryOutcome | null =
    status === 'delivered' ? 'delivered' : status === 'undelivered' || status === 'failed' ? 'failed' : status ? 'sent' : null;
  return id && outcome ? { providerMessageId: id, outcome, code: code(params.ErrorCode) } : null;
}

/** Twilio inbound message: `From`, `Body`. */
export function parseTwilioInbound(params: Record<string, string>): InboundReply | null {
  const from = e164(params.From);
  return from && typeof params.Body === 'string' ? { from, text: params.Body } : null;
}

/** The language of a stop answer when only the number is known: by the country code, else English. */
export function languageOfNumber(phone: string): RankingCopyLang {
  const prefixes: [string, RankingCopyLang][] = [
    ['+55', 'pt'],
    ['+351', 'pt'],
    ['+34', 'es'],
    ['+33', 'fr'],
    ['+39', 'it'],
    ['+49', 'de'],
    ['+52', 'es'],
    ['+54', 'es'],
  ];
  return prefixes.find(([p]) => phone.startsWith(p))?.[1] ?? 'en';
}

export interface StatusReport {
  found: boolean;
  changed: boolean;
  /** What the confirmation became, when this status settled it. */
  settled: 'confirmed' | 'no_channel' | 'undeliverable' | 'fallback_sms' | null;
}

async function setState(deps: MessageDeps, contact: PhoneContact, state: string, channel: PhoneChannel | null): Promise<void> {
  const { error } = await deps.drive.rpc('set_phone_delivery_state', {
    p_user_id: contact.user_id,
    p_phone_e164: contact.phone_e164,
    p_state: state,
    p_channel: channel,
  });
  if (error) deps.log(`[message-webhook] state not saved: ${error.code ?? 'unknown'}`);
}

/**
 * Applies one provider status. Only a change of a confirmation settles the phone; a repeated or
 * late webhook changes nothing (`record_message_status` moves forward only).
 */
export async function applyStatus(deps: MessageDeps, channel: PhoneChannel, update: StatusUpdate): Promise<StatusReport> {
  const { data, error } = await deps.drive.rpc('record_message_status', {
    p_channel: channel,
    p_provider_message_id: update.providerMessageId,
    p_outcome: update.outcome,
    p_reason: update.code,
  });
  if (error) {
    deps.log(`[message-webhook] record_message_status failed: ${error.code ?? 'unknown'}`);
    return { found: false, changed: false, settled: null };
  }
  const row = data as { found?: boolean; changed?: boolean; user_id?: string | null; piece?: string } | null;
  const report: StatusReport = { found: row?.found === true, changed: row?.changed === true, settled: null };
  if (!report.changed || row?.piece !== 'phone_confirmation' || !row.user_id) return report;

  const { data: c, error: contactError } = await deps.drive.rpc('get_phone_contact', { p_user_id: row.user_id });
  const contact = c as PhoneContact | null;
  if (contactError || !contact || contact.stopped || typeof contact.phone_e164 !== 'string') return report;

  if (update.outcome === 'delivered') {
    await setState(deps, contact, 'confirmed', channel);
    return { ...report, settled: 'confirmed' };
  }
  if (update.outcome !== 'failed') return report;

  const smsOn = Array.isArray(contact.message_channels) && contact.message_channels.includes('sms');
  if (channel === 'whatsapp' && update.code === WHATSAPP_UNDELIVERABLE) {
    if (!smsOn) {
      await setState(deps, contact, 'no_channel', null);
      return { ...report, settled: 'no_channel' };
    }
    // Item 5: the number is not on WhatsApp, so the confirmation goes by SMS, once.
    const result = await sendByLadder(
      ladderDeps(deps, { userId: contact.user_id, piece: 'phone_confirmation', phoneE164: contact.phone_e164, tripId: null }),
      contact.phone_e164,
      ['sms'],
      { templatePiece: 'phone_confirmation', copyPiece: 'M1', lang: normalizeCopyLang(contact.language), languageBase: contact.language_base, vars: {} }
    );
    if (result.state) await setState(deps, contact, 'undeliverable', null);
    return { ...report, settled: result.sent ? 'fallback_sms' : result.state ? 'undeliverable' : null };
  }
  // The last rung refused the number: the app asks to check it. Any other failure blames nobody.
  const lastRung = channel === 'sms' || !smsOn;
  if (lastRung && isNumberProblem(channel, update.code)) {
    await setState(deps, contact, 'undeliverable', null);
    return { ...report, settled: 'undeliverable' };
  }
  return report;
}

/** A reply that is a stop word stops the number on every account. Returns whether it was a stop. */
export async function applyReply(deps: MessageDeps, reply: InboundReply): Promise<boolean> {
  if (!isStopReply(reply.text)) return false;
  const { error } = await deps.drive.rpc('stop_phone_messages_by_reply', { p_phone_e164: reply.from });
  if (error) {
    deps.log(`[message-webhook] stop failed: ${error.code ?? 'unknown'}`);
    return false;
  }
  return true;
}

/** `application/x-www-form-urlencoded` into a flat record, the last value of a repeated name winning. */
export function formParams(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(raw)) out[k] = v;
  return out;
}
