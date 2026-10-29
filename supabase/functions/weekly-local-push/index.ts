/**
 * weekly-local-push: the weekly push, Thursday 18h and Saturday 10h in the person's zone
 * (BR-COMUNICACAO-019 item 3.m, BR-COMUNICACAO-012 item 1.7; #1046, #1047).
 *
 *   POST, no body, machine key only (pg_cron `weekly-local-push`, minute 2 of every hour)
 *   -> 200 { claimed, outcomes: { sent, denied, not_delivered, failed }, invalid, unfinished }
 *   -> 401 any other caller, 405 any other method, 500 when the claim fails
 *
 * Contract: `docs/contracts/edge-functions.md`, "Dois baldes no portão". The work lives in
 * `_shared/weekly-local-push.ts`; this file only authenticates and wires the client and the sender
 * of `_shared/push-send.ts`, which runs here, in process (#1046: no call to another function).
 * Deploy with `--no-verify-jwt`: the cron presents `ef_secret_key`, which is not a JWT.
 */
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { isOwnMachineKey } from '../_shared/auth-middleware.ts';
import { createPushSender } from '../_shared/push-send.ts';
import { getSecretKey } from '../_shared/secret-key.ts';
import { runWeeklyLocalPush, WeeklyClaimError } from '../_shared/weekly-local-push.ts';

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  // Machine key only. The only caller is the database cron; a CMS session has no reason to fire a
  // push to the whole due audience, so `requireAdmin` (which admits one) is not the gate here.
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
    const report = await runWeeklyLocalPush({
      drive: supabase.schema('drive'),
      send,
      log: (line) => console.log(line),
    });
    return json(report, 200);
  } catch (error) {
    const code = error instanceof WeeklyClaimError ? error.code : 'internal';
    console.error(`[weekly-local-push] run aborted: ${code}`);
    return json({ error: 'server_error' }, 500);
  }
});
