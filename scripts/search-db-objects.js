import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !key) {
  console.error('Missing env vars: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(url, key)

async function run() {
  try {
    console.log('Checking pg_policy for core.cms_users...')
    const { data: policies, error: polError } = await supabase.rpc('sql', {
      q: `SELECT polname, pg_get_expr(polqual, polrelid) AS qual, pg_get_expr(polwithcheck, polrelid) AS with_check
          FROM pg_policy
          WHERE polrelid = 'core.cms_users'::regclass;`
    })
    if (polError) console.error('Policy error:', polError)
    else console.log('Policies:', policies)

    console.log('\nSearching functions containing cms_users or address in definition...')
    const { data: funcs, error: funcErr } = await supabase.rpc('sql', {
      q: `SELECT proname, pg_get_functiondef(p.oid) AS definition
          FROM pg_proc p
          JOIN pg_namespace n ON p.pronamespace = n.oid
          WHERE pg_get_functiondef(p.oid) ILIKE '%cms_users%' OR pg_get_functiondef(p.oid) ILIKE '%address%';`
    })
    if (funcErr) console.error('Function search error:', funcErr)
    else console.log('Functions matched:', funcs?.length || 0)

    console.log('\nSearching views referencing cms_users or address...')
    const { data: views, error: viewErr } = await supabase.rpc('sql', {
      q: `SELECT table_schema, table_name, view_definition
          FROM information_schema.views
          WHERE view_definition ILIKE '%cms_users%' OR view_definition ILIKE '%address%';`
    })
    if (viewErr) console.error('View search error:', viewErr)
    else console.log('Views found:', views)

  } catch (err) {
    console.error('Error executing DB searches:', err)
  }
}

run()
