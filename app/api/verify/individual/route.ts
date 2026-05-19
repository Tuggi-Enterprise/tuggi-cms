import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '../../../../lib/core/supabase-client';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SECRET_KEY!;

const supabase = getSupabase('server');

export async function POST(request: NextRequest) {
  try {
    const { description_id } = await request.json();

    if (!description_id) {
      return NextResponse.json(
        { error: 'description_id is required' },
        { status: 400 }
      );
    }

    console.log(`🔄 Verificando descrição individual: ${description_id}`);

    // Buscar a descrição
    const { data: description, error: fetchError } = await supabase
      .schema('core')
      .from('attraction_descriptions')
      .select('id, description, attraction_id, is_original, language')
      .eq('id', description_id)
      .single();

    if (fetchError) {
      console.error('❌ Erro ao buscar descrição:', fetchError);
      return NextResponse.json(
        { error: 'Description not found' },
        { status: 404 }
      );
    }

    // Verificar se é original
    if (!description.is_original) {
      return NextResponse.json(
        { error: 'Only original descriptions can be verified' },
        { status: 400 }
      );
    }

    // Verificar se é pt-br
    if (description.language !== 'pt-br') {
      return NextResponse.json(
        { error: 'Only Portuguese descriptions can be verified' },
        { status: 400 }
      );
    }

    console.log(`✅ Descrição válida encontrada`);

    // Processar com retry automático para erro 429
    let data, error;
    let retryCount = 0;
    const maxRetries = 3;
    
    while (retryCount <= maxRetries) {
      const result = await supabase.functions.invoke('verify-batch', {
        body: {
          description_id: description.id,
          description: description.description,
          attraction_id: description.attraction_id,
          force_reprocess: true
        }
      });
      
      data = result.data;
      error = result.error;
      
      // Se não há erro ou não é 429, sair do loop
      if (!error || !error.message?.includes('429')) {
        break;
      }
      
      retryCount++;
      if (retryCount <= maxRetries) {
        const waitTime = Math.pow(2, retryCount) * 30000; // 30s, 1min, 2min
        console.log(`⏳ Erro 429 - aguardando ${waitTime/1000}s antes do retry ${retryCount}/${maxRetries}`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }

    if (error) {
      console.error(`❌ Erro após ${retryCount} tentativas:`, error);
      return NextResponse.json(
        { 
          error: 'Verification failed after retries',
          details: error.message,
          retries: retryCount
        },
        { status: 500 }
      );
    }

    console.log(`✅ Verificação concluída com sucesso`);

    return NextResponse.json({
      success: true,
      description_id: description.id,
      result: data,
      retries_used: retryCount
    });

  } catch (error) {
    console.error('❌ Erro inesperado:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
