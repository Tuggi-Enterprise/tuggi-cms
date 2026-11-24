/**
 * Who receives which tourist e-mail today (#957, BR-COMUNICACAO-020). Pure: it takes the rows of
 * `marketing.get_tourist_lifecycle_email_candidates` (facts, no policy) and answers with a list of
 * recipients and a counted list of discards. `tourist-lifecycle-email/index.ts` reads, reserves and
 * sends; this file decides, and `tests/api/tourist-lifecycle-email.test.ts` runs it under Node.
 *
 * THE GATES, IN ORDER (an address hits the FIRST that refuses it, so the counts stay readable):
 *
 * 1. `no_address` — no e-mail on the account.
 * 2. `unsubscribed` — `marketing.email_unsubscribes` (item 4): no service, no reengagement. Fails
 *    closed: anything but an explicit `false` counts as unsubscribed.
 * 3. `active` — "using the app" is BR-COMUNICACAO-019 item 2, computed by the database with
 *    `drive.user_active_within_days` and the window of `drive.unrequested_push_policy()`. Every
 *    e-mail here is for whoever is NOT using it. Fails closed the same way.
 * 4. `apple_relay_domain_unverified` — item 7 / BR-COMUNICACAO-017 item 6, the same secret and the
 *    same fail-closed reading as the ranking e-mail.
 * 5. The type, most perishable first: hours expiring (a date that passes), hours earned, then
 *    reengagement. ONE e-mail per address per run; the others wait for the next run.
 *
 * WHAT THE DATABASE OWNS, AND THIS FILE ONLY MIRRORS FOR THE DRY RUN: "once" and "at most one per
 * 7 days". `marketing.claim_tourist_lifecycle_email` reserves `(user, dedupe_key)` and refuses a
 * second hours-earned e-mail inside 7 days, atomically; the reservation is the proof, and it is
 * never given back. The checks below on `sent_keys` and `last_hours_earned_email_at` keep the dry
 * run truthful and save a round trip; they are not the guarantee.
 */

import { isApplePrivateRelayAddress, isRelayDomainVerified } from './newsletter-metrics.ts';
import {
  DEFAULT_TIME_ZONE,
  daysUntil,
  localDay,
  normalizeTouristLang,
  type TouristEmailData,
  type TouristEmailLang,
  type TouristEmailType,
} from './tourist-email.ts';

/** BR-COMUNICACAO-020 item 3: one e-mail at 7, one at 14, one at 30 days without use, and stop. */
export const REENGAGEMENT_STAGE_DAYS = [7, 14, 30] as const;

/**
 * How long after day 30 the last reminder can still leave. The 30-day e-mail says "it has been a
 * month"; to someone dormant for a year (the day this ships) that sentence is false, so the stage
 * closes a week after it opens. Choice of the `dev` (#957), reversible.
 */
export const REENGAGEMENT_LAST_STAGE_GRACE_DAYS = 7;

/** BR-COMUNICACAO-020 item 2.a: at most one hours-earned e-mail per 7 days. */
export const HOURS_EARNED_COOLDOWN_DAYS = 7;

/** BR-MONETIZACAO-086 item 6.b / BR-COMUNICACAO-020 item 2.b: 3 days before the expiry. */
export const HOURS_EXPIRING_LEAD_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

/** One row of `marketing.get_tourist_lifecycle_email_candidates` (spec in #957 for the `data`). */
export interface LifecycleCandidateRow {
  user_id: string;
  email: string | null;
  language: string | null;
  timezone: string | null;
  email_opt_in: boolean | null;
  unsubscribed: boolean | null;
  is_active: boolean | null;
  last_used_at: string | null;
  earned_unseen_minutes: number | null;
  earned_unseen_count: number | null;
  earned_nickname: string | null;
  earned_expires_at: string | null;
  last_hours_earned_email_at: string | null;
  expiring_minutes: number | null;
  expiring_at: string | null;
  balance_minutes: number | null;
  sent_keys: string[] | null;
  /**
   * BR-COMUNICACAO-019 3.h.2 (#1230 D11): the local expiry date of a short concession, set only
   * while its eve notice is due (from 12:00 local of the eve), and the minutes of every earned hour
   * expiring that date. Absent on a database before #1230.
   */
  short_expiring_on?: string | null;
  short_expiring_minutes?: number | null;
}

export interface LifecycleRecipient {
  user_id: string;
  email: string;
  lang: TouristEmailLang;
  type: TouristEmailType;
  /** What `claim_tourist_lifecycle_email` reserves. Names a fact, never a person. */
  dedupe_key: string;
  data: TouristEmailData;
}

export interface LifecycleDiscards {
  no_address: number;
  unsubscribed: number;
  active: number;
  apple_relay_domain_unverified: number;
  /** Not using the app, but nothing is due today (no opt-in, already sent, out of window). */
  nothing_due: number;
  /** Two accounts on one address: one e-mail per address per run. */
  address_superseded: number;
  /** The database already holds this key, or the 7-day ceiling refused it. */
  already_claimed: number;
  /** The reservation could not be proved. No proof, no e-mail. */
  claim_failed: number;
}

export interface LifecyclePlan {
  recipients: LifecycleRecipient[];
  discarded: LifecycleDiscards;
  candidates: number;
}

export interface LifecyclePlanInput {
  rows: readonly LifecycleCandidateRow[];
  now: Date;
  /** Raw `APPLE_PRIVATE_RELAY_DOMAIN_VERIFIED`. Anything but `true` is unverified. */
  relayDomainVerifiedRaw: string | null | undefined;
}

const PRIORITY: Record<TouristEmailType, number> = {
  tourist_hours_expiring: 0,
  tourist_hours_earned: 1,
  tourist_reengagement_30: 2,
  tourist_reengagement_14: 3,
  tourist_reengagement_7: 4,
};

const positive = (n: unknown): number => {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : 0;
};

const time = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
};

/** The single e-mail due for one row, or null. Exported for the stage tests. */
export function dueEmail(
  row: LifecycleCandidateRow,
  now: Date
): Omit<LifecycleRecipient, 'user_id' | 'email' | 'lang'> | null {
  const sent = new Set(row.sent_keys ?? []);
  const tz = row.timezone;

  // 2.b — hours expiring, one per expiry date, 3 days before.
  const expiringMinutes = positive(row.expiring_minutes);
  const days = daysUntil(row.expiring_at, now);
  if (expiringMinutes > 0 && days !== null && days >= 2 && days <= HOURS_EXPIRING_LEAD_DAYS) {
    const key = `hours_expiring:${localDay(row.expiring_at, tz)}`;
    if (!sent.has(key)) {
      return {
        type: 'tourist_hours_expiring',
        dedupe_key: key,
        data: { minutes: expiringMinutes, expires_at: row.expiring_at, timezone: tz },
      };
    }
  }

  // 2.a — hours earned by referral and not seen yet, at most one e-mail per 7 days.
  const earned = positive(row.earned_unseen_minutes);
  const lastEarnedMail = time(row.last_hours_earned_email_at);
  const cooled = lastEarnedMail === null || now.getTime() - lastEarnedMail >= HOURS_EARNED_COOLDOWN_DAYS * DAY_MS;
  if (earned > 0 && cooled) {
    return {
      type: 'tourist_hours_earned',
      dedupe_key: `hours_earned:${now.toISOString().slice(0, 10)}`,
      data: {
        minutes: earned,
        expires_at: row.earned_expires_at,
        // The name only when the e-mail reports ONE credit; a sum of several is the generic line.
        nickname: row.earned_unseen_count === 1 ? row.earned_nickname : null,
        timezone: tz,
      },
    };
  }

  // 3 — reengagement, only with `email_opt_in = true` (NULL is "has not answered", not yes).
  if (row.email_opt_in !== true) return null;
  const lastUsed = time(row.last_used_at);
  if (lastUsed === null) return null;
  const idle = Math.floor((now.getTime() - lastUsed) / DAY_MS);
  const stage = [...REENGAGEMENT_STAGE_DAYS].reverse().find((s) => idle >= s);
  if (stage === undefined) return null;
  const last = REENGAGEMENT_STAGE_DAYS[REENGAGEMENT_STAGE_DAYS.length - 1];
  if (stage === last && idle >= last + REENGAGEMENT_LAST_STAGE_GRACE_DAYS) return null;
  // The key carries the anchor: using the app again moves `last_used_at` and re-arms the sequence.
  const key = `reengagement_${stage}:${new Date(lastUsed).toISOString()}`;
  if (sent.has(key)) return null;
  return {
    type: `tourist_reengagement_${stage}` as TouristEmailType,
    dedupe_key: key,
    data: stage === 7 ? { balance_minutes: positive(row.balance_minutes) } : {},
  };
}

export function planTouristLifecycleEmails(input: LifecyclePlanInput): LifecyclePlan {
  const relayVerified = isRelayDomainVerified(input.relayDomainVerifiedRaw);
  const discarded: LifecycleDiscards = {
    no_address: 0,
    unsubscribed: 0,
    active: 0,
    apple_relay_domain_unverified: 0,
    nothing_due: 0,
    address_superseded: 0,
    already_claimed: 0,
    claim_failed: 0,
  };
  const recipients: LifecycleRecipient[] = [];
  const indexByAddress = new Map<string, number>();

  for (const row of input.rows) {
    const email = String(row.email ?? '').trim();
    if (!email) {
      discarded.no_address += 1;
      continue;
    }
    if (row.unsubscribed !== false) {
      discarded.unsubscribed += 1;
      continue;
    }
    if (row.is_active !== false) {
      discarded.active += 1;
      continue;
    }
    if (!relayVerified && isApplePrivateRelayAddress(email)) {
      discarded.apple_relay_domain_unverified += 1;
      continue;
    }
    const due = dueEmail(row, input.now);
    if (!due) {
      discarded.nothing_due += 1;
      continue;
    }

    const recipient: LifecycleRecipient = {
      user_id: String(row.user_id),
      email,
      lang: normalizeTouristLang(row.language),
      ...due,
    };
    const key = email.toLowerCase();
    const seen = indexByAddress.get(key);
    if (seen !== undefined) {
      if (PRIORITY[recipient.type] < PRIORITY[recipients[seen].type]) recipients[seen] = recipient;
      discarded.address_superseded += 1;
      continue;
    }
    indexByAddress.set(key, recipients.length);
    recipients.push(recipient);
  }

  return { recipients, discarded, candidates: input.rows.length };
}

export type LifecycleClaimVerdict = 'reserved' | 'already_claimed' | 'claim_failed';

/**
 * Reserves every recipient and keeps only the ones that won. Reserve, then deliver; the slot is
 * never given back (a failed send costs one e-mail that does not leave, a released slot could cost
 * two); an error is silence.
 */
export async function claimTouristLifecycleEmails(
  plan: LifecyclePlan,
  claim: (recipient: LifecycleRecipient) => Promise<LifecycleClaimVerdict>
): Promise<LifecyclePlan> {
  const reserved: LifecycleRecipient[] = [];
  const discarded = { ...plan.discarded };
  for (const recipient of plan.recipients) {
    let verdict: LifecycleClaimVerdict;
    try {
      verdict = await claim(recipient);
    } catch {
      verdict = 'claim_failed';
    }
    if (verdict === 'reserved') reserved.push(recipient);
    else if (verdict === 'already_claimed') discarded.already_claimed += 1;
    else discarded.claim_failed += 1;
  }
  return { ...plan, recipients: reserved, discarded };
}

// ===============================================================================================
// THE TRIP QUESTION IN THE REENGAGEMENT E-MAILS (BR-COMUNICACAO-019 3.u.4, #1276)
// ===============================================================================================
//
// Same e-mails, same people, same ceiling: the database answers who among the reserved
// reengagement recipients is in the audience of 3.u.1 with the month still open (3.u.2), and those
// get the block. The month is spent only after `send-transactional` accepted the e-mail.

const REENGAGEMENT_TYPES: ReadonlySet<TouristEmailType> = new Set([
  'tourist_reengagement_7',
  'tourist_reengagement_14',
  'tourist_reengagement_30',
]);

/** The accounts to ask `trip_question_audience('email', ...)` about: the reengagement recipients. */
export function tripQuestionUserIds(recipients: readonly LifecycleRecipient[]): string[] {
  return [...new Set(recipients.filter((r) => REENGAGEMENT_TYPES.has(r.type)).map((r) => r.user_id))];
}

/** The recipients, with the block on each reengagement e-mail whose account is in `asked`. */
export function withTripQuestion(
  recipients: readonly LifecycleRecipient[],
  asked: ReadonlySet<string>,
  reminder: boolean
): LifecycleRecipient[] {
  return recipients.map((r) =>
    REENGAGEMENT_TYPES.has(r.type) && asked.has(r.user_id)
      ? { ...r, data: { ...r.data, trip_question: reminder ? 'reminder' : 'no_reminder' } }
      : r
  );
}

/** Counts by type. The audit trail of a run: no address, no id. */
export function countByType(recipients: readonly LifecycleRecipient[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of recipients) out[r.type] = (out[r.type] ?? 0) + 1;
  return out;
}

/**
 * The single log line of a run. Reengagement is promotional and shares the 1-per-7-days bucket
 * with the newsletter (BR-COMUNICACAO-014 item 6.2); that arbiter does not exist yet, so the count
 * of reengagement e-mails that left without it is stated, not hidden.
 */
export function lifecycleAuditLine(plan: LifecyclePlan, dryRun: boolean): string {
  const d = plan.discarded;
  const byType = countByType(plan.recipients);
  const reengagement =
    (byType.tourist_reengagement_7 ?? 0) + (byType.tourist_reengagement_14 ?? 0) + (byType.tourist_reengagement_30 ?? 0);
  return (
    `dry_run=${dryRun} candidates=${plan.candidates} mailable=${plan.recipients.length} ` +
    `types=${JSON.stringify(byType)} ` +
    `(no_address=${d.no_address}, unsubscribed=${d.unsubscribed}, active=${d.active}, ` +
    `apple_relay_domain_unverified=${d.apple_relay_domain_unverified}, nothing_due=${d.nothing_due}, ` +
    `address_superseded=${d.address_superseded}, already_claimed=${d.already_claimed}, ` +
    `claim_failed=${d.claim_failed}) no_cadence_arbiter=${reengagement}`
  );
}

// ===============================================================================================
// THE EVE OF A SHORT CONCESSION (BR-COMUNICACAO-019 3.h.2, BR-MONETIZACAO-086 6.b, #1231)
// ===============================================================================================
//
// The database says WHO and WHEN (`short_expiring_on` is set only while the notice is due); this
// part says WHICH CHANNEL, and runs the claims and the sends. The rules that differ from the daily
// e-mails above:
//
// - 3.h.2.b: using the app or not. There is no `active` gate here.
// - E-mail: BR-COMUNICACAO-020 still applies (an address, not unsubscribed, the relay domain), and
//   the key is the one of the e-mail of 3 days before, `hours_expiring:<date>`, so one expiry e-mail
//   leaves per date whatever the rule (3.h.2.d).
// - Push: claimed by `drive.claim_hours_expiring_push`, sent with the kind `hours_expiring`, whose
//   gate asks consent only (outside every cap, 3.h.2.e). The quiet hours of item 5 are checked HERE:
//   the row stays due until the local midnight, and 22:00 is inside the quiet hours. A push not sent
//   by 22:00 is dropped, not deferred, because at 08:00 "tomorrow" is false (item 5).
// - Reserved is never given back (3.h.2.d): a failed send is a log line.

/** BR-COMUNICACAO-019 item 5: no unrequested push from 22:00 to 08:00 in the person's zone. */
export const QUIET_HOURS_START = 22;
export const QUIET_HOURS_END = 8;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const hourFormats = new Map<string, Intl.DateTimeFormat>();

/** The local hour (0 to 23) of `now` in `zone`, falling back to `DEFAULT_TIME_ZONE` (item 5). */
export function localHour(now: Date, zone: string | null | undefined): number {
  const make = (z: string) => {
    let f = hourFormats.get(z);
    if (!f) {
      f = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: z });
      hourFormats.set(z, f);
    }
    return Number(f.format(now));
  };
  try {
    return make(zone || DEFAULT_TIME_ZONE);
  } catch {
    return make(DEFAULT_TIME_ZONE);
  }
}

export function insideQuietHours(now: Date, zone: string | null | undefined): boolean {
  const h = localHour(now, zone);
  return h >= QUIET_HOURS_START || h < QUIET_HOURS_END;
}

export type EveEmailSkip =
  | 'no_address'
  | 'unsubscribed'
  | 'apple_relay_domain_unverified'
  | 'already_sent'
  | 'address_superseded';

export interface EveNotice {
  user_id: string;
  /** Where the e-mail goes, or `null` when it does not (`email_skip` says why). */
  email: string | null;
  email_skip: EveEmailSkip | null;
  /** The e-mail language. */
  lang: TouristEmailLang;
  /** The profile language as stored, for the push (six languages, BR-COMUNICACAO-019 item 11). */
  language: string | null;
  /** The local expiry date, `YYYY-MM-DD`: the claim keys of both channels. */
  expires_on: string;
  minutes: number;
  /** `hours_expiring:<date>`, the e-mail claim key. */
  dedupe_key: string;
  /** `false` inside the quiet hours. */
  push: boolean;
}

export interface EvePlan {
  notices: EveNotice[];
  candidates: number;
  email_skipped: Record<EveEmailSkip, number>;
  /** Notices whose push is not sent now because of the quiet hours. */
  quiet_hours: number;
}

export function planEveNotices(input: LifecyclePlanInput): EvePlan {
  const relayVerified = isRelayDomainVerified(input.relayDomainVerifiedRaw);
  const email_skipped: Record<EveEmailSkip, number> = {
    no_address: 0,
    unsubscribed: 0,
    apple_relay_domain_unverified: 0,
    already_sent: 0,
    address_superseded: 0,
  };
  const notices: EveNotice[] = [];
  const addresses = new Set<string>();
  const people = new Set<string>();
  let quiet = 0;

  for (const row of input.rows) {
    const on = String(row.short_expiring_on ?? '');
    const minutes = positive(row.short_expiring_minutes);
    if (!DATE_RE.test(on) || minutes <= 0) continue;
    const userId = String(row.user_id ?? '');
    if (!userId || people.has(userId)) continue;
    people.add(userId);

    const key = `hours_expiring:${on}`;
    const address = String(row.email ?? '').trim();
    let skip: EveEmailSkip | null = null;
    if (!address) skip = 'no_address';
    else if (row.unsubscribed !== false) skip = 'unsubscribed';
    else if (!relayVerified && isApplePrivateRelayAddress(address)) skip = 'apple_relay_domain_unverified';
    else if ((row.sent_keys ?? []).includes(key)) skip = 'already_sent';
    else if (addresses.has(address.toLowerCase())) skip = 'address_superseded';
    if (skip) email_skipped[skip] += 1;
    else addresses.add(address.toLowerCase());

    const push = !insideQuietHours(input.now, row.timezone);
    if (!push) quiet += 1;

    notices.push({
      user_id: userId,
      email: skip ? null : address,
      email_skip: skip,
      lang: normalizeTouristLang(row.language),
      language: row.language ?? null,
      expires_on: on,
      minutes,
      dedupe_key: key,
      push,
    });
  }
  return { notices, candidates: input.rows.length, email_skipped, quiet_hours: quiet };
}

export type EvePushOutcome = 'sent' | 'denied' | 'not_delivered' | 'failed';

export interface EveDeps {
  claimEmail: (n: EveNotice) => Promise<LifecycleClaimVerdict>;
  claimPush: (n: EveNotice) => Promise<LifecycleClaimVerdict>;
  /** `true` when `send-transactional` accepted the e-mail. */
  sendEmail: (n: EveNotice) => Promise<boolean>;
  sendPush: (n: EveNotice) => Promise<EvePushOutcome>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

export interface EveLimits {
  /** People whose notice makes a call to another function in one run; the rest come back next run. */
  maxSending: number;
  /** Between two such people. */
  minIntervalMs: number;
}

/**
 * Each person costs up to two calls to other functions (`send-transactional`, the push), and
 * Supabase gives a run 30 such calls per 60 s (https://supabase.com/docs/guides/functions/recursive-functions).
 * One person every 4.2 s is at most 28.6 calls a minute; 25 people end inside 110 s. The row stays
 * due until the local midnight, so whoever did not fit is served by the next hourly run.
 */
export const EVE_LIMITS: EveLimits = { maxSending: 25, minIntervalMs: 4200 };

export interface EveReport {
  candidates: number;
  notices: number;
  email: { sent: number; failed: number; already_claimed: number; claim_failed: number };
  push: Record<EvePushOutcome, number> & { already_claimed: number; claim_failed: number };
  email_skipped: Record<EveEmailSkip, number>;
  quiet_hours: number;
  /** Not claimed in this run because of `maxSending`. */
  deferred: number;
}

async function verdictOf(claim: () => Promise<LifecycleClaimVerdict>): Promise<LifecycleClaimVerdict> {
  try {
    return await claim();
  } catch {
    return 'claim_failed';
  }
}

/** Claims, then sends what it claimed. Never throws. */
export async function runEveNotices(plan: EvePlan, deps: EveDeps, limits: EveLimits = EVE_LIMITS): Promise<EveReport> {
  const report: EveReport = {
    candidates: plan.candidates,
    notices: plan.notices.length,
    email: { sent: 0, failed: 0, already_claimed: 0, claim_failed: 0 },
    push: { sent: 0, denied: 0, not_delivered: 0, failed: 0, already_claimed: 0, claim_failed: 0 },
    email_skipped: { ...plan.email_skipped },
    quiet_hours: plan.quiet_hours,
    deferred: 0,
  };
  let sending = 0;
  let nextAt = 0;
  for (const notice of plan.notices) {
    if (!notice.email && !notice.push) continue;
    if (sending >= limits.maxSending) {
      report.deferred += 1;
      continue;
    }
    const push = notice.push ? await verdictOf(() => deps.claimPush(notice)) : null;
    const email = notice.email ? await verdictOf(() => deps.claimEmail(notice)) : null;
    if (push === 'already_claimed') report.push.already_claimed += 1;
    if (push === 'claim_failed') report.push.claim_failed += 1;
    if (email === 'already_claimed') report.email.already_claimed += 1;
    if (email === 'claim_failed') report.email.claim_failed += 1;
    if (push !== 'reserved' && email !== 'reserved') continue;

    sending += 1;
    const wait = nextAt - deps.now();
    if (wait > 0) await deps.sleep(wait);
    nextAt = deps.now() + limits.minIntervalMs;

    if (email === 'reserved') {
      let ok = false;
      try {
        ok = await deps.sendEmail(notice);
      } catch {
        ok = false;
      }
      report.email[ok ? 'sent' : 'failed'] += 1;
    }
    if (push === 'reserved') {
      let outcome: EvePushOutcome = 'failed';
      try {
        outcome = await deps.sendPush(notice);
      } catch {
        outcome = 'failed';
      }
      report.push[outcome] += 1;
    }
  }
  return report;
}
