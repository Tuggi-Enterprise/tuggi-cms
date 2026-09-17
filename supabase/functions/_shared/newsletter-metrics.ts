/**
 * Newsletter metrics — the rules that decide what a recipient row MEANS.
 *
 * Three pure functions and one table, with no imports at all, and that is deliberate: the two
 * Edge Functions that use them (`resend-webhook`, `send-newsletter`) both import
 * `https://esm.sh/@supabase/supabase-js@2` through `_shared/supabase-client.ts`, which Node
 * cannot resolve. A rule that lives inside one of those files can only ever be checked by a
 * source ruler — a regexp over the text — and a source ruler cannot tell you whether the rule
 * is CORRECT, only that it is still written down.
 *
 * Here they are executed by `tests/api/marketing-ef-metrics.test.ts` against real inputs.
 */

/**
 * The lifecycle of one `marketing.newsletter_recipients` row, as a RANK. A status may only ever
 * move UP this ladder.
 *
 * Resend sends `email.opened` on EVERY reopen, and the webhook used to write the incoming status
 * unconditionally. So a reader who clicked and then reopened the message was written back down
 * to `opened`, and the click vanished. Measured 2026-09-10: 11 rows say `clicked`, and 4 more
 * carry `click_count > 0` while saying `opened` — clicks undercounted by 27%.
 *
 * `bounced` and `complained` are TERMINAL and sit above everything else. They are facts about
 * the ADDRESS, not about the reading, and no later engagement event may erase them.
 *
 * The column has no CHECK constraint in the database — it is free `text` — so this table is the
 * only place the set is written down. Adding a status means adding it here.
 */
export const STATUS_RANK: Record<string, number> = {
  queued: 0,
  failed: 1,
  sent: 2,
  delivered: 3,
  opened: 4,
  clicked: 5,
  bounced: 6,
  complained: 7,
};

/**
 * The status a row should carry after an event, given the one it already carries.
 *
 * Never demotes. An unknown status on either side ranks below everything known, so a value this
 * table has not heard of can never displace one it has.
 */
export function highestStatus(current: string | null | undefined, incoming: string): string {
  const currentRank = STATUS_RANK[current ?? ''] ?? -1;
  const incomingRank = STATUS_RANK[incoming] ?? -1;
  return incomingRank > currentRank ? incoming : (current || incoming);
}

/**
 * Is this bounce permanent — must the address be suppressed forever?
 *
 * CONFIRMED IN RESEND'S OFFICIAL DOCS, on 2026-09-10, not from memory:
 *
 *  - https://resend.com/docs/dashboard/webhooks/event-types — `email.bounced` "Occurs whenever
 *    the recipient's mail server permanently rejected the email".
 *  - https://resend.com/docs/webhooks/emails/bounced — the payload carries `data.bounce` with
 *    `type`, `subType`, `message` and `diagnosticCode`. The worked example is
 *    `{"message": "…suppression list…", "subType": "Suppressed", "type": "Permanent"}`.
 *  - https://resend.com/docs/dashboard/emails/email-bounces — the enumeration:
 *      `Permanent`    (General, NoEmail) — hard, "will never be delivered";
 *      `Transient`    (General, MailboxFull, MessageTooLarge, ContentRejected,
 *                      AttachmentRejected) — soft, "may be delivered in the future";
 *      `Undetermined` — "the bounce message didn't contain enough information".
 *
 * So the payload DOES distinguish hard from soft, and `data.bounce.type` is the discriminator.
 *
 * ONLY `Permanent` suppresses. `Transient` is a full mailbox or an oversized message, and
 * unsubscribing a paying customer because their inbox was full for one afternoon is a worse
 * defect than the one this fixes. `Undetermined` does not suppress either: Resend is saying it
 * does not know, and "I don't know" is not consent to stop mailing someone.
 */
export function isPermanentBounce(bounce: unknown): boolean {
  const type = String((bounce as { type?: unknown } | null)?.type ?? '')
    .trim()
    .toLowerCase();
  return type === 'permanent';
}

/**
 * `utm_campaign` is a GA4 DIMENSION, not a label.
 *
 * The campaign's free-text name went in raw, so `Novidades de junho` arrived in the report as
 * `Novidades%20de%20junho`, with one separate row per accent and capitalisation variant of the
 * same campaign. ASCII slug, lowercase, hyphen-separated; `fallback` (the campaign id) when the
 * name has nothing sluggable in it, because an EMPTY `utm_campaign` is worse than an ugly one —
 * it merges the campaign into every other unattributed session.
 */
export function slugifyCampaign(name: string, fallback: string): string {
  const slug = (name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || fallback;
}

/**
 * The domain Sign in with Apple hands us instead of the person's real address.
 *
 * **70 of our accounts use it** (measured 2026-09-11, epic #737), and they are the reason the two
 * functions below exist.
 */
export const APPLE_PRIVATE_RELAY_DOMAIN = 'privaterelay.appleid.com';

export function isApplePrivateRelayAddress(email: string | null | undefined): boolean {
  return String(email ?? '').trim().toLowerCase().endsWith(`@${APPLE_PRIVATE_RELAY_DOMAIN}`);
}

/**
 * Whose fault is this bounce — the address, or us?
 *
 * **BR-COMUNICACAO-017 item 6.** Apple requires every sending domain to be registered and
 * validated with SPF and/or DKIM in the Developer Account, with an EXACT match between the
 * registered domain and the envelope domain. Official documentation, verbatim: *"If you don't
 * register all the source domains or emails that you use, email sent to the private relay service
 * will result in a bounce message."*
 *
 * That bounce is `Permanent`, and Resend has no way to tell it apart from a dead mailbox — so
 * without this function the hard-bounce branch of `resend-webhook` suppresses the address, and
 * **70 accounts are burned at once, in silence, by a misconfiguration of ours**. Item 6.b says it
 * in one line: a bounce caused by our own missing registration does not remove the address from
 * the base. BR-COMUNICACAO-015 governs exit BY A SIGNAL FROM THE RECIPIENT, and this signal is
 * not theirs.
 *
 * `relayDomainVerified` is the operator's answer to the one question no agent can answer:
 * *is the sending domain registered under Certificates, IDs & Profiles → More → Configure Private
 * Email Relay?* It arrives as the `APPLE_PRIVATE_RELAY_DOMAIN_VERIFIED` secret, and **anything
 * other than an explicit `true` counts as not verified** — unknown must behave like unregistered,
 * because the cost of the two mistakes is not symmetric: treating a verified domain as
 * unverified keeps one dead address in the base, and the reverse deletes 70 live ones.
 */
export type BounceOwner = 'recipient' | 'sender';

export function bounceOwner(
  email: string | null | undefined,
  relayDomainVerified: boolean
): BounceOwner {
  return isApplePrivateRelayAddress(email) && !relayDomainVerified ? 'sender' : 'recipient';
}

/**
 * Reads the operator's verification flag. Fails closed — see `bounceOwner`.
 *
 * It is a free function and not a constant so that a test can move it, and so that the value is
 * read at the moment of the event rather than at cold start.
 */
export function isRelayDomainVerified(raw: string | null | undefined): boolean {
  return String(raw ?? '').trim().toLowerCase() === 'true';
}
