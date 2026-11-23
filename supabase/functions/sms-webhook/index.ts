/**
 * sms-webhook: the Twilio webhooks of the trip messages (BR-COMUNICACAO-024 items 5 and 7, #1231).
 * Built and idle while `channel.sms` is off and the slots are empty.
 *
 *   POST /status    the `StatusCallback` of every SMS we send   -> 204
 *   POST /inbound   the messaging webhook of the number          -> 200 `<Response/>` (no reply)
 *   Both signed with `sms.auth_token` (`X-Twilio-Signature`)    -> 403 when the signature fails
 *
 * The signature covers the URL Twilio called, which is the one we gave it: PUBLIC_FUNCTIONS_URL (or
 * SUPABASE_URL/functions/v1) + `/sms-webhook/<route>`, not `req.url`, which the platform rewrites.
 * The answer to STOP, HELP and their synonyms is Twilio's opt-out management, configured with the
 * texts of `docs/design/copy/proxima-viagem-1229-2026-11.md` §9.d; replying here too would send two.
 * Deploy with `--no-verify-jwt`: Twilio sends no JWT.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  applyReply,
  applyStatus,
  formParams,
  parseTwilioInbound,
  parseTwilioStatus,
  verifyTwilioSignature,
} from '../_shared/message-webhooks.ts';
import type { DriveRpc } from '../_shared/push-gate.ts';
import { getSecretKey } from '../_shared/secret-key.ts';

const env = (name: string) => (Deno.env.get(name) ?? '').trim();

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
  const url = new URL(req.url);
  const route = url.pathname.replace(/.*\/sms-webhook/, '') || '/';
  if (route !== '/status' && route !== '/inbound') return new Response('not found', { status: 404 });

  const supabaseUrl = env('SUPABASE_URL').replace(/\/$/, '');
  const functionsUrl = env('PUBLIC_FUNCTIONS_URL') || `${supabaseUrl}/functions/v1`;
  const supabase = createClient(supabaseUrl, getSecretKey().trim(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const drive = supabase.schema('drive') as unknown as DriveRpc;
  const { data } = await drive.rpc('get_provider_secrets', { p_channel: 'sms' });
  const secrets = (data ?? {}) as Record<string, string | undefined>;

  const params = formParams(await req.text());
  const signedUrl = `${functionsUrl}/sms-webhook${route}${url.search}`;
  if (!(await verifyTwilioSignature(signedUrl, params, req.headers.get('x-twilio-signature'), secrets['sms.auth_token']))) {
    return new Response('forbidden', { status: 403 });
  }

  const deps = { drive, fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init), log: (l: string) => console.log(l) };
  if (route === '/status') {
    const status = parseTwilioStatus(params);
    const report = status ? await applyStatus(deps, 'sms', status) : null;
    console.log(`[sms-webhook] status found=${report?.found ?? false} settled=${report?.settled ?? '-'}`);
    return new Response(null, { status: 204 });
  }
  const reply = parseTwilioInbound(params);
  const stopped = reply ? await applyReply(deps, reply) : false;
  console.log(`[sms-webhook] inbound stop=${stopped}`);
  return new Response('<Response/>', { status: 200, headers: { 'Content-Type': 'text/xml' } });
});
