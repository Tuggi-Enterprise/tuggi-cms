
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''; // Needs service role for stats
const supabase = createClient(supabaseUrl, supabaseKey);

async function debugFomoSystem() {
  console.log('🔍 [DEBUG] Starting Gamification FOMO System Audit...\n');

  // 1. Check Cache Table
  console.log('--- 🛡️ Check: daily_user_fomo_stats ---');
  const { data: cacheStats, error: cacheError } = await supabase
    .schema('drive')
    .from('daily_user_fomo_stats')
    .select('summary_date, count(*)')
    .order('summary_date', { ascending: false })
    .limit(5);

  if (cacheError) console.error('❌ Error reading cache:', cacheError.message);
  else console.table(cacheStats);

  // 2. Check Candidates for 07:00 AM window (testing current hour and previous hours)
  console.log('\n--- 🎯 Check: push candidates for yesterday (2026-03-31) ---');
  // We can't easily mock NOW() in the RPC, but we can check the base data
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const { data: yData, error: yError } = await supabase
    .schema('drive')
    .from('daily_user_fomo_stats')
    .select('user_id, nickname, language, timezone, notified_at, missed_count')
    .eq('summary_date', '2026-03-31')
    .gt('missed_count', 0);
  
  if (yError) console.error('❌ Error reading stats:', yError.message);
  else {
    console.log(`✅ Found ${yData?.length || 0} users with missed POIs for yesterday.`);
    const notNotified = yData?.filter(u => !u.notified_at) || [];
    console.log(`⚠️ ${notNotified.length} users have NOT been notified yet.`);
    if (notNotified.length > 0) {
        console.log('Sample missing notification:', notNotified.slice(0, 3));
    }
  }

  // 3. Check Scheduled Notifications queue
  console.log('\n--- ⏳ Check: core.scheduled_notifications (Today) ---');
  const { data: scheduled, error: schError } = await supabase
    .schema('core')
    .from('scheduled_notifications')
    .select('id, user_ids, title, status, created_at')
    .gte('created_at', new Date().toISOString().split('T')[0])
    .limit(10);
  
  if (schError) console.error('❌ Error reading queue:', schError.message);
  else {
    console.log(`✅ Found ${scheduled?.length || 0} scheduled tasks created today.`);
    console.table(scheduled);
  }

  // 4. Check Logs
  console.log('\n--- 🪵 Check: core.notification_logs (Today) ---');
  const { data: logs, error: logError } = await supabase
    .schema('core')
    .from('notification_logs')
    .select('id, user_ids, title, status, sent_at')
    .gte('sent_at', new Date().toISOString().split('T')[0])
    .limit(10);

  if (logError) console.error('❌ Error reading logs:', logError.message);
  else {
    console.log(`✅ Found ${logs?.length || 0} logs today.`);
    console.table(logs);
  }

  console.log('\n🏁 [DEBUG] Audit finished.');
}

debugFomoSystem().catch(console.error);
