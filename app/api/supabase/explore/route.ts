import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/core/supabase-client'

/**
 * API route to explore Supabase database schema and data
 * READ-ONLY operations for database inspection
 */
export async function GET(request: NextRequest) {
  try {
    // Verify environment variables are loaded
    const hasUrl = !!process.env.NEXT_PUBLIC_SUPABASE_URL
    const hasAnonKey = !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    const hasServiceKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY
    
    if (!hasUrl || !hasAnonKey) {
      return NextResponse.json(
        { 
          error: 'Missing Supabase environment variables',
          details: {
            hasUrl,
            hasAnonKey,
            hasServiceKey,
            url: hasUrl ? 'configured' : 'missing',
            anonKey: hasAnonKey ? 'configured' : 'missing'
          }
        },
        { status: 500 }
      )
    }

    const supabase = getSupabase('server')
    const { searchParams } = new URL(request.url)
    const action = searchParams.get('action') || 'schemas'
    const schema = searchParams.get('schema') || 'core'
    const table = searchParams.get('table')
    const limit = parseInt(searchParams.get('limit') || '10')

    switch (action) {
      case 'schemas': {
        // Return known schemas from the project
        // Supabase doesn't allow direct querying of information_schema via REST API
        return NextResponse.json({
          schemas: ['core', 'homolog', 'public', 'auth', 'storage'],
          source: 'project_config'
        })
      }

      case 'tables': {
        // Return known tables based on schema
        // Supabase doesn't allow direct querying of information_schema via REST API
        const knownTables: Record<string, string[]> = {
          core: [
            'attractions',
            'attraction_coordinate',
            'attraction_description',
            'attraction_image',
            'attraction_trigger_points',
            'attraction_analytics',
            'cms_users',
            'description_claims',
            'description_claim_evidence',
            'saved_polygons'
          ],
          homolog: [
            'pois',
            'coordinates',
            'stats'
          ],
          public: [],
          auth: [],
          storage: []
        }

        return NextResponse.json({
          tables: knownTables[schema] || [],
          source: 'project_config',
          schema
        })
      }

      case 'columns': {
        if (!table) {
          return NextResponse.json(
            { error: 'Table name is required' },
            { status: 400 }
          )
        }

        // Try to get a sample row to infer structure
        let sampleRows: any = null
        let sampleError: any = null
        
        try {
          const result = await supabase
            .schema(schema as any)
            .from(table)
            .select('*')
            .limit(1)
          
          sampleRows = result.data
          sampleError = result.error
        } catch (err: any) {
          sampleError = { message: 'Table access denied', details: err.message }
        }

        const sample = sampleRows && Array.isArray(sampleRows) ? sampleRows[0] : sampleRows

        if (!sampleError && sample) {
          const columns = Object.keys(sample).map(key => {
            const value = sample[key]
            let dataType: string = typeof value
            
            if (value === null) {
              dataType = 'unknown'
            } else if (Array.isArray(value)) {
              dataType = 'array'
            } else if (typeof value === 'object') {
              dataType = 'jsonb'
            } else if (typeof value === 'number') {
              dataType = Number.isInteger(value) ? 'integer' : 'numeric'
            }

            return {
              column_name: key,
              data_type: dataType,
              is_nullable: value === null,
              column_default: null,
              character_maximum_length: typeof value === 'string' ? value.length : null
            }
          })

          return NextResponse.json({
            columns,
            source: 'sample_inference',
            schema,
            table
          })
        }

        return NextResponse.json(
          { error: sampleError?.message || 'Unable to fetch column information' },
          { status: 500 }
        )
      }

      case 'data': {
        if (!table) {
          return NextResponse.json(
            { error: 'Table name is required' },
            { status: 400 }
          )
        }

        // Get sample data from table (READ-ONLY)
        let data: any = null
        let error: any = null
        let count: number | null = null
        
        try {
          const result = await supabase
            .schema(schema as any)
            .from(table)
            .select('*', { count: 'exact' })
            .limit(limit)
          
          data = result.data
          error = result.error
          count = result.count
        } catch (err: any) {
          error = { message: 'Table access denied', details: err.message }
        }

        if (error) {
          return NextResponse.json(
            { error: error.message },
            { status: 500 }
          )
        }

        return NextResponse.json({
          data: data || [],
          count: count || 0,
          limit,
          schema,
          table
        })
      }

      case 'stats': {
        // Get database statistics
        const stats: any = {
          connection: {
            url: process.env.NEXT_PUBLIC_SUPABASE_URL ? 'configured' : 'not configured',
            hasAnonKey: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
            hasServiceKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY
          }
        }

        // Try to get table counts for core schema
        try {
          const attractionsResult = await supabase
            .schema('core')
            .from('attractions')
            .select('*', { count: 'exact', head: true })

          const poisResult = await supabase
            .schema('homolog')
            .from('pois')
            .select('*', { count: 'exact', head: true })

          stats.tables = {
            'core.attractions': attractionsResult.count || 0,
            'homolog.pois': poisResult.count || 0
          }
        } catch (err) {
          // Ignore errors
          stats.tables = {
            'core.attractions': 0,
            'homolog.pois': 0
          }
        }

        return NextResponse.json({ stats })
      }

      default:
        return NextResponse.json(
          { error: 'Invalid action' },
          { status: 400 }
        )
    }
  } catch (error: any) {
    console.error('Database exploration error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

