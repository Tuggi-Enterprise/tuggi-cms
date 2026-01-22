import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !key) {
  console.error('Missing env vars: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(url, key)

async function run() {
  console.log('Testing core.clients with service role key...')
  try {
    const resCore = await supabase.schema('core').from('clients').select('id').limit(1)
    console.log('core.clients ->', JSON.stringify(resCore, null, 2))

    const resPublic = await supabase.from('clients').select('id').limit(1)
    console.log('public.clients ->', JSON.stringify(resPublic, null, 2))

    // Check information_schema
    const info = await supabase.rpc('pg_tables_info', {})
    console.log('rpc pg_tables_info ->', JSON.stringify(info, null, 2))
  } catch (err) {
    console.error('Error running checks:', err)
  }
}

run()
