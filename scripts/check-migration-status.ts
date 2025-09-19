import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function checkStatus() {
  const { count: wikimediaCount } = await supabase
    .schema('core')
    .from('attractions')
    .select('*', { count: 'exact', head: true })
    .like('image_url', '%wikimedia%')
  
  const { count: supabaseCount } = await supabase
    .schema('core')
    .from('attractions')
    .select('*', { count: 'exact', head: true })
    .like('image_url', '%supabase%')
  
  console.log('📊 Current Status:')
  console.log('   🎯 Wikimedia URLs remaining:', wikimediaCount)
  console.log('   ✅ Supabase URLs:', supabaseCount)
  console.log('   📈 Progress:', ((2939 - wikimediaCount) / 2939 * 100).toFixed(1) + '%')
}

checkStatus()
