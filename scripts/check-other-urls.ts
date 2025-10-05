import { getSupabase } from '../lib/core/supabase-client'
import dotenv from 'dotenv'

dotenv.config()

const supabase = getSupabase('server')

async function checkOtherUrls() {
  console.log('🔍 Checking other URLs in attractions table...')
  
  const { data, error } = await supabase
    .schema('core')
    .from('attractions')
    .select('id, name, image_url')
    .not('image_url', 'is', null)
    .not('image_url', 'like', '%supabase%')
    .not('image_url', 'like', '%google%')
    .limit(20)
  
  if (error) {
    console.error('Error:', error)
    return
  }
  
  console.log(`📊 Found ${data?.length || 0} attractions with other URLs:`)
  console.log('')
  
  data?.forEach((attraction, index) => {
    console.log(`${index + 1}. ${attraction.name}`)
    console.log(`   URL: ${attraction.image_url}`)
    console.log('')
  })
  
  // Count by domain
  const domainCounts: { [key: string]: number } = {}
  data?.forEach(attraction => {
    if (attraction.image_url) {
      try {
        const url = new URL(attraction.image_url)
        const domain = url.hostname
        domainCounts[domain] = (domainCounts[domain] || 0) + 1
      } catch (e) {
        // Invalid URL
      }
    }
  })
  
  console.log('📊 Domain breakdown:')
  Object.entries(domainCounts)
    .sort(([,a], [,b]) => b - a)
    .forEach(([domain, count]) => {
      console.log(`   ${domain}: ${count}`)
    })
}

checkOtherUrls()
