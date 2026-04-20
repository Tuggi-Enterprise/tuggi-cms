import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseRouteHandler } from '@/lib/core/supabase-client'
;
import { cookies } from 'next/headers';
// import { withAuth, withRateLimit } from '@/lib/auth-middleware';

export const POST = async function(req: NextRequest) {
  console.log('🔍 API: /api/attraction-groups/group POST called (no auth)');
  
  try {
    const cookieStore = await cookies();
    const supabase = getSupabaseRouteHandler(cookieStore);
    const body = await req.json();
    const { groupId, name, poiIds, userId } = body;

    console.log('Group API called with:', { groupId, name, poiIds, userId });

    if (!name || !Array.isArray(poiIds) || poiIds.length === 0 || !userId) {
      console.error('Missing required fields:', { name, poiIds, userId });
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

  let group_id = groupId;
  if (!groupId) {
    // Create new group
    const { data: group, error: groupError } = await supabase
      .schema('core')
      .from('attraction_groups')
      .insert({ name, created_by: userId })
      .select('id')
      .single();
    if (groupError || !group) {
      console.error('Error creating group:', groupError);
      return NextResponse.json({ error: 'Failed to create group' }, { status: 500 });
    }
    group_id = group.id;
  } else {
    // Update group name
    const { error: updateError } = await supabase
      .schema('core')
      .from('attraction_groups')
      .update({ name })
      .eq('id', groupId);
    if (updateError) {
      console.error('Error updating group:', updateError);
      return NextResponse.json({ error: 'Failed to update group' }, { status: 500 });
    }
  }

  // Remove all current members for this group
  const { error: deleteError } = await supabase
    .schema('core')
    .from('attraction_group_members')
    .delete()
    .eq('group_id', group_id);
  
  if (deleteError) {
    console.error('Error deleting group members:', deleteError);
  }
  
  // Also remove these specific POIs from ANY other groups they might belong to (due to unique attraction_id constraint)
  const { error: clearError } = await supabase
    .schema('core')
    .from('attraction_group_members')
    .delete()
    .in('attraction_id', poiIds);
  
  if (clearError) {
    console.error('Error clearing old memberships:', clearError);
    return NextResponse.json({ error: 'Failed to clear old memberships' }, { status: 500 });
  }

  // Insert new members with roles (first POI is main, others are members)
  const members = poiIds.map((attraction_id: string, index: number) => ({ 
    group_id, 
    attraction_id,
    group_role: index === 0 ? 'main' : 'member'
  }));
  if (members.length > 0) {
    const { error: insertError } = await supabase
      .schema('core')
      .from('attraction_group_members')
      .insert(members);
    if (insertError) {
      console.error('Error inserting group members:', insertError);
      return NextResponse.json({ error: 'Failed to assign POIs to group' }, { status: 500 });
    }
  }

  return NextResponse.json({ groupId: group_id });
  } catch (error) {
    console.error('Unexpected error in group API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}