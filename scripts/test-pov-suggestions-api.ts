import 'dotenv/config'

const API_BASE_URL = 'http://localhost:3000'

async function testPOVSuggestionsAPI() {
  console.log('🧪 Testing POV Suggestions API')
  console.log('================================')
  
  // Teste 1: Shopping Center (deve ter muitos exemplos)
  console.log('\n📦 Test 1: Shopping Center')
  console.log('---------------------------')
  
  const shoppingTest = {
    poi_id: 'test-shopping-1',
    poi_name: 'Shopping Center Test',
    poi_lat: -23.5455,
    poi_lng: -46.6448,
    poi_types: ['establishment', 'shopping_mall'],
    limit: 5,
    min_confidence: 70
  }
  
  try {
    const response = await fetch(`${API_BASE_URL}/api/pov-suggestions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(shoppingTest)
    })
    
    const result = await response.json()
    
    if (response.ok) {
      console.log('✅ Shopping test successful')
      console.log(`📊 Generated ${result.data.suggestions.length} suggestions`)
      
      result.data.suggestions.forEach((suggestion: any, index: number) => {
        console.log(`  ${index + 1}. ${suggestion.distance_m}m, ${suggestion.bearing_deg}°, ${suggestion.access_type} (${suggestion.confidence_score.toFixed(1)}%)`)
      })
    } else {
      console.log('❌ Shopping test failed:', result.error)
    }
  } catch (error) {
    console.log('❌ Shopping test error:', error)
  }
  
  // Teste 2: Parque (deve ter exemplos diferentes)
  console.log('\n🌳 Test 2: Park')
  console.log('---------------')
  
  const parkTest = {
    poi_id: 'test-park-1',
    poi_name: 'Parque Test',
    poi_lat: -23.5500,
    poi_lng: -46.6500,
    poi_types: ['park', 'natural_feature'],
    limit: 5,
    min_confidence: 60
  }
  
  try {
    const response = await fetch(`${API_BASE_URL}/api/pov-suggestions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(parkTest)
    })
    
    const result = await response.json()
    
    if (response.ok) {
      console.log('✅ Park test successful')
      console.log(`📊 Generated ${result.data.suggestions.length} suggestions`)
      
      result.data.suggestions.forEach((suggestion: any, index: number) => {
        console.log(`  ${index + 1}. ${suggestion.distance_m}m, ${suggestion.bearing_deg}°, ${suggestion.access_type} (${suggestion.confidence_score.toFixed(1)}%)`)
      })
    } else {
      console.log('❌ Park test failed:', result.error)
    }
  } catch (error) {
    console.log('❌ Park test error:', error)
  }
  
  // Teste 3: GET request
  console.log('\n🌐 Test 3: GET Request')
  console.log('----------------------')
  
  const getUrl = new URL(`${API_BASE_URL}/api/pov-suggestions`)
  getUrl.searchParams.set('poi_id', 'test-get-1')
  getUrl.searchParams.set('poi_name', 'Test GET')
  getUrl.searchParams.set('poi_lat', '-23.5400')
  getUrl.searchParams.set('poi_lng', '-46.6400')
  getUrl.searchParams.set('poi_types', 'establishment,point_of_interest')
  getUrl.searchParams.set('limit', '3')
  getUrl.searchParams.set('min_confidence', '50')
  
  try {
    const response = await fetch(getUrl.toString())
    const result = await response.json()
    
    if (response.ok) {
      console.log('✅ GET test successful')
      console.log(`📊 Generated ${result.data.suggestions.length} suggestions`)
      
      result.data.suggestions.forEach((suggestion: any, index: number) => {
        console.log(`  ${index + 1}. ${suggestion.distance_m}m, ${suggestion.bearing_deg}°, ${suggestion.access_type} (${suggestion.confidence_score.toFixed(1)}%)`)
      })
    } else {
      console.log('❌ GET test failed:', result.error)
    }
  } catch (error) {
    console.log('❌ GET test error:', error)
  }
  
  // Teste 4: Validação de erros
  console.log('\n⚠️  Test 4: Error Validation')
  console.log('----------------------------')
  
  const invalidTest = {
    poi_id: 'test-invalid',
    poi_name: 'Invalid Test',
    // Missing coordinates
  }
  
  try {
    const response = await fetch(`${API_BASE_URL}/api/pov-suggestions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(invalidTest)
    })
    
    const result = await response.json()
    
    if (!response.ok && result.error) {
      console.log('✅ Error validation working correctly')
      console.log(`📝 Error message: ${result.error}`)
    } else {
      console.log('❌ Error validation failed - should have returned error')
    }
  } catch (error) {
    console.log('❌ Error validation test error:', error)
  }
  
  console.log('\n🎉 API Testing completed!')
}

// Executar testes se script for chamado diretamente
if (require.main === module) {
  testPOVSuggestionsAPI()
    .then(() => {
      console.log('\n✅ All tests completed successfully!')
      process.exit(0)
    })
    .catch(error => {
      console.error('\n💥 Test execution failed:', error)
      process.exit(1)
    })
}
