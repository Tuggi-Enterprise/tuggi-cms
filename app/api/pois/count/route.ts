import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(request: NextRequest) {
  try {
    console.log('🔍 API: Checking POI counts with service role')

    // Count with service role (bypass RLS)
    const { count: serviceRoleCount, error: serviceRoleError } = await supabase
      .schema('core')
      .from('attractions')
      .select('*', { count: 'exact', head: true });

    console.log('🔍 API: Service role count:', { count: serviceRoleCount, error: serviceRoleError });

    // Get sample POIs with service role
    const { data: serviceRolePois, error: serviceRolePoisError } = await supabase
      .schema('core')
      .from('attractions')
      .select('id, name, city, country, created_at, user_id')
      .order('created_at', { ascending: false })
      .limit(10);

    console.log('🔍 API: Service role POIs sample:', { dataCount: serviceRolePois?.length, error: serviceRolePoisError });

    // Check distribution by user_id
    const { data: userDistribution, error: userDistError } = await supabase
      .schema('core')
      .from('attractions')
      .select('user_id')
      .not('user_id', 'is', null);

    const userCounts = userDistribution?.reduce((acc: any, poi: any) => {
      acc[poi.user_id] = (acc[poi.user_id] || 0) + 1;
      return acc;
    }, {});

    console.log('🔍 API: User distribution:', userCounts);

    // Get current user info
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    console.log('🔍 API: Current user:', user?.id);
    console.log('🔍 API: Current user error:', userError);

    return NextResponse.json({
      serviceRoleCount,
      serviceRoleError,
      samplePOIs: serviceRolePois,
      userDistribution: userCounts,
      totalUsers: Object.keys(userCounts || {}).length,
      currentUserId: user?.id,
      currentUserError: userError
    })

  } catch (error) {
    console.error('🔍 API: Error checking POI counts:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
