import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const { batch = 20, cursor } = await request.json();
    
    // Get verification settings
    const { data: settings } = await supabase
      .schema('core')
      .from('verify_settings')
      .select('value')
      .eq('key', 'batch_size')
      .single();
    
    const batchSize = settings?.value || batch;
    
    // Build query to find descriptions that need verification
    let query = supabase
      .schema('core')
      .from('attraction_descriptions')
      .select(`
        id,
        description,
        is_original,
        description_hash,
        attraction_id,
        language
      `)
      .eq('is_original', true)
      .eq('language', 'pt-br')
      .limit(batchSize);
    
    // If cursor is provided, use it for pagination
    if (cursor) {
      query = query.gt('id', cursor);
    }
    
    // Get descriptions that need verification
    const { data: descriptions, error } = await query;
    
    if (error) {
      console.error('Error fetching descriptions:', error);
      return NextResponse.json(
        { error: 'Failed to fetch descriptions' },
        { status: 500 }
      );
    }
    
    if (!descriptions || descriptions.length === 0) {
      return NextResponse.json({
        scheduled: 0,
        nextCursor: null,
        message: 'No descriptions found for verification'
      });
    }
    
    // Calculate hash for each description and filter those that need verification
    const descriptionsToVerify = descriptions.filter(desc => {
      if (!desc.description) return false;
      
      const currentHash = crypto
        .createHash('sha256')
        .update(desc.description)
        .digest('hex');
      
      // Check if we need to verify this description
      return !desc.description_hash || desc.description_hash !== currentHash;
    });
    
    if (descriptionsToVerify.length === 0) {
      return NextResponse.json({
        scheduled: 0,
        nextCursor: descriptions[descriptions.length - 1]?.id || cursor,
        message: 'All descriptions are up to date'
      });
    }
    
    // Update description hashes for the ones we're going to verify
    const updatePromises = descriptionsToVerify.map(desc => {
      const hash = crypto
        .createHash('sha256')
        .update(desc.description || '')
        .digest('hex');
      
      return supabase
        .schema('core')
        .from('attraction_descriptions')
        .update({ description_hash: hash })
        .eq('id', desc.id);
    });
    
    await Promise.all(updatePromises);
    
    // Schedule verification for each description
    const verificationPromises = descriptionsToVerify.map(async (desc) => {
      try {
        // Call the Supabase Edge Function for verification
        const { data, error } = await supabase.functions.invoke('verify-batch', {
          body: {
            description_id: desc.id,
            description: desc.description,
            attraction_id: desc.attraction_id
          }
        });
        
        if (error) {
          console.error(`Error scheduling verification for ${desc.id}:`, error);
          return { success: false, description_id: desc.id, error: error.message };
        }
        
        return { success: true, description_id: desc.id };
      } catch (error) {
        console.error(`Error scheduling verification for ${desc.id}:`, error);
        return { success: false, description_id: desc.id, error: 'Unknown error' };
      }
    });
    
    const results = await Promise.all(verificationPromises);
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    
    // Get next cursor for pagination
    const nextCursor = descriptions[descriptions.length - 1]?.id || cursor;
    
    return NextResponse.json({
      scheduled: successful,
      failed,
      nextCursor,
      total_processed: descriptions.length,
      message: `Scheduled ${successful} descriptions for verification${failed > 0 ? `, ${failed} failed` : ''}`
    });
    
  } catch (error) {
    console.error('Error in schedule verification:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
