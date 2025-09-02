import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { DescriptionService } from '@/lib/services/poi-processing/description.service'

/**
 * POI Description Processing API - Modular Version
 * 
 * Supports individual description operations:
 * - generate: Create new description
 * - improve: Enhance existing description  
 * - validate: Check description quality
 */
export async function POST(request: NextRequest) {
  try {
    console.log('🚀 Starting modular description processing...')
    
    // Authentication check
    const supabase = createRouteHandlerClient({ cookies })
    const { data: { session }, error: authError } = await supabase.auth.getSession()
    
    if (authError || !session) {
      console.log('❌ Authentication failed')
      return NextResponse.json(
        { error: 'Unauthorized - Authentication required' },
        { status: 401 }
      )
    }
    
    console.log('✅ User authenticated:', session.user.email)
    
    const body = await request.json()
    const { action = 'generate', poi_data, options = {} } = body
    
    // Validate required parameters
    if (!poi_data) {
      return NextResponse.json(
        { error: 'Missing required parameter: poi_data' },
        { status: 400 }
      )
    }

    // Add user context to options
    options.user_id = session.user.id

    let result
    
    switch (action) {
      case 'generate':
        console.log(`📝 Generating description for: ${poi_data.name}`)
        result = await DescriptionService.generate(poi_data, options)
        break
        
      case 'improve':
        console.log(`🔄 Improving description for: ${poi_data.name}`)
        if (!options.existing_description) {
          return NextResponse.json(
            { error: 'Missing required parameter for improve: existing_description' },
            { status: 400 }
          )
        }
        result = await DescriptionService.improve(poi_data, options.existing_description, options)
        break
        
      case 'validate':
        console.log(`🔍 Validating description for: ${poi_data.name}`)
        if (!options.description) {
          return NextResponse.json(
            { error: 'Missing required parameter for validate: description' },
            { status: 400 }
          )
        }
        const validation = await DescriptionService.validate(options.description, poi_data.name)
        result = {
          success: true,
          verification: validation
        }
        break
        
      default:
        return NextResponse.json(
          { error: `Invalid action: ${action}. Supported actions: generate, improve, validate` },
          { status: 400 }
        )
    }
    
    console.log(`✅ Description ${action} completed:`, result.success ? 'SUCCESS' : 'FAILED')
    
    return NextResponse.json(result)

  } catch (error: any) {
    console.error(`❌ Error in description processing:`, error)
    return NextResponse.json(
      { 
        success: false,
        error: error.message || 'Internal server error' 
      },
      { status: 500 }
    )
  }
}
