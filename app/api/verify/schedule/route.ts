import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

const VERIFY_BATCH_SIZE = parseInt(process.env.VERIFY_BATCH_SIZE || '20');

async function createBatchJob(userEmail: string, batchSize: number, totalItems: number, cursorId: string | null) {
  const { data, error } = await supabase
    .schema('core')
    .rpc('create_batch_job', {
      p_user_email: userEmail,
      p_batch_size: batchSize,
      p_total_items: totalItems,
      p_cursor_id: cursorId
    });

  if (error) {
    console.error('Error creating batch job:', error);
    return null;
  }

  return data;
}

async function processDescriptionsInBackground(jobId: string, descriptionsToProcess: any[]) {
  console.log(`🔄 Starting background processing for job ${jobId} with ${descriptionsToProcess.length} descriptions`);
  
  let processedCount = 0;
  let failedCount = 0;
  
  for (const description of descriptionsToProcess) {
    try {
      console.log(`🔄 Processing description ${description.id}...`);
      
      const { data, error } = await supabase.functions.invoke('verify-batch', {
        body: {
          description_id: description.id,
          description: description.description,
          attraction_id: description.attraction_id,
          force_reprocess: false
        }
      });

      if (error) {
        console.error(`❌ Error processing ${description.id}:`, error);
        failedCount++;
      } else {
        console.log(`✅ Description ${description.id} processed successfully`);
        processedCount++;
      }

      // Update job progress
      await supabase
        .schema('core')
        .rpc('update_batch_progress', {
          p_job_id: jobId,
          p_processed_items: processedCount,
          p_failed_items: failedCount,
          p_status: 'running'
        });

      // Wait 2 seconds between processing to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 2000));

    } catch (error) {
      console.error(`❌ Unexpected error processing ${description.id}:`, error);
      failedCount++;
    }
  }

  // Finalize job
  console.log(`✅ Background processing completed for job ${jobId}: ${processedCount} processed, ${failedCount} failed`);
  await supabase
    .schema('core')
    .rpc('update_batch_progress', {
      p_job_id: jobId,
      p_processed_items: processedCount,
      p_failed_items: failedCount,
      p_status: 'completed'
    });
}

export async function POST(request: NextRequest) {
  try {
    const { batch = VERIFY_BATCH_SIZE, cursor } = await request.json();

    console.log(`🔍 Buscando ${batch} descrições que PRECISAM de verificação`);
    console.log(`🎯 QUERY DIRETA: Usando função SQL otimizada`);

    // Usar função SQL otimizada que busca APENAS itens processáveis
    const { data: descriptionsToProcess, error: fetchError } = await supabase
      .schema('core')
      .rpc('get_descriptions_for_batch_processing', {
        batch_size: batch,
        cursor_id: cursor,
        target_language: 'pt-br'
      });

    if (fetchError) {
      console.error('❌ Erro ao buscar descrições:', fetchError);
      return NextResponse.json(
        { error: 'Failed to fetch descriptions' },
        { status: 500 }
      );
    }

    if (!descriptionsToProcess || descriptionsToProcess.length === 0) {
      console.log('✅ Nenhuma descrição encontrada para verificação');
      return NextResponse.json({
        scheduled: 0,
        nextCursor: null,
        message: 'No descriptions found for verification'
      });
    }

    console.log(`📋 Encontradas ${descriptionsToProcess.length} descrições que PRECISAM de processamento`);
    
    // Categorizar por motivo (para logs)
    const reasonCounts: Record<string, number> = {};
    descriptionsToProcess.forEach((d: any) => {
      reasonCounts[d.needs_processing_reason] = (reasonCounts[d.needs_processing_reason] || 0) + 1;
    });

    console.log('📊 Motivos para processamento:');
    Object.entries(reasonCounts).forEach(([reason, count]) => {
      const emoji = {
        'no_score': '🆕',
        'hash_changed': '🔄', 
        'status_allows': '✅'
      }[reason] || '❓';
      console.log(`   ${emoji} ${reason}: ${count}`);
    });

    // Criar job de processamento ANTES de processar
    const userEmail = 'leandro.ramos@tuggi.app'; // TODO: Get from auth
    const jobId = await createBatchJob(userEmail, batch, descriptionsToProcess.length, null);
    
    if (!jobId) {
      console.error('❌ Erro ao criar job de processamento');
      return NextResponse.json(
        { error: 'Failed to create processing job' },
        { status: 500 }
      );
    }

    console.log(`🎯 Job de processamento criado: ${jobId}`);

    // Retornar o job_id imediatamente para mostrar a barra de progresso
    console.log(`🎯 Retornando job_id imediatamente: ${jobId}`);
    
    // Processar as descrições em background (não bloquear a resposta)
    processDescriptionsInBackground(jobId, descriptionsToProcess);

    return NextResponse.json({
      job_id: jobId,
      scheduled: 0, // Será atualizado durante o processamento
      failed: 0,    // Será atualizado durante o processamento
      nextCursor: null,
      found_processable: descriptionsToProcess.length,
      reason_breakdown: reasonCounts,
      query_efficiency: '100% (direct SQL query)',
      message: 'Processing started in background'
    });

  } catch (error) {
    console.error('❌ Erro inesperado:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
