
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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
    const FIREBASE_PROJECT_ID = Deno.env.get('FIREBASE_PROJECT_ID');
    const FIREBASE_PRIVATE_KEY = Deno.env.get('FIREBASE_PRIVATE_KEY');
    const FIREBASE_CLIENT_EMAIL = Deno.env.get('FIREBASE_CLIENT_EMAIL');
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    // Diagnostics
    if (!FIREBASE_PRIVATE_KEY) console.error(`[${requestId}] ❌ FIREBASE_PRIVATE_KEY is missing`);
    if (!FIREBASE_PROJECT_ID) console.error(`[${requestId}] ❌ FIREBASE_PROJECT_ID is missing`);

    // Initialize Supabase client
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
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
        .replace(/\\n/g, '')
        .replace(/[\s\n\r]/g, '')
        .replace(/[^A-Za-z0-9+/=]/g, '');

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
      if (!response.ok) throw new Error(`Firebase Auth Failed: ${JSON.stringify(data)}`);
      
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
      console.log(`[${requestId}] 📝 Logging result to core.notification_logs...`);
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
          .schema('core')
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
      const { type, notification, userIds, topic, priority = 'normal', ttl = 3600 } = body;
      
      let tokens = [];
      let stats;

      if (type === 'user') {
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
        const [fcmResult, profileResult] = await Promise.all([
          supabase.schema('drive').from('fcm_tokens').select('fcm_token').eq('is_active', true),
          supabase.schema('drive').from('profiles').select('push_token').not('push_token', 'is', null)
        ]);

        const fcmTokens = fcmResult.data?.map(t => t.fcm_token) || [];
        const profileTokens = profileResult.data?.map(p => p.push_token) || [];
        
        tokens = Array.from(new Set([...fcmTokens, ...profileTokens]));
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
