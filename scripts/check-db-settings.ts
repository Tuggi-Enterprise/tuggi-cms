
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkDBSettings() {
  console.log('🔍 [DB SETTINGS AUDIT] Checking Postgres internal settings used by Cron...\n');

  // 1. Try to read settings
  const { data, error } = await supabase.rpc('get_system_settings'); // Check if we have this or similar

  if (error) {
    console.log('⚠️ Could not run RPC get_system_settings. Trying to check via raw query proxies...');
    // We'll try to at least verify the cron jobs list if possible
    const { data: jobs, error: jobsError } = await supabase.from('pg_cron.job' as any).select('*');
    if (jobsError) console.error('❌ Access denied to pg_cron.job table directly. (Expected for security)');
    else console.table(jobs);
  } else {
    console.table(data);
  }

  // 2. Let's try to see if we can manually test the core.trigger_process_scheduled_notifications()
  console.log('\n--- 🚀 Testing direct RPC trigger... ---');
  const { error: triggerError } = await supabase.rpc('trigger_process_scheduled_notifications');
  if (triggerError) {
      console.error('❌ Failed to manually trigger via RPC:', triggerError.message);
      console.log('💡 This is the smoking gun! The RPC itself might be failing due to missing settings.');
  } else {
      console.log('✅ Manual RPC trigger success! If no logs appear in EF, the issue is the URL/Key inside the function.');
  }
}

checkDBSettings().catch(console.error);
