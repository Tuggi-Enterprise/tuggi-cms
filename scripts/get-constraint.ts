
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function getConstraint() {
  console.log('🔍 [DB AUDIT] Checking constraint definition...\n');

  // Query to find the check constraint for the status column
  const { data, error } = await supabase
    .rpc('get_table_constraints', { p_table_name: 'scheduled_notifications', p_schema_name: 'core' }); 

  if (error) {
    console.log('⚠️ RPC get_table_constraints not found. Trying information_schema...');
    const { data: info, error: infoError } = await supabase
        .from('information_schema.check_constraints')
        .select('*')
        .limit(10);
    
    if (infoError) console.error('❌ Error reading information_schema:', infoError.message);
    else console.table(info);
  } else {
    console.table(data);
  }
}

getConstraint().catch(console.error);
