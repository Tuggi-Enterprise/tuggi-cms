import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '../../../../lib/core/supabase-client'

const supabase = getSupabase('service')

export async function POST(request: NextRequest) {
  try {
    const { attraction_id, group_id, group_role = 'member' } = await request.json()

    console.log('🔍 API: Adding member to group:', { attraction_id, group_id, group_role })

    // Check if the attraction exists
    const { data: attraction, error: attractionError } = await supabase
      .schema('core')
      .from('attractions')
      .select('id, name')
      .eq('id', attraction_id)
      .single()

    if (attractionError || !attraction) {
      console.error('🔍 API: Attraction not found:', attractionError)
      return NextResponse.json({ error: 'Attraction not found' }, { status: 404 })
    }

    // Check if the group exists
    const { data: group, error: groupError } = await supabase
      .schema('core')
      .from('attraction_groups')
      .select('id, name')
      .eq('id', group_id)
      .single()

    if (groupError || !group) {
      console.error('🔍 API: Group not found:', groupError)
      return NextResponse.json({ error: 'Group not found' }, { status: 404 })
    }

    // Check if membership already exists
    const { data: existingMembership, error: existingError } = await supabase
      .schema('core')
      .from('attraction_group_members')
      .select('*')
      .eq('attraction_id', attraction_id)
      .eq('group_id', group_id)
      .single()

    if (existingMembership) {
      console.log('🔍 API: Membership already exists:', existingMembership)
      return NextResponse.json({ 
        message: 'Membership already exists',
        membership: existingMembership
      })
    }

    // Insert the membership
    const { data: newMembership, error: insertError } = await supabase
      .schema('core')
      .from('attraction_group_members')
      .insert({
        attraction_id,
        group_id,
        group_role,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select()
      .single()

    if (insertError) {
      console.error('🔍 API: Error inserting membership:', insertError)
      return NextResponse.json({ error: 'Failed to add member to group' }, { status: 500 })
    }

    console.log('🔍 API: Successfully added member to group:', newMembership)

    return NextResponse.json({ 
      message: 'Member added to group successfully',
      membership: newMembership
    })

  } catch (error) {
    console.error('🔍 API: Unexpected error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
