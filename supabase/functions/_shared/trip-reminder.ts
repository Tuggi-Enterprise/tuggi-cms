/**
 * The trip reminder (BR-COMUNICACAO-023, #1231): N days before and on the day, by push, e-mail and
 * message to the phone, all in the same run, each channel on its own (item 7).
 *
 * Contract `docs/contracts/viagem-marcada-e-lembrete.md`, Part 3 and "#1231 Edge Functions" item 1:
 * - `drive.claim_due_trip_reminders(p_limit)` credits the due trip hours, then claims the due
 *   reminders and returns what each needs. Claimed never comes back: every channel is recorded with
 *   `drive.record_message_send`, sent or failed, and that row is the proof (item 7: a failure is a
 *   line in the CMS log, never a notice to the tourist);
 * - the reminder was asked for (019 3.s): outside every cap and the quiet hours. The push kind is
 *   `trip_reminder`, requested, so the gate asks consent only;
 * - the e-mail carries its own stop link, scope `trip_reminder` (`unsubscribe-link.ts`), and the
 *   general unsubscribe stops it too (the database already leaves those addresses out);
 * - the phone goes down the ladder of `message-channels.ts`; with the channel unknown (confirmation
 *   off) the first reminder discovers it.
 *
 * Phase 2 (#1238, BR-MONETIZACAO-091 items 2.a, 5 and 9): every trip has its own reminders, so an
 * account with two trips gets two, each speaking of the hours credited to that trip. Hours are named
 * only when the payload carries `trip_hours` (the credit happened); a trip that got no hours, inside
 * the interval or overlapping a credited one, gets the reminder without any hours line.
 *
 * The tap opens `tuggi://map`. BR-COMUNICACAO-023 item 6 says the trip card, but the app has no link
 * to the card; the map is where the `copy` sends it (voz-do-push §3.7, amendment 4 to the `produto`).
 *
 * Pure: client, `fetch` and the push sender come in. Logs carry counts and codes only.
 */
import { renderEmail, renderText } from './emailLayout.ts';
import { channelOrder, sendByLadder } from './message-channels.ts';
import { isApplePrivateRelayAddress, isRelayDomainVerified } from './newsletter-metrics.ts';
import { ladderDeps, type MessageDeps } from './phone-confirmation.ts';
import { singleGateOutcome } from './push-gate.ts';
import { phoneVars, copyPieceOf, tripReminderEmail, tripReminderPush, type TripFacts, type TripPiece } from './trip-message-copy.ts';
import { TOURIST_APP_LINK } from './tourist-email.ts';
import { buildScopedStopUrl, unsubscribeHeaders } from './unsubscribe-link.ts';

export const TRIP_REMINDER_TYPE = 'trip_reminder';
export const TRIP_REMINDER_DEEPLINK = 'tuggi://map';

/**
 * Reminders claimed per run. A run every 15 minutes takes 200 an hour; a claimed reminder that the
 * run cannot finish is lost, so the batch stays well inside the wall clock.
 */
export const CLAIM_LIMIT = 50;

/** One element of `drive.claim_due_trip_reminders`. */
export interface DueReminder {
  trip_id: string;
  user_id: string;
  piece: TripPiece;
  trip_date: string;
  date_precision: 'day' | 'month';
  destination: { city: string | null; country_code: string } | null;
  language: string | null;
  language_base: string | null;
  push: boolean;
  email: string | null;
  phone: { phone_e164: string; channel: string | null; delivery_state: string | null; message_channels: string[] } | null;
  /** The grant of this trip, first reminder only. The one source of the amount a message says. */
  trip_hours: { minutes: number; expires_at: string } | null;
  /**
   * The length band (#1237). No message reads it, and the amount is never derived from it: the CMS
   * value of a band can change after the credit, `trip_hours` is what was granted.
   */
  duration_band?: 'short' | 'week' | 'long' | null;
}

export interface EmailConfig {
  /** Resend key: the CMS slot `email.api_key`, or the project's `RESEND_API_KEY`. */
  apiKey: string;
  from: string;
  /** Where `trip-reminder/stop` lives. */
  functionsUrl: string;
  /** `NEWSLETTER_SECRET`, the one secret of every unsubscribe link. */
  secret: string;
  relayDomainVerifiedRaw: string | null | undefined;
}

export interface TripReminderDeps extends MessageDeps {
  /** `createPushSender(...).send`, in process, or a stand-in. */
  sendPush: (body: Record<string, unknown>) => Promise<{ status: number; body: unknown }>;
  /** `null` when there is no key or no secret: the e-mail is recorded as not configured. */
  email: EmailConfig | null;
  now?: Date;
  /** Reminders to claim; `CLAIM_LIMIT` when absent. */
  limit?: number;
}

type ChannelTally = { sent: number; failed: number };

export interface TripReminderReport {
  claimed: number;
  push: ChannelTally;
  email: ChannelTally;
  phone: ChannelTally & { skipped_month: number };
}

export class TripReminderClaimError extends Error {
  constructor(readonly code: string) {
    super(`claim_due_trip_reminders failed: ${code}`);
  }
}

const RESEND_URL = 'https://api.resend.com/emails';

async function balanceOf(deps: TripReminderDeps, userId: string): Promise<number | null> {
  const { data, error } = await deps.drive.rpc('get_entitlement', { p_user_id: userId });
  if (error) return null;
  const row = (Array.isArray(data) ? data[0] : data) as { state?: unknown; balance_minutes?: unknown } | null;
  // `unlimited` has no hours to count: the day reminder without the balance (M5).
  if (!row || row.state === 'unlimited') return null;
  const minutes = Number(row.balance_minutes);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : 0;
}

async function record(
  deps: TripReminderDeps,
  r: DueReminder,
  channel: 'push' | 'email',
  outcome: 'sent' | 'failed',
  reason: string | null,
  providerMessageId: string | null
): Promise<void> {
  const { error } = await deps.drive.rpc('record_message_send', {
    p_user_id: r.user_id,
    p_piece: r.piece,
    p_channel: channel,
    p_outcome: outcome,
    p_reason: reason,
    p_provider_message_id: providerMessageId,
    p_phone_e164: null,
    p_trip_id: r.trip_id,
  });
  if (error) deps.log(`[trip-reminder] record_message_send failed: ${error.code ?? 'unknown'}`);
}

/** The one-person `/send` body of the reminder push, or `null` when a fact is missing. */
export function tripReminderSendBody(r: DueReminder, facts: TripFacts, now: Date): Record<string, unknown> | null {
  const push = tripReminderPush(facts, r.language, now);
  if (!push) return null;
  return {
    type: 'user',
    userIds: [r.user_id],
    push_kind: TRIP_REMINDER_TYPE,
    notification: {
      title: push.title,
      body: push.body,
      data: { type: TRIP_REMINDER_TYPE, deeplink: TRIP_REMINDER_DEEPLINK, piece: r.piece, variant: 'a' },
    },
    priority: 'high',
    // Sent at 10:00 local; a phone off for longer still gets it the same day.
    ttl: 6 * 3600,
  };
}

async function pushOne(deps: TripReminderDeps, r: DueReminder, facts: TripFacts, now: Date): Promise<boolean> {
  const body = tripReminderSendBody(r, facts, now);
  if (!body) {
    await record(deps, r, 'push', 'failed', 'missing_fact', null);
    return false;
  }
  let outcome = 'failed';
  try {
    const answer = await deps.sendPush(body);
    outcome = answer.status >= 200 && answer.status < 300 ? (singleGateOutcome(answer.body) ?? 'failed') : `http_${answer.status}`;
  } catch {
    outcome = 'exception';
  }
  const sent = outcome === 'sent';
  await record(deps, r, 'push', sent ? 'sent' : 'failed', sent ? null : outcome, null);
  return sent;
}

/** The reminder e-mail, rendered in the layout of every Tuggi e-mail, with its own stop link. */
export async function renderTripReminderEmail(
  r: DueReminder,
  facts: TripFacts,
  config: EmailConfig,
  now: Date
): Promise<{ subject: string; html: string; text: string; headers: Record<string, string> } | null> {
  const copy = tripReminderEmail(facts, r.language, now);
  if (!copy || !r.email) return null;
  const stopUrl = await buildScopedStopUrl('trip_reminder', r.email, config.functionsUrl, config.secret, copy.lang);
  const content = {
    subject: copy.subject,
    preheader: copy.paragraphs[1],
    paragraphs: [...copy.paragraphs, copy.detail],
    cta_label: copy.button,
    cta_url: TOURIST_APP_LINK,
  };
  const opts = {
    unsubscribeUrl: stopUrl,
    locale: copy.lang,
    utmCampaign: r.piece.replace(/_/g, '-'),
    footerNote: copy.footer,
    unsubscribeLabel: copy.stopLabel,
  };
  return {
    subject: copy.subject,
    html: renderEmail(content, opts),
    text: renderText(content, opts),
    // RFC 8058: the one-click POST lands on the same `trip-reminder/stop`, which answers POST.
    headers: unsubscribeHeaders(stopUrl),
  };
}

async function emailOne(deps: TripReminderDeps, r: DueReminder, facts: TripFacts, now: Date): Promise<boolean> {
  const config = deps.email;
  if (!config) {
    await record(deps, r, 'email', 'failed', 'not_configured', null);
    return false;
  }
  // BR-COMUNICACAO-020 item 7: no relay address before the domain is registered with Apple.
  if (!isRelayDomainVerified(config.relayDomainVerifiedRaw) && isApplePrivateRelayAddress(r.email ?? '')) {
    await record(deps, r, 'email', 'failed', 'apple_relay_unverified', null);
    return false;
  }
  const mail = await renderTripReminderEmail(r, facts, config, now);
  if (!mail) {
    await record(deps, r, 'email', 'failed', 'missing_fact', null);
    return false;
  }
  let reason: string | null = null;
  let id: string | null = null;
  try {
    const res = await deps.fetch(RESEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: config.from, to: [r.email], ...mail }),
    });
    const body = (await res.json().catch(() => null)) as { id?: unknown } | null;
    if (res.ok && typeof body?.id === 'string') id = body.id;
    else reason = `http_${res.status}`;
  } catch {
    reason = 'network';
  }
  await record(deps, r, 'email', id ? 'sent' : 'failed', reason, id);
  return id !== null;
}

async function phoneOne(deps: TripReminderDeps, r: DueReminder, facts: TripFacts, now: Date): Promise<boolean> {
  const phone = r.phone;
  if (!phone) return false;
  const channels = channelOrder(phone.channel, phone.message_channels);
  if (channels.length === 0) return false;
  const { lang, vars } = phoneVars(facts, r.language, now);
  const result = await sendByLadder(
    ladderDeps(deps, { userId: r.user_id, piece: r.piece, phoneE164: phone.phone_e164, tripId: r.trip_id }),
    phone.phone_e164,
    channels,
    { templatePiece: r.piece, copyPiece: copyPieceOf(facts), lang, languageBase: r.language_base, vars }
  );
  // The channel was unknown (confirmation off): this reminder is the discovery (contract, Part 3).
  if (!phone.channel && result.state) {
    const { error } = await deps.drive.rpc('set_phone_delivery_state', {
      p_user_id: r.user_id,
      p_phone_e164: phone.phone_e164,
      p_state: result.state,
      p_channel: null,
    });
    if (error) deps.log(`[trip-reminder] state not saved: ${error.code ?? 'unknown'}`);
  }
  return result.sent !== null;
}

function isReminder(value: unknown): value is DueReminder {
  const r = value as DueReminder | null;
  return (
    !!r &&
    typeof r.trip_id === 'string' &&
    typeof r.user_id === 'string' &&
    (r.piece === 'trip_reminder_before' || r.piece === 'trip_reminder_day') &&
    typeof r.trip_date === 'string'
  );
}

/** One run. Throws `TripReminderClaimError` when the claim fails; a channel failure never throws. */
export async function runTripReminders(deps: TripReminderDeps): Promise<TripReminderReport> {
  const now = deps.now ?? new Date();
  const { data, error } = await deps.drive.rpc('claim_due_trip_reminders', { p_limit: deps.limit ?? CLAIM_LIMIT });
  if (error) throw new TripReminderClaimError(error.code ?? 'unknown');
  const reminders = (Array.isArray(data) ? data : []).filter(isReminder);
  const report: TripReminderReport = {
    claimed: reminders.length,
    push: { sent: 0, failed: 0 },
    email: { sent: 0, failed: 0 },
    phone: { sent: 0, failed: 0, skipped_month: 0 },
  };

  for (const r of reminders) {
    const facts: TripFacts = {
      piece: r.piece,
      trip_date: r.trip_date,
      date_precision: r.date_precision === 'month' ? 'month' : 'day',
      destination: r.destination,
      trip_hours: r.trip_hours,
      balance_minutes: r.piece === 'trip_reminder_day' ? await balanceOf(deps, r.user_id).catch(() => null) : null,
    };
    // Item 7: each channel on its own; one throwing does not stop the next.
    if (r.push) {
      const ok = await pushOne(deps, r, facts, now).catch(() => false);
      report.push[ok ? 'sent' : 'failed'] += 1;
    }
    if (r.email) {
      const ok = await emailOne(deps, r, facts, now).catch(() => false);
      report.email[ok ? 'sent' : 'failed'] += 1;
    }
    if (r.phone) {
      // The approved models of the day say "today" (§9.c, §9.d); a month-only trip has none.
      if (r.piece === 'trip_reminder_day' && facts.date_precision === 'month') {
        report.phone.skipped_month += 1;
      } else {
        const ok = await phoneOne(deps, r, facts, now).catch(() => false);
        report.phone[ok ? 'sent' : 'failed'] += 1;
      }
    }
  }
  deps.log(`[trip-reminder] ${JSON.stringify(report)}`);
  return report;
}
