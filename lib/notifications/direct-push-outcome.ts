/**
 * Why a direct push (`cms_direct`) from the CMS left nobody's phone, read from the `/send`
 * answer of `firebase-push-notification`.
 *
 * `result.success` and `result.failure` both read 0 when the gate refused the push, and also when
 * the person has no active device: the provider was never called. The banner used to say "no
 * active device" for both. The real reason is in `gate`, the per-person tally the Edge Function
 * returns (`PushGateOutcome` in `supabase/functions/_shared/push-gate.ts`).
 *
 * A direct push is a requested push since ee191f93: no cap, no quiet hours, consent only
 * (BR-COMUNICACAO-019). So `denied` and `inactive` both mean the person has notifications off.
 */

export interface DirectPushResult {
  success?: number;
  failure?: number;
}

export type DirectPushGate = Partial<Record<
  'sent' | 'not_delivered' | 'denied' | 'inactive' | 'gate_missing' | 'gate_error' | 'failed',
  number
>>;

/** Keys under `Pages.Notifications.messages`. */
export type DirectPushNotSentKey =
  | 'no_tokens'
  | 'not_sent_off'
  | 'not_sent_unknown'
  | 'not_sent_failed'
  | 'not_sent_mixed';

export interface DirectPushNotSent {
  key: DirectPushNotSentKey;
  /** Per-reason head count, for the plural forms and the mixed line. */
  values: { count: number; off: number; noDevice: number; unknown: number; failed: number };
}

function n(value: unknown): number {
  const v = Number(value);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * `null` when the push left for at least one device: the caller shows the sent banner.
 * Otherwise the message key that says why, with the counts.
 */
export function directPushNotSent(
  result: DirectPushResult | null | undefined,
  gate: DirectPushGate | null | undefined,
): DirectPushNotSent | null {
  if (n(result?.success) > 0) return null;

  const off = gate ? n(gate.denied) + n(gate.inactive) : 0;
  const noDevice = gate ? n(gate.not_delivered) : 0;
  const unknown = gate ? n(gate.gate_missing) + n(gate.gate_error) : 0;
  const failed = gate ? n(gate.failed) : 0;
  const count = off + noDevice + unknown + failed;
  const values = { count, off, noDevice, unknown, failed };

  const reasons = [off, noDevice, unknown, failed].filter((c) => c > 0).length;
  if (reasons === 0) return { key: 'no_tokens', values };
  if (reasons > 1) return { key: 'not_sent_mixed', values };
  if (off > 0) return { key: 'not_sent_off', values };
  if (unknown > 0) return { key: 'not_sent_unknown', values };
  if (failed > 0) return { key: 'not_sent_failed', values };
  return { key: 'no_tokens', values };
}
