const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkScoresData() {
  console.log('🔍 VERIFICANDO DADOS NAS TABELAS');
  console.log('═══════════════════════════════════\n');

  try {
    // Verificar description_scores
    console.log('📊 Verificando description_scores...');
    const { data: scores, error: scoresError, count: scoresCount } = await supabase
      .schema('core')
      .from('description_scores')
      .select('*', { count: 'exact' })
      .limit(5);

    if (scoresError) {
      console.log('❌ Erro ao buscar scores:', scoresError);
    } else {
      console.log(`✅ Scores encontrados: ${scoresCount || 0}`);
      if (scores && scores.length > 0) {
        console.log('📋 Primeiros scores:');
        scores.forEach((score, i) => {
          console.log(`   ${i + 1}. Score: ${score.score_overall}%, Flags: ${score.flags?.join(', ') || 'Nenhuma'}`);
        });
      }
    }
    console.log('');

    // Verificar attractions
    console.log('🏛️ Verificando attractions...');
    const { data: attractions, error: attractionsError, count: attractionsCount } = await supabase
      .schema('core')
      .from('attractions')
      .select('*', { count: 'exact' })
      .limit(5);

    if (attractionsError) {
      console.log('❌ Erro ao buscar attractions:', attractionsError);
    } else {
      console.log(`✅ Attractions encontradas: ${attractionsCount || 0}`);
      if (attractions && attractions.length > 0) {
        console.log('📋 Primeiras attractions:');
        attractions.forEach((attraction, i) => {
          console.log(`   ${i + 1}. ${attraction.name} (${attraction.city}, ${attraction.country})`);
        });
      }
    }
    console.log('');

    // Verificar attraction_descriptions
    console.log('📝 Verificando attraction_descriptions...');
    const { data: descriptions, error: descriptionsError, count: descriptionsCount } = await supabase
      .schema('core')
      .from('attraction_descriptions')
      .select('*', { count: 'exact' })
      .eq('language', 'pt-br')
      .eq('is_original', true)
      .limit(5);

    if (descriptionsError) {
      console.log('❌ Erro ao buscar descriptions:', descriptionsError);
    } else {
      console.log(`✅ Descriptions encontradas: ${descriptionsCount || 0}`);
      if (descriptions && descriptions.length > 0) {
        console.log('📋 Primeiras descriptions:');
        descriptions.forEach((desc, i) => {
          console.log(`   ${i + 1}. ${desc.description.substring(0, 100)}...`);
        });
      }
    }
    console.log('');

    // Verificar se há dados relacionados
    if (scoresCount > 0 && attractionsCount > 0 && descriptionsCount > 0) {
      console.log('🔗 Verificando relacionamentos...');
      
      // Buscar um score com dados relacionados
      const { data: sampleScore, error: sampleError } = await supabase
        .schema('core')
        .from('description_scores')
        .select(`
          attraction_id,
          score_overall,
          flags,
          reasoning
        `)
        .limit(1)
        .single();

      if (sampleScore) {
        console.log('✅ Score de exemplo encontrado:');
        console.log(`   Attraction ID: ${sampleScore.attraction_id}`);
        console.log(`   Score: ${sampleScore.score_overall}%`);
        console.log(`   Flags: ${sampleScore.flags?.join(', ') || 'Nenhuma'}`);
        
        // Verificar se a atração existe
        const { data: relatedAttraction, error: relatedError } = await supabase
          .schema('core')
          .from('attractions')
          .select('name, city, country')
          .eq('id', sampleScore.attraction_id)
          .single();

        if (relatedAttraction) {
          console.log(`   Atração: ${relatedAttraction.name} (${relatedAttraction.city}, ${relatedAttraction.country})`);
        } else {
          console.log('   ⚠️ Atração não encontrada');
        }
      }
    }

  } catch (error) {
    console.error('❌ Erro geral:', error);
  }
}

// Executar verificação
checkScoresData().catch(console.error);
