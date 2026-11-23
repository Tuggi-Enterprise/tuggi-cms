/**
 * trip-message-test: "send a test to me" of the trip message screen of the CMS (BR-COMUNICACAO-024
 * item 9, #1231; the caller is the CMS server of #1233). Contract: `docs/contracts/viagem-marcada-e-lembrete.md`, #1231.
 *
 *   POST { piece: 'phone_confirmation' | 'trip_reminder_before' | 'trip_reminder_day',
 *          channel: 'push' | 'email' | 'whatsapp' | 'sms' }
 *   Authorization: Bearer <the access token of the admin signed in to the CMS>
 *   x-cms-job-secret: <CMS_JOB_SECRET>, the secret the CMS server and the functions share
 *   -> 200 { ok, channel, error_code? }   the attempt was made (or refused for a reason in error_code)
 *   -> 400 { ok: false, error_code: 'invalid_body' }
 *   -> 401 / 403 { ok: false }            no job secret or no user / not an active admin of core.cms_users
 *
 * The message goes to the e-mail and to `core.cms_users.phone` of that admin, never to an address in
 * the body, and is recorded with `p_piece = 'test'`. The work is `_shared/trip-message-test.ts`.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { constantTimeEqual } from '../_shared/constant-time.ts';
import { CMS_JOB_SECRET_HEADER } from '../_shared/places-payout.ts';
import type { DriveRpc } from '../_shared/push-gate.ts';
import { createPushSender } from '../_shared/push-send.ts';
import { getSecretKey } from '../_shared/secret-key.ts';
import { parseTestRequest, sendTestMessage } from '../_shared/trip-message-test.ts';
import type { EmailConfig } from '../_shared/trip-reminder.ts';

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const env = (name: string) => (Deno.env.get(name) ?? '').trim();

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ ok: false, error_code: 'method_not_allowed' }, 405);
  // Only the CMS server: the shared `CMS_JOB_SECRET`, checked before the token (the pattern of the
  // support actions of `places-payment`, #1054, which the caller of #1233 follows).
  const expected = env('CMS_JOB_SECRET');
  const provided = (req.headers.get(CMS_JOB_SECRET_HEADER) ?? '').trim();
  if (!expected || !provided || !constantTimeEqual(provided, expected)) return json({ ok: false }, 401);
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ?? '';
  if (!token) return json({ ok: false }, 401);

  const supabaseUrl = env('SUPABASE_URL').replace(/\/$/, '');
  const supabase = createClient(supabaseUrl, getSecretKey().trim(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: auth, error: authError } = await supabase.auth.getUser(token);
  const user = auth?.user;
  if (authError || !user?.id || !user.email || user.is_anonymous) return json({ ok: false }, 401);

  // `drive.assert_cms_admin`: active, role admin, matched by e-mail. Exact values, no pattern.
  const { data: admin, error: adminError } = await supabase
    .schema('core')
    .from('cms_users')
    .select('email, phone, role, is_active')
    .in('email', [...new Set([user.email, user.email.toLowerCase()])])
    .eq('is_active', true)
    .eq('role', 'admin')
    .maybeSingle();
  if (adminError || !admin) return json({ ok: false }, 403);

  const request = parseTestRequest(await req.json().catch(() => null));
  if (!request) return json({ ok: false, error_code: 'invalid_body' }, 400);

  const drive = supabase.schema('drive') as unknown as DriveRpc;
  const { data: profile } = await supabase.schema('drive').from('profiles').select('language').eq('id', user.id).maybeSingle();
  const functionsUrl = env('PUBLIC_FUNCTIONS_URL') || `${supabaseUrl}/functions/v1`;
  const { data: emailSecrets } = await drive.rpc('get_provider_secrets', { p_channel: 'email' });
  const apiKey = String((emailSecrets as Record<string, unknown> | null)?.['email.api_key'] ?? '').trim() || env('RESEND_API_KEY');
  const secret = env('NEWSLETTER_SECRET');
  const email: EmailConfig | null =
    apiKey && secret
      ? {
          apiKey,
          from: env('RESEND_FROM') || 'Tuggi <news@tuggi.app>',
          functionsUrl,
          secret,
          // The admin's own address: the relay check of BR-COMUNICACAO-020 item 7 is not this test's.
          relayDomainVerifiedRaw: 'true',
        }
      : null;

  const result = await sendTestMessage(
    {
      drive,
      fetch: (input, init) => fetch(input, init),
      smsStatusCallback: `${functionsUrl}/sms-webhook/status`,
      log: (line) => console.log(line),
      sendPush: createPushSender(supabase, crypto.randomUUID()).send,
      email,
    },
    {
      userId: user.id,
      email: String(admin.email ?? user.email),
      phone: typeof admin.phone === 'string' ? admin.phone.replace(/[\s().-]/g, '') : null,
      language: typeof profile?.language === 'string' ? profile.language : 'pt-BR',
    },
    request
  );
  console.log(`[trip-message-test] ${request.piece}/${request.channel} ok=${result.ok} code=${result.error_code ?? '-'}`);
  return json(result, 200);
});
