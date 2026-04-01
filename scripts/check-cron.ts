
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkCronJobs() {
  console.log('🔍 [CRON AUDIT] Checking pg_cron jobs and runs...\n');

  // 1. Check existing jobs
  const { data: jobs, error: jobsError } = await supabase
    .rpc('get_cron_jobs'); // We might need to check if this RPC exists or use a raw query if enabled

  if (jobsError) {
    console.log('⚠️ Could not use RPC get_cron_jobs, trying raw query if possible...');
    // In many Supabase setups, you can't query cron tables directly via API
    // We'll try to check if the extension is enabled at least
    const { data: ext, error: extError } = await supabase.from('pg_extension').select('*').eq('extname', 'pg_cron');
    if (extError) console.error('❌ Could not check extensions:', extError.message);
    else console.log('✅ pg_cron extension:', ext?.length > 0 ? 'Enabled' : 'Disabled');
  } else {
    console.table(jobs);
  }

  // 2. Try to manually trigger the orchestrator via fetch for a test
  console.log('\n--- 🚀 Testing Orchestrator Invocation manually... ---');
  try {
    const url = `${supabaseUrl}/functions/v1/daily-gamification-orchestrator`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
      }
    });
    
    const result = await response.json();
    console.log(`Status: ${response.status}`);
    console.log('Result:', JSON.stringify(result));
  } catch (e) {
    console.error('❌ Manual invocation failed:', e.message);
  }
}

checkCronJobs().catch(console.error);
