/**
 * Test script for the deployed Edge Function
 * 
 * Tests the generate-description function with a real POI
 */

const SUPABASE_URL = 'https://tysnkzmljlmmqpbotkxv.supabase.co'
const EDGE_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/generate-description`

// Test POI data (Bragança Paulista - POI importante)
const testPOI = {
  id: '50cd5835-70db-41be-9084-3adcae63c15e',
  name: 'Bragança Paulista',
  city: 'Bragança Paulista',
  country: 'Brasil',
  state: 'SP',
  google_types: ['locality', 'political', 'point_of_interest'],
  lat: -22.9539,
  lng: -46.5422,
  website: 'https://www.braganca.sp.gov.br',
  reference_links: [
    'https://pt.wikipedia.org/wiki/Bragança_Paulista',
    'https://www.turismo.sp.gov.br/braganca-paulista'
  ]
}

// Test options
const testOptions = {
  language: 'pt-br',
  use_dynamic_sources: true,
  enrich_with_osm: false, // Edge Function não tem OSM por enquanto
  persist_verification: true,
  auto_generate_audio: false
}

async function testEdgeFunction() {
  console.log('🧪 Testing Edge Function: generate-description')
  console.log('📍 URL:', EDGE_FUNCTION_URL)
  console.log('🎯 POI:', testPOI.name)
  console.log('🏙️ City:', testPOI.city)
  console.log('')
  
  try {
    // Make request to Edge Function
    const response = await fetch(EDGE_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer YOUR_JWT_TOKEN_HERE' // Replace with real token
      },
      body: JSON.stringify({
        poi_data: testPOI,
        options: testOptions
      })
    })
    
    console.log('📡 Response Status:', response.status)
    console.log('📡 Response Headers:', Object.fromEntries(response.headers.entries()))
    
    if (!response.ok) {
      const errorText = await response.text()
      console.error('❌ Error Response:', errorText)
      return
    }
    
    const result = await response.json()
    
    console.log('')
    console.log('✅ SUCCESS! Edge Function Response:')
    console.log('📊 Success:', result.success)
    console.log('⏱️ Processing Time:', result.processing_time + 'ms')
    console.log('🤖 Model Used:', result.metadata?.model_used)
    console.log('📈 Quality Score:', result.metadata?.quality_score)
    console.log('')
    console.log('📝 Generated Description:')
    console.log('─'.repeat(50))
    console.log(result.data?.description || 'No description generated')
    console.log('─'.repeat(50))
    console.log('')
    console.log('🔍 Full Response:')
    console.log(JSON.stringify(result, null, 2))
    
  } catch (error) {
    console.error('💥 Test failed:', error.message)
    console.error('Stack:', error.stack)
  }
}

// Instructions for manual testing
console.log('📋 MANUAL TESTING INSTRUCTIONS:')
console.log('')
console.log('1. Get a JWT token from your Supabase auth')
console.log('2. Replace "YOUR_JWT_TOKEN_HERE" in the script')
console.log('3. Run: node test-edge-function.js')
console.log('')
console.log('🔗 Or test directly with curl:')
console.log('')
console.log(`curl -X POST '${EDGE_FUNCTION_URL}' \\`)
console.log('  -H "Authorization: Bearer YOUR_JWT_TOKEN" \\')
console.log('  -H "Content-Type: application/json" \\')
console.log('  -d \'{"poi_data": {"name": "Test POI", "city": "Test City", "country": "Brasil"}, "options": {}}\'')
console.log('')

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { testEdgeFunction, testPOI, testOptions }
}
