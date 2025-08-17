import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

export async function POST(request: NextRequest) {
  try {
    const { description_ids } = await request.json();

    if (!description_ids || !Array.isArray(description_ids) || description_ids.length === 0) {
      return NextResponse.json(
        { error: 'description_ids array is required' },
        { status: 400 }
      );
    }

    console.log(`🔄 Reprocessando ${description_ids.length} descrições...`);

    // Buscar as descrições especificadas
    const { data: descriptions, error: fetchError } = await supabase
      .schema('core')
      .from('attraction_descriptions')
      .select('id, description, attraction_id, is_original')
      .in('id', description_ids);

    if (fetchError) {
      console.error('❌ Erro ao buscar descrições:', fetchError);
      return NextResponse.json(
        { error: 'Failed to fetch descriptions' },
        { status: 500 }
      );
    }

    if (!descriptions || descriptions.length === 0) {
      return NextResponse.json(
        { error: 'No descriptions found' },
        { status: 404 }
      );
    }

    // Verificar se todas são originais
    const nonOriginalDescriptions = descriptions.filter(d => !d.is_original);
    if (nonOriginalDescriptions.length > 0) {
      return NextResponse.json(
        { 
          error: 'Some descriptions are not original',
          non_original_ids: nonOriginalDescriptions.map(d => d.id)
        },
        { status: 400 }
      );
    }

    console.log(`📋 Encontradas ${descriptions.length} descrições originais para reprocessar`);

    // Reprocessar cada descrição
    const results = [];
    for (const description of descriptions) {
      try {
        console.log(`🔄 Reprocessando descrição ${description.id}...`);
        
        const { data, error } = await supabase.functions.invoke('verify-batch', {
          body: {
            description_id: description.id,
            description: description.description,
            attraction_id: description.attraction_id,
            force_reprocess: true
          }
        });

        if (error) {
          console.error(`❌ Erro ao reprocessar ${description.id}:`, error);
          results.push({
            description_id: description.id,
            success: false,
            error: error.message
          });
        } else {
          console.log(`✅ Descrição ${description.id} reprocessada com sucesso`);
          results.push({
            description_id: description.id,
            success: true,
            response: data
          });
        }
      } catch (error) {
        console.error(`❌ Erro inesperado ao reprocessar ${description.id}:`, error);
        results.push({
          description_id: description.id,
          success: false,
          error: error.message
        });
      }
    }

    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    console.log(`✅ Reprocessamento concluído: ${successful} sucessos, ${failed} falhas`);

    return NextResponse.json({
      total: descriptions.length,
      successful,
      failed,
      results
    });

  } catch (error) {
    console.error('❌ Erro inesperado:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
