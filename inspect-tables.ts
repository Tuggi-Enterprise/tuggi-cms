import { getSupabase } from './lib/core/supabase-client';

const sb = getSupabase('service');

async function inspect() {
  console.log('--- Inspecting drive.fcm_tokens ---');
  const { data: fcmCols, error: fcmError } = await sb.rpc('get_table_columns', { 
    p_schema: 'drive', 
    p_table: 'fcm_tokens' 
  });
  
  if (fcmError) {
    // If RPC doesn't exist, try a simple select
    console.log('RPC get_table_columns not found, trying select * limit 0');
    const { data: fcmSample, error: fcmSampleError } = await sb.schema('drive').from('fcm_tokens').select('*').limit(1);
    if (fcmSampleError) console.error('Error fetching fcm_tokens sample:', fcmSampleError.message);
    else console.log('fcm_tokens columns:', Object.keys(fcmSample[0] || {}));
  } else {
    console.log('fcm_tokens columns:', fcmCols);
  }

  console.log('\n--- Inspecting drive.profiles ---');
  const { data: profileCols, error: profileError } = await sb.rpc('get_table_columns', { 
    p_schema: 'drive', 
    p_table: 'profiles' 
  });
  
  if (profileError) {
    console.log('RPC get_table_columns not found, trying select * limit 0');
    const { data: profileSample, error: profileSampleError } = await sb.schema('drive').from('profiles').select('*').limit(1);
    if (profileSampleError) console.error('Error fetching profiles sample:', profileSampleError.message);
    else console.log('profiles columns:', Object.keys(profileSample[0] || {}));
  } else {
    console.log('profiles columns:', profileCols);
  }
}

inspect().catch(console.error);
