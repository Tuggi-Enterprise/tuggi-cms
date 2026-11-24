/**
 * first-story-push: the push after the first story, once in a life (BR-COMUNICACAO-019 item 3.n,
 * #1072; contract `docs/contracts/notificacoes.md` §14).
 *
 *   POST, no body, machine key only (pg_cron, once an hour)
 *   -> 200 { candidates, outcomes: { sent, denied, not_delivered, failed }, invalid, marked, unmarked }
 *   -> 500 with the same report when the mark failed twice: nobody was sent to (`unmarked` > 0)
 *   -> 401 any other caller, 405 any other method, 500 when the candidate query fails
 *
 * The work lives in `_shared/first-story-push.ts`; this file only authenticates and wires the
 * client and the in-process sender of `_shared/push-send.ts` (#1046: no call to another function).
 * Deploy with `--no-verify-jwt`: the cron presents `ef_secret_key`, which is not a JWT.
 */
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { isOwnMachineKey } from '../_shared/auth-middleware.ts';
import { FirstStoryCandidatesError, firstStoryRunFailed, runFirstStoryPush } from '../_shared/first-story-push.ts';
import { createPushSender } from '../_shared/push-send.ts';
import { getSecretKey } from '../_shared/secret-key.ts';

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  // The machine key and nothing else. `requireAdmin` also admits a CMS admin session, and nobody
  // signed in has a reason to fire this push at the whole due audience.
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!isOwnMachineKey(bearer)) return json({ error: 'unauthorized' }, 401);

  const supabaseUrl = (Deno.env.get('SUPABASE_URL') ?? '').trim();
  const machineKey = getSecretKey().trim();
  const supabase = createClient(supabaseUrl, machineKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  // One sender for the run: one OAuth exchange with Google, shared by every person.
  const { send } = createPushSender(supabase, crypto.randomUUID());

  try {
    const report = await runFirstStoryPush({
      drive: supabase.schema('drive'),
      send,
      log: (line) => console.log(line),
    });
    // The mark failed and nothing went out: the cron must see a failure, not a quiet 2xx.
    return json(report, firstStoryRunFailed(report) ? 500 : 200);
  } catch (error) {
    const code = error instanceof FirstStoryCandidatesError ? error.code : 'internal';
    console.error(`[first-story-push] run aborted: ${code}`);
    return json({ error: 'server_error' }, 500);
  }
});
