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
    console.log('Querying information_schema for core.cms_users columns...')
    const { data, error } = await supabase
      .from('information_schema.columns')
      .select('column_name, data_type')
      .eq('table_schema', 'core')
      .eq('table_name', 'cms_users')

    if (error) {
      console.error('Error fetching columns:', error)
      return
    }

    console.log('Columns for core.cms_users:')
    data.forEach((col) => console.log('-', col.column_name, col.data_type))
  } catch (err) {
    console.error('Script error:', err)
  }
}

run()
