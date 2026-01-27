import { getSupabase } from '../lib/core/supabase-client'

const supabase = getSupabase('service')

async function count() {
  const { count, error } = await supabase
    .schema('homolog')
    .from('pois')
    .select('*', { count: 'exact', head: true })
    .or('country.is.null,country.eq.,state.is.null,state.eq.,city.is.null,city.eq.')
    .eq('processing_status', 'pending')

  if (error) {
    console.error('Error:', error)
  } else {
    console.log('Count of pending POIs with missing location data:', count)
  }
}

count()
