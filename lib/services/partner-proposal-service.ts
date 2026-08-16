/**
 * The partner form's data access — and the only place in the #341 surface that holds a
 * `service_role` client.
 *
 * WHY THE SERVICE CLIENT IS HERE AND NOT IN THE ROUTE, stated out loud because
 * `scripts/check-route-policies.ts` refuses `withPublicRoute` in a file that reaches
 * `service_role` and this module is, by construction, on the other side of that check:
 *
 * The check closes the fast path — "public" stamped on a handler that queries the whole
 * database with the secret key. It says so in its own docstring: a route that reaches
 * `service_role` through `lib/services/*` is out of its scope. This module is not an evasion
 * of it, it is the shape the check leaves open on purpose, and it only holds because of three
 * things that are code and not intent:
 *
 *  1. The API here is closed and narrow. There is no "run this query" export. Every function
 *     names one operation, and none of them can be pointed at another table.
 *  2. The only public surface is one INSERT into one table, of a value the caller has already
 *     had stripped to an allowlist.
 *  3. That INSERT is behind a durable per-IP limit that is decided by the database, not by
 *     this process — see `registerSubmissionAttempt`.
 *
 * THE FORM IS NOW A DOOR WITH NO CREDENTIAL AT ALL (operator, 2026-08-16). There is no invite
 * token: the same address goes to every partner, and it is only ever sent to an establishment
 * whose papers the team already checked in person. That removes the thing that used to
 * authenticate the caller, so what stands between the internet and a `service_role` write is
 * exactly this file plus the route's validation — which is why nothing here reads or writes
 * anything it does not have to.
 *
 * `core.clients` IS REACHABLE FROM HERE, and in one direction only: `lookupTaxId` asks whether
 * a CNPJ is already registered and gets back one of three words. It selects `id`, returns no
 * column to the caller, and has no sibling that writes. The submission is still a proposal,
 * and the promotion into the live record is still an authenticated act of the team
 * (BR-B2B-026, item 4).
 */

import { getSupabaseService } from '@/lib/core/supabase-client'
import { createHmac } from 'node:crypto'
import type { PartnerAnswers } from '@/lib/partner-form/schema'
import { cnpjLookupValues } from '@/lib/validation/cnpj'

const SCHEMA = 'core'
const SUBMISSIONS = 'partner_form_submissions'
const CLIENTS = 'clients'

function service() {
  return getSupabaseService().schema(SCHEMA)
}

// ── The CNPJ is the deduplication key ───────────────────────────────────────────────────

/**
 * Whether this CNPJ is already a client of ours — `registered`, `free`, or `unknown` when the
 * question could not be asked.
 *
 * A CNPJ already in `core.clients` is a partner the team has registered, and a second
 * registration of the same company through a public form would either duplicate the record or
 * invite somebody to overwrite it. It is refused at the door and the person is told to talk to
 * whoever they were already talking to.
 *
 * A CNPJ that only has a PENDING PROPOSAL is not refused — it becomes another proposal, and a
 * human resolves the duplicate on the conference screen. Refusing there would let anyone with
 * a CNPJ (a public number) find out whether that company is talking to the Tuggi.
 *
 * WHICH SHAPES COUNT AS THE SAME CNPJ is `cnpjLookupValues`, shared with the promotion — the
 * two ends of this feature must not disagree about what "already registered" means.
 */
export type TaxIdLookup = 'registered' | 'free' | 'unknown'

export async function lookupTaxId(taxId: string): Promise<TaxIdLookup> {
  const candidates = cnpjLookupValues(taxId)
  if (candidates.length === 0) return 'free'

  const { data, error } = await service()
    .from(CLIENTS)
    .select('id')
    .in('tax_id', candidates)
    .limit(1)

  // `unknown` and never `free`: a lookup that did not answer is not permission to write. A
  // CNPJ that got through here would become a duplicate client record somebody has to unpick
  // by hand, and the route turns this into "try again", not into a silent second registration.
  if (error) {
    console.error('[partner-form] tax id lookup failed')
    return 'unknown'
  }

  return Array.isArray(data) && data.length > 0 ? 'registered' : 'free'
}

// ── The submission ──────────────────────────────────────────────────────────────────────

export type CreateProposalOutcome =
  | { ok: true; submissionId: string }
  | { ok: false; reason: 'write_failed' }

/**
 * Turns the answers into a submitted proposal. One INSERT, no read before it, nothing to
 * update: every submission is a new proposal, including the second one for a CNPJ that
 * already has one waiting.
 *
 * There is no `draft` row any more — the draft lives on the person's device
 * (`lib/partner-form/draft-mirror.ts`) precisely because there is no credential that could
 * address a server-side one.
 */
export async function createProposal(answers: PartnerAnswers): Promise<CreateProposalOutcome> {
  const now = new Date().toISOString()

  const { data, error } = await service()
    .from(SUBMISSIONS)
    .insert({
      answers,
      status: 'submitted',
      submitted_at: now,
      updated_at: now,
    })
    .select('id')
    .single()

  if (error || !data) return { ok: false, reason: 'write_failed' }
  return { ok: true, submissionId: data.id }
}

// ── The abuse limit, decided by the database ────────────────────────────────────────────

/**
 * How many submissions one address may make, and over how long.
 *
 * Ten in an hour: an owner with several places fills a handful in one sitting and never
 * notices this, while a script gets 10 rows instead of an unbounded number. The numbers are
 * arguments of the call and not constants in SQL so that "how often may a stranger write to
 * this table" is answerable from the route that allows it.
 */
export const SUBMISSION_LIMIT_PER_WINDOW = 10
export const SUBMISSION_WINDOW_SECONDS = 60 * 60

export interface SubmissionLimitDecision {
  allowed: boolean
  /** How long until the oldest attempt in the window falls out of it. */
  retryAfterSeconds: number
}

/**
 * Counts this address's submissions and says whether another one is allowed.
 *
 * WHY THIS IS NOT `withRateLimit`. That composer keeps its window in a `Map` inside one
 * process. On Vercel every instance has its own, they are created and destroyed per request
 * burst, and a caller that spreads its requests hits a fresh counter almost every time — so it
 * is a brake on one accidental double-click and never a barrier. It stays on the route as the
 * cheap first line, and this is the barrier.
 *
 * The count is the database's, in one statement: PostgREST cannot count-then-insert without a
 * race, so the RPC does both and returns the verdict. Specified for the `data` in #341.
 *
 * THE ADDRESS IS KEY-HASHED, and the docstring will not claim more than that — see
 * `hashClientAddress`.
 *
 * FAIL CLOSED, and for two reasons now. An RPC that errors, or is not there yet, means nobody
 * counted — and an uncounted write to a `service_role` table from an anonymous caller is the
 * thing this function exists to prevent. A missing server secret means the key could only be
 * built by dropping it, which would silently downgrade every row already written into the
 * brute-forceable shape this stopped being. Both refuse; the route turns that into "try again
 * in a moment", never into a silent allow.
 */
export async function registerSubmissionAttempt(
  clientAddress: string
): Promise<SubmissionLimitDecision> {
  const clientHash = hashClientAddress(clientAddress)
  if (!clientHash) {
    console.error(
      `[partner-form] ${HASH_SECRET_VAR} is not configured — the submission was refused`
    )
    return { allowed: false, retryAfterSeconds: SUBMISSION_WINDOW_SECONDS }
  }

  const { data, error } = await service().rpc('record_partner_form_attempt', {
    p_client_hash: clientHash,
    p_window_seconds: SUBMISSION_WINDOW_SECONDS,
    p_max_attempts: SUBMISSION_LIMIT_PER_WINDOW,
  })

  const decision = Array.isArray(data) ? data[0] : data

  if (error || !decision || typeof decision.allowed !== 'boolean') {
    console.error('[partner-form] submission limit could not be consulted')
    return { allowed: false, retryAfterSeconds: SUBMISSION_WINDOW_SECONDS }
  }

  return {
    allowed: decision.allowed,
    retryAfterSeconds:
      typeof decision.retry_after_seconds === 'number'
        ? decision.retry_after_seconds
        : SUBMISSION_WINDOW_SECONDS,
  }
}

/**
 * The environment variable holding the server-side secret of the key-hash below. Named here
 * because the log line has to say WHICH variable is missing — an operator reading
 * "not configured" learns nothing.
 */
export const HASH_SECRET_VAR = 'PARTNER_FORM_HASH_SECRET'

/**
 * The counter's key for one address: HMAC-SHA-256 of the address under a server secret.
 *
 * WHY A SECRET AND NOT A PLAIN DIGEST. A bare `sha256(ip)` is reversible by anybody who gets
 * the table: the whole IPv4 space is 2^32 digests, which is minutes of laptop time, and IPv6
 * assignments in practice are not much better. The secret takes that offline attack away —
 * without it there is nothing to enumerate against.
 *
 * WHAT IT IS STILL NOT. This is pseudonymisation, not anonymisation, and calling it anonymous
 * would be the same overclaim with a longer key: the same address always produces the same
 * value (that is the whole point — the counter has to recognise a repeat caller), so the rows
 * remain linkable to each other, and whoever holds the secret can re-derive the key for an
 * address they already suspect. What it buys is that the raw address is not in the table, not
 * kept in this process and not in any log line, and that the table alone reveals nobody.
 *
 * NULL, NEVER AN UNSALTED FALLBACK. Returning a plain digest when the secret is missing would
 * be worse than never having had one: the door would stay open, the rows would look identical
 * to the good ones, and nobody would find out until somebody dumped the table. The caller
 * refuses instead — `registerSubmissionAttempt`, and the type is what forces it to.
 *
 * The secret is a deploy-time value: rotating it re-keys everybody, which costs at most one
 * window of counting and is the reason the window is an hour and not a month.
 */
export function hashClientAddress(clientAddress: string): string | null {
  const secret = (process.env[HASH_SECRET_VAR] ?? '').trim()
  if (!secret) return null

  return createHmac('sha256', secret).update((clientAddress ?? '').trim(), 'utf8').digest('hex')
}

/**
 * Which address a request came from. `x-forwarded-for` is a list when there are proxies in
 * front, and the FIRST entry is the client — the same one `withRateLimit` reads, so the two
 * limits are never counting different people.
 */
export function clientAddressOf(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for') ?? ''
  const first = forwarded.split(',')[0]?.trim()
  return first || headers.get('x-real-ip')?.trim() || 'unknown'
}
