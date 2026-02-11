import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { logAuditEvent } from '@/lib/services/audit-service'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function PUT(request: NextRequest) {
  try {
    // Ensure requester is an admin
    const cookieStore = await cookies()
    const supabaseAuth = createRouteHandlerClient({ cookies: () => cookieStore as any })
    const { data: { session }, error: authError } = await supabaseAuth.auth.getSession()
    if (authError || !session) {
      return NextResponse.json({ error: 'Unauthorized - Authentication required' }, { status: 401 })
    }
    const { data: cmsUser, error: cmsError } = await supabaseAuth
      .schema('core')
      .from('cms_users')
      .select('id, role, is_active')
      .eq('email', session.user.email as string)
      .eq('is_active', true)
      .single()
    if (cmsError || !cmsUser || cmsUser.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized - Admin only' }, { status: 403 })
    }
    const { id, updates } = await request.json()
    
    if (!id) {
      return NextResponse.json(
        { error: 'POI ID is required' },
        { status: 400 }
      )
    }
    
    const { error } = await supabase
      .schema('homolog')
      .from('pois')
      .update(updates)
      .eq('uuid_id', id)
    
    if (error) throw error

    const updatedFields = updates ? Object.keys(updates) : []
    await logAuditEvent({
      request,
      action: 'UPDATE_POI',
      entity: 'POI',
      entityId: id,
      userId: cmsUser.id,
      userEmail: session.user.email || null,
      description: `Updated POI fields: ${updatedFields.join(', ')}`
    })
    
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error updating POI:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Update failed' },
      { status: 500 }
    )
  }
}
