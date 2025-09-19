import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

async function checkWikimediaWithGoogleIds() {
  console.log('🔍 Checking Wikimedia attractions with Google Place IDs...')
  
  // Check how many have Google Place IDs
  const { count: withGoogleIds } = await supabase
    .schema('core')
    .from('attractions')
    .select('*', { count: 'exact', head: true })
    .like('image_url', '%wikimedia%')
    .not('google_place_id', 'is', null)
  
  console.log(`📊 Wikimedia attractions with Google Place IDs: ${withGoogleIds}`)
  
  // Get sample
  const { data: sample } = await supabase
    .schema('core')
    .from('attractions')
    .select('id, name, google_place_id, import_source')
    .like('image_url', '%wikimedia%')
    .not('google_place_id', 'is', null)
    .limit(5)
  
  console.log('\n📋 Sample Wikimedia attractions with Google Place IDs:')
  sample?.forEach((attraction, index) => {
    console.log(`${index + 1}. ${attraction.name}`)
    console.log(`   Google Place ID: ${attraction.google_place_id}`)
    console.log(`   Import Source: ${attraction.import_source}`)
    console.log('')
  })
}

checkWikimediaWithGoogleIds()
