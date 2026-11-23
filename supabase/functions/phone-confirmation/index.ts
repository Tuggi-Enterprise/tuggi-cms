/**
 * phone-confirmation: the message that confirms the phone number (BR-COMUNICACAO-024 item 5, #1231).
 * Contract: `docs/contracts/viagem-marcada-e-lembrete.md`, "Fluxo da confirmação" and #1231.
 *
 *   POST, no body, `Authorization: Bearer <the user's JWT>` (the app, after `save_my_phone_v1`
 *   answered `confirmation: true`; it does not wait for this answer)
 *   -> 200 { ok: true }   claimed and sent, claimed and refused (recorded), or nothing to claim
 *   -> 401 { ok: false }  no valid user token
 *   -> 405                any other method
 *   -> 500 { ok: false }  the claim could not be asked
 *
 * The person is the `sub` of the token, never a field of a body. The work is
 * `_shared/phone-confirmation.ts`; this file authenticates and wires the client.
 * Secrets: SUPABASE_URL and the ef secret key. Logs carry outcomes only.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { confirmPhone } from '../_shared/phone-confirmation.ts';
import type { DriveRpc } from '../_shared/push-gate.ts';
import { getSecretKey } from '../_shared/secret-key.ts';

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ?? '';
  if (!token) return json({ ok: false }, 401);

  const url = (Deno.env.get('SUPABASE_URL') ?? '').trim().replace(/\/$/, '');
  const supabase = createClient(url, getSecretKey().trim(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await supabase.auth.getUser(token);
  const userId = data?.user?.id;
  if (error || typeof userId !== 'string') return json({ ok: false }, 401);

  const result = await confirmPhone(
    {
      drive: supabase.schema('drive') as unknown as DriveRpc,
      fetch: (input, init) => fetch(input, init),
      smsStatusCallback: `${url}/functions/v1/sms-webhook/status`,
      log: (line) => console.log(line),
    },
    userId
  );
  return json({ ok: result.ok }, result.ok ? 200 : 500);
});
