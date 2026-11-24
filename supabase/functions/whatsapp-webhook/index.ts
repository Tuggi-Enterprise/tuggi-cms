/**
 * whatsapp-webhook: the Cloud API webhook of the trip messages (BR-COMUNICACAO-024 items 5 and 7,
 * #1231). Built and idle while `channel.whatsapp` is off and the slots are empty.
 *
 *   GET  ?hub.mode=subscribe&hub.verify_token=&hub.challenge=   the subscription check of Meta
 *        -> 200 the challenge when the token is `whatsapp.webhook_verify_token`, 403 otherwise
 *   POST the notifications, signed with `whatsapp.app_secret` (`X-Hub-Signature-256`)
 *        -> 200 once the signature holds (Meta retries anything else), 401 when it does not
 *
 * Statuses go to `record_message_status` and may settle the confirmation; a stop reply stops the
 * number and is answered once, in free text, inside the window it opened. The work is
 * `_shared/message-webhooks.ts`. Deploy with `--no-verify-jwt`: Meta sends no JWT.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { constantTimeEqual } from '../_shared/constant-time.ts';
import { sendWhatsappText } from '../_shared/message-channels.ts';
import {
  applyReply,
  applyStatus,
  languageOfNumber,
  parseWhatsappNotification,
  verifyMetaSignature,
} from '../_shared/message-webhooks.ts';
import type { DriveRpc } from '../_shared/push-gate.ts';
import { getSecretKey } from '../_shared/secret-key.ts';
import { WHATSAPP_STOP_REPLY } from '../_shared/trip-message-copy.ts';

const text = (body: string, status: number) => new Response(body, { status, headers: { 'Content-Type': 'text/plain' } });

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const supabaseUrl = (Deno.env.get('SUPABASE_URL') ?? '').trim().replace(/\/$/, '');
  const supabase = createClient(supabaseUrl, getSecretKey().trim(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const drive = supabase.schema('drive') as unknown as DriveRpc;
  const { data } = await drive.rpc('get_provider_secrets', { p_channel: 'whatsapp' });
  const secrets = (data ?? {}) as Record<string, string | undefined>;

  if (req.method === 'GET') {
    const token = url.searchParams.get('hub.verify_token') ?? '';
    const expected = secrets['whatsapp.webhook_verify_token'] ?? '';
    if (url.searchParams.get('hub.mode') === 'subscribe' && expected && constantTimeEqual(token, expected)) {
      return text(url.searchParams.get('hub.challenge') ?? '', 200);
    }
    return text('forbidden', 403);
  }
  if (req.method !== 'POST') return text('method not allowed', 405);

  const raw = await req.text();
  if (!(await verifyMetaSignature(raw, req.headers.get('x-hub-signature-256'), secrets['whatsapp.app_secret']))) {
    return text('unauthorized', 401);
  }

  let body: unknown = null;
  try {
    body = JSON.parse(raw);
  } catch {
    return text('ok', 200);
  }
  const deps = { drive, fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init), log: (l: string) => console.log(l) };
  const { statuses, replies } = parseWhatsappNotification(body);
  let settled = 0;
  for (const status of statuses) {
    if ((await applyStatus(deps, 'whatsapp', status)).settled) settled += 1;
  }
  let stops = 0;
  for (const reply of replies) {
    if (await applyReply(deps, reply)) {
      stops += 1;
      await sendWhatsappText(deps.fetch, secrets, reply.from, WHATSAPP_STOP_REPLY[languageOfNumber(reply.from)]);
    }
  }
  console.log(`[whatsapp-webhook] statuses=${statuses.length} settled=${settled} replies=${replies.length} stops=${stops}`);
  return text('ok', 200);
});
