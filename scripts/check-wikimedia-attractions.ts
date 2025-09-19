import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

async function checkWikimediaAttractions() {
  console.log('🔍 Checking Wikimedia attractions...')
  
  // Get count of Wikimedia URLs
  const { count: wikimediaCount } = await supabase
    .schema('core')
    .from('attractions')
    .select('*', { count: 'exact', head: true })
    .like('image_url', '%wikimedia%')
  
  console.log(`📊 Total attractions with Wikimedia URLs: ${wikimediaCount}`)
  
  // Check if any have photo references
  const { data: withPhotoRefs } = await supabase
    .schema('core')
    .from('attractions')
    .select(`
      id, name, image_url,
      attraction_image!inner(photo_reference)
    `)
    .like('image_url', '%wikimedia%')
    .limit(5)
  
  console.log(`📸 Attractions with Wikimedia URLs that have photo references: ${withPhotoRefs?.length || 0}`)
  
  if (withPhotoRefs && withPhotoRefs.length > 0) {
    console.log('\n📋 Sample attractions with both Wikimedia URLs and photo references:')
    withPhotoRefs.forEach((attraction, index) => {
      console.log(`${index + 1}. ${attraction.name}`)
      console.log(`   Wikimedia URL: ${attraction.image_url}`)
      console.log(`   Photo Reference: ${attraction.attraction_image[0]?.photo_reference}`)
      console.log('')
    })
  }
  
  // Check import sources
  const { data: importSources } = await supabase
    .schema('core')
    .from('attractions')
    .select('import_source')
    .like('image_url', '%wikimedia%')
    .not('import_source', 'is', null)
  
  const sourceCounts: { [key: string]: number } = {}
  importSources?.forEach(attraction => {
    const source = attraction.import_source || 'unknown'
    sourceCounts[source] = (sourceCounts[source] || 0) + 1
  })
  
  console.log('📊 Import sources for Wikimedia attractions:')
  Object.entries(sourceCounts)
    .sort(([,a], [,b]) => b - a)
    .forEach(([source, count]) => {
      console.log(`   ${source}: ${count}`)
    })
}

checkWikimediaAttractions()
