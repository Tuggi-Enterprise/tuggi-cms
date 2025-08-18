import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';

export async function GET(req: NextRequest) {
  try {
    // Verify authentication
    const supabase = createRouteHandlerClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user || !user.email?.endsWith('@tuggi.app')) {
      return NextResponse.json(
        { error: 'Unauthorized - Authentication required' },
        { status: 401 }
      );
    }

    // Get job_id from query
    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get('job_id');

    if (!jobId) {
      return NextResponse.json(
        { error: 'Missing job_id parameter' },
        { status: 400 }
      );
    }

    // Fetch job status
    const { data: jobData, error: jobError } = await supabase
      .schema('core')
      .from('v_batch_job_progress')
      .select('*')
      .eq('id', jobId)
      .single();

    if (jobError) {
      return NextResponse.json(
        { error: 'Failed to fetch job status', details: jobError },
        { status: 500 }
      );
    }

    if (!jobData) {
      return NextResponse.json(
        { error: 'Job not found' },
        { status: 404 }
      );
    }

    // Fetch job items if job is in progress or completed
    let items = [];
    if (jobData.status !== 'pending') {
      const { data: itemsData } = await supabase
        .schema('core')
        .from('batch_processing_items')
        .select('*')
        .eq('job_id', jobId)
        .order('created_at', { ascending: true });

      items = itemsData || [];
    }

    // Return job data
    return NextResponse.json({
      ...jobData,
      items: items.length > 0 ? items : undefined
    });

  } catch (error: any) {
    console.error('Error in job-status API:', error);
    return NextResponse.json(
      { error: error.message || 'Unknown error' },
      { status: 500 }
    );
  }
}
