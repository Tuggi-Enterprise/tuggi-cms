import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

const VERIFY_BATCH_SIZE = parseInt(process.env.VERIFY_BATCH_SIZE || '20');

export async function POST(request: NextRequest) {
  try {
    const { batch = VERIFY_BATCH_SIZE, cursor } = await request.json();

    console.log(`🔍 Buscando descrições originais para verificação (batch: ${batch}, cursor: ${cursor})`);

    // Buscar descrições originais que precisam de verificação
    let query = supabase
      .schema('core')
      .from('attraction_descriptions')
      .select('id, description, attraction_id, description_hash')
      .eq('is_original', true)
      .limit(batch);

    // Se há cursor, continuar de onde parou
    if (cursor) {
      query = query.gt('id', cursor);
    }

    const { data: descriptions, error: fetchError } = await query;

    if (fetchError) {
      console.error('❌ Erro ao buscar descrições:', fetchError);
      return NextResponse.json(
        { error: 'Failed to fetch descriptions' },
        { status: 500 }
      );
    }

    if (!descriptions || descriptions.length === 0) {
      console.log('✅ Nenhuma descrição encontrada para verificação');
      return NextResponse.json({
        scheduled: 0,
        nextCursor: null,
        message: 'No descriptions found for verification'
      });
    }

    console.log(`📋 Encontradas ${descriptions.length} descrições para verificação`);

    // Verificar quais descrições já têm scores recentes
    const descriptionsToProcess = [];
    const processedDescriptions = [];

    for (const description of descriptions) {
      // Buscar o score mais recente para esta descrição
      const { data: latestScore } = await supabase
        .schema('core')
        .from('description_scores')
        .select('description_hash, created_at')
        .eq('description_id', description.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      // Se não há score ou o hash mudou, precisa processar
      if (!latestScore || latestScore.description_hash !== description.description_hash) {
        descriptionsToProcess.push(description);
      } else {
        processedDescriptions.push(description.id);
      }
    }

    console.log(`📊 ${descriptionsToProcess.length} descrições precisam de processamento`);
    console.log(`📊 ${processedDescriptions.length} descrições já estão atualizadas`);

    // Agendar processamento das descrições que precisam (sequencialmente para evitar timeout)
    const scheduledTasks = [];
    for (const description of descriptionsToProcess) {
      try {
        console.log(`🔄 Processando descrição ${description.id}...`);
        
        const { data, error } = await supabase.functions.invoke('verify-batch', {
          body: {
            description_id: description.id,
            description: description.description,
            attraction_id: description.attraction_id,
            force_reprocess: false
          }
        });

        if (error) {
          console.error(`❌ Erro ao processar ${description.id}:`, error);
          scheduledTasks.push({
            description_id: description.id,
            success: false,
            error: error.message
          });
        } else {
          console.log(`✅ Descrição ${description.id} processada com sucesso`);
          scheduledTasks.push({
            description_id: description.id,
            success: true,
            response: data
          });
        }

        // Aguardar 2 segundos entre processamentos para evitar rate limiting
        await new Promise(resolve => setTimeout(resolve, 2000));

      } catch (error) {
        console.error(`❌ Erro inesperado ao processar ${description.id}:`, error);
        scheduledTasks.push({
          description_id: description.id,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    // Determinar próximo cursor
    const nextCursor = descriptions.length > 0 ? descriptions[descriptions.length - 1].id : null;

    console.log(`✅ Processadas ${scheduledTasks.filter(t => t.success).length} descrições com sucesso`);

    return NextResponse.json({
      scheduled: scheduledTasks.filter(t => t.success).length,
      failed: scheduledTasks.filter(t => !t.success).length,
      nextCursor,
      total_found: descriptions.length,
      needs_processing: descriptionsToProcess.length,
      already_updated: processedDescriptions.length,
      tasks: scheduledTasks
    });

  } catch (error) {
    console.error('❌ Erro inesperado:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
