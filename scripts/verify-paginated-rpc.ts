
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

async function verifyPaginatedRPC() {
  console.log('🚀 Verifying Paginated RPC (homolog.get_pois_paginated_v2)...\n')

  // Test Case 1: Basic pagination
  console.log('1️⃣  Testing basic pagination (page 1, limit 10)...')
  const t1 = performance.now()
  const { data: data1, error: error1 } = await supabase
    .schema('homolog')
    .rpc('get_pois_paginated_v2', {
      p_page: 1,
      p_limit: 10
    })
  const d1 = performance.now() - t1

  if (error1) {
    console.error('❌ Error:', error1)
  } else {
    console.log(`✅ Success in ${d1.toFixed(2)}ms`)
    console.log(`   Returned ${data1.length} items`)
    console.log(`   Total count: ${data1[0]?.total_count}`)
    console.log(`   Total pages: ${data1[0]?.total_pages}`)
    console.log(`   Current page: ${data1[0]?.current_page}`)
    if (data1[0]) {
      console.log('   Sample:', { 
        name: data1[0].name, 
        city: data1[0].city, 
        state: data1[0].state 
      })
    }
  }

  // Test Case 2: With state filter
  console.log('\n2️⃣  Testing with state filter (São Paulo)...')
  const t2 = performance.now()
  const { data: data2, error: error2 } = await supabase
    .schema('homolog')
    .rpc('get_pois_paginated_v2', {
      p_page: 1,
      p_limit: 10,
      p_state: 'São Paulo'
    })
  const d2 = performance.now() - t2

  if (error2) {
    console.error('❌ Error:', error2)
  } else {
    console.log(`✅ Success in ${d2.toFixed(2)}ms`)
    console.log(`   Returned ${data2.length} items for São Paulo`)
    console.log(`   Total in São Paulo: ${data2[0]?.total_count}`)
  }

  // Test Case 3: With search
  console.log('\n3️⃣  Testing with search term...')
  const { data: data3, error: error3 } = await supabase
    .schema('homolog')
    .rpc('get_pois_paginated_v2', {
      p_page: 1,
      p_limit: 10,
      p_search: 'Parque'
    })

  if (error3) {
    console.error('❌ Error:', error3)
  } else {
    console.log(`✅ Success. Found ${data3[0]?.total_count} results for "Parque"`)
    if (data3[0]) {
      console.log('   Sample:', data3[0].name)
    }
  }

  // Test Case 4: Filter options
  console.log('\n4️⃣  Testing filter options RPC...')
  const { data: data4, error: error4 } = await supabase
    .schema('homolog')
    .rpc('get_filter_options', {})

  if (error4) {
    console.error('❌ Error:', error4)
  } else if (data4?.[0]) {
    console.log(`✅ Success.`)
    console.log(`   States: ${data4[0].states?.length || 0}`)
    console.log(`   Cities: ${data4[0].cities?.length || 0}`)
    console.log(`   Categories: ${data4[0].categories?.length || 0}`)
    console.log(`   Total: ${data4[0].total_count}`)
    console.log('   Sample states:', data4[0].states?.slice(0, 5))
  }

  console.log('\n✅ Verification complete!')
}

verifyPaginatedRPC().catch(console.error)
