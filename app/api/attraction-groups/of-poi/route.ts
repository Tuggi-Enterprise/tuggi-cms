import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { withAuth, withRateLimit } from '@/lib/auth-middleware';

export const GET = withAuth(withRateLimit(100, 60000)(async function(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies });
  const { searchParams } = new URL(req.url);
  const poiId = searchParams.get('poiId');
  if (!poiId) {
    return NextResponse.json({ error: 'Missing poiId' }, { status: 400 });
  }

  // Find group membership
  const { data: member, error: memberError } = await supabase
    .schema('core')
    .from('attraction_group_members')
    .select('group_id')
    .eq('attraction_id', poiId)
    .single();

  if (memberError || !member) {
    return NextResponse.json({ group: null });
  }

  // Fetch group details
  const { data: group, error: groupError } = await supabase
    .schema('core')
    .from('attraction_groups')
    .select('id, name, created_by, created_at')
    .eq('id', member.group_id)
    .single();

  if (groupError || !group) {
    return NextResponse.json({ group: null });
  }

  // Fetch all members
  const { data: members } = await supabase
    .schema('core')
    .from('attraction_group_members')
    .select('attraction_id')
    .eq('group_id', group.id);

  return NextResponse.json({ group, members: members?.map(m => m.attraction_id) || [] });
}))