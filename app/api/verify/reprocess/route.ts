import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const { description_ids } = await request.json();
    
    if (!description_ids || !Array.isArray(description_ids) || description_ids.length === 0) {
      return NextResponse.json(
        { error: 'description_ids array is required' },
        { status: 400 }
      );
    }
    
    // Limit batch size to prevent overload
    const maxBatchSize = 50;
    if (description_ids.length > maxBatchSize) {
      return NextResponse.json(
        { error: `Too many IDs. Maximum allowed: ${maxBatchSize}` },
        { status: 400 }
      );
    }
    
    // Fetch the descriptions to reprocess
    const { data: descriptions, error: fetchError } = await supabase
      .schema('core')
      .from('attraction_descriptions')
      .select(`
        id,
        description,
        is_original,
        attraction_id,
        language
      `)
      .in('id', description_ids)
      .eq('is_original', true);
    
    if (fetchError) {
      console.error('Error fetching descriptions:', fetchError);
      return NextResponse.json(
        { error: 'Failed to fetch descriptions' },
        { status: 500 }
      );
    }
    
    if (!descriptions || descriptions.length === 0) {
      return NextResponse.json({
        processed: 0,
        failed: 0,
        message: 'No valid descriptions found for reprocessing'
      });
    }
    
    // Clear existing scores for these descriptions
    const { error: clearError } = await supabase
      .schema('core')
      .from('description_scores')
      .delete()
      .in('description_id', description_ids);
    
    if (clearError) {
      console.error('Error clearing existing scores:', clearError);
      // Continue anyway, the new scores will override
    }
    
    // Clear existing claims for these descriptions
    const { error: clearClaimsError } = await supabase
      .schema('core')
      .from('description_claims')
      .delete()
      .in('description_id', description_ids);
    
    if (clearClaimsError) {
      console.error('Error clearing existing claims:', clearClaimsError);
      // Continue anyway
    }
    
    // Reprocess each description
    const reprocessPromises = descriptions.map(async (desc) => {
      try {
        // Call the Supabase Edge Function for verification
        const { data, error } = await supabase.functions.invoke('verify-batch', {
          body: {
            description_id: desc.id,
            description: desc.description,
            attraction_id: desc.attraction_id,
            force_reprocess: true
          }
        });
        
        if (error) {
          console.error(`Error reprocessing ${desc.id}:`, error);
          return { success: false, description_id: desc.id, error: error.message };
        }
        
        return { success: true, description_id: desc.id };
      } catch (error) {
        console.error(`Error reprocessing ${desc.id}:`, error);
        return { success: false, description_id: desc.id, error: 'Unknown error' };
      }
    });
    
    const results = await Promise.all(reprocessPromises);
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    
    return NextResponse.json({
      processed: successful,
      failed,
      total_requested: description_ids.length,
      total_found: descriptions.length,
      message: `Reprocessed ${successful} descriptions${failed > 0 ? `, ${failed} failed` : ''}`
    });
    
  } catch (error) {
    console.error('Error in reprocess verification:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
