/**
 * "Send a test to me" of the CMS (BR-COMUNICACAO-024 item 9, #1231, called by the screen of #1233):
 * one message of one piece, by one channel, to the e-mail and the phone of the admin who is signed
 * in, recorded with `p_piece = 'test'` so the send log shows the result.
 *
 * - The admin is the user of the access token the CMS server forwards (the pattern of
 *   `lib/services/portal-transition-email.ts`), checked against `core.cms_users` the way
 *   `drive.assert_cms_admin` checks `p_actor`: active, role `admin`, matched by e-mail. Exact match,
 *   never a pattern: `_` in an address is a wildcard to `ilike`.
 * - The switches are not read: the test exists to try a channel before turning it on. Only the
 *   secrets and the models are needed.
 * - The facts are a sample (a trip in 7 days to Lisboa, 1 h of trip hours, 1 h 30 min of balance),
 *   so the admin sees the real copy with real numbers.
 *
 * Pure: client, `fetch` and the push sender come in. Logs carry codes only.
 */
import { channelOrder, isPhoneChannel, sendByLadder, type TemplatePiece } from './message-channels.ts';
import { ladderDeps, type MessageDeps } from './phone-confirmation.ts';
import { singleGateOutcome } from './push-gate.ts';
import { copyPieceOf, phoneVars, type TripFacts } from './trip-message-copy.ts';
import { renderTripReminderEmail, tripReminderSendBody, type DueReminder, type EmailConfig } from './trip-reminder.ts';

export const TEST_CHANNELS = ['push', 'email', 'whatsapp', 'sms'] as const;
export type TestChannel = (typeof TEST_CHANNELS)[number];
export const TEST_PIECES: readonly TemplatePiece[] = ['phone_confirmation', 'trip_reminder_before', 'trip_reminder_day'];

export interface TestRequest {
  piece: TemplatePiece;
  channel: TestChannel;
}

/** The body, or `null` for anything else. */
export function parseTestRequest(body: unknown): TestRequest | null {
  const b = body as { piece?: unknown; channel?: unknown } | null;
  const piece = TEST_PIECES.find((p) => p === b?.piece);
  const channel = TEST_CHANNELS.find((c) => c === b?.channel);
  return piece && channel ? { piece, channel } : null;
}

export interface TestAdmin {
  /** `auth.users.id`, where a test push goes. */
  userId: string;
  email: string;
  phone: string | null;
  language: string | null;
}

export interface TestResult {
  ok: boolean;
  channel: TestChannel;
  error_code?: string;
}

export interface TestDeps extends MessageDeps {
  sendPush: (body: Record<string, unknown>) => Promise<{ status: number; body: unknown }>;
  email: EmailConfig | null;
  now?: Date;
}

const DAY_MS = 86_400_000;

/** The sample reminder, in the admin's language. */
export function sampleReminder(piece: TemplatePiece, admin: TestAdmin, now: Date): { reminder: DueReminder; facts: TripFacts } {
  const tripDate = new Date(now.getTime() + 7 * DAY_MS).toISOString().slice(0, 10);
  const tripPiece = piece === 'trip_reminder_day' ? 'trip_reminder_day' : 'trip_reminder_before';
  const tripHours = { minutes: 60, expires_at: new Date(now.getTime() + 60 * DAY_MS).toISOString() };
  const reminder: DueReminder = {
    trip_id: '00000000-0000-0000-0000-000000000000',
    user_id: admin.userId,
    piece: tripPiece,
    trip_date: tripDate,
    date_precision: 'day',
    destination: { city: 'Lisboa', country_code: 'PT' },
    language: admin.language,
    language_base: (admin.language ?? 'pt').slice(0, 2).toLowerCase(),
    push: true,
    email: admin.email,
    phone: null,
    trip_hours: tripPiece === 'trip_reminder_before' ? tripHours : null,
  };
  const facts: TripFacts = {
    piece: tripPiece,
    trip_date: tripDate,
    date_precision: 'day',
    destination: reminder.destination,
    trip_hours: reminder.trip_hours,
    balance_minutes: tripPiece === 'trip_reminder_day' ? 90 : null,
  };
  return { reminder, facts };
}

async function recordTest(
  deps: TestDeps,
  channel: TestChannel,
  outcome: 'sent' | 'failed',
  reason: string | null,
  providerMessageId: string | null
): Promise<void> {
  const { error } = await deps.drive.rpc('record_message_send', {
    p_user_id: null,
    p_piece: 'test',
    p_channel: channel,
    p_outcome: outcome,
    p_reason: reason,
    p_provider_message_id: providerMessageId,
    p_phone_e164: null,
    p_trip_id: null,
  });
  if (error) deps.log(`[trip-message-test] record_message_send failed: ${error.code ?? 'unknown'}`);
}

export async function sendTestMessage(deps: TestDeps, admin: TestAdmin, req: TestRequest): Promise<TestResult> {
  const now = deps.now ?? new Date();
  const { reminder, facts } = sampleReminder(req.piece, admin, now);
  const fail = async (code: string): Promise<TestResult> => {
    await recordTest(deps, req.channel, 'failed', code, null);
    return { ok: false, channel: req.channel, error_code: code };
  };

  if (req.channel === 'push' || req.channel === 'email') {
    // The confirmation exists only on the phone: it is what discovers the channel (§9).
    if (req.piece === 'phone_confirmation') return { ok: false, channel: req.channel, error_code: 'piece_not_on_channel' };
    if (req.channel === 'push') {
      const body = tripReminderSendBody(reminder, facts);
      if (!body) return fail('missing_fact');
      try {
        const answer = await deps.sendPush(body);
        const outcome = answer.status >= 200 && answer.status < 300 ? singleGateOutcome(answer.body) ?? 'failed' : `http_${answer.status}`;
        if (outcome !== 'sent') return fail(outcome);
      } catch {
        return fail('exception');
      }
      await recordTest(deps, 'push', 'sent', null, null);
      return { ok: true, channel: 'push' };
    }
    if (!deps.email) return fail('not_configured');
    const mail = await renderTripReminderEmail(reminder, facts, deps.email);
    if (!mail) return fail('missing_fact');
    try {
      const res = await deps.fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${deps.email.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: deps.email.from, to: [admin.email], ...mail }),
      });
      const out = (await res.json().catch(() => null)) as { id?: unknown } | null;
      if (!res.ok || typeof out?.id !== 'string') return fail(`http_${res.status}`);
      await recordTest(deps, 'email', 'sent', null, out.id);
      return { ok: true, channel: 'email' };
    } catch {
      return fail('network');
    }
  }

  if (!admin.phone || !/^\+[0-9]{8,15}$/.test(admin.phone)) return fail('no_phone');
  const channel = req.channel;
  if (!isPhoneChannel(channel)) return fail('unknown_channel');
  const { lang, vars } = phoneVars(req.piece === 'phone_confirmation' ? null : facts, admin.language, now);
  const base = ladderDeps(deps, { userId: null, piece: 'test', phoneE164: admin.phone, tripId: null });
  const result = await sendByLadder(base, admin.phone, channelOrder(channel, [channel]), {
    templatePiece: req.piece,
    copyPiece: req.piece === 'phone_confirmation' ? 'M1' : copyPieceOf(facts),
    lang,
    languageBase: reminder.language_base,
    vars,
  });
  const attempt = result.attempts[0];
  return result.sent
    ? { ok: true, channel: req.channel }
    : { ok: false, channel: req.channel, error_code: attempt?.reason ?? 'failed' };
}
