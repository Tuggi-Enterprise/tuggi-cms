/**
 * social-collect: the daily collector of the CMS social analytics (#1059).
 *
 *   POST {}                                  daily run (pg_cron `social-collect`, 09:00 UTC = 6h Brasília)
 *   POST {"force_weekly": true}              the same run, writing the weekly recommendation on any day
 *   POST {"job":"stories"}                   the live stories only (pg_cron `social-collect-stories`, hourly)
 *   POST {"action":"lookup","username":"x"}  Business Discovery only: the CMS checks a username
 *   -> 200 the run report, or { ok, ig_user_id, followers_count } / { ok: false, reason }
 *   -> 400 bad action, job or username, 401 any caller without our secret key, 405 any other method,
 *      503 when META_PAGE_TOKEN or META_IG_USER_ID is missing (nothing is written)
 *
 * #1062: the daily run also reads the App Store Connect Analytics Reports (first-time downloads by
 * campaign) when APPLE_ASC_KEY_ID, APPLE_ASC_ISSUER_ID and APPLE_ASC_PRIVATE_KEY are set; without them
 * it records `apple` as `not_configured` in `social.collector_runs` and goes on.
 *
 * Machine key only (`isOwnSecretKey`: `ef_secret_key` of the cron, `cms_secret_key` of the CMS
 * server). The Meta token lives in this function's secrets and nowhere else: the CMS validates a
 * username by calling the lookup above, never the Graph API. The work is `_shared/social-collect.ts`;
 * this file authenticates and wires the clients. Deploy with `--no-verify-jwt`: no caller sends a JWT.
 */
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getSecretKey, isOwnSecretKey } from '../_shared/secret-key.ts';
import { GA4_CREDENTIALS_ENV, ga4Runner, parseServiceAccount } from '../_shared/ga4-data.ts';
import { runGeminiPromptWithUsage } from '../_shared/translationUtility.ts';
import { appleConfig } from '../_shared/apple-downloads.ts';
import {
  type Gemini,
  lookupAccount,
  metaClient,
  recordRun,
  runSocialCollect,
  runStoriesCollect,
  supabaseStore,
} from '../_shared/social-collect.ts';

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!isOwnSecretKey(bearer)) return json({ error: 'unauthorized' }, 401);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown> | null;
  const action = body?.action;
  if (action !== undefined && action !== 'lookup') return json({ error: 'unknown_action' }, 400);
  const job = body?.job;
  if (job !== undefined && job !== 'stories') return json({ error: 'unknown_job' }, 400);

  const token = (Deno.env.get('META_PAGE_TOKEN') ?? '').trim();
  const igUserId = (Deno.env.get('META_IG_USER_ID') ?? '').trim();
  if (!token || !igUserId) {
    console.error('[social-collect] META_PAGE_TOKEN or META_IG_USER_ID missing');
    return json({ error: 'meta_not_configured' }, 503);
  }
  const meta = metaClient({
    fetch: (url, init) => fetch(url, init),
    token,
    igUserId,
    version: Deno.env.get('META_GRAPH_VERSION') || undefined,
  });

  if (action === 'lookup') {
    const result = await lookupAccount(meta, body?.username);
    return json(result, result.ok || result.reason !== 'invalid' ? 200 : 400);
  }

  const supabaseUrl = (Deno.env.get('SUPABASE_URL') ?? '').trim();
  const social = createClient(supabaseUrl, getSecretKey().trim(), {
    auth: { autoRefreshToken: false, persistSession: false },
  }).schema('social');
  const store = supabaseStore(social);
  const now = () => new Date();
  const log = (line: string) => console.log(line);

  if (job === 'stories') {
    const report = await runStoriesCollect({ store, meta, ga4: null, gemini: null, now, log });
    console.log(`[social-collect] stories ${JSON.stringify(report)}`);
    return json(report ?? { error: 'stories_failed' }, report ? 200 : 500);
  }

  const sa = parseServiceAccount(Deno.env.get(GA4_CREDENTIALS_ENV));
  const geminiKey = (Deno.env.get('GEMINI_API_KEY') ?? '').trim();
  const gemini: Gemini | null = geminiKey
    ? async (prompt) => {
      try {
        const r = await runGeminiPromptWithUsage(prompt, geminiKey, 4096, 0.3);
        return { text: r.text, model: r.usage?.model ?? 'unknown' };
      } catch {
        // The helper's message can carry the request URL, and the key rides in it: never forward it.
        throw new Error('gemini_failed');
      }
    }
    : null;

  try {
    const report = await runSocialCollect({
      store,
      meta,
      ga4: sa ? (propertyId) => ga4Runner(sa, propertyId, (url, init) => fetch(url, init)) : null,
      gemini,
      now,
      log,
      forceWeekly: body?.force_weekly === true,
      apple: { config: appleConfig((name) => Deno.env.get(name)), fetch: (url, init) => fetch(url, init) },
    });
    console.log(`[social-collect] done ${JSON.stringify(report)}`);
    return json(report, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown';
    console.error(`[social-collect] run aborted: ${message}`);
    await recordRun({ store, now, log }, 'daily', 'error', message);
    return json({ error: 'server_error' }, 500);
  }
});
