
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Firebase configuration
const FIREBASE_PROJECT_ID = Deno.env.get('FIREBASE_PROJECT_ID');
const FIREBASE_PRIVATE_KEY = Deno.env.get('FIREBASE_PRIVATE_KEY');
const FIREBASE_CLIENT_EMAIL = Deno.env.get('FIREBASE_CLIENT_EMAIL');

// Notification Templates
interface NotificationPayload {
  title: string;
  body: string;
  data?: Record<string, any>;
  imageUrl?: string;
  priority?: 'high' | 'normal';
  ttl?: number;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const path = url.pathname.replace('/firebase-push-notification', '') || '/';

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Helper: Get user tokens from database
    const getUserTokens = async (userIds: string[]): Promise<string[]> => {
      // FIX: Use 'drive' schema explicitly
      const { data: tokens } = await supabase
        .schema('drive')
        .from('fcm_tokens')
        .select('fcm_token')
        .in('user_id', userIds)
        .eq('is_active', true);

      return tokens?.map((t: any) => t.fcm_token) || [];
    };

    // Helper: Get all active tokens for broadcast
    const getAllTokens = async (): Promise<string[]> => {
      // FIX: Use 'drive' schema explicitly
      const { data: tokens } = await supabase
        .schema('drive')
        .from('fcm_tokens')
        .select('fcm_token')
        .eq('is_active', true);

      return tokens?.map((t: any) => t.fcm_token) || [];
    };

    // Helper: Create Firebase JWT
    const createFirebaseJWT = async (): Promise<string> => {
      if (!FIREBASE_PROJECT_ID || !FIREBASE_PRIVATE_KEY || !FIREBASE_CLIENT_EMAIL) {
        throw new Error('Firebase credentials not configured');
      }

      const now = Math.floor(Date.now() / 1000);
      const header = { alg: 'RS256', typ: 'JWT' };
      const payload = {
        iss: FIREBASE_CLIENT_EMAIL,
        scope: 'https://www.googleapis.com/auth/firebase.messaging',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
      };

      const encoder = new TextEncoder();
      const headerB64 = btoa(JSON.stringify(header)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
      const payloadB64 = btoa(JSON.stringify(payload)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

      // Import private key
      const pemHeader = "-----BEGIN PRIVATE KEY-----";
      const pemFooter = "-----END PRIVATE KEY-----";
      const pemContents = FIREBASE_PRIVATE_KEY
        .replace(/\\n/g, '\n')
        .replace(pemHeader, '')
        .replace(pemFooter, '')
        .replace(/\s/g, '');

      const binaryDerString = atob(pemContents);
      const binaryDer = new Uint8Array(binaryDerString.length);
      for (let i = 0; i < binaryDerString.length; i++) {
        binaryDer[i] = binaryDerString.charCodeAt(i);
      }

      const key = await crypto.subtle.importKey(
        'pkcs8',
        binaryDer,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['sign']
      );

      const signature = await crypto.subtle.sign(
        'RSASSA-PKCS1-v1_5',
        key,
        encoder.encode(`${headerB64}.${payloadB64}`)
      );

      const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
        .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

      return `${headerB64}.${payloadB64}.${signatureB64}`;
    };

    // Helper: Get Firebase Access Token
    const getAccessToken = async (): Promise<string> => {
      const jwt = await createFirebaseJWT();
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(`Failed to get access token: ${data.error}`);
      }

      return data.access_token;
    };

    // Helper: Send FCM Notification
    const sendFCMNotification = async (
      tokens: string[],
      notification: NotificationPayload,
      priority: string = 'normal',
      ttl: number = 3600
    ) => {
      if (tokens.length === 0) {
        return { success: 0, failure: 0, errors: ['No tokens provided'] };
      }

      const accessToken = await getAccessToken();
      const results = { success: 0, failure: 0, errors: [] as string[] };

      // Batch sending is deprecated/unreliable in HTTP v1, sending individually
      // In production, consider parallelizing requests with Promise.all() in batches of 50
      const BATCH_SIZE = 10;
      
      for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
        const batch = tokens.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async (token) => {
          const message = {
            message: {
              token: token,
              notification: {
                title: notification.title,
                body: notification.body,
                ...(notification.imageUrl && { image: notification.imageUrl }),
              },
              data: notification.data || {},
              android: {
                priority: priority === 'high' ? 'high' : 'normal',
                ttl: `${ttl}s`,
              },
              apns: {
                headers: {
                  'apns-priority': priority === 'high' ? '10' : '5',
                },
                payload: {
                  aps: {
                    'content-available': 1,
                  },
                },
              },
            },
          };

          try {
            const response = await fetch(
              `https://fcm.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/messages:send`,
              {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${accessToken}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify(message),
              }
            );

            const result = await response.json();
            if (response.ok) {
              results.success++;
            } else {
              results.failure++;
              const errorMsg = result.error?.message || 'Unknown error';
              results.errors.push(`Token ${token.substring(0, 10)}...: ${errorMsg}`);
              
              // Optional: Mark token as invalid if error is specific
              if (errorMsg.includes('UNREGISTERED') || errorMsg.includes('INVALID_ARGUMENT')) {
                 await supabase.schema('drive').from('fcm_tokens').update({ is_active: false }).eq('fcm_token', token);
              }
            }
          } catch (error: any) {
            results.failure++;
            results.errors.push(`Token ${token.substring(0, 10)}...: ${error.message}`);
          }
        }));
      }

      return results;
    };

    const sendToTopic = async (
        topic: string,
        notification: NotificationPayload,
        priority: string = 'normal',
        ttl: number = 3600
    ) => {
        const accessToken = await getAccessToken();
        
        const message = {
            message: {
                topic: topic,
                notification: {
                    title: notification.title,
                    body: notification.body,
                    ...(notification.imageUrl && { image: notification.imageUrl }),
                },
                data: notification.data || {},
                android: {
                    priority: priority === 'high' ? 'high' : 'normal',
                    ttl: `${ttl}s`,
                },
                apns: {
                    headers: {
                        'apns-priority': priority === 'high' ? '10' : '5',
                    },
                    payload: {
                        aps: {
                            'content-available': 1,
                        },
                    },
                },
            },
        };

        try {
            const response = await fetch(
                `https://fcm.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/messages:send`,
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(message),
                }
            );

            const result = await response.json();
            if (response.ok) {
                return { success: 1, failure: 0, errors: [] };
            } else {
                return { success: 0, failure: 1, errors: [result.error?.message || 'Unknown error'] };
            }
        } catch (error: any) {
            return { success: 0, failure: 1, errors: [error.message] };
        }
    }

    const logNotification = async (type: string, title: string, body: string, data: any, userIds: string[], topic: string | undefined, status: string, errorDetails: string | null = null) => {
        try {
            await supabase.schema('core').from('notification_logs').insert({
                type,
                title,
                body,
                data,
                user_ids: userIds || [],
                topic,
                status,
                error_details: errorDetails,
                sent_at: new Date().toISOString()
            });
        } catch (error) {
            console.error('Failed to log notification:', error);
        }
    };

    // Route Logic
    switch (path) {
      case '/health':
        return new Response(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });

      // -----------------------------------------------------------------------
      // PROCESSOR: Check and send scheduled notifications
      // -----------------------------------------------------------------------
      case '/process-scheduled':
        if (req.method !== 'POST') {
             return new Response('Method not allowed', { status: 405, headers: corsHeaders });
        }

        // 1. Fetch pending notifications scheduled for now or earlier
        const { data: scheduledItems, error: fetchError } = await supabase
            .schema('core')
            .from('scheduled_notifications')
            .select('*')
            .eq('status', 'pending')
            .lte('scheduled_for', new Date().toISOString())
            .limit(5); // Process in batches of 5 to avoid timeouts

        if (fetchError) {
             return new Response(JSON.stringify({ error: fetchError.message }), { status: 500, headers: corsHeaders });
        }

        if (!scheduledItems || scheduledItems.length === 0) {
             return new Response(JSON.stringify({ message: 'No pending notifications' }), { status: 200, headers: corsHeaders });
        }

        const results = [];

        // 2. Process each item
        for (const item of scheduledItems) {
            // Update status to processing to prevent double send
            await supabase.schema('core').from('scheduled_notifications')
                .update({ status: 'processing' })
                .eq('id', item.id);

            let sendResult;
            let tokens = [];

            try {
                // Determine target
                if (item.type === 'user') {
                    tokens = await getUserTokens(item.user_ids);
                    sendResult = await sendFCMNotification(tokens, item, item.priority, item.ttl);
                } else if (item.type === 'topic') {
                    sendResult = await sendToTopic(item.topic, item, item.priority, item.ttl);
                } else if (item.type === 'broadcast') {
                    tokens = await getAllTokens();
                    sendResult = await sendFCMNotification(tokens, item, item.priority, item.ttl);
                }

                // Update status to sent/failed
                const status = sendResult && sendResult.failure === 0 ? 'sent' : 'failed'; // Or 'partial'
                const errorDetails = sendResult?.errors?.join(', ');

                await supabase.schema('core').from('scheduled_notifications')
                    .update({ 
                        status: status,
                        processed_at: new Date().toISOString(),
                        error_details: errorDetails
                    })
                    .eq('id', item.id);

                // Log to history
                await logNotification(item.type, item.title, item.body, item.data, item.user_ids, item.topic, status, errorDetails);
                
                results.push({ id: item.id, status, result: sendResult });

            } catch (err: any) {
                // Mark as failed
                await supabase.schema('core').from('scheduled_notifications')
                    .update({ 
                        status: 'failed',
                        processed_at: new Date().toISOString(),
                        error_details: err.message
                    })
                    .eq('id', item.id);
                 results.push({ id: item.id, status: 'failed', error: err.message });
            }
        }

        return new Response(JSON.stringify({ success: true, processed: results.length, results }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });

      // -----------------------------------------------------------------------
      // SEND: Immediate send
      // -----------------------------------------------------------------------
      case '/send':
        if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
        
        try {
            const { type, notification, userIds, topic, priority, ttl } = await req.json();

            let tokens = [];
            let result;

            if (type === 'user') {
                tokens = await getUserTokens(userIds);
                result = await sendFCMNotification(tokens, notification, priority, ttl);
            } else if (type === 'topic') {
                result = await sendToTopic(topic, notification, priority, ttl);
            } else if (type === 'broadcast') {
                tokens = await getAllTokens();
                result = await sendFCMNotification(tokens, notification, priority, ttl);
            } else {
                 return new Response(JSON.stringify({ error: 'Invalid type' }), { status: 400, headers: corsHeaders });
            }

            await logNotification(type, notification.title, notification.body, notification.data, userIds, topic, result.success > 0 ? 'sent' : 'failed');

            return new Response(JSON.stringify({ success: true, result }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

        } catch (err: any) {
            return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
        }
        
      // -----------------------------------------------------------------------
      // SCHEDULE: Add to queue
      // -----------------------------------------------------------------------
      case '/schedule':
         if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
         
         const scheduleReq = await req.json();
         // Basic validation
         if (!scheduleReq.scheduleAt || !scheduleReq.notification) {
              return new Response(JSON.stringify({ error: 'Missing scheduleAt or notification' }), { status: 400, headers: corsHeaders });
         }

         const { data, error } = await supabase.schema('core').from('scheduled_notifications').insert({
             type: scheduleReq.type,
             user_ids: scheduleReq.userIds || [],
             topic: scheduleReq.topic,
             title: scheduleReq.notification.title,
             body: scheduleReq.notification.body,
             data: scheduleReq.notification.data || {},
             image_url: scheduleReq.notification.imageUrl,
             priority: scheduleReq.priority || 'normal',
             ttl: scheduleReq.ttl || 3600,
             scheduled_for: scheduleReq.scheduleAt,
             status: 'pending' // Default
         }).select();

         if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });

         return new Response(JSON.stringify({ success: true, notification: data?.[0] }), { status: 201, headers: corsHeaders });

      default:
        return new Response(JSON.stringify({ error: 'Endpoint not found', available: ['/process-scheduled', '/send', '/schedule'] }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
