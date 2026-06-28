
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getSecretKey } from '../_shared/supabase-client.ts';
import { partnerStrings, type PartnerEvent } from '../_shared/partner-i18n.ts';

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

    // Get environment variables inside handler to be safe
    const FIREBASE_PROJECT_ID = (Deno.env.get('FIREBASE_PROJECT_ID') ?? '').trim();
    const FIREBASE_PRIVATE_KEY = (Deno.env.get('FIREBASE_PRIVATE_KEY') ?? '').trim();
    const FIREBASE_CLIENT_EMAIL = (Deno.env.get('FIREBASE_CLIENT_EMAIL') ?? '').trim();
    const SUPABASE_URL = (Deno.env.get('SUPABASE_URL') ?? '').trim();
    const SUPABASE_SECRET_KEY = (getSecretKey() ?? '').trim();

    // Diagnostics
    if (!FIREBASE_PRIVATE_KEY) console.error(`[${requestId}] ❌ FIREBASE_PRIVATE_KEY is missing`);
    if (!FIREBASE_PROJECT_ID) console.error(`[${requestId}] ❌ FIREBASE_PROJECT_ID is missing`);

    // Initialize Supabase client
    const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Helper: JWT Creation
    const createAccessToken = async () => {
      console.log(`[${requestId}] 🔑 Generating Firebase Access Token...`);
      
      if (!FIREBASE_PROJECT_ID || !FIREBASE_PRIVATE_KEY || !FIREBASE_CLIENT_EMAIL) {
        throw new Error('Firebase credentials not configured');
      }

      // 1. Clean up private key aggressively
      console.log(`[${requestId}] 🧹 Cleaning PEM key...`);
      let pemContents = FIREBASE_PRIVATE_KEY
        .replace(/-----BEGIN PRIVATE KEY-----/g, '')
        .replace(/-----END PRIVATE KEY-----/g, '')
        .replace(/\\n/g, '\n') // Maintain internal newlines if escaped
        .replace(/[\s]/g, '') // Remove all whitespaces (important for Base64)
        .trim();

      // 2. Fix padding if necessary
      while (pemContents.length % 4 !== 0) {
        pemContents += '=';
      }

      console.log(`[${requestId}] 🛠 Cleaned length: ${pemContents.length}`);
      console.log(`[${requestId}] 🔍 Key preview: ${pemContents.substring(0, 10)}...${pemContents.substring(pemContents.length - 10)}`);

      // 3. Decode Base64 to Binary
      let binaryDer;
      try {
        const binaryDerString = atob(pemContents);
        binaryDer = new Uint8Array(binaryDerString.length);
        for (let i = 0; i < binaryDerString.length; i++) {
          binaryDer[i] = binaryDerString.charCodeAt(i);
        }
      } catch (e) {
        console.error(`[${requestId}] ❌ Final atob failure:`, e.message);
        throw new Error(`Invalid FIREBASE_PRIVATE_KEY format: ${e.message}`);
      }

      // 3. Import Key
      const key = await crypto.subtle.importKey(
        'pkcs8',
        binaryDer,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['sign']
      );

      // 4. Create JWT Payload
      const now = Math.floor(Date.now() / 1000);
      const header = { alg: 'RS256', typ: 'JWT' };
      const payload = {
        iss: FIREBASE_CLIENT_EMAIL,
        scope: 'https://www.googleapis.com/auth/firebase.messaging',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
      };

      const encodeBase64Url = (str: string) => btoa(str).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
      const headerPart = encodeBase64Url(JSON.stringify(header));
      const payloadPart = encodeBase64Url(JSON.stringify(payload));
      
      const encoder = new TextEncoder();
      const signature = await crypto.subtle.sign(
        'RSASSA-PKCS1-v1_5',
        key,
        encoder.encode(`${headerPart}.${payloadPart}`)
      );

      const signatureArray = new Uint8Array(signature);
      let binarySignature = '';
      for (let i = 0; i < signatureArray.length; i++) {
        binarySignature += String.fromCharCode(signatureArray[i]);
      }
      const signaturePart = btoa(binarySignature).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

      const jwt = `${headerPart}.${payloadPart}.${signaturePart}`;

      // 5. Exchange JWT for Access Token
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
      });

      const data = await response.json();
      if (!response.ok) {
        console.error(`[${requestId}] ⚠️ Google Auth token exchange failed:`, JSON.stringify(data));
        throw new Error(`Firebase Auth Failed: ${JSON.stringify(data)}`);
      }
      
      console.log(`[${requestId}] 🔑 Google Access Token generated successfully.`);
      return data.access_token;
    };

    // Helper: Construct Multi-platform Message
    const constructMessage = (notification: any, priority: string, ttl: number) => {
      return {
        notification: {
          title: notification.title,
          body: notification.body,
          ...(notification.imageUrl && { image: notification.imageUrl }),
        },
        data: notification.data || {},
        android: {
          priority: priority === 'high' ? 'high' : 'normal',
          ttl: `${ttl}s`,
          notification: {
            sound: 'default',
            ...(notification.badge !== undefined && { notificationCount: notification.badge }),
          },
        },
        apns: {
          headers: { 
            'apns-priority': priority === 'high' ? '10' : '5',
            'apns-push-type': 'alert'
          },
          payload: {
            aps: {
              alert: {
                title: notification.title,
                body: notification.body,
              },
              'mutable-content': 1,
              sound: 'default',
              ...(notification.badge !== undefined && { badge: notification.badge }),
            },
          },
        },
      };
    };

    // Helper: Send Notification
    const sendNotification = async (tokens: string[], notification: any, priority: string, ttl: number) => {
      if (tokens.length === 0) return { success: 0, failure: 0, errors: [] };
      
      const accessToken = await createAccessToken();
      const results = { success: 0, failure: 0, errors: [] as string[] };
      const baseMessage = constructMessage(notification, priority, ttl);

      for (const token of tokens) {
        const message = { message: { ...baseMessage, token } };

        try {
          const res = await fetch(`https://fcm.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/messages:send`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(message),
          });

          const data = await res.json();
          if (res.ok) {
            results.success++;
          } else {
            const error = data.error?.message || 'Unknown';
            results.failure++;
            results.errors.push(`Token ${token.substring(0, 8)}...: ${error}`);
            console.error(`[${requestId}] ⚠️ FCM error for token ${token.substring(0, 8)}:`, JSON.stringify(data));
            
            if (error.includes('UNREGISTERED') || error.includes('INVALID_ARGUMENT')) {
              await supabase.schema('drive').from('fcm_tokens').update({ is_active: false }).eq('fcm_token', token);
            }
          }
        } catch (e) {
          results.failure++;
          results.errors.push(`Token ${token.substring(0, 8)}...: ${e.message}`);
        }
      }
      return results;
    };

    // Logging helper
    const logResult = async (type: string, notification: any, userIds: string[], topic: string | undefined, status: string, stats: any) => {
      console.log(`[${requestId}] 📝 Logging result to marketing.notification_logs...`);
      try {
        // Ensure userIds are valid UUIDs to avoid DB errors
        const validUserIds = (userIds || []).filter(id => 
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
        );

        const logData: any = {
          type,
          title: notification.title || 'No Title',
          body: notification.body || 'No Body',
          data: notification.data || {},
          user_ids: validUserIds,
          topic: topic || null,
          status,
          sent_at: new Date().toISOString()
        };

        console.log(`[${requestId}] 📄 Log payload:`, JSON.stringify(logData));

        const { data: insertData, error } = await supabase
          .schema('marketing')
          .from('notification_logs')
          .insert(logData)
          .select();
        
        if (error) {
          console.error(`[${requestId}] ❌ Supabase log error:`, JSON.stringify(error));
        } else {
          console.log(`[${requestId}] ✅ Log created:`, insertData?.[0]?.id);
        }
      } catch (e) {
        console.error(`[${requestId}] 📝 Log function crashed:`, e.message);
      }
    };

    // -------- ROUTES --------
    if (path === '/send') {
      const body = await req.json();
      let { notification } = body;
      const { type, userIds, topic, priority = 'normal', ttl = 3600, template, lang, data, filters } = body;

      // Localized partner-flow templates: when `template` is given and no explicit
      // notification.title was passed, render title/body from the shared i18n map.
      if (template && !notification?.title) {
        const event = String(template).replace(/^partner_/, '') as PartnerEvent;
        const s = partnerStrings(event, lang);
        notification = {
          title: s.push.title,
          body: s.push.body,
          data: notification?.data ?? data ?? {},
        };
        console.log(`[${requestId}] 🌐 Localized push template=${event} lang=${lang}`);
      }

      let tokens = [];
      let stats;

      if (type === 'user') {
        // Persist one inbox row per recipient — the Notification Center mirrors
        // every user-targeted push. `persist` defaults true; routes never reach
        // this EF (in-app toasts) so they're naturally excluded. For a single
        // recipient we embed the row id in the FCM data so the device can ack
        // delivery (ack_notification_delivered).
        if (body.persist !== false && Array.isArray(userIds) && userIds.length && notification?.title) {
          const notifType = template
            ? `partner_${String(template).replace(/^partner_/, '')}`
            : (notification?.data?.type ?? data?.type ?? 'generic');
          const deeplink = notification?.data?.deeplink ?? data?.deeplink ?? null;
          const rows = userIds.map((uid: string) => ({
            user_id: uid,
            type: notifType,
            title: notification.title,
            body: notification.body ?? null,
            data: notification.data ?? {},
            deeplink,
          }));
          try {
            const { data: inserted, error: insErr } = await supabase
              .schema('drive')
              .from('user_notifications')
              .insert(rows)
              .select('id');
            if (insErr) {
              console.error(`[${requestId}] ⚠️ inbox persist failed:`, JSON.stringify(insErr));
            } else if (inserted?.length === 1) {
              notification = {
                ...notification,
                data: { ...(notification.data || {}), notification_id: inserted[0].id },
              };
              console.log(`[${requestId}] 📥 inbox row ${inserted[0].id} persisted`);
            } else {
              console.log(`[${requestId}] 📥 ${inserted?.length ?? 0} inbox rows persisted`);
            }
          } catch (e) {
            console.error(`[${requestId}] ⚠️ inbox persist exception:`, (e as Error).message);
          }
        }

        // ✅ BADGE (default, SSOT = inbox): for a SINGLE recipient, set the
        // app-icon badge to their current unread count so the Tuggi icon shows
        // the number and draws attention. Absolute value → aps.badge (iOS) /
        // notificationCount (Android); the app clears it on foreground. A
        // multi-user send shares one FCM message, so a per-user badge isn't
        // possible there. An explicit caller-provided badge is respected.
        if (
          Array.isArray(userIds) &&
          userIds.length === 1 &&
          notification &&
          notification.badge === undefined
        ) {
          try {
            const { count, error: cErr } = await supabase
              .schema('drive')
              .from('user_notifications')
              .select('id', { count: 'exact', head: true })
              .eq('user_id', userIds[0])
              .is('read_at', null);
            if (!cErr && typeof count === 'number' && count > 0) {
              notification = { ...notification, badge: count };
              console.log(`[${requestId}] 🔢 badge set to ${count} (unread)`);
            }
          } catch (e) {
            console.warn(`[${requestId}] ⚠️ badge count failed:`, (e as Error).message);
          }
        }

        // Fetch from both tables to ensure we have the latest "organized" token too
        const [fcmResult, profileResult] = await Promise.all([
          supabase.schema('drive').from('fcm_tokens').select('fcm_token').in('user_id', userIds).eq('is_active', true),
          supabase.schema('drive').from('profiles').select('push_token').in('id', userIds)
        ]);
        
        const fcmTokens = fcmResult.data?.map(t => t.fcm_token) || [];
        const profileTokens = profileResult.data?.map(p => p.push_token).filter(Boolean) || [];
        
        tokens = Array.from(new Set([...fcmTokens, ...profileTokens]));
        stats = await sendNotification(tokens, notification, priority, ttl);
      } else if (type === 'broadcast') {
        // Audience is resolved in SQL (core.get_audience_push_tokens) so platform/
        // language/tier filters are applied via the profiles JOIN — fcm_tokens has
        // no platform column. Empty filters → whole base. SSOT shared with the
        // estimate + newsletter RPCs (core.build_audience_filter).
        const { data: audienceTokens, error: audienceErr } = await supabase
          .schema('core')
          .rpc('get_audience_push_tokens', { p_filters: filters ?? {} });
        if (audienceErr) throw audienceErr;

        tokens = audienceTokens || [];
        console.log(`[${requestId}] 🎯 broadcast audience=${tokens.length} filters=${JSON.stringify(filters ?? {})}`);
        stats = await sendNotification(tokens, notification, priority, ttl);
      } else if (type === 'topic') {
        // Topic send (direct call to FCM)
        const accessToken = await createAccessToken();
        const baseMessage = constructMessage(notification, priority, ttl);
        const res = await fetch(`https://fcm.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/messages:send`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: { ...baseMessage, topic } }),
        });
        const data = await res.json();
        stats = res.ok ? { success: 1, failure: 0 } : { success: 0, failure: 1, errors: [data.error?.message] };
        if (!res.ok) {
          console.error(`[${requestId}] ❌ Topic FCM Error:`, JSON.stringify(data));
        }
      }

      await logResult(type, notification, userIds, topic, stats.success > 0 ? 'sent' : 'failed', stats);
      
      return new Response(JSON.stringify({ success: true, result: stats }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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
        console.error(`[${requestId}] ❌ schedule insert error:`, JSON.stringify(schedErr));
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
        let tokens = [];
        let stats;

        // Mark as processing to avoid double-spend
        await supabase.schema('marketing').from('scheduled_notifications')
            .update({ status: 'processing', updated_at: new Date().toISOString() })
            .eq('id', item.id);

        try {
            if (item.type === 'user') {
                const [fcmResult, profileResult] = await Promise.all([
                   supabase.schema('drive').from('fcm_tokens').select('fcm_token').in('user_id', item.user_ids).eq('is_active', true),
                   supabase.schema('drive').from('profiles').select('push_token').in('id', item.user_ids)
                ]);
                const fcmTokens = fcmResult.data?.map(t => t.fcm_token) || [];
                const profileTokens = profileResult.data?.map(p => p.push_token).filter(Boolean) || [];
                tokens = Array.from(new Set([...fcmTokens, ...profileTokens]));
            } else if (item.type === 'broadcast') {
                // Same SSOT audience resolver as the immediate /send broadcast path.
                const { data: audienceTokens, error: audienceErr } = await supabase
                    .schema('core')
                    .rpc('get_audience_push_tokens', { p_filters: item.audience_filters ?? {} });
                if (audienceErr) throw audienceErr;
                tokens = audienceTokens || [];
                console.log(`[${requestId}] 🎯 scheduled broadcast ${item.id} audience=${tokens.length}`);
            } else if (item.type === 'topic') {
                // Topic send (direct call to FCM in sendNotification helper if topic is provided)
                // For simplicity, we handle it as topic in sendNotification logic if type is topic
                // But current sendNotification needs tokens. Let's adapt if needed or use logic from /send
            }

            // Note: priority and ttl come from scheduled_notifications columns if they exist
            stats = await sendNotification(tokens, { title: item.title, body: item.body, data: item.data }, item.priority || 'normal', item.ttl || 3600);
            
            // Mark as sent
            await supabase.schema('marketing').from('scheduled_notifications')
                .update({
                    status: stats.success > 0 ? 'sent' : 'failed', 
                    processed_at: new Date().toISOString(),
                    error_details: stats.failure > 0 ? stats.errors.join(', ') : null
                })
                .eq('id', item.id);

            // Log the result
            await logResult(item.type, { title: item.title, body: item.body, data: item.data }, item.user_ids, item.topic, stats.success > 0 ? 'sent' : 'failed', stats);
            results.push({ id: item.id, status: stats.success > 0 ? 'sent' : 'failed' });

        } catch (e) {
            console.error(`[${requestId}] ⚠️ Failed processing notification ${item.id}:`, e.message);
            await supabase.schema('marketing').from('scheduled_notifications')
                .update({ status: 'failed', error_details: e.message })
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
    console.error(`[${requestId}] 💥 Fatal error:`, err);
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
