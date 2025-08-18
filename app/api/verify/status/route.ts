import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

export async function POST(request: NextRequest) {
  try {
    const { description_id, attraction_id } = await request.json();

    if (!description_id && !attraction_id) {
      return NextResponse.json(
        { error: 'Either description_id or attraction_id is required' },
        { status: 400 }
      );
    }

    let verificationData = null;

    if (description_id) {
      // Buscar por description_id específico
      const { data, error } = await supabase
        .schema('core')
        .from('attraction_descriptions')
        .select(`
          id,
          verification_status,
          last_verified_at,
          is_original,
          language,
          description_scores!inner(
            score_overall,
            subscores,
            flags,
            created_at
          )
        `)
        .eq('id', description_id)
        .single();

      if (!error && data) {
        const latestScore = data.description_scores
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];

        verificationData = {
          verification_status: data.verification_status,
          score: latestScore?.score_overall || null,
          last_verified_at: data.last_verified_at,
          is_original: data.is_original,
          language: data.language,
          subscores: latestScore?.subscores,
          flags: latestScore?.flags
        };
      }
    } else if (attraction_id) {
      // Buscar descrição original pt-br para a atração
      const { data, error } = await supabase
        .schema('core')
        .from('attraction_descriptions')
        .select(`
          id,
          verification_status,
          last_verified_at,
          is_original,
          language,
          description_scores(
            score_overall,
            subscores,
            flags,
            created_at
          )
        `)
        .eq('attraction_id', attraction_id)
        .eq('is_original', true)
        .eq('language', 'pt-br')
        .single();

      if (!error && data) {
        const latestScore = data.description_scores
          ?.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];

        verificationData = {
          verification_status: data.verification_status,
          score: latestScore?.score_overall || null,
          last_verified_at: data.last_verified_at,
          is_original: data.is_original,
          language: data.language,
          subscores: latestScore?.subscores,
          flags: latestScore?.flags,
          description_id: data.id
        };
      }
    }

    if (!verificationData) {
      return NextResponse.json({
        verification_status: null,
        score: null,
        last_verified_at: null,
        is_original: false,
        language: null
      });
    }

    return NextResponse.json(verificationData);

  } catch (error) {
    console.error('❌ Erro ao buscar status de verificação:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
