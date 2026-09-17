/**
 * The ranking e-mail PLAN — who is actually mailed, in which language, with which sentence.
 *
 * Card #747 (epic #737), **BR-COMUNICACAO-017**. This module is pure: it takes the audience the
 * database resolved, the decisions `buildRankingDispatch` produced, and the two environment facts
 * that live outside the database, and it answers with a list of recipients and a counted list of
 * discards. It reads nothing and sends nothing — `daily-gamification-orchestrator` gives it the
 * inputs and `send-newsletter/ranking` delivers the output.
 *
 * It exists as its own file for the same reason `ranking-communication.ts` does: every Edge
 * Function that talks to the database imports `https://esm.sh/@supabase/supabase-js@2`, which
 * Node cannot resolve, so a rule that lives inside one of them can only ever be checked by a
 * regexp over its text. Here the rules are executed against real inputs by
 * `tests/api/ranking-email.test.ts`.
 *
 * ---------------------------------------------------------------------------------------------
 * THE FOUR GATES, IN ORDER, AND WHO OWNS EACH ONE
 * ---------------------------------------------------------------------------------------------
 *
 * 1. **Consents and unsubscribe — the DATABASE owns them, not this file.**
 *    `marketing.get_ranking_email_audience` asks for `ranking_opt_in IS TRUE AND email_opt_in IS
 *    TRUE` (BR-COMUNICACAO-017 item 3) and applies `marketing.email_unsubscribes`, the only
 *    unsubscribe list there is (item 5, BR-COMUNICACAO-015). Re-checking either here would be a
 *    second gate, and two gates disagree the day one of them moves (CLAUDE.md §6). An address
 *    that is not in the rows simply is not a recipient.
 *
 * 2. **Apple Private Relay — THIS side owns it, because the fact is not in the database.**
 *    BR-COMUNICACAO-017 item 6.a: no relay address is mailed before the sending domain is
 *    registered and validated with SPF/DKIM in the Apple Developer Account. That registration is
 *    not a row anywhere; it arrives as the `APPLE_PRIVATE_RELAY_DOMAIN_VERIFIED` secret and it
 *    FAILS CLOSED — anything that is not the literal `true` counts as unverified
 *    (`isRelayDomainVerified`). "Not verified equals not sent", and it is 71 addresses.
 *
 * 3. **The language the sender publishes — `mailableEmailLang`.** Four, not five. A French
 *    recipient would read a Portuguese footer and be called `traveler`, in English, so `fr` is
 *    written in the catalogue and refused here.
 *
 * 4. **The sentence itself — `resolveRankingEmailCopy`.** All three fields or none. A piece
 *    missing one key in one language does not leave IN THAT LANGUAGE and does not disturb the
 *    others, which is what keeps a half-translated release from being an all-or-nothing outage.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT THIS FILE DOES **NOT** GATE, AND WHY THE ABSENCE IS RETURNED INSTEAD OF HIDDEN
 * ---------------------------------------------------------------------------------------------
 *
 * **There is no cadence gate, here or anywhere.** BR-COMUNICACAO-017 item 4.a: the ranking e-mail
 * and the newsletter share ONE bucket of 1 send per address per 7 days, and BR-COMUNICACAO-014
 * item 6.3 says the service e-mail wins and the newsletter yields. That arbitration is a single
 * SQL gate called by the audience resolvers (014 item 7) and **it does not exist** — a sweep of
 * `pg_proc` in `core`, `drive` and `marketing` on 2026-09-17 returned no candidate. Building a
 * fourth blind gate in TypeScript is precisely the defect item 7 exists to prevent, so this file
 * does the opposite: `cadenceArbiterAbsent` counts the recipients that are leaving WITHOUT an
 * arbiter, so the gap is a number in the log instead of an invisible double send.
 *
 * **There is no once-per-cycle store either.** BR-COMUNICACAO-017 item 8.b caps the e-mail at one
 * per recipient per weekly cycle, and nothing records that an address was mailed: the daily
 * window evaluates each candidate once a DAY, so the same recipient can be reached on more than
 * one day of the same cycle. It needs a row — `marketing.newsletter_recipients` demands a
 * `campaign_id` this dispatch has no campaign for — and a row is `data`'s. Same treatment: the
 * count is returned and logged, never silently assumed to be one.
 */

import { isApplePrivateRelayAddress, isRelayDomainVerified } from './newsletter-metrics.ts';
import type { RankingDecision } from './ranking-communication.ts';
import {
  mailableEmailLang,
  rankingCopyVars,
  resolveRankingEmailCopy,
  type RankingCopyLang,
} from './ranking-comm-i18n.ts';

/** One row of `marketing.get_ranking_email_audience` — three columns, and it has no fourth. */
export interface RankingEmailAudienceRow {
  email: string;
  user_id: string;
  language: string | null;
}

/** One addressable recipient, with the sentence already chosen. */
export interface RankingEmailRecipient {
  user_id: string;
  email: string;
  lang: RankingCopyLang;
  piece: RankingDecision['piece'];
  subject: string;
  heading: string;
  body: string;
}

/**
 * Why an address in the audience got nothing. Counted, never named — BR-COMUNICACAO-017 item 8.c
 * asks for how many were discarded and by which ceiling, and a log that names addresses is PII.
 */
export interface RankingEmailDiscards {
  /** In the audience, but the mechanism decided no e-mail piece for them today. */
  no_decision: number;
  /** `@privaterelay.appleid.com` while the sending domain is unverified — item 6.a. */
  apple_relay_domain_unverified: number;
  /** A language the promotional sender does not publish — `fr` today. */
  language_not_published: number;
  /** The piece has no complete sentence in that language. */
  no_copy: number;
}

export interface RankingEmailPlan {
  recipients: RankingEmailRecipient[];
  discarded: RankingEmailDiscards;
  /** How many rows the audience resolver returned, before any gate of this file. */
  audienceSize: number;
  /**
   * How many of `recipients` are leaving with NO cadence arbiter between this piece and the
   * newsletter — BR-COMUNICACAO-017 item 4.b. Today it equals `recipients.length`, and the day it
   * stops equalling it is the day the SQL gate exists.
   */
  cadenceArbiterAbsent: number;
}

export interface RankingEmailPlanInput {
  audience: readonly RankingEmailAudienceRow[];
  /** The `channel === 'email'` half of `buildRankingDispatch`. */
  decisions: readonly RankingDecision[];
  /** `current_streak_days` per account, for the only piece that states a number. */
  streakDaysByUserId: ReadonlyMap<string, number>;
  /** Raw `APPLE_PRIVATE_RELAY_DOMAIN_VERIFIED`. Anything but `true` is unverified. */
  relayDomainVerifiedRaw: string | null | undefined;
}

/**
 * The plan. Order matters only for the counts: an address hits the FIRST gate that refuses it, so
 * `no_copy` never absorbs a relay address and the log stays readable.
 */
export function planRankingEmails(input: RankingEmailPlanInput): RankingEmailPlan {
  const relayVerified = isRelayDomainVerified(input.relayDomainVerifiedRaw);
  const decisionByUserId = new Map(input.decisions.map((d) => [d.user_id, d]));

  const recipients: RankingEmailRecipient[] = [];
  const discarded: RankingEmailDiscards = {
    no_decision: 0,
    apple_relay_domain_unverified: 0,
    language_not_published: 0,
    no_copy: 0,
  };

  for (const row of input.audience) {
    const email = String(row.email ?? '').trim();
    const decision = decisionByUserId.get(String(row.user_id));
    if (!email || !decision) {
      discarded.no_decision += 1;
      continue;
    }

    if (!relayVerified && isApplePrivateRelayAddress(email)) {
      discarded.apple_relay_domain_unverified += 1;
      continue;
    }

    const lang = mailableEmailLang(row.language);
    if (lang === null) {
      discarded.language_not_published += 1;
      continue;
    }

    // `{{rank}}` arrives already formatted as the ordinal of `lang`, and `{{count}}` only exists
    // for whoever has a measured live streak. Both are facts about this recipient and nobody
    // else — BR-MONETIZACAO-081 item 6.5, BR-RANKING-002.
    const copy = resolveRankingEmailCopy(
      decision.piece,
      lang,
      rankingCopyVars(decision.piece, lang, {
        rank: decision.rank,
        points: decision.points,
        streakDays: input.streakDaysByUserId.get(String(row.user_id)) ?? null,
      })
    );
    if (!copy) {
      discarded.no_copy += 1;
      continue;
    }

    recipients.push({
      user_id: String(row.user_id),
      email,
      lang,
      piece: decision.piece,
      subject: copy.subject,
      heading: copy.heading,
      body: copy.body,
    });
  }

  return {
    recipients,
    discarded,
    audienceSize: input.audience.length,
    cadenceArbiterAbsent: recipients.length,
  };
}

/**
 * The single line BR-COMUNICACAO-017 item 8.c asks of an automatic dispatch: how many entered the
 * audience, how many were discarded and by which ceiling or suppression, and how many are leaving
 * with no cadence arbiter.
 *
 * It is a function and not an inline template because it is the substitute for a human act —
 * item 9 of BR-COMUNICACAO-014 exists for the CMS path, where a person presses a button; here
 * there is no button, and this string is the whole audit trail. It carries no address and no id.
 */
export function rankingEmailAuditLine(plan: RankingEmailPlan, relayVerifiedRaw: string | null | undefined): string {
  const d = plan.discarded;
  const discardedTotal = d.no_decision + d.apple_relay_domain_unverified + d.language_not_published + d.no_copy;
  return (
    `audience=${plan.audienceSize} mailable=${plan.recipients.length} ` +
    `discarded=${discardedTotal} ` +
    `(no_decision=${d.no_decision}, apple_relay_domain_unverified=${d.apple_relay_domain_unverified} ` +
    `[domain_verified=${isRelayDomainVerified(relayVerifiedRaw)}], ` +
    `language_not_published=${d.language_not_published}, no_copy=${d.no_copy}) ` +
    `no_cadence_arbiter=${plan.cadenceArbiterAbsent} ` +
    '(BR-COMUNICACAO-017 item 4.b: no 7-day bucket gate exists, so these left unarbitrated)'
  );
}
