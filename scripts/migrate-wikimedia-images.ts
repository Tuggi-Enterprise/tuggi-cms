import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

async function callEdgeFunction(attractionId: string, attractionName: string, wikimediaUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/store-poi-images`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({
        attractionId: attractionId,
        attractionName: attractionName,
        imageSource: 'wikimedia_commons',
        wikimediaUrl: wikimediaUrl
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`Edge Function failed: ${response.status} - ${errorText}`)
      return false
    }

    const result = await response.json()
    console.log(`Edge Function response:`, result)
    return result.success && result.images && result.images.length > 0
  } catch (error) {
    console.error('Error calling Edge Function:', error)
    return false
  }
}

async function migrateWikimediaImages() {
  console.log('🚀 Starting Wikimedia images migration...')
  
  // Get attractions with Wikimedia URLs
  const { data: attractions, error } = await supabase
    .schema('core')
    .from('attractions')
    .select('id, name, image_url')
    .like('image_url', '%wikimedia%')
    .limit(10) // Start with 10 for testing
  
  if (error) {
    console.error('Error fetching attractions:', error)
    return
  }

  console.log(`📊 Found ${attractions?.length || 0} attractions to migrate`)
  
  let successCount = 0
  let errorCount = 0

  for (const attraction of attractions || []) {
    try {
      console.log(`\n🔄 Processing: ${attraction.name}`)
      console.log(`   Current URL: ${attraction.image_url}`)
      
      // Call Edge Function to process Wikimedia image
      const edgeFunctionSuccess = await callEdgeFunction(
        attraction.id,
        attraction.name,
        attraction.image_url
      )

      if (edgeFunctionSuccess) {
        console.log(`   ✅ Edge Function processed successfully`)
        successCount++
      } else {
        console.log(`   ❌ Edge Function failed`)
        errorCount++
      }

      // Wait 2 seconds between requests to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 2000))

    } catch (error) {
      console.error(`   ❌ Error processing ${attraction.name}:`, error)
      errorCount++
    }
  }

  console.log(`\n📊 Migration Summary:`)
  console.log(`   ✅ Successful: ${successCount}`)
  console.log(`   ❌ Failed: ${errorCount}`)
  console.log(`   📊 Total processed: ${successCount + errorCount}`)
}

migrateWikimediaImages()
