
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

async function peekCandidates() {
  console.log('🔍 Peeking into drive.daily_user_fomo_stats for yesterday...\n');
  
  const fetch = (await import('node-fetch')).default;
  const url = `${supabaseUrl}/rest/v1/rpc/get_morning_push_candidates`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${supabaseKey}`,
      'apikey': supabaseKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({})
  });

  const result = await response.json();
  console.log('Function Response:', JSON.stringify(result, null, 2));
  
  // Also check raw table data
  const { data: raw } = await (await import('@supabase/supabase-js')).createClient(supabaseUrl, supabaseKey)
    .schema('drive')
    .from('daily_user_fomo_stats')
    .select('*')
    .eq('summary_date', '2026-03-31');
    
  console.log('\nRaw Table Data for 2026-03-31:');
  console.table(raw);
}

peekCandidates().catch(console.error);
