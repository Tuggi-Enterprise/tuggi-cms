/**
 * trip-reminder: the trip reminder N days before and on the day (BR-COMUNICACAO-023, #1231), and the
 * stop link of its e-mail. Contract: `docs/contracts/viagem-marcada-e-lembrete.md`, #1231 items 1 and 4.
 *
 *   POST /run         machine key only (pg_cron + pg_net, every 15 minutes)
 *                     -> 200 { claimed, push, email, phone }   500 when the claim fails   401 otherwise
 *   GET|POST /stop?e=&s=&scope=trip_reminder&lang=   public, signed (`unsubscribe-link.ts`)
 *                     -> 200 text, the confirmation in the reader's language   400 for a link we did not sign
 *                     GET is the footer link (one tap, no login, §9.b); POST is RFC 8058 one-click.
 *                     GET with `o=1` is the header URL fetched by anti-spam: 200, writes nothing.
 *
 * Deploy with `--no-verify-jwt`: the cron presents `ef_secret_key`, which is not a JWT, and the stop
 * link is opened from a mail client. The work is `_shared/trip-reminder.ts`.
 * Secrets: SUPABASE_URL, the ef secret key, NEWSLETTER_SECRET, RESEND_API_KEY (unless the CMS slot
 * `email.api_key` is filled), RESEND_FROM, PUBLIC_FUNCTIONS_URL, APPLE_PRIVATE_RELAY_DOMAIN_VERIFIED.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { isOwnMachineKey } from '../_shared/auth-middleware.ts';
import type { DriveRpc } from '../_shared/push-gate.ts';
import { createPushSender } from '../_shared/push-send.ts';
import { getSecretKey } from '../_shared/secret-key.ts';
import { normalizeTouristLang } from '../_shared/tourist-email.ts';
import { TRIP_EMAIL_COPY } from '../_shared/trip-message-copy.ts';
import { runTripReminders, TripReminderClaimError, type EmailConfig } from '../_shared/trip-reminder.ts';
import { isOneClickProbe, verifyScopedStop } from '../_shared/unsubscribe-link.ts';

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const env = (name: string) => (Deno.env.get(name) ?? '').trim();

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/.*\/trip-reminder/, '') || '/';
  const supabaseUrl = env('SUPABASE_URL').replace(/\/$/, '');
  const machineKey = getSecretKey().trim();
  const functionsUrl = env('PUBLIC_FUNCTIONS_URL') || `${supabaseUrl}/functions/v1`;

  if (path === '/stop' && (req.method === 'GET' || req.method === 'POST')) {
    const email = await verifyScopedStop(
      'trip_reminder',
      url.searchParams.get('scope') === 'trip_reminder' ? url.searchParams.get('e') : null,
      url.searchParams.get('s'),
      env('NEWSLETTER_SECRET')
    );
    if (!email) return json({ error: 'invalid_link' }, 400);
    const lang = normalizeTouristLang(url.searchParams.get('lang'));
    const answer = (body: string) =>
      new Response(body, { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
    if (isOneClickProbe(req, url)) return answer(TRIP_EMAIL_COPY.stop_header_get[lang]);
    const supabase = createClient(supabaseUrl, machineKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { error } = await supabase.schema('drive').rpc('stop_trip_reminder_emails', { p_email: email });
    if (error) {
      console.error(`[trip-reminder] stop failed: ${error.code ?? 'unknown'}`);
      return json({ error: 'server_error' }, 500);
    }
    return answer(TRIP_EMAIL_COPY.stop_done[lang]);
  }

  if (path !== '/run') return json({ error: 'not_found' }, 404);
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!isOwnMachineKey(bearer)) return json({ error: 'unauthorized' }, 401);

  const supabase = createClient(supabaseUrl, machineKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const drive = supabase.schema('drive') as unknown as DriveRpc;
  const { send } = createPushSender(supabase, crypto.randomUUID());

  // The CMS slot wins; the project's key keeps the e-mail going while the slot is empty.
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
          relayDomainVerifiedRaw: Deno.env.get('APPLE_PRIVATE_RELAY_DOMAIN_VERIFIED'),
        }
      : null;

  try {
    const report = await runTripReminders({
      drive,
      fetch: (input, init) => fetch(input, init),
      smsStatusCallback: `${functionsUrl}/sms-webhook/status`,
      log: (line) => console.log(line),
      sendPush: send,
      email,
    });
    return json(report, 200);
  } catch (error) {
    const code = error instanceof TripReminderClaimError ? error.code : 'internal';
    console.error(`[trip-reminder] run aborted: ${code}`);
    return json({ error: 'server_error' }, 500);
  }
});
