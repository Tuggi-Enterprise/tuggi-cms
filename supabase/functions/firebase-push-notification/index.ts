import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getSecretKey } from '../_shared/supabase-client.ts';
import { requireAdmin } from '../_shared/auth-middleware.ts';
import { resolveDeeplink } from '../_shared/notification-deeplink.ts';
// BR-COMUNICACAO-019 (#955): every push to a tourist passes the gate inside the one sender,
// `_shared/push-send.ts`, which `/send`, `/process-scheduled` and `weekly-local-push` share (#1046).
import { createPushSender } from '../_shared/push-send.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const requestId = crypto.randomUUID();
  console.log(`[${requestId}] 🚀 Function started: ${req.method} ${req.url}`);

  try {
    const url = new URL(req.url);
    const path = url.pathname.replace(/.*\/firebase-push-notification/, '') || '/';
    console.log(`[${requestId}] 📍 Path: ${path}`);

    // ---- AUTHORIZATION (#346) — everything but /health ----
    //
    // A POST to `/send` with `type: 'broadcast'` and `filters: {}` resolves
    // `core.get_audience_push_tokens({})`, which is THE WHOLE BASE, with an arbitrary title,
    // body and deeplink, and writes a row into every user's inbox. Until now this route read no
    // `Authorization` at all, and the gateway's `verify_jwt` is satisfied by the publishable key
    // that ships inside the app binary and the site's JS.
    //
    // `requireAdmin` lets our own machine keys through (`isOwnMachineKey`), which is what keeps
    // the callers that are not people working: `daily-gamification-orchestrator` (EF-to-EF) and
    // the database — `core.notify_partner_event` and
    // `core.trigger_process_scheduled_notifications` — all of them carrying the `ef_secret_key`
    // from the Vault. The migration FILES say the database posts with a `SERVICE_ROLE_KEY`; the
    // Vault has no such entry, so a function that still read that name would resolve a null key
    // and never reach us at all. See `isOwnMachineKey` for the measurement.
    if (path !== '/health') {
      const auth = await requireAdmin(req, { ...corsHeaders, 'Content-Type': 'application/json' });
      if (auth instanceof Response) {
        console.warn(`[${requestId}] ⛔ refused ${path}: ${auth.status}`);
        return auth;
      }
      console.log(`[${requestId}] 🔓 authorized (${auth.role ?? 'none'})`);
    }

    // Get environment variables inside handler to be safe
    const SUPABASE_URL = (Deno.env.get('SUPABASE_URL') ?? '').trim();
    const SUPABASE_SECRET_KEY = (getSecretKey() ?? '').trim();

    // Initialize Supabase client
    const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const { send, gatedSendToUsers, logResult } = createPushSender(supabase, requestId);

    // -------- ROUTES --------
    if (path === '/send') {
      const answer = await send(await req.json());
      return new Response(JSON.stringify(answer.body), {
        status: answer.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (path === '/schedule') {
      const body = await req.json();
      const {
        type,
        notification,
        userIds = [],
        topic = null,
        priority = 'normal',
        ttl = 3600,
        scheduleAt,
        filters,
      } = body;

      if (!scheduleAt) {
        return new Response(JSON.stringify({ error: 'scheduleAt is required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      // Same refusal as /send (#955, BR-COMUNICACAO-019 item 9): a topic cannot be capped.
      if (type === 'topic') {
        return new Response(JSON.stringify({ error: 'TOPIC_NOT_GATED' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { data: inserted, error: schedErr } = await supabase
        .schema('marketing')
        .from('scheduled_notifications')
        .insert({
          type,
          title: notification?.title ?? '',
          body: notification?.body ?? '',
          data: notification?.data ?? {},
          image_url: notification?.imageUrl ?? null,
          user_ids: userIds,
          topic,
          priority,
          ttl,
          scheduled_for: scheduleAt,
          status: 'pending',
          audience_filters: filters ?? {},
        })
        .select('id')
        .single();

      if (schedErr) {
        console.error(`[${requestId}] ❌ schedule insert error:`, schedErr?.code ?? 'unknown');
        throw schedErr;
      }

      console.log(`[${requestId}] ⏰ scheduled ${type} ${inserted?.id} for ${scheduleAt}`);
      return new Response(JSON.stringify({ success: true, id: inserted?.id }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (path === '/process-scheduled') {
      console.log(`[${requestId}] ⏳ Processing scheduled notifications...`);
      
      // 1. Fetch pending notifications scheduled for NOW or earlier
      const { data: pending, error: fetchError } = await supabase
        .schema('marketing')
        .from('scheduled_notifications')
        .select('*')
        .eq('status', 'pending')
        .lte('scheduled_for', new Date().toISOString())
        .limit(10); // Batch process

      if (fetchError) throw fetchError;
      if (!pending || pending.length === 0) {
        return new Response(JSON.stringify({ success: true, message: 'No pending notifications' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      console.log(`[${requestId}] 🎯 Found ${pending.length} pending notifications.`);
      const results = [];

      for (const item of pending) {
        let stats;
        let recipientCount = 0;
        let scheduledBroadcastIds: string[] = [];

        // Mark as processing to avoid double-spend
        await supabase.schema('marketing').from('scheduled_notifications')
            .update({ status: 'processing', updated_at: new Date().toISOString() })
            .eq('id', item.id);

        try {
            const itemNotification = { title: item.title, body: item.body, data: item.data };
            const itemPriority = item.priority || 'normal';
            const itemTtl = item.ttl || 3600;
            if (item.type === 'user') {
                // The scheduled direct send passes the same gate as /send (#955).
                const sent = await gatedSendToUsers(item.user_ids, itemNotification, 'cms_direct', itemPriority, itemTtl, {
                    persistInbox: false,
                    skipWithoutDevice: false,
                });
                stats = sent.stats;
                recipientCount = sent.tokenCount;
            } else if (item.type === 'broadcast') {
                // Same audience as the immediate /send broadcast: the inbox rows of the filter
                // (#858), then person by person through the gate (#955).
                if (item.title) {
                    const notifType = item.data?.type ?? 'generic';
                    // `item.data` is the `notification.data` frozen by /schedule.
                    const deeplink = resolveDeeplink(item.data);
                    const { data: inboxIds, error: inboxErr } = await supabase
                        .schema('core')
                        .rpc('broadcast_persist_inbox', {
                            p_filters: item.audience_filters ?? {},
                            p_type: notifType,
                            p_title: item.title,
                            p_body: item.body ?? null,
                            p_data: item.data ?? {},
                            p_deeplink: deeplink,
                        });
                    if (inboxErr) throw inboxErr;
                    scheduledBroadcastIds = inboxIds || [];
                    console.log(`[${requestId}] 📥 ${scheduledBroadcastIds.length} scheduled broadcast inbox rows persisted`);
                }
                const pass = await gatedSendToUsers(scheduledBroadcastIds, itemNotification, 'cms_broadcast', itemPriority, itemTtl, {
                    persistInbox: false,
                    skipWithoutDevice: true,
                });
                stats = pass.stats;
                recipientCount = pass.tokenCount;
            } else {
                // A topic item (scheduled before #955) cannot pass the cap: it fails loudly.
                throw new Error('TOPIC_NOT_GATED');
            }

            // Same rule as /send: an aborted run never counts as sent. Only this
            // item is abandoned — each pending row carries its own payload, so a
            // payload FCM refuses says nothing about the next one in the batch.
            const itemStatus = stats.aborted
                ? 'failed'
                : stats.success > 0
                  ? (stats.failure > 0 ? 'partial' : 'sent')
                  : 'failed';

            // Mark as sent
            await supabase.schema('marketing').from('scheduled_notifications')
                .update({
                    status: itemStatus,
                    processed_at: new Date().toISOString(),
                    error_details: stats.failure > 0 ? stats.errors.join(', ') : null
                })
                .eq('id', item.id);

            // Log the result
            const schedLogUserIds = item.type === 'broadcast' ? scheduledBroadcastIds : item.user_ids;
            await logResult(
                item.type,
                { title: item.title, body: item.body, data: item.data },
                schedLogUserIds,
                item.topic,
                itemStatus,
                stats,
                item.type === 'broadcast' ? (item.audience_filters ?? {}) : null,
                recipientCount
            );
            results.push({ id: item.id, status: itemStatus, ...(stats.aborted ? { aborted: stats.aborted } : {}) });

        } catch (e) {
            console.error(`[${requestId}] ⚠️ Failed processing notification ${item.id}:`, (e as Error).message);
            await supabase.schema('marketing').from('scheduled_notifications')
                .update({ status: 'failed', error_details: (e as Error).message })
                .eq('id', item.id);
        }
      }

      return new Response(JSON.stringify({ success: true, processed: results.length, results }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (path === '/health') {
      return new Response(JSON.stringify({ status: 'ok' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: corsHeaders });

  } catch (err: any) {
    console.error(`[${requestId}] 💥 Fatal error:`, (err as { code?: string })?.code ?? (err as Error)?.message);
    return new Response(JSON.stringify({ 
      error: 'Internal Server Error',
      message: err.message,
      requestId,
      stack: err.stack 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
