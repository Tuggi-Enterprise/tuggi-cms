// Edge Function: tourist-lifecycle-email
//
// #957, BR-COMUNICACAO-020. Selects who receives a tourist e-mail today and sends it through
// `send-transactional`: hours earned by referral (item 2.a), hours expiring in 3 days (item 2.b)
// and reengagement at 7, 14 and 30 days without use (item 3). Run once a day by the scheduler.
//
// Routes:
//   POST /run   { dry_run?: boolean }   [admin or machine key]
//               DRY RUN IS THE DEFAULT: only `"dry_run": false` sends. A dry run reads the
//               candidates and answers who WOULD receive what, and reserves nothing.
//   GET  /health                        [public]
//
// The database gives FACTS (`marketing.get_tourist_lifecycle_email_candidates`) and the proof of
// "once" (`marketing.claim_tourist_lifecycle_email`); the policy is `_shared/tourist-lifecycle-
// email.ts`. Both functions are service_role only and are the `data`'s to create (spec in #957).
// The RPCs are called over PostgREST with `fetch`, not supabase-js, so this file has no remote
// import and the whole handler runs under Node in `tests/api/tourist-lifecycle-email.test.ts`.
//
// Logs carry counts and the request id only: no address, no user id (PII).
//
// Secrets: SUPABASE_URL, the ef secret key (`_shared/secret-key.ts`),
//          APPLE_PRIVATE_RELAY_DOMAIN_VERIFIED (literal `true` to mail relay addresses).

import { requireAdmin } from '../_shared/auth-middleware.ts';
import { getSecretKey } from '../_shared/secret-key.ts';
import {
  claimTouristLifecycleEmails,
  countByType,
  lifecycleAuditLine,
  planTouristLifecycleEmails,
  type LifecycleCandidateRow,
  type LifecycleClaimVerdict,
  type LifecycleRecipient,
} from '../_shared/tourist-lifecycle-email.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CANDIDATES_RPC = 'get_tourist_lifecycle_email_candidates';
const CLAIM_RPC = 'claim_tourist_lifecycle_email';

/**
 * Resend allows 10 requests per second PER TEAM (https://resend.com/docs/api-reference/introduction)
 * and `send-transactional` shares that lane with account confirmation. 5 per second, the same
 * half `send-newsletter` takes.
 */
const MIN_INTERVAL_MS = 200;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Ctx {
  url: string;
  key: string;
}

/** A `marketing` RPC over PostgREST. Throws a typed code, never the body (it may carry PII). */
async function rpc<T>(ctx: Ctx, fn: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${ctx.url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: ctx.key,
      Authorization: `Bearer ${ctx.key}`,
      'Content-Type': 'application/json',
      'Content-Profile': 'marketing',
      'Accept-Profile': 'marketing',
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    let code = String(res.status);
    try {
      const body = await res.json();
      if (body && typeof body.code === 'string') code = body.code;
    } catch {
      // no body
    }
    throw new Error(`${fn}:${code}`);
  }
  return (await res.json()) as T;
}

async function claim(ctx: Ctx, r: LifecycleRecipient): Promise<LifecycleClaimVerdict> {
  const reserved = await rpc<unknown>(ctx, CLAIM_RPC, {
    p_user_id: r.user_id,
    p_kind: r.type,
    p_dedupe_key: r.dedupe_key,
  });
  if (reserved === true) return 'reserved';
  if (reserved === false) return 'already_claimed';
  return 'claim_failed';
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const requestId = crypto.randomUUID();
  const path = new URL(req.url).pathname.replace(/.*\/tourist-lifecycle-email/, '') || '/';
  if (path === '/health') return json({ status: 'ok' });

  const auth = await requireAdmin(req, { ...corsHeaders, 'Content-Type': 'application/json' });
  if (auth instanceof Response) {
    console.warn(`[${requestId}] refused ${path}: ${auth.status}`);
    return auth;
  }

  if (path !== '/run' || req.method !== 'POST') return json({ error: 'not_found' }, 404);

  const body = await req.json().catch(() => ({}));
  if (body !== null && typeof body !== 'object') return json({ error: 'invalid_body' }, 400);
  const dryRun = (body as { dry_run?: unknown })?.dry_run !== false;

  const url = (Deno.env.get('SUPABASE_URL') ?? '').trim().replace(/\/$/, '');
  const key = (getSecretKey() ?? '').trim();
  if (!url || !key) return json({ error: 'not_configured' }, 500);
  const ctx: Ctx = { url, key };

  let rows: LifecycleCandidateRow[];
  try {
    const answer = await rpc<unknown>(ctx, CANDIDATES_RPC, {});
    if (!Array.isArray(answer)) throw new Error(`${CANDIDATES_RPC}:shape`);
    rows = answer as LifecycleCandidateRow[];
  } catch (e) {
    // PGRST202 here means the `data` migration of #957 is not applied yet.
    console.error(`[${requestId}] candidates unavailable: ${(e as Error).message}`);
    return json({ error: 'candidates_unavailable', detail: (e as Error).message }, 503);
  }

  const plan = planTouristLifecycleEmails({
    rows,
    now: new Date(),
    relayDomainVerifiedRaw: Deno.env.get('APPLE_PRIVATE_RELAY_DOMAIN_VERIFIED'),
  });

  if (dryRun) {
    console.log(`[${requestId}] tourist e-mail: ${lifecycleAuditLine(plan, true)}`);
    return json({
      dry_run: true,
      // The caller is an operator or our scheduler; the address stays out of the answer anyway.
      would_send: plan.recipients.map((r) => ({
        user_id: r.user_id,
        type: r.type,
        lang: r.lang,
        dedupe_key: r.dedupe_key,
      })),
      by_type: countByType(plan.recipients),
      discarded: plan.discarded,
      candidates: plan.candidates,
    });
  }

  const reserved = await claimTouristLifecycleEmails(plan, (r) => claim(ctx, r));

  let sent = 0;
  let failed = 0;
  let nextAt = 0;
  for (const r of reserved.recipients) {
    const wait = nextAt - Date.now();
    if (wait > 0) await sleep(wait);
    nextAt = Date.now() + MIN_INTERVAL_MS;
    try {
      const res = await fetch(`${url}/functions/v1/send-transactional/send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: r.type, to: r.email, lang: r.lang, data: r.data }),
      });
      // The slot is NOT given back on failure: a retry could deliver twice (see the plan module).
      if (res.ok) sent += 1;
      else failed += 1;
    } catch {
      failed += 1;
    }
  }

  console.log(
    `[${requestId}] tourist e-mail: ${lifecycleAuditLine(reserved, false)} sent=${sent} failed=${failed}`
  );
  return json({
    dry_run: false,
    sent,
    failed,
    by_type: countByType(reserved.recipients),
    discarded: reserved.discarded,
    candidates: reserved.candidates,
  });
});
