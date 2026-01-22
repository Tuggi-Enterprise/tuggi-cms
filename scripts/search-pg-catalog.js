import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing env vars')
  process.exit(1)
}

const supabase = createClient(url, key)

async function run() {
  try {
    console.log('Searching pg_proc for prosrc containing cms_users or address...')
    const { data: procs, error: pErr } = await supabase
      .from('pg_proc')
      .select('oid, proname, prosrc')
      .ilike('prosrc', '%cms_users%')

    if (pErr) console.error('pg_proc error:', pErr)
    else console.log('pg_proc matches:', (procs || []).map(p => p.proname))

    console.log('\nSearching pg_proc for address...')
    const { data: procs2, error: pErr2 } = await supabase
      .from('pg_proc')
      .select('oid, proname, prosrc')
      .ilike('prosrc', '%address%')
    if (pErr2) console.error('pg_proc address error:', pErr2)
    else console.log('pg_proc address matches:', (procs2 || []).map(p => p.proname))

    console.log('\nSearching pg_policy for polqual containing address or cms_users...')
    const { data: policies, error: polErr } = await supabase
      .from('pg_policy')
      .select('polname, polqual, polwithcheck')
    if (polErr) console.error('pg_policy error:', polErr)
    else {
      const matches = (policies || []).filter(p => (p.polqual || '').toLowerCase().includes('address') || (p.polqual||'').toLowerCase().includes('cms_users') || (p.polwithcheck||'').toLowerCase().includes('address') || (p.polwithcheck||'').toLowerCase().includes('cms_users'))
      console.log('pg_policy matches:', matches.map(m => ({ name: m.polname, qual: m.polqual, with_check: m.polwithcheck })))
    }

    console.log('\nSearching information_schema.views for address or cms_users...')
    const { data: views, error: vErr } = await supabase
      .from('information_schema.views')
      .select('table_schema, table_name, view_definition')
      .ilike('view_definition', '%address%')
    if (vErr) console.error('views error:', vErr)
    else console.log('views with address:', (views || []).map(v => `${v.table_schema}.${v.table_name}`))

    const { data: views2, error: vErr2 } = await supabase
      .from('information_schema.views')
      .select('table_schema, table_name, view_definition')
      .ilike('view_definition', '%cms_users%')
    if (vErr2) console.error('views cms_users error:', vErr2)
    else console.log('views with cms_users:', (views2 || []).map(v => `${v.table_schema}.${v.table_name}`))

  } catch (err) {
    console.error('Error searching catalog:', err)
  }
}

run()
