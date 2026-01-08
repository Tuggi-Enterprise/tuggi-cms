import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(request: NextRequest) {
  try {
    // Ensure the requester is an admin
    const cookieStore = await cookies()
    const supabaseAuth = createRouteHandlerClient({ cookies: () => cookieStore as any })
    const { data: { session }, error: authError } = await supabaseAuth.auth.getSession()
    if (authError || !session) {
      return NextResponse.json({ error: 'Unauthorized - Authentication required' }, { status: 401 })
    }
    const { data: cmsUser, error: cmsError } = await supabaseAuth
      .schema('core')
      .from('cms_users')
      .select('role, is_active')
      .eq('email', session.user.email as string)
      .eq('is_active', true)
      .single()
    if (cmsError || !cmsUser || cmsUser.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized - Admin only' }, { status: 403 })
    }
    const { ids } = await request.json()
    
    if (!ids || ids.length === 0) {
      return NextResponse.json(
        { error: 'No IDs provided' },
        { status: 400 }
      )
    }
    
    console.log(`🗑️ [API] Deleting ${ids.length} POIs and adding to blacklist`)
    
    // First, get POI data before deleting (for blacklist)
    const { data: poisToDelete, error: fetchError } = await supabase
      .schema('homolog')
      .from('pois')
      .select('uuid_id, name, city, state, country, category, primary_category, osm_id, osm_type, source_file')
      .in('uuid_id', ids)
    
    if (fetchError) {
      console.error('❌ [API] Error fetching POIs for blacklist:', fetchError)
      throw fetchError
    }
    
    // Add POIs to blacklist before deleting
    if (poisToDelete && poisToDelete.length > 0) {
      const blacklistEntries = poisToDelete.map(poi => ({
        poi_uuid_id: poi.uuid_id,
        osm_id: poi.osm_id,
        osm_type: poi.osm_type,
        name: poi.name,
        city: poi.city,
        state: poi.state,
        country: poi.country,
        category: poi.category,
        primary_category: poi.primary_category,
        reason: 'user_deleted',
        excluded_by: 'user',
        source_file: poi.source_file,
        metadata: {
          deleted_at: new Date().toISOString(),
          deleted_from: 'homolog.pois',
          original_uuid_id: poi.uuid_id // Store original UUID for reference
        }
      }))
      
      // Insert into blacklist, ignoring duplicates
      // The UNIQUE index on (osm_id, osm_type) will prevent duplicates
      // If POI is already blacklisted, that's OK - we just want to ensure it stays blacklisted
      const { error: blacklistError } = await supabase
        .schema('homolog')
        .from('pois_blacklist')
        .insert(blacklistEntries)
      
      // If error is about duplicate key, that's OK - POI is already blacklisted
      if (blacklistError) {
        const isDuplicateError = blacklistError.message.includes('duplicate') || 
                                  blacklistError.message.includes('unique') ||
                                  blacklistError.code === '23505' // PostgreSQL unique violation
        if (isDuplicateError) {
          console.log(`ℹ️ [API] Some POIs were already in blacklist (this is OK)`)
        } else {
          console.error('⚠️ [API] Error adding to blacklist (continuing with delete):', blacklistError)
          // Don't throw - continue with deletion even if blacklist fails
        }
      } else {
        console.log(`✅ [API] Added ${blacklistEntries.length} POIs to blacklist (OSM IDs saved for future import prevention)`)
      }
    }
    
    // Delete from homolog.pois (cascade will delete coordinates)
    const { error } = await supabase
      .schema('homolog')
      .from('pois')
      .delete()
      .in('uuid_id', ids)
    
    if (error) throw error
    
    console.log(`✅ [API] Successfully deleted ${ids.length} POIs`)
    
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
