import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(request: NextRequest) {
  try {
    const { ids } = await request.json()
    
    if (!ids || ids.length === 0) {
      return NextResponse.json(
        { error: 'No IDs provided' },
        { status: 400 }
      )
    }
    
    // Delete from homolog.pois (cascade will delete coordinates)
    const { error } = await supabase
      .schema('homolog')
      .from('pois')
      .delete()
      .in('uuid_id', ids)
    
    if (error) throw error
    
    return NextResponse.json({
      success: true,
      deleted: ids.length
    })
  } catch (error) {
    console.error('Error deleting POIs:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Delete failed' },
      { status: 500 }
    )
  }
}
