/**
 * partner-message-send: the round of the partner message (BR-COMUNICACAO-026, #1264) and the two
 * signed links of its e-mail. Contract: `docs/contracts/tuggi-do-parceiro.md` §11.3.
 *
 *   POST /                       machine key only (pg_cron job `partner-message-send`, every 15 minutes,
 *                                only with `partner_message.enabled` on)
 *   GET|POST /stop?r=&s=&lang=   public, signed: stop the messages of that partner (5.d)
 *   GET /click?r=&u=&s=          public, signed: count the open and go to the button (6.e)
 *
 * Deploy with `--no-verify-jwt`: the job presents `ef_secret_key`, which is not a JWT, and both links
 * are opened from a mail client. The work is `_shared/partner-message-send.ts`.
 * Secrets: SUPABASE_URL, the ef secret key, NEWSLETTER_SECRET, RESEND_API_KEY (unless the CMS slot
 * `email.api_key` is filled), RESEND_FROM, PARTNER_MESSAGE_REPLY_TO, PUBLIC_FUNCTIONS_URL, APP_URL,
 * APPLE_PRIVATE_RELAY_DOMAIN_VERIFIED, FIREBASE_*.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { isOwnMachineKey } from '../_shared/auth-middleware.ts';
import {
  handlePartnerMessageRequest,
  runPartnerMessageRound,
  type PartnerEmailConfig,
} from '../_shared/partner-message-send.ts';
import type { DriveRpc } from '../_shared/push-gate.ts';
import { createPushSender } from '../_shared/push-send.ts';
import { getSecretKey } from '../_shared/secret-key.ts';

const env = (name: string) => (Deno.env.get(name) ?? '').trim();

/** The site that hosts `/unsubscribe`, the same default `send-transactional` uses. */
const DEFAULT_SITE_ORIGIN = 'https://www.tuggi.app';
/** Replies reach the Tuggi (BR-COMUNICACAO-026 item 6.c), the support box by default. */
const DEFAULT_REPLY_TO = 'suporte@tuggi.app';

Deno.serve((req: Request) => {
  const supabaseUrl = env('SUPABASE_URL').replace(/\/$/, '');
  const machineKey = getSecretKey().trim();
  const functionsUrl = env('PUBLIC_FUNCTIONS_URL') || `${supabaseUrl}/functions/v1`;
  const secret = env('NEWSLETTER_SECRET');
  const client = () => createClient(supabaseUrl, machineKey, { auth: { autoRefreshToken: false, persistSession: false } });

  return handlePartnerMessageRequest(req, {
    isMachineKey: isOwnMachineKey,
    secret,
    drive: () => client().schema('drive') as unknown as DriveRpc,
    log: (line) => console.log(line),
    run: async () => {
      const supabase = client();
      const drive = supabase.schema('drive') as unknown as DriveRpc;
      const { send } = createPushSender(supabase, crypto.randomUUID());
      // The CMS slot wins; the project's key keeps the e-mail going while the slot is empty.
      const { data: emailSecrets } = await drive.rpc('get_provider_secrets', { p_channel: 'email' });
      const apiKey = String((emailSecrets as Record<string, unknown> | null)?.['email.api_key'] ?? '').trim() || env('RESEND_API_KEY');
      const email: PartnerEmailConfig | null =
        apiKey && secret
          ? {
              apiKey,
              from: env('RESEND_FROM') || 'Tuggi <news@tuggi.app>',
              replyTo: env('PARTNER_MESSAGE_REPLY_TO') || DEFAULT_REPLY_TO,
              functionsUrl,
              siteUrl: env('APP_URL') || DEFAULT_SITE_ORIGIN,
              storageUrl: supabaseUrl,
              secret,
              relayDomainVerifiedRaw: Deno.env.get('APPLE_PRIVATE_RELAY_DOMAIN_VERIFIED'),
            }
          : null;
      return runPartnerMessageRound({
        drive,
        fetch: (input, init) => fetch(input, init),
        sendPush: (body, internal) => send(body, internal),
        email,
        log: (line) => console.log(line),
      });
    },
  });
});
