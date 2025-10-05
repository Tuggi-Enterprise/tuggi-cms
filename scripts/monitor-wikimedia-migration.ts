import { getSupabase } from '../lib/core/supabase-client'
import dotenv from 'dotenv'

dotenv.config()

const supabase = getSupabase('service')

async function monitorMigration() {
  console.log('📊 Monitoring Wikimedia Migration Progress...')
  console.log('=' .repeat(50))
  
  while (true) {
    try {
      // Count total Wikimedia URLs
      const { count: totalWikimedia } = await supabase
        .schema('core')
        .from('attractions')
        .select('*', { count: 'exact', head: true })
        .like('image_url', '%wikimedia%')
      
      // Count total Supabase URLs
      const { count: totalSupabase } = await supabase
        .schema('core')
        .from('attractions')
        .select('*', { count: 'exact', head: true })
        .like('image_url', '%supabase%')
      
      // Count total attractions with images
      const { count: totalWithImages } = await supabase
        .schema('core')
        .from('attractions')
        .select('*', { count: 'exact', head: true })
        .not('image_url', 'is', null)
      
      const processed = 2939 - (totalWikimedia || 0)
      const progress = ((processed / 2939) * 100).toFixed(1)
      
      console.log(`\n🕐 ${new Date().toLocaleTimeString()}`)
      console.log(`📊 Migration Progress:`)
      console.log(`   🎯 Total Wikimedia URLs: ${totalWikimedia}`)
      console.log(`   ✅ Processed: ${processed}`)
      console.log(`   📈 Progress: ${progress}%`)
      console.log(`   🗄️  Total Supabase URLs: ${totalSupabase}`)
      console.log(`   🖼️  Total with images: ${totalWithImages}`)
      
      if (totalWikimedia === 0) {
        console.log('\n🎉 Migration completed! All Wikimedia images have been processed!')
        break
      }
      
      // Wait 30 seconds before next check
      await new Promise(resolve => setTimeout(resolve, 30000))
      
    } catch (error) {
      console.error('Error monitoring migration:', error)
      await new Promise(resolve => setTimeout(resolve, 30000))
    }
  }
}

monitorMigration()
