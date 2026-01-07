
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
dotenv.config({ path: path.resolve(process.cwd(), '.env') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials in .env or .env.local')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function verifyMapRPC() {
  console.log('🗺️ Verifying cms_search_pois_map RPC...')

  // Test Case 1: Low Zoom (Should return clusters)
  console.log('\n--- Test 1: Low Zoom (Zoom 3) - Expecting Clusters ---')
  const { data: lowZoomData, error: lowZoomError } = await supabase.schema('core').rpc('cms_search_pois_map', {
    min_lat: -34.0, // Brazil roughly
    min_lng: -74.0,
    max_lat: 5.0,
    max_lng: -34.0,
    zoom_level: 3
  })

  if (lowZoomError) {
    console.error('❌ Error calling RPC (Low Zoom):', lowZoomError)
  } else {
    const clusters = lowZoomData.filter((i: any) => i.type === 'cluster')
    const points = lowZoomData.filter((i: any) => i.type === 'poi')
    console.log(`✅ Success! Returned ${lowZoomData.length} items`)
    console.log(`   - Clusters: ${clusters.length}`)
    console.log(`   - Points: ${points.length}`)
    
    if (clusters.length > 0) {
      console.log('   Example Cluster:', JSON.stringify(clusters[0], null, 2))
    } else {
      console.warn('   ⚠️ No clusters returned. Is the data sparse or clustering logic too strict?')
    }
  }

  // Test Case 2: High Zoom (Zoom 15) - Expecting POIs)
  console.log('\n--- Test 2: High Zoom (Zoom 15) - Expecting POIs ---')
  // Using coordinates for Sao Paulo or a known dense area if possible, or just the same bounds (though usually high zoom has smaller bounds)
  // Let's use a smaller bound to simulate a real view
  const { data: highZoomData, error: highZoomError } = await supabase.schema('core').rpc('cms_search_pois_map', {
    min_lat: -23.6,
    min_lng: -46.7,
    max_lat: -23.5,
    max_lng: -46.6,
    zoom_level: 15
  })

  if (highZoomError) {
    console.error('❌ Error calling RPC (High Zoom):', highZoomError)
  } else {
    const clusters = highZoomData.filter((i: any) => i.type === 'cluster')
    const points = highZoomData.filter((i: any) => i.type === 'poi')
    console.log(`✅ Success! Returned ${highZoomData.length} items`)
    console.log(`   - Clusters: ${clusters.length}`)
    console.log(`   - Points: ${points.length}`)
    
    if (points.length > 0) {
      console.log('   Example Point:', JSON.stringify(points[0], null, 2))
      // Check metadata fields
      const sample = points[0]
      console.log('\nSample POI metadata check:')
      if (sample.metadata) {
        console.log('✅ Metadata present')
        console.log('   - Approved:', sample.metadata.approved !== undefined ? '✅' : '❌ missing')
        console.log('   - Has Description:', sample.metadata.has_description !== undefined ? '✅' : '❌ missing')
        console.log('   - Has Audio:', sample.metadata.has_audio !== undefined ? '✅' : '❌ missing')
      } else {
        console.log('❌ Metadata missing')
      }
    } else if (highZoomData.length === 0) {
       console.log('   ℹ️ No POIs found in this small area (Sao Paulo region). Try a different area if expected.')
    } else {
      console.log('No individual POIs found in viewport (checked points array)')
    }
  }
}

verifyMapRPC().catch(err => console.error('Unexpected error:', err))
