import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

const VERIFY_BATCH_SIZE = parseInt(process.env.VERIFY_BATCH_SIZE || '20');

export async function POST(request: NextRequest) {
  try {
    const { batch = VERIFY_BATCH_SIZE, cursor } = await request.json();

    console.log(`🔍 Buscando ${batch} descrições que PRECISAM de verificação`);
    console.log(`🎯 ESTRATÉGIA: Buscar mais itens e filtrar eficientemente`);

    // Buscar um número maior de itens para garantir que encontremos suficientes processáveis
    const searchBatch = Math.max(batch * 3, 50); // Buscar 3x mais para filtrar
    
    let query = supabase
      .schema('core')
      .from('attraction_descriptions')
      .select(`
        id, 
        description, 
        attraction_id, 
        description_hash,
        verification_status,
        last_score_overall,
        last_verified_at,
        language
      `)
      .eq('is_original', true)
      .eq('language', 'pt-br')
      .neq('verification_status', 'approved') // Excluir aprovadas
      .limit(searchBatch)
      .order('updated_at', { ascending: false });

    if (cursor) {
      query = query.gt('id', cursor);
    }

    const { data: candidateDescriptions, error: fetchError } = await query;

    if (fetchError) {
      console.error('❌ Erro ao buscar descrições candidatas:', fetchError);
      return NextResponse.json(
        { error: 'Failed to fetch descriptions' },
        { status: 500 }
      );
    }

    if (!candidateDescriptions || candidateDescriptions.length === 0) {
      console.log('✅ Nenhuma descrição candidata encontrada');
      return NextResponse.json({
        scheduled: 0,
        nextCursor: null,
        message: 'No descriptions found for verification'
      });
    }

    console.log(`📋 Encontradas ${candidateDescriptions.length} descrições candidatas, filtrando...`);

    // Agora filtrar eficientemente para encontrar apenas as que precisam de processamento
    const descriptionsToProcess = [];
    const processedDescriptions = [];

    for (const description of candidateDescriptions) {
      // Parar quando atingir o batch desejado
      if (descriptionsToProcess.length >= batch) {
        break;
      }

      // Buscar o score mais recente
      const { data: latestScore } = await supabase
        .schema('core')
        .from('description_scores')
        .select('description_hash')
        .eq('description_id', description.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      // Determinar se precisa processar
      const needsProcessing = 
        !latestScore || // Sem score
        latestScore.description_hash !== description.description_hash || // Hash diferente
        !['rejected', 'needs_review'].includes(description.verification_status); // Não é rejected/needs_review

      if (needsProcessing) {
        descriptionsToProcess.push(description);
      } else {
        processedDescriptions.push(description.id);
      }
    }

    if (descriptionsToProcess.length === 0) {
      console.log('✅ Nenhuma descrição precisa de processamento após filtragem');
      return NextResponse.json({
        scheduled: 0,
        nextCursor: candidateDescriptions[candidateDescriptions.length - 1]?.id || null,
        message: 'No descriptions need processing'
      });
    }

    console.log(`📋 Encontradas ${descriptionsToProcess.length} descrições que PRECISAM de processamento`);
    
    // Categorizar por tipo (para logs)
    const priorityDescriptions = []; // Será preenchido durante processamento
    const updateDescriptions = []; // Será preenchido durante processamento

    console.log(`📊 ${descriptionsToProcess.length} descrições precisam de processamento`);
    console.log(`📊 ${processedDescriptions.length} descrições foram puladas (já processadas)`);
    console.log(`📈 Eficiência: ${candidateDescriptions.length} candidatas → ${descriptionsToProcess.length} processáveis`);

    // Processar todas as descrições encontradas (já filtradas pela query SQL)
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
    const nextCursor = candidateDescriptions.length > 0 ? candidateDescriptions[candidateDescriptions.length - 1].id : null;

    console.log(`✅ Processadas ${scheduledTasks.filter(t => t.success).length} descrições com sucesso`);

    return NextResponse.json({
      scheduled: scheduledTasks.filter(t => t.success).length,
      failed: scheduledTasks.filter(t => !t.success).length,
      nextCursor,
      total_candidates: candidateDescriptions.length,
      needs_processing: descriptionsToProcess.length,
      already_updated: processedDescriptions.length,
      efficiency: `${candidateDescriptions.length} → ${descriptionsToProcess.length}`,
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
