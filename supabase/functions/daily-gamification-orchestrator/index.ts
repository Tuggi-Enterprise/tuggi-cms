
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getSecretKey } from '../_shared/supabase-client.ts';
// The copy of this push lives in _shared/daily-push-i18n.ts, outside this file,
// because this one imports a remote URL and therefore cannot be loaded by a
// test. Spec: docs/design/copy-push-diario-2026-08.md.
import { getTranslation } from '../_shared/daily-push-i18n.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const requestId = crypto.randomUUID();
  const startTime = Date.now();
  console.log(`[${requestId}] 🚀 Daily Gamification Orchestrator session started`);

  try {
    const supabaseUrl = (Deno.env.get('SUPABASE_URL') ?? '').trim();
    const supabaseKey = (getSecretKey() ?? '').trim();
    
    // Every read and write of this function is in the `drive` schema.
    const driveClient = createClient(supabaseUrl, supabaseKey, {
      db: { schema: 'drive' }
    });

    // 1. Get Candidates (those at 07:00 AM local time)
    const { data: candidates, error: candidateError } = await driveClient
      .rpc('get_morning_push_candidates');

    if (candidateError) throw candidateError;
    if (!candidates || candidates.length === 0) {
      console.log(`[${requestId}] ℹ️ No candidates found for the current hour (7:00 AM local time check).`);
      return new Response(JSON.stringify({ success: true, message: 'No candidates for current hour' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[${requestId}] 🎯 Found ${candidates.length} candidates to notify.`);

    // Calculate 'yesterday' to match the summary_date logic (CURRENT_DATE - 1)
    const yesterdayDate = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    const userIdsNotified = [];
    const results = [];

    // 2. Send Push directly via firebase-push-notification/send (EF-to-EF)
    const pushUrl = `${supabaseUrl}/functions/v1/firebase-push-notification/send`;

    for (const user of candidates) {
      const i18n = getTranslation(user.language);
      
      const messageBody = user.heard_count > 0 
        ? i18n.body(user.nickname || i18n.fallback, user.heard_count, user.missed_count)
        : i18n.body_zero_heard(user.nickname || i18n.fallback, user.missed_count);

      try {
        const payload = {
          type: 'user',
          userIds: [user.user_id],
          notification: {
            title: i18n.title,
            body: messageBody,
            // deeplink → app opens the Explore/Discover sheet on nearby
            // attractions so the tap lands somewhere actionable (was: no
            // deeplink → fell into the inbox and went nowhere on tap).
            data: { source: 'daily-fomo', date: new Date().toISOString().split('T')[0], deeplink: 'tuggi://map' }
          },
          priority: 'high',
          ttl: 86400
        };

        const pushResponse = await fetch(pushUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseKey}`,
            'apikey': supabaseKey
          },
          body: JSON.stringify(payload)
        });

        if (!pushResponse.ok) {
          const errText = await pushResponse.text();
          throw new Error(`Edge Function returned a non-2xx status code: ${pushResponse.status} ${pushResponse.statusText} - ${errText}`);
        }

        const pushResult = await pushResponse.json();

        console.log(`[${requestId}] 📲 Push to ${user.nickname}: Success`, JSON.stringify(pushResult));
        results.push({ user_id: user.user_id, status: 'sent' });
        userIdsNotified.push(user.user_id);

      } catch (pushErr: any) {
        console.error(`[${requestId}] ⚠️ Push failed for ${user.user_id}:`, pushErr.message);
        results.push({ user_id: user.user_id, status: 'error', error: pushErr.message });
        await driveClient.rpc('increment_fomo_attempt', { p_user_id: user.user_id, p_date: yesterdayDate });
      }
    }

    // 3. Mark cache as notified to avoid double-send
    if (userIdsNotified.length > 0) {
      console.log(`[${requestId}] 📝 Marking ${userIdsNotified.length} users notified for ${yesterdayDate}`);
      
      const { error: updateError } = await driveClient
        .from('daily_user_fomo_stats')
        .update({ notified_at: new Date().toISOString() })
        .in('user_id', userIdsNotified)
        .eq('summary_date', yesterdayDate);
      
      if (updateError) {
        console.error(`[${requestId}] ❌ Error marking notified candidates:`, updateError.message);
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[${requestId}] ✅ Orchestration finished in ${duration}ms. Sent: ${userIdsNotified.length}/${candidates.length}`);

    return new Response(JSON.stringify({ 
      success: true, 
      sent: userIdsNotified.length,
      total: candidates.length,
      results 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    console.error(`[${requestId}] 💥 Error:`, err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
