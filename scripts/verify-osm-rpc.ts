
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

// Load environment variables
dotenv.config({ path: '.env' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing environment variables')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function verifyOSMRPC() {
  console.log('🚀 Verifying OSM Map RPC (homolog.get_coordinates_in_bounds)...')

  // Test Case 1: Broad search (Country level zoom)
  // Zoom 4 -> High clustering expected
  console.log('\n1️⃣  Testing Zoom level 4 (whole Brazil context)...')
  const t1 = performance.now()
  const { data: data1, error: error1 } = await supabase.schema('homolog').rpc('get_coordinates_in_bounds', {
    min_lat: -34.0,
    min_lng: -74.0,
    max_lat: 5.0,
    max_lng: -30.0,
    zoom_level: 4,
    limit_count: 50
  })
  const d1 = performance.now() - t1

  if (error1) {
    console.error('❌ Error executing RPC:', error1)
  } else {
    console.log(`✅ Success in ${d1.toFixed(2)}ms`)
    console.log(`   Returned ${data1.length} items`)
    const clusters = data1.filter((i: any) => i.type === 'cluster').length
    const points = data1.filter((i: any) => i.type === 'poi').length
    console.log(`   Clusters: ${clusters}, Points: ${points}`)
    if (data1.length > 0) console.log('   Sample:', data1[0])
  }

  // Test Case 2: City level search (São Paulo)
  // Zoom 12 -> Some clustering, some points
  console.log('\n2️⃣  Testing Zoom level 12 (São Paulo)...')
  const t2 = performance.now()
  const { data: data2, error: error2 } = await supabase.schema('homolog').rpc('get_coordinates_in_bounds', {
    min_lat: -23.7,
    min_lng: -46.8,
    max_lat: -23.4,
    max_lng: -46.3,
    zoom_level: 12,
    city_filter: 'São Paulo'
  })
  const d2 = performance.now() - t2

  if (error2) {
    console.error('❌ Error executing RPC:', error2)
  } else {
    console.log(`✅ Success in ${d2.toFixed(2)}ms`)
    console.log(`   Returned ${data2.length} items`)
    if (data2.length > 0) console.log('   Sample:', data2[0])
  }

  // Test Case 3: Verify Filters
  console.log('\n3️⃣  Testing Filters (State="SP")...')
  const { data: data3, error: error3 } = await supabase.schema('homolog').rpc('get_coordinates_in_bounds', {
    min_lat: -24.0,
    min_lng: -47.0,
    max_lat: -23.0,
    max_lng: -46.0,
    state_filter: 'São Paulo'
  })

  if (error3) {
    console.error('❌ Error testing filters:', error3)
  } else {
    console.log(`✅ Success. Returned ${data3?.length} items`)
  }
}

verifyOSMRPC().catch(console.error)
