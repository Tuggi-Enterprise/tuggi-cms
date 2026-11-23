/**
 * The confirmation of the phone number (BR-COMUNICACAO-024 item 5, #1231): "all set, we'll remind
 * you here", by the first message channel that takes it.
 *
 * Contract `docs/contracts/viagem-marcada-e-lembrete.md`, "Fluxo da confirmação":
 * - the app calls `phone-confirmation` with its own JWT after `save_my_phone_v1` answered
 *   `confirmation: true`, and does not wait;
 * - this module sends ONLY when `drive.claim_phone_confirmation` returns the row (security-reviewer,
 *   #1230, condition 1). `null` (already claimed for this save, removed, stopped, or the switch
 *   `phone.confirmation` off) is "send nothing, answer success". Nothing is read from
 *   `get_phone_contact` to decide a send;
 * - claimed is never given back: a failed send is recorded and not claimed again;
 * - every attempt is a row of `drive.record_message_send`, the proof of the send;
 * - a message only "sent" waits for the status webhook, which confirms the channel or moves down
 *   the ladder (`message-webhooks.ts`); a refusal of the number now sets the state now.
 *
 * Pure: the client and `fetch` come in. Logs carry the outcome only, never the number, the user id
 * or a secret (condition 3).
 */
import { channelOrder, sendByLadder, type LadderDeps, type MessageTemplate, type PhoneChannel } from './message-channels.ts';
import type { DriveRpc } from './push-gate.ts';
import { normalizeCopyLang } from './ranking-comm-i18n.ts';

export interface PhoneContact {
  user_id: string;
  phone_e164: string;
  calling_code: string | null;
  channel: string | null;
  delivery_state: string | null;
  stopped: boolean;
  message_channels: string[];
  confirmation: boolean;
  language: string | null;
  language_base: string | null;
  confirmation_claimed_at?: string;
}

export type ConfirmationOutcome =
  | 'not_claimed'
  | 'sent'
  | 'not_sent'
  | 'no_channel_on'
  | 'claim_error';

export interface ConfirmationResult {
  ok: boolean;
  outcome: ConfirmationOutcome;
  channel: PhoneChannel | null;
}

export interface MessageDeps {
  drive: DriveRpc;
  fetch: typeof fetch;
  /** The SMS status webhook (`sms-webhook/status`). */
  smsStatusCallback?: string;
  log: (line: string) => void;
}

/** The ladder's dependencies on the database, for one person and one piece. */
export function ladderDeps(
  deps: MessageDeps,
  record: { userId: string | null; piece: string; phoneE164: string; tripId: string | null }
): LadderDeps {
  let templates: Promise<readonly MessageTemplate[]> | null = null;
  return {
    fetch: deps.fetch,
    smsStatusCallback: deps.smsStatusCallback,
    secrets: async (channel) => {
      const { data, error } = await deps.drive.rpc('get_provider_secrets', { p_channel: channel });
      if (error || !data || typeof data !== 'object') return {};
      return data as Record<string, string>;
    },
    templates: () => {
      templates ??= Promise.resolve(deps.drive.rpc('cms_get_trip_settings')).then(({ data, error }) => {
        const list = (data as { templates?: unknown } | null)?.templates;
        return !error && Array.isArray(list) ? (list as MessageTemplate[]) : [];
      });
      return templates;
    },
    record: async (attempt) => {
      const { error } = await deps.drive.rpc('record_message_send', {
        p_user_id: record.userId,
        p_piece: record.piece,
        p_channel: attempt.channel,
        p_outcome: attempt.outcome,
        p_reason: attempt.reason,
        p_provider_message_id: attempt.providerMessageId,
        p_phone_e164: record.phoneE164,
        p_trip_id: record.tripId,
      });
      if (error) deps.log(`[message] record_message_send failed: ${error.code ?? 'unknown'}`);
    },
  };
}

export async function confirmPhone(deps: MessageDeps, userId: string): Promise<ConfirmationResult> {
  const { data, error } = await deps.drive.rpc('claim_phone_confirmation', { p_user_id: userId });
  if (error) {
    deps.log(`[phone-confirmation] claim failed: ${error.code ?? 'unknown'}`);
    return { ok: false, outcome: 'claim_error', channel: null };
  }
  const contact = data as PhoneContact | null;
  if (!contact || typeof contact.phone_e164 !== 'string') {
    return { ok: true, outcome: 'not_claimed', channel: null };
  }

  const channels = channelOrder(contact.channel, contact.message_channels);
  if (channels.length === 0) {
    deps.log('[phone-confirmation] no message channel on');
    return { ok: true, outcome: 'no_channel_on', channel: null };
  }

  const result = await sendByLadder(
    ladderDeps(deps, { userId, piece: 'phone_confirmation', phoneE164: contact.phone_e164, tripId: null }),
    contact.phone_e164,
    channels,
    {
      templatePiece: 'phone_confirmation',
      copyPiece: 'M1',
      lang: normalizeCopyLang(contact.language),
      languageBase: contact.language_base,
      vars: {},
    }
  );

  if (result.state) {
    const { error: stateError } = await deps.drive.rpc('set_phone_delivery_state', {
      p_user_id: userId,
      p_phone_e164: contact.phone_e164,
      p_state: result.state,
      p_channel: null,
    });
    if (stateError) deps.log(`[phone-confirmation] state not saved: ${stateError.code ?? 'unknown'}`);
  }
  const reasons = result.attempts.map((a) => `${a.channel}:${a.outcome}:${a.reason ?? '-'}`).join(',');
  deps.log(`[phone-confirmation] ${result.sent ? 'sent' : 'not_sent'} attempts=${reasons} state=${result.state ?? '-'}`);
  return { ok: true, outcome: result.sent ? 'sent' : 'not_sent', channel: result.sent };
}
