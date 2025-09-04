/**
 * Test file for TriggerPointsService
 * Run with: node test-trigger-points-service.js
 */

// Mock environment variables for testing
process.env.SUPABASE_URL = 'https://test.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key'

// Mock POI data
const mockPOIData = {
  id: 'test-poi-123',
  name: 'Test POI',
  city: 'Test City',
  country: 'Test Country',
  state: 'Test State',
  lat: -23.5505,
  lng: -46.6333
}

// Mock options
const mockOptions = {
  language: 'pt-br',
  gender: 'male',
  use_description_context: true,
  boundary_strategy: 'osm',
  trigger_point_count: 5,
  min_distance_meters: 30,
  max_distance_meters: 200
}

async function testTriggerPointsService() {
  console.log('🧪 Testing TriggerPointsService...\n')
  
  try {
    // Import the service
    const { TriggerPointsService } = await import('./lib/services/poi-processing/trigger-points.service.ts')
    
    console.log('✅ Service imported successfully')
    
    // Test 1: Generate trigger points
    console.log('\n🎯 Test 1: Generating trigger points...')
    const generateResult = await TriggerPointsService.generate(mockPOIData, mockOptions)
    
    if (generateResult.success) {
      console.log('✅ Generation successful!')
      console.log(`📊 Generated ${generateResult.data?.trigger_points.length} trigger points`)
      console.log(`🎯 Confidence score: ${generateResult.data?.confidence_score}`)
      console.log(`⏱️ Processing time: ${generateResult.processing_time}ms`)
    } else {
      console.log('❌ Generation failed:', generateResult.error)
    }
    
    // Test 2: Validate trigger points
    if (generateResult.success && generateResult.data?.trigger_points) {
      console.log('\n🔍 Test 2: Validating trigger points...')
      const validationResult = await TriggerPointsService.validate(generateResult.data.trigger_points)
      
      if (validationResult.success) {
        console.log('✅ Validation successful!')
        console.log(`📊 Quality score: ${validationResult.data?.quality_score}`)
        console.log(`✅ Valid: ${validationResult.data?.valid}`)
        
        if (validationResult.data?.issues.length > 0) {
          console.log('⚠️ Issues found:')
          validationResult.data.issues.forEach(issue => console.log(`  - ${issue}`))
        }
        
        if (validationResult.data?.suggestions.length > 0) {
          console.log('💡 Suggestions:')
          validationResult.data.suggestions.forEach(suggestion => console.log(`  - ${suggestion}`))
        }
      } else {
        console.log('❌ Validation failed:', validationResult.error)
      }
    }
    
    // Test 3: Get processing status
    console.log('\n📊 Test 3: Getting processing status...')
    const statusResult = await TriggerPointsService.getProcessingStatus(mockPOIData.id)
    
    if (statusResult) {
      console.log('✅ Status retrieved successfully!')
      console.log(`📊 Step: ${statusResult.step}`)
      console.log(`📈 Progress: ${statusResult.progress}%`)
      console.log(`🔄 Status: ${statusResult.status}`)
    } else {
      console.log('❌ Status retrieval failed')
    }
    
    console.log('\n🎉 All tests completed!')
    
  } catch (error) {
    console.error('❌ Test failed:', error)
  }
}

// Run tests
testTriggerPointsService()
