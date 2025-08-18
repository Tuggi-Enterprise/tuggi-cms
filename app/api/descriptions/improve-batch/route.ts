import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { createBatchJob, addBatchItem, updateBatchItemStatus, updateBatchProgress } from '@/lib/batch-processing';

export const maxDuration = 300; // 5 minutes max duration for this API route

export async function POST(req: NextRequest) {
  try {
    // Authenticate user
    const supabase = createRouteHandlerClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user || !user.email?.endsWith('@tuggi.app')) {
      return NextResponse.json(
        { error: 'Unauthorized - Authentication required' },
        { status: 401 }
      );
    }

    // Get parameters from request body
    const { 
      limit = 50, 
      minScore = 0,
      maxScore = 60, 
      language = 'pt-br',
      country = 'Brazil',
      status = 'rejected'
    } = await req.json();

    // Create a new batch job for tracking progress
    const jobType = 'improve_descriptions';
    const jobParams = { 
      limit, 
      minScore, 
      maxScore, 
      language, 
      country,
      status
    };
    const { jobId } = await createBatchJob(supabase, jobType, jobParams);

    // Start processing in background
    processDescriptionsInBackground(supabase, jobId, jobParams);

    // Return job ID immediately
    return NextResponse.json({ 
      jobId,
      message: 'Description improvement batch job started',
      params: jobParams
    });
    
  } catch (error: any) {
    console.error('Error in improve-batch API:', error);
    return NextResponse.json(
      { error: error.message || 'Unknown error' },
      { status: 500 }
    );
  }
}

async function processDescriptionsInBackground(supabase: any, jobId: string, params: any) {
  try {
    const { limit, minScore, maxScore, language, country, status } = params;
    
    // Update job status to processing
    await updateBatchProgress(supabase, jobId, {
      status: 'processing',
      progress_message: 'Fetching descriptions to improve'
    });

    // Fetch descriptions that need improvement
    const { data: descriptions, error } = await supabase
      .schema('core')
      .from('attraction_descriptions')
      .select(`
        id, 
        description, 
        attraction_id,
        description_hash,
        language,
        attractions!inner(
          id,
          name,
          google_types,
          country,
          city
        ),
        description_scores(score_overall)
      `)
      .eq('is_original', true)
      .eq('language', language)
      .eq('verification_status', status)
      .eq('attractions.country', country)
      .gte('description_scores.score_overall', minScore)
      .lte('description_scores.score_overall', maxScore)
      .order('description_scores.score_overall', { ascending: true })
      .limit(limit);

    if (error) {
      throw new Error(`Failed to fetch descriptions: ${error.message}`);
    }

    // Update job with total items
    const totalItems = descriptions.length;
    await updateBatchProgress(supabase, jobId, {
      total_items: totalItems,
      progress_message: `Found ${totalItems} descriptions to improve`
    });

    if (totalItems === 0) {
      await updateBatchProgress(supabase, jobId, {
        status: 'completed',
        progress_message: 'No descriptions found to improve'
      });
      return;
    }

    // Process each description
    let processed = 0;
    let successful = 0;
    let failed = 0;

    for (const desc of descriptions) {
      try {
        // Add item to batch
        const score = desc.description_scores?.[0]?.score_overall || 0;
        const itemId = await addBatchItem(supabase, jobId, {
          item_type: 'description',
          item_id: desc.id,
          status: 'pending',
          metadata: {
            attraction_id: desc.attraction_id,
            attraction_name: desc.attractions.name,
            original_score: score,
            google_types: desc.attractions.google_types,
            city: desc.attractions.city
          }
        });

        // Update progress
        await updateBatchProgress(supabase, jobId, {
          processed_items: processed,
          progress_message: `Improving description for ${desc.attractions.name} (${processed}/${totalItems})`
        });

        // Call the generate-with-feedback API to improve the description
        const apiUrl = new URL('/api/descriptions/generate-with-feedback', req.url);
        const response = await fetch(apiUrl.toString(), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            description_id: desc.id,
            attraction_id: desc.attraction_id
          })
        });

        if (!response.ok) {
          const errorData = await response.text();
          throw new Error(`Failed to improve description: ${errorData}`);
        }

        const result = await response.json();

        // Update the description in the database
        const { error: updateError } = await supabase
          .schema('core')
          .from('attraction_descriptions')
          .update({
            description: result.description,
            description_hash: result.description_hash,
            verification_status: 'pending',
            updated_at: new Date().toISOString()
          })
          .eq('id', desc.id);

        if (updateError) {
          throw new Error(`Failed to update description: ${updateError.message}`);
        }

        // Trigger verification for the improved description
        const verifyUrl = new URL('/api/verify/individual', req.url);
        const verifyResponse = await fetch(verifyUrl.toString(), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            description_id: desc.id
          })
        });

        if (!verifyResponse.ok) {
          const verifyErrorData = await verifyResponse.text();
          throw new Error(`Failed to verify improved description: ${verifyErrorData}`);
        }

        // Update batch item status
        await updateBatchItemStatus(supabase, itemId, 'completed', {
          new_description: result.description,
          verification_triggered: true
        });

        successful++;
      } catch (itemError: any) {
        console.error(`Error processing description ${desc.id}:`, itemError);
        
        // Update batch item status to failed
        await updateBatchItemStatus(supabase, desc.id, 'failed', {
          error: itemError.message
        });
        
        failed++;
      }

      processed++;

      // Update overall job progress
      await updateBatchProgress(supabase, jobId, {
        processed_items: processed,
        successful_items: successful,
        failed_items: failed,
        progress_message: `Processed ${processed}/${totalItems} descriptions (${successful} successful, ${failed} failed)`
      });
    }

    // Complete the job
    await updateBatchProgress(supabase, jobId, {
      status: 'completed',
      progress_message: `Completed improving ${totalItems} descriptions (${successful} successful, ${failed} failed)`
    });

  } catch (error: any) {
    console.error('Error in background processing:', error);
    
    // Update job status to failed
    await updateBatchProgress(supabase, jobId, {
      status: 'failed',
      progress_message: `Failed: ${error.message}`
    });
  }
}