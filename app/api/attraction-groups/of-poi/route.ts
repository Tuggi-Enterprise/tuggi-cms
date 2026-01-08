import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  console.log('🔍 API: /api/attraction-groups/of-poi called');
  
  const cookieStore = await cookies();
  const supabase = createRouteHandlerClient({ cookies: () => cookieStore as any });
  const { searchParams } = new URL(req.url);
  const poiId = searchParams.get('poiId');
  
  console.log('🔍 API: poiId =', poiId);
  
  if (!poiId) {
    console.log('❌ API: Missing poiId');
    return NextResponse.json({ error: 'Missing poiId' }, { status: 400 });
  }

  try {
    // Find group membership
    const { data: member, error: memberError } = await supabase
      .schema('core')
      .from('attraction_group_members')
      .select('group_id')
      .eq('attraction_id', poiId)
      .single();

    console.log('🔍 API: Member query result:', { member, memberError });

    if (memberError || !member) {
      console.log('🔍 API: No group membership found, returning null');
      return NextResponse.json({ group: null });
    }

    // Fetch group details
    const { data: group, error: groupError } = await supabase
      .schema('core')
      .from('attraction_groups')
      .select('id, name, created_by, created_at')
      .eq('id', member.group_id)
      .single();

    console.log('🔍 API: Group query result:', { group, groupError });

    if (groupError || !group) {
      console.log('🔍 API: Group not found, returning null');
      return NextResponse.json({ group: null });
    }

    // Fetch all members
    const { data: members } = await supabase
      .schema('core')
      .from('attraction_group_members')
      .select('attraction_id')
      .eq('group_id', group.id);

    console.log('🔍 API: Members query result:', { members });

    const result = { group, members: members?.map(m => m.attraction_id) || [] };
    console.log('✅ API: Returning result:', result);
    
    return NextResponse.json(result);
  } catch (error) {
    console.error('❌ API: Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}